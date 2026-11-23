// Monthly newsletter, zine style. Organizer-only (caller's session must pass is_club_admin = signed in + MFA).
//   { action: 'render', id } → { html }             (for the in-page preview)
//   { action: 'test',   id } → email it to the caller only
//   { action: 'send',   id } → email every confirmed subscriber (once per issue; at most one issue per club per day)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, db } from '../_shared/guard.ts';
import { appUrl, h, sendAll, type Msg } from '../_shared/bulk.ts';

const INK = '#1a1a1a', PAPER = '#f3ecd8', CARD = '#fffaf0', RED = '#c9402d', TEAL = '#1f6f6b', GOLD = '#f2c230';
const HEAD = "'Arial Black','Helvetica Neue',Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";
const BODY = "Georgia,'Times New Roman',serif";

type Section = { heading: string; body: string };
const clean = (x: unknown, n: number) => String(x ?? '').replace(/\r/g, '').slice(0, n);

// Plain text → paragraphs + line breaks + clickable links (escaped first, so nothing organizer-typed can inject HTML).
function rich(text: string): string {
  return h(text).trim().split(/\n{2,}/).map((p) => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>')
    .replace(/https?:\/\/[^\s<]+/g, (u) => { const m = u.match(/[.,;:!?)]+$/); const tail = m ? m[0] : ''; const url = tail ? u.slice(0, -tail.length) : u;
      return `<a href="${url}" style="color:${TEAL}">${url}</a>${tail}`; }) + '</p>').join('');
}
const plain = (text: string) => text.trim();

function sectionsOf(raw: unknown): Section[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 8).map((s) => ({ heading: clean((s as Section)?.heading, 80).trim(), body: clean((s as Section)?.body, 3000).trim() })).filter((s) => s.heading || s.body);
}

const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function buildEmail(o: { club: string; issueNo: number; title: string; intro: string; sections: Section[]; events: { title: string; when: string; location: string | null; url: string }[] | null; monthYear: string; unsubUrl: string; siteUrl: string }) {
  const tag = (t: string) => `<span style="display:inline-block;background:${GOLD};border:2px solid ${INK};padding:2px 8px;font:700 11px ${MONO};letter-spacing:1px;text-transform:uppercase">${h(t)}</span>`;
  const hr = `<div style="border-top:3px dashed ${INK};margin:26px 0"></div>`;
  const heading = (t: string) => `<h2 style="margin:0 0 12px;font:900 20px/1.2 ${HEAD};text-transform:uppercase"><span style="background:${INK};color:${PAPER};padding:1px 8px">${h(t)}</span></h2>`;
  const blocks: string[] = [];
  if (o.intro.trim()) blocks.push(`<div style="font:17px/1.6 ${BODY}">${rich(o.intro)}</div>`);
  if (o.events) {
    const list = o.events.length
      ? o.events.map((e) => `<div style="border-left:5px solid ${RED};background:${CARD};padding:8px 12px;margin:0 0 10px"><div style="font:700 12px ${MONO};text-transform:uppercase;color:${RED}">${h(e.when)}</div><a href="${h(e.url)}" style="font:900 17px ${HEAD};color:${INK};text-decoration:none">${h(e.title)}</a>${e.location ? `<div style="font:14px ${BODY};color:#555">${h(e.location)}</div>` : ''}</div>`).join('')
      : `<p style="margin:0;font:16px ${BODY}">Nothing on the calendar yet. Check back soon.</p>`;
    blocks.push(heading('Coming up') + list + `<p style="margin:12px 0 0"><a href="${h(o.siteUrl)}" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;font:700 14px ${MONO};text-transform:uppercase;padding:10px 16px;border-right:4px solid ${RED};border-bottom:4px solid ${RED}">See the calendar &amp; sign up</a></p>`);
  }
  for (const s of o.sections) blocks.push((s.heading ? heading(s.heading) : '') + (s.body ? `<div style="font:16px/1.6 ${BODY}">${rich(s.body)}</div>` : ''));

  const html = `<!doctype html><html><body style="margin:0;background:${PAPER};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:3px solid ${INK};background:#fff"><tr><td style="padding:0">
  <div style="padding:22px 24px 12px;border-bottom:3px solid ${INK};background:${PAPER}">
    <div style="font:900 34px/1 ${HEAD};text-transform:uppercase;letter-spacing:-1px">${h(o.club)}</div>
    <div style="margin-top:10px">${tag(`Issue ${o.issueNo}`)} ${tag(o.monthYear)}</div>
  </div>
  <div style="padding:24px">
    ${o.title ? `<h1 style="margin:0 0 18px;font:900 28px/1.1 ${HEAD}">${h(o.title)}</h1>` : ''}
    ${blocks.join(hr)}
  </div>
  <div style="border-top:3px solid ${INK};background:${PAPER};padding:14px 24px;font:12px/1.5 ${MONO};color:#444">
    You're getting this because you joined the ${h(o.club)} email list. <a href="${h(o.unsubUrl)}" style="color:#444">Unsubscribe</a>
  </div>
</td></tr></table></td></tr></table></body></html>`;

  const text = [`${o.club.toUpperCase()}  ·  Issue ${o.issueNo}  ·  ${o.monthYear}`, o.title ? `\n${o.title}` : '', o.intro.trim() ? `\n${plain(o.intro)}` : '',
    o.events ? `\nCOMING UP\n` + (o.events.length ? o.events.map((e) => `- ${e.when}: ${e.title}${e.location ? ` (${e.location})` : ''}\n  ${e.url}`).join('\n') : 'Nothing on the calendar yet.') + `\nSee the calendar & sign up: ${o.siteUrl}` : '',
    ...o.sections.map((s) => `\n${s.heading.toUpperCase()}\n${plain(s.body)}`), `\n--\nUnsubscribe: ${o.unsubUrl}`].filter(Boolean).join('\n');
  return { html, text };
}

Deno.serve(async (req) => {
  const { ok, reply, headers } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const action = String(b.action ?? ''); const id = Number(b.id);
  if (!['render', 'test', 'send'].includes(action) || !Number.isInteger(id)) return reply(400, { error: 'BAD_REQUEST' });

  const auth = req.headers.get('authorization') ?? '';
  const me = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: n } = await db.from('newsletters').select('*, clubs(name, timezone)').eq('id', id).maybeSingle();
  if (!n) return reply(404, { error: 'BAD_REQUEST' });
  const { data: isAdmin } = await me.rpc('is_club_admin', { p_club: n.club_id });
  if (!isAdmin) return reply(403, { error: 'NOT_ADMIN' });

  const tz = n.clubs.timezone || 'America/New_York';
  const sections = sectionsOf(n.sections);
  if (action !== 'render' && (!n.subject.trim() || (!n.intro.trim() && !sections.length && !n.include_events))) return reply(409, { error: 'NEWS_EMPTY' });
  let events: { title: string; when: string; location: string | null; url: string }[] | null = null;
  if (n.include_events) {
    const { data: ev } = await db.from('events').select('id, title, starts_at, location').eq('club_id', n.club_id).eq('published', true)
      .gte('starts_at', new Date().toISOString()).lte('starts_at', new Date(Date.now() + 45 * 864e5).toISOString()).order('starts_at').limit(20);
    events = (ev ?? []).map((e) => ({ title: e.title, when: fmt(e.starts_at, tz), location: e.location, url: appUrl(n.club_id, `#/e/${e.id}`) }));
  }
  const issueNo = n.issue_no ?? (((await db.from('newsletters').select('id', { count: 'exact', head: true }).eq('club_id', n.club_id).eq('status', 'sent')).count ?? 0) + 1);
  const monthYear = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' }).format(new Date());
  const build = (unsubUrl: string) => buildEmail({ club: n.clubs.name, issueNo, title: n.issue_title, intro: n.intro, sections, events, monthYear, unsubUrl, siteUrl: appUrl(n.club_id, '') });

  if (action === 'render') return reply(200, { html: build('#').html });

  if (action === 'test') {
    const { data: u } = await me.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    const to = u?.user?.email; if (!to) return reply(401, { error: 'NOT_SIGNED_IN' });
    const e = build(appUrl(n.club_id, '#/'));
    try { await sendAll([{ to, subject: `[TEST] ${n.subject}`, html: e.html, text: e.text }]); return reply(200, { sent: 1, to }); }
    catch (x) { return reply(500, { error: String((x as Error).message) === 'MAIL_NOT_CONFIGURED' ? 'MAIL_NOT_CONFIGURED' : 'MAIL_FAILED' }); }
  }

  // send
  if (n.status === 'sent') return reply(409, { error: 'ALREADY_SENT' });
  const { data: recent } = await db.from('newsletters').select('id').eq('club_id', n.club_id).eq('status', 'sent').gte('sent_at', new Date(Date.now() - 864e5).toISOString()).limit(1);
  if (recent?.length) return reply(409, { error: 'NEWS_TOO_SOON' });
  const { data: subs } = await db.from('subscribers').select('email, token').eq('club_id', n.club_id).eq('status', 'active');
  if (!subs?.length) return reply(409, { error: 'NO_SUBSCRIBERS' });
  // Claim the issue first so a double click can't send twice; hand it back if the mail service refuses.
  const { data: claimed } = await db.from('newsletters').update({ status: 'sent', issue_no: issueNo, sent_at: new Date().toISOString(), sent_count: subs.length }).eq('id', id).eq('status', 'draft').select('id');
  if (!claimed?.length) return reply(409, { error: 'ALREADY_SENT' });
  const msgs: Msg[] = subs.map((s) => {
    const url = appUrl(n.club_id, `#/list/unsub/${s.token}`); const e = build(url);
    return { to: s.email, subject: n.subject, html: e.html, text: e.text, headers: { 'List-Unsubscribe': `<${url}>` } };
  });
  try {
    const sent = await sendAll(msgs);
    await db.from('audit_log').insert({ actor: null, aal: 'aal2', action: 'NEWSLETTER_SENT', tbl: 'newsletters', club_id: n.club_id, changes: { id, issue: issueNo, sent } });
    return reply(200, { sent, issue_no: issueNo });
  } catch (x) {
    await db.from('newsletters').update({ status: 'draft', issue_no: null, sent_at: null, sent_count: null }).eq('id', id);
    return reply(500, { error: String((x as Error).message) === 'MAIL_NOT_CONFIGURED' ? 'MAIL_NOT_CONFIGURED' : 'MAIL_FAILED' });
  }
});
