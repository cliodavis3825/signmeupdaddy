// Organizer-triggered email. The caller's own session (JWT) is checked against club_admins, which only returns a row
// for a signed-in organizer who has passed MFA (RLS: user_id = auth.uid() AND has_mfa()).
//   { kind: 'announce', event_id }  → email the club's confirmed email list about this event (max once per hour)
//   { kind: 'update',   post_id  }  → email everyone signed up (or waitlisted) for the event with this update (once per post)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, db, UUID } from '../_shared/guard.ts';
import { appUrl, button, h, layout, sendAll, unsubFooter, type Msg } from '../_shared/bulk.ts';

const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const mailErr = (x: unknown) => (String((x as Error).message) === 'MAIL_NOT_CONFIGURED' ? 'MAIL_NOT_CONFIGURED' : 'MAIL_FAILED');

Deno.serve(async (req) => {
  const { ok, reply, headers } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const kind = String(b.kind ?? '');

  const auth = req.headers.get('authorization') ?? '';
  const me = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const isAdmin = async (club: string) => ((await me.from('club_admins').select('club_id').eq('club_id', club)).data ?? []).length > 0;

  if (kind === 'announce') {
    const id = String(b.event_id ?? '');
    if (!UUID.test(id)) return reply(400, { error: 'BAD_REQUEST' });
    const { data: e } = await db.from('events').select('*, clubs(name, timezone, contact_email)').eq('id', id).maybeSingle();
    if (!e) return reply(404, { error: 'EVENT_NOT_FOUND' });
    if (!(await isAdmin(e.club_id))) return reply(403, { error: 'NOT_ADMIN' });
    if (!e.published) return reply(409, { error: 'NOT_PUBLISHED' });
    if (new Date(e.starts_at) < new Date()) return reply(409, { error: 'EVENT_PAST' });
    if (e.announced_at && Date.now() - new Date(e.announced_at).getTime() < 3600e3) return reply(409, { error: 'TOO_SOON' });

    const { data: subs } = await db.from('subscribers').select('email, token').eq('club_id', e.club_id).eq('status', 'active');
    if (!subs?.length) return reply(200, { sent: 0 });
    const url = appUrl(e.club_id, `#/e/${e.id}`);
    const when = fmt(e.starts_at, e.clubs.timezone);
    const desc = String(e.description ?? '').slice(0, 600);
    const msgs: Msg[] = subs.map((s) => {
      const u = unsubFooter(e.club_id, s.token, `You're getting this because you joined the ${e.clubs.name} email list.`);
      return {
        to: s.email, subject: `${e.title}: ${when}`,
        headers: { 'List-Unsubscribe': `<${u.url}>` }, reply_to: e.clubs.contact_email || undefined,
        text: `${e.title}\n${when}${e.location ? `\n${e.location}` : ''}\n\n${desc}\n\nDetails and signup: ${url}\n\n${u.text}`,
        html: layout(e.clubs.name,
          `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.2">${h(e.title)}</h1>
<p style="margin:0 0 4px;color:#6b635b">${h(when)}</p>${e.location ? `<p style="margin:0 0 12px;color:#6b635b">${h(e.location)}</p>` : ''}
${desc ? `<p style="margin:0 0 8px">${h(desc).replace(/\n/g, '<br>')}</p>` : ''}${button(url, 'See details & sign up')}`, u.html),
      };
    });
    try { const sent = await sendAll(msgs); await db.from('events').update({ announced_at: new Date().toISOString() }).eq('id', id); return reply(200, { sent }); }
    catch (x) { return reply(500, { error: mailErr(x) }); }
  }

  if (kind === 'update') {
    const pid = Number(b.post_id);
    if (!Number.isInteger(pid)) return reply(400, { error: 'BAD_REQUEST' });
    const { data: p } = await db.from('event_posts').select('*, events(*, clubs(name, timezone, contact_email))').eq('id', pid).maybeSingle();
    if (!p || p.kind !== 'update') return reply(404, { error: 'EVENT_NOT_FOUND' });
    const e = p.events;
    if (!(await isAdmin(e.club_id))) return reply(403, { error: 'NOT_ADMIN' });
    if (p.emailed_at) return reply(409, { error: 'ALREADY_SENT' });

    const { data: rows } = await db.from('signups').select('email, name, cancel_token').eq('event_id', e.id).in('status', ['confirmed', 'waitlist']);
    if (!rows?.length) return reply(200, { sent: 0 });
    const url = appUrl(e.club_id, `#/e/${e.id}`);
    const when = fmt(e.starts_at, e.clubs.timezone);
    const msgs: Msg[] = rows.map((r) => {
      const manage = appUrl(e.club_id, `#/cancel/${r.cancel_token}`);
      return {
        to: r.email, subject: `Update: ${e.title}`, reply_to: e.clubs.contact_email || undefined,
        text: `Update for ${e.title} (${when}):\n\n${p.body}\n\nEvent page: ${url}\nCan't make it now? ${manage}`,
        html: layout(e.clubs.name,
          `<h1 style="margin:0 0 4px;font-size:20px;line-height:1.2">Update: ${h(e.title)}</h1>
<p style="margin:0 0 12px;color:#6b635b">${h(when)}</p>
<p style="margin:0 0 8px;white-space:pre-wrap">${h(p.body)}</p>${button(url, 'Event page')}
<p style="margin:0;font-size:14px"><a href="${h(manage)}" style="color:#c2412d">Can't make it now? Release my spot</a></p>`,
          `You're getting this because you signed up for this event.`),
      };
    });
    try { const sent = await sendAll(msgs); await db.from('event_posts').update({ emailed_at: new Date().toISOString() }).eq('id', pid); return reply(200, { sent }); }
    catch (x) { return reply(500, { error: mailErr(x) }); }
  }
  return reply(400, { error: 'BAD_REQUEST' });
});
