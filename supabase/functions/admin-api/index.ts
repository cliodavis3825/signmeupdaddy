// Privileged admin actions that RLS alone can't do: invite people to the email list (double opt-in kept),
// grant / revoke organizer access, approve new-club requests. Caller must be signed in with MFA (aal2).
import { cors, db, EMAIL } from '../_shared/guard.ts';
import { appUrl, button, h, layout, sendAll } from '../_shared/bulk.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = Deno.env.get('SITE_URL') ?? 'https://signmeupdaddy.com';
const SLUG = /^[a-z0-9-]{2,40}$/;

function aal(jwt: string): string {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? ''; } catch { return ''; }
}
async function audit(actor: string, action: string, club: string | null, changes: unknown) {
  await db.from('audit_log').insert({ actor, aal: 'aal2', action, tbl: 'club_admins', club_id: club, changes });
}

Deno.serve(async (req) => {
  const { ok, reply, headers } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await uc.auth.getUser(jwt);
  const me = u?.user;
  if (!me) return reply(401, { error: 'NOT_SIGNED_IN' });
  if (aal(jwt) !== 'aal2') return reply(403, { error: 'MFA_REQUIRED' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const action = String(b.action ?? '');
  const club = String(b.club_id ?? '').toLowerCase();

  const { data: sa } = await db.from('site_admins').select('user_id').eq('user_id', me.id).maybeSingle();
  const isSite = !!sa;
  const { data: mine } = club ? await db.from('club_admins').select('role').eq('club_id', club).eq('user_id', me.id).maybeSingle() : { data: null };
  const isOwner = isSite || mine?.role === 'owner';
  const isAdmin = isSite || !!mine;

  try {
    // ── invite people to the email list: they get a confirmation email and only join once they click it ──
    if (action === 'invite_to_list') {
      if (!isAdmin) return reply(403, { error: 'FORBIDDEN' });
      const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x) && x.length <= 120))].slice(0, 50);
      if (!emails.length) return reply(400, { error: 'BAD_REQUEST' });
      const { data: c } = await db.from('clubs').select('id, name').eq('id', club).maybeSingle();
      if (!c) return reply(404, { error: 'BAD_REQUEST' });
      const msgs = []; let skipped = 0;
      for (const email of emails) {
        const { data: ex } = await db.from('subscribers').select('id, status').eq('club_id', club).ilike('email', email).maybeSingle();
        if (ex?.status === 'active') { skipped++; continue; }
        const token = crypto.randomUUID();
        const row = { status: 'pending', token, requested_at: new Date().toISOString() };
        const { error } = ex ? await db.from('subscribers').update(row).eq('id', ex.id) : await db.from('subscribers').insert({ club_id: club, email, ...row });
        if (error) { skipped++; continue; }
        const url = appUrl(club, `#/list/confirm/${token}`);
        msgs.push({
          to: email, subject: `Confirm your spot on the ${c.name} email list`,
          text: `${c.name} added your email to its event list. Tap to confirm you want these emails:\n${url}\n\nIf you don't, ignore this email and nothing will happen.`,
          html: layout(c.name, `<h1 style="margin:0 0 12px;font-size:22px">One tap to confirm</h1><p style="margin:0">${h(c.name)} would like to email you about upcoming events.</p>${button(url, 'Yes, keep me posted')}`, "If you don't want these, ignore this email and nothing will happen."),
        });
      }
      if (msgs.length) await sendAll(msgs);
      await audit(me.id, 'INVITE_LIST', club, { sent: msgs.length, skipped });
      return reply(200, { ok: true, sent: msgs.length, skipped });
    }

    // ── grant access ──
    if (action === 'grant') {
      if (!isOwner) return reply(403, { error: 'FORBIDDEN' });
      const email = String(b.email ?? '').trim().toLowerCase();
      const role = b.role === 'owner' ? 'owner' : 'organizer';
      if (!EMAIL.test(email) || email.length > 120 || !SLUG.test(club)) return reply(400, { error: 'BAD_REQUEST' });
      const { data: c } = await db.from('clubs').select('id, name').eq('id', club).maybeSingle();
      if (!c) return reply(404, { error: 'BAD_REQUEST' });
      let { data: uid } = await db.rpc('find_user', { p_email: email });
      if (!uid) {
        const { data: made, error } = await db.auth.admin.createUser({ email, email_confirm: true });
        if (error || !made.user) return reply(500, { error: 'SERVER' });
        uid = made.user.id;
      }
      const { error } = await db.from('club_admins').upsert({ club_id: club, user_id: uid, role, email }, { onConflict: 'club_id,user_id' });
      if (error) return reply(500, { error: 'SERVER' });
      await audit(me.id, 'GRANT', club, { email, role });
      const url = appUrl(club, '#/admin');
      let mailed = true;
      try {
        await sendAll([{
          to: email, subject: `You can now manage ${c.name} events`,
          text: `You've been added as ${role === 'owner' ? 'an owner' : 'an organizer'} for ${c.name}.\n\n1. Go to ${url}\n2. Enter this email address and use the 6-digit code we email you.\n3. The first time, set up an authenticator app when asked.\n`,
          html: layout(c.name, `<h1 style="margin:0 0 12px;font-size:22px">You're in</h1><p style="margin:0 0 8px">You've been added as ${role === 'owner' ? 'an owner' : 'an organizer'} for ${h(c.name)}.</p><ol style="margin:0;padding-left:20px"><li>Open the admin page below.</li><li>Enter this email address and the 6-digit code we email you.</li><li>The first time, set up an authenticator app when asked.</li></ol>${button(url, 'Open the admin page')}`, `Not expecting this? You can ignore it. Questions: ${h(SITE)}`),
        }]);
      } catch { mailed = false; }
      return reply(200, { ok: true, mailed });
    }

    // ── revoke access ──
    if (action === 'revoke') {
      if (!isOwner) return reply(403, { error: 'FORBIDDEN' });
      const uid = String(b.user_id ?? '');
      const { data: rows } = await db.from('club_admins').select('user_id, role, email').eq('club_id', club);
      const target = rows?.find((r) => r.user_id === uid);
      if (!target) return reply(404, { error: 'BAD_REQUEST' });
      if (target.role === 'owner' && rows!.filter((r) => r.role === 'owner').length < 2 && !isSite) return reply(409, { error: 'LAST_OWNER' });
      const { error } = await db.from('club_admins').delete().eq('club_id', club).eq('user_id', uid);
      if (error) return reply(500, { error: 'SERVER' });
      await audit(me.id, 'REVOKE', club, { email: target.email, role: target.role });
      return reply(200, { ok: true });
    }

    // ── approve a new-club request (site owner) ──
    if (action === 'approve_request') {
      if (!isSite) return reply(403, { error: 'FORBIDDEN' });
      const id = String(b.request_id ?? '');
      if (!SLUG.test(club)) return reply(400, { error: 'BAD_SLUG' });
      const { data: r } = await db.from('club_requests').select('*').eq('id', id).maybeSingle();
      if (!r) return reply(404, { error: 'BAD_REQUEST' });
      const email = String(r.email ?? '').toLowerCase();
      if (!EMAIL.test(email)) return reply(400, { error: 'BAD_REQUEST' });
      const { data: taken } = await db.from('clubs').select('id').eq('id', club).maybeSingle();
      if (taken) return reply(409, { error: 'SLUG_TAKEN' });
      const name = String(r.club_name ?? club).slice(0, 80);
      const { error: ce } = await db.from('clubs').insert({ id: club, name, tagline: r.about ? String(r.about).slice(0, 140) : null });
      if (ce) return reply(500, { error: 'SERVER' });
      let { data: uid } = await db.rpc('find_user', { p_email: email });
      if (!uid) { const { data: made } = await db.auth.admin.createUser({ email, email_confirm: true }); uid = made?.user?.id; }
      if (uid) await db.from('club_admins').upsert({ club_id: club, user_id: uid, role: 'owner', email }, { onConflict: 'club_id,user_id' });
      await db.from('club_requests').update({ status: 'approved' }).eq('id', id);
      await audit(me.id, 'APPROVE_CLUB', club, { request: id, owner: email });
      let mailed = true;
      try {
        const url = appUrl(club, '#/admin');
        await sendAll([{ to: email, subject: `${name} is live on signmeupdaddy`, text: `Your club is approved. Sign in to manage it: ${url}\nUse your email and the 6-digit code we send, then set up an authenticator app.`,
          html: layout(name, `<h1 style="margin:0 0 12px;font-size:22px">${h(name)} is live</h1><p style="margin:0">Sign in with this email address and the 6-digit code we send you, then set up an authenticator app.</p>${button(url, 'Open your admin page')}`, '') }]);
      } catch { mailed = false; }
      return reply(200, { ok: true, mailed });
    }
    return reply(400, { error: 'BAD_REQUEST' });
  } catch (e) {
    return reply(500, { error: String((e as Error).message) === 'MAIL_NOT_CONFIGURED' ? 'MAIL_NOT_CONFIGURED' : 'MAIL_FAILED' });
  }
});
