// Guards shared by the public write endpoints: CORS/origin allowlist, honeypot + fill time, Turnstile, per-IP rate limit.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://signmeupdaddy.com').split(',').map((s) => s.trim()).filter(Boolean);
const HOSTS = ORIGINS.map((o) => new URL(o).hostname);
const SECRET = Deno.env.get('TURNSTILE_SECRET') ?? '';
const SALT = Deno.env.get('RATE_SALT') ?? '';
export const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cors(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const ok = ORIGINS.includes(origin);
  const headers = {
    'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
  return { ok, headers, reply: (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers }) };
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';

// Returns an error code, or null when the request passes bot checks, Turnstile and the rate limit.
export async function check(req: Request, b: Record<string, unknown>, action: string, minFillMs: number, limit: number, windowSecs: number): Promise<{ code: string; status: number } | null> {
  if (b.website || typeof b.elapsed_ms !== 'number' || (b.elapsed_ms as number) < minFillMs) return { code: 'BOT_SUSPECTED', status: 400 };
  const ip = clientIp(req);
  if (!SECRET) return { code: 'CAPTCHA_NOT_CONFIGURED', status: 500 };
  const form = new FormData();
  form.append('secret', SECRET); form.append('response', String(b.captcha ?? ''));
  if (ip) form.append('remoteip', ip);
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ success: false }));
  if (!v.success || v.action !== action || !HOSTS.includes(v.hostname)) return { code: 'CAPTCHA_FAILED', status: 400 };
  const { data: allowed, error } = await db.rpc('hit_rate_limit', { p_key: `${action}:` + (await sha256(SALT + ip)), p_limit: limit, p_window_secs: windowSecs });
  if (error) return { code: 'SERVER', status: 500 };
  if (!allowed) return { code: 'RATE_LIMITED', status: 429 };
  return null;
}
