// "Report an issue" form. Stores the report (public.issue_reports) and emails it to NOTIFY_EMAIL (a function secret).
// Same guards as the other public endpoints: origin allowlist, honeypot, Turnstile, rate limit.
import { cors, check, db, EMAIL } from '../_shared/guard.ts';
import { h, layout, sendAll } from '../_shared/bulk.ts';

const TOPICS = ['Signing up for an event', "Didn't get an email", 'Email list', 'Problem at an event', 'Website problem', 'Something else'];
const NOTIFY = Deno.env.get('NOTIFY_EMAIL') ?? '';

Deno.serve(async (req) => {
  const { ok, reply, headers } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const s = (k: string, n: number) => String(b[k] ?? '').trim().slice(0, n);
  const topic = s('topic', 60), page = s('page', 200), what = s('what', 2000), expected = s('expected', 1000);
  const name = s('name', 80), email = s('email', 120).toLowerCase(), device = s('device', 300);
  const club = s('club_id', 40).toLowerCase() || null;
  if (!TOPICS.includes(topic) || !what || !name || !EMAIL.test(email)) return reply(400, { error: 'BAD_REQUEST' });

  const bad = await check(req, b, 'report', 4000, 5, 3600);
  if (bad) return reply(bad.status, { error: bad.code });

  const { error } = await db.from('issue_reports').insert({ club_id: club, topic, page: page || null, what, expected: expected || null, name, email, device: device || null });
  if (error) return reply(500, { error: 'SERVER' });

  if (NOTIFY) {
    const row = (k: string, v: string) => v ? `<p style="margin:0 0 10px"><b>${h(k)}</b><br>${h(v).replace(/\n/g, '<br>')}</p>` : '';
    try {
      await sendAll([{
        to: NOTIFY, reply_to: email, subject: `Issue report: ${topic}`,
        text: `${topic}\nFrom: ${name} <${email}>\nPage/event: ${page}\n\nWhat happened:\n${what}\n\nExpected:\n${expected}\n\nDevice: ${device}`,
        html: layout(club ?? 'signmeupdaddy', `<h1 style="margin:0 0 12px;font-size:20px">${h(topic)}</h1>${row('From', `${name} <${email}>`)}${row('Page or event', page)}${row('What happened', what)}${row('What they expected', expected)}${row('Device', device)}`,
          'Reply to this email to answer them. Reports are also saved in Supabase → Table Editor → issue_reports.'),
      }]);
    } catch { /* saved anyway */ }
  }
  return reply(200, { ok: true });
});
