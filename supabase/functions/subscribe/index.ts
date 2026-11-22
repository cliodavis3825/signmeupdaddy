// Join a club's email list (double opt-in). Public endpoint: origin allowlist, honeypot, Turnstile, rate limit.
// Sends a confirmation email; the person is only added to the list once they click the link (confirm_subscription RPC).
import { cors, check, db, EMAIL } from '../_shared/guard.ts';
import { appUrl, button, h, layout, sendAll } from '../_shared/bulk.ts';

Deno.serve(async (req) => {
  const { ok, reply } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req).headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const club = String(b.club_id ?? '').toLowerCase();
  const email = String(b.email ?? '').trim().toLowerCase();
  const name = String(b.name ?? '').trim().slice(0, 80) || null;
  if (!/^[a-z0-9-]{2,40}$/.test(club) || !EMAIL.test(email) || email.length > 120) return reply(400, { error: 'BAD_REQUEST' });

  const bad = await check(req, b, 'subscribe', 2500, 8, 3600);
  if (bad) return reply(bad.status, { error: bad.code });

  const { data: c } = await db.from('clubs').select('id, name').eq('id', club).maybeSingle();
  if (!c) return reply(404, { error: 'BAD_REQUEST' });

  const { data: ex } = await db.from('subscribers').select('id, status, requested_at').eq('club_id', club).ilike('email', email).maybeSingle();
  // Always answer "check your email" so nobody can probe who is on a list.
  if (ex?.status === 'active') return reply(200, { ok: true });
  if (ex?.status === 'pending' && Date.now() - new Date(ex.requested_at).getTime() < 5 * 60e3) return reply(200, { ok: true });

  const token = crypto.randomUUID();
  const row = { status: 'pending', token, name, requested_at: new Date().toISOString() };
  const { error } = ex
    ? await db.from('subscribers').update(row).eq('id', ex.id)
    : await db.from('subscribers').insert({ club_id: club, email, ...row });
  if (error) return reply(500, { error: 'SERVER' });

  const url = appUrl(club, `#/list/confirm/${token}`);
  try {
    await sendAll([{
      to: email,
      subject: `Confirm your spot on the ${c.name} email list`,
      text: `Tap to confirm you want event emails from ${c.name}:\n${url}\n\nIf this wasn't you, ignore this email and nothing will happen.`,
      html: layout(c.name,
        `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.2">One tap to confirm</h1>
<p style="margin:0">Confirm that you'd like to hear about upcoming ${h(c.name)} events by email.</p>${button(url, 'Yes, keep me posted')}`,
        'If this wasn\'t you, ignore this email and nothing will happen.'),
    }]);
  } catch { return reply(500, { error: 'MAIL_FAILED' }); }
  return reply(200, { ok: true });
});
