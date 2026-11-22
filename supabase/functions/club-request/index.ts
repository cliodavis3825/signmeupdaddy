// signmeupdaddy — "start a club" requests (Supabase Edge Function, Deno).
// Same guards as the signup function: origin allowlist, honeypot + fill time, Turnstile, per-IP rate limit.
// Requests are stored in public.club_requests (review them in the Table Editor); an approved request becomes a
// row in clubs + club_admins by hand. If NOTIFY_EMAIL (and RESEND_API_KEY/MAIL_FROM) are set, you also get an email.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://signmeupdaddy.com').split(',').map((s) => s.trim()).filter(Boolean);
const HOSTS = ORIGINS.map((o) => new URL(o).hostname);
const SECRET = Deno.env.get('TURNSTILE_SECRET') ?? '';
const SALT = Deno.env.get('RATE_SALT') ?? '';
const NOTIFY = Deno.env.get('NOTIFY_EMAIL') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('MAIL_FROM') ?? 'signmeupdaddy <hello@signmeupdaddy.com>';
const LIMIT_PER_DAY = 3;
const MIN_FILL_MS = 4000;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

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

  const club_name = String(b.club_name ?? '').trim();
  const contact = String(b.contact ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const place = String(b.place ?? '').trim().slice(0, 80);
  const about = String(b.about ?? '').trim().slice(0, 600);
  const token = String(b.captcha ?? '');

  if (b.website || typeof b.elapsed_ms !== 'number' || (b.elapsed_ms as number) < MIN_FILL_MS) return reply(400, { error: 'BOT_SUSPECTED' });
  if (club_name.length < 2 || club_name.length > 80 || !contact || contact.length > 80 || !EMAIL.test(email) || email.length > 120) return reply(400, { error: 'BAD_REQUEST' });

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';

  if (!SECRET) return reply(500, { error: 'CAPTCHA_NOT_CONFIGURED' });
  const form = new FormData();
  form.append('secret', SECRET); form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    .then((r) => r.json()).catch(() => ({ success: false }));
  if (!v.success || v.action !== 'club-request' || !HOSTS.includes(v.hostname)) return reply(400, { error: 'CAPTCHA_FAILED' });

  const key = 'club-request:' + (await sha256(SALT + ip));
  const { data: allowed, error: rlErr } = await db.rpc('hit_rate_limit', { p_key: key, p_limit: LIMIT_PER_DAY, p_window_secs: 86400 });
  if (rlErr) return reply(500, { error: 'SERVER' });
  if (!allowed) return reply(429, { error: 'RATE_LIMITED' });

  const { error } = await db.from('club_requests').insert({ club_name, contact, email, place: place || null, about: about || null });
  if (error) return reply(500, { error: 'SERVER' });

  // Optional heads-up email to the site owner. Never fail the request over it.
  if (NOTIFY && RESEND_KEY) {
    try {
      await Promise.race([
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: [NOTIFY], reply_to: email,
            subject: `New club request: ${club_name}`,
            html: `<p><b>${esc(club_name)}</b>${place ? ` (${esc(place)})` : ''}</p><p>From: ${esc(contact)} &lt;${esc(email)}&gt;</p><p>${esc(about)}</p><p>Review it in Supabase → Table Editor → club_requests.</p>`,
          }),
        }),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    } catch { /* stored anyway */ }
  }
  return reply(200, { ok: true });
});
