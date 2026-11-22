// Attendee "My signups": no accounts. Enter your email → we email a one-time link → the page swaps it for a device session
// (60 days) that can list your signups and email-list memberships across every club, and cancel / unsubscribe.
import { cors, check, db, EMAIL, UUID } from '../_shared/guard.ts';
import { button, h, layout, sendAll } from '../_shared/bulk.ts';

const SITE = Deno.env.get('SITE_URL') ?? 'https://signmeupdaddy.com';
const LINK_MIN = 20, SESSION_DAYS = 60;

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const secret = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

async function sessionEmail(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 32 || token.length > 100) return null;
  const { data } = await db.from('member_sessions').select('email, expires_at').eq('token_hash', await sha(token)).eq('kind', 'session').maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.email;
}

Deno.serve(async (req) => {
  const { ok, reply, headers } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const action = String(b.action ?? '');

  // 1. ask for a sign-in link (always answers "check your email" so nobody can probe who has signed up)
  if (action === 'request') {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 120) return reply(400, { error: 'BAD_REQUEST' });
    const bad = await check(req, b, 'member', 2500, 8, 3600);
    if (bad) return reply(bad.status, { error: bad.code });
    const { data: per } = await db.rpc('hit_rate_limit', { p_key: 'member-email:' + await sha(email), p_limit: 3, p_window_secs: 3600 });
    if (!per) return reply(200, { ok: true });
    const [{ count: s }, { count: n }] = await Promise.all([
      db.from('signups').select('id', { count: 'exact', head: true }).ilike('email', esc(email)),
      db.from('subscribers').select('id', { count: 'exact', head: true }).ilike('email', esc(email)),
    ]);
    if (!s && !n) return reply(200, { ok: true });
    const token = secret();
    await db.from('member_sessions').delete().lt('expires_at', new Date().toISOString());
    const { error } = await db.from('member_sessions').insert({ token_hash: await sha(token), email, kind: 'link', expires_at: new Date(Date.now() + LINK_MIN * 60e3).toISOString() });
    if (error) return reply(500, { error: 'SERVER' });
    const url = `${SITE}/app/#/me/${token}`;
    try {
      await sendAll([{
        to: email, subject: 'Your signmeupdaddy sign-in link',
        text: `Open this link to see your signups across all clubs (works for ${LINK_MIN} minutes):\n${url}\n\nIf you didn't ask for this, ignore this email.`,
        html: layout('signmeupdaddy', `<h1 style="margin:0 0 12px;font-size:22px">See your signups</h1><p style="margin:0">Tap below to see everything you've signed up for, across every club. The link works for ${LINK_MIN} minutes.</p>${button(url, 'Show my signups')}`, "If you didn't ask for this, ignore this email."),
      }]);
    } catch { return reply(500, { error: 'MAIL_FAILED' }); }
    return reply(200, { ok: true });
  }

  // 2. swap the emailed link for a device session
  if (action === 'redeem') {
    const t = String(b.token ?? '');
    if (t.length < 32 || t.length > 100) return reply(400, { error: 'BAD_LINK' });
    const hash = await sha(t);
    const { data } = await db.from('member_sessions').select('email, expires_at').eq('token_hash', hash).eq('kind', 'link').maybeSingle();
    if (!data || new Date(data.expires_at).getTime() < Date.now()) return reply(400, { error: 'BAD_LINK' });
    await db.from('member_sessions').delete().eq('token_hash', hash);
    const session = secret();
    await db.from('member_sessions').insert({ token_hash: await sha(session), email: data.email, kind: 'session', expires_at: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
    return reply(200, { session, email: data.email });
  }

  // everything below needs a valid session
  const email = await sessionEmail(b.session);
  if (!email) return reply(401, { error: 'SESSION_EXPIRED' });

  if (action === 'list') {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const [su, sb] = await Promise.all([
      db.from('signups').select('id, status, guests, created_at, events!inner(id, title, starts_at, club_id, kind, published, clubs(name, accent))')
        .ilike('email', esc(email)).neq('status', 'cancelled').gte('events.starts_at', since).order('created_at', { ascending: false }).limit(300),
      db.from('subscribers').select('id, status, club_id, clubs(name, accent)').ilike('email', esc(email)).neq('status', 'unsubscribed'),
    ]);
    if (su.error || sb.error) return reply(500, { error: 'SERVER' });
    const signups = (su.data ?? []).map((r: any) => ({ id: r.id, status: r.status, guests: r.guests, event: { id: r.events.id, title: r.events.title, starts_at: r.events.starts_at, kind: r.events.kind, club_id: r.events.club_id, club_name: r.events.clubs?.name, accent: r.events.clubs?.accent } }));
    const lists = (sb.data ?? []).map((r: any) => ({ id: r.id, status: r.status, club_id: r.club_id, club_name: r.clubs?.name, accent: r.clubs?.accent }));
    return reply(200, { email, signups, lists });
  }

  if (action === 'cancel') {
    const id = String(b.signup_id ?? '');
    if (!UUID.test(id)) return reply(400, { error: 'BAD_REQUEST' });
    const { data: s } = await db.from('signups').select('cancel_token, email, events(starts_at)').eq('id', id).maybeSingle();
    if (!s || String(s.email).toLowerCase() !== email) return reply(404, { error: 'SIGNUP_NOT_FOUND' });
    if (new Date((s as any).events?.starts_at).getTime() < Date.now()) return reply(409, { error: 'EVENT_PAST' });
    const { error } = await db.rpc('cancel_signup', { p_token: s.cancel_token });
    if (error) return reply(500, { error: 'SERVER' });
    return reply(200, { ok: true });
  }

  if (action === 'unsubscribe') {
    const id = Number(b.list_id);
    const { data: s } = await db.from('subscribers').select('token, email').eq('id', id).maybeSingle();
    if (!s || String(s.email).toLowerCase() !== email) return reply(404, { error: 'BAD_REQUEST' });
    const { error } = await db.rpc('unsubscribe', { p_token: s.token });
    if (error) return reply(500, { error: 'SERVER' });
    return reply(200, { ok: true });
  }

  if (action === 'logout') {
    await db.from('member_sessions').delete().eq('token_hash', await sha(String(b.session)));
    return reply(200, { ok: true });
  }
  return reply(400, { error: 'BAD_REQUEST' });
});
