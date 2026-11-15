// signmeupdaddy — public signup endpoint (Supabase Edge Function, Deno).
//
// The browser can no longer call sign_up() directly. Every signup comes through here:
//   1. origin allowlist        5. per-IP rate limit (salted hash, never stores raw IPs)
//   2. honeypot + fill time    6. sign_up() with the service role (capacity/waitlist/dupes)
//   3. input validation        7. confirmation email sent immediately (outbox; cron retries)
//   4. Cloudflare Turnstile siteverify (action + hostname checked)
//
// Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   TURNSTILE_SECRET   Turnstile widget secret key
//   ALLOWED_ORIGINS    comma list, e.g. https://signmeupdaddy.com,https://www.signmeupdaddy.com
//   RATE_SALT          any long random string
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { drainOutbox } from '../_shared/mailer.ts';

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://signmeupdaddy.com').split(',').map((s) => s.trim()).filter(Boolean);
const HOSTS = ORIGINS.map((o) => new URL(o).hostname);
const SECRET = Deno.env.get('TURNSTILE_SECRET') ?? '';
const SALT = Deno.env.get('RATE_SALT') ?? '';
const LIMIT_PER_HOUR = 10;
const MIN_FILL_MS = 2500;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KNOWN = ['EVENT_NOT_FOUND', 'EVENT_PAST', 'EVENT_FULL', 'ALREADY_SIGNED_UP', 'TOO_MANY_GUESTS'];

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const okOrigin = ORIGINS.includes(origin);
  const headers = {
    'Access-Control-Allow-Origin': okOrigin ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!okOrigin) return reply(403, { error: 'BAD_ORIGIN' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }

  const event_id = String(b.event_id ?? '');
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const guests = Number(b.guests ?? 0);
  const note = String(b.note ?? '').slice(0, 500);
  const token = String(b.captcha ?? '');
  const skill = ['new', 'learning', 'experienced'].includes(String(b.skill)) ? String(b.skill) : null;
  const bringsGear = b.brings_gear === true;

  // Bots: filled the hidden field, or submitted faster than a person can type.
  if (b.website || typeof b.elapsed_ms !== 'number' || (b.elapsed_ms as number) < MIN_FILL_MS) return reply(400, { error: 'BOT_SUSPECTED' });
  if (!UUID.test(event_id) || !name || name.length > 80 || !EMAIL.test(email) || email.length > 120
      || !Number.isInteger(guests) || guests < 0 || guests > 10) return reply(400, { error: 'BAD_REQUEST' });

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';

  // Turnstile: single-use token, must come from our widget action on our hostname.
  if (!SECRET) return reply(500, { error: 'CAPTCHA_NOT_CONFIGURED' });
  const form = new FormData();
  form.append('secret', SECRET); form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    .then((r) => r.json()).catch(() => ({ success: false }));
  if (!v.success || v.action !== 'signup' || !HOSTS.includes(v.hostname)) return reply(400, { error: 'CAPTCHA_FAILED' });

  // Rate limit per IP (hashed with a secret salt; raw IPs are never stored).
  const key = 'signup:' + (await sha256(SALT + ip));
  const { data: allowed, error: rlErr } = await db.rpc('hit_rate_limit', { p_key: key, p_limit: LIMIT_PER_HOUR, p_window_secs: 3600 });
  if (rlErr) return reply(500, { error: 'SERVER' });
  if (!allowed) return reply(429, { error: 'RATE_LIMITED' });

  const { data, error } = await db.rpc('sign_up', {
    p_event: event_id, p_name: name, p_email: email, p_guests: guests, p_note: note, p_skill: skill, p_brings_gear: bringsGear,
  });
  if (error) {
    const code = KNOWN.find((k) => error.message.includes(k));
    return reply(code ? 409 : 500, { error: code ?? 'SERVER' });
  }
  // Send the confirmation now rather than waiting for the next cron run. Never fail the signup over email.
  try { await Promise.race([drainOutbox(db, 5), new Promise((r) => setTimeout(r, 4000))]); } catch { /* cron retries */ }
  return reply(200, data[0]);
});
