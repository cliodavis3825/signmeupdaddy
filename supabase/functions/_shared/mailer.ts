// Drains the email outbox through Resend. Used by send-outbox (cron) and signup (instant confirmations).
// Each message carries an Idempotency-Key, so a retry after a timeout can't send the same email twice.
import { vcalendar } from './ics.ts';

const SITE = Deno.env.get('SITE_URL') ?? 'https://signmeupdaddy.com';
const FROM = Deno.env.get('MAIL_FROM') ?? 'signmeupdaddy <hello@signmeupdaddy.com>';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

type Row = {
  outbox_id: number; kind: 'confirmed' | 'waitlisted' | 'promoted' | 'reminder';
  name: string; email: string; guests: number; status: string; cancel_token: string; table_no: number | null;
  event_id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; description: string | null;
  book_title: string | null; book_author: string | null;
  club_id: string; club_name: string; club_email: string | null; club_tz: string;
};

const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };

export function render(r: Row) {
  const when = new Intl.DateTimeFormat('en-US', { timeZone: r.club_tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(r.starts_at));
  const first = r.name.split(' ')[0];
  const eventUrl = `${SITE}/?club=${r.club_id}#/e/${r.event_id}`;
  const manageUrl = `${SITE}/?club=${r.club_id}#/cancel/${r.cancel_token}`;
  const party = r.guests ? ` (you + ${r.guests})` : '';
  const book = r.book_title ? `We're reading ${r.book_title}${r.book_author ? ` by ${r.book_author}` : ''}.` : '';
  const table = r.table_no ? `You're at Table ${r.table_no}.` : '';

  const copy = {
    confirmed: { subject: `You're in: ${r.title}`, lead: `You're in${party}, ${first}. See you ${when}.`, ask: "Plans change? Release your spot so someone on the waitlist gets in." },
    waitlisted: { subject: `Waitlist: ${r.title}`, lead: `${r.title} is full, so you're on the waitlist${party}. If a spot opens you're moved up automatically and we'll email you.`, ask: 'No longer interested? Leave the waitlist.' },
    promoted: { subject: `A spot opened. You're in: ${r.title}`, lead: `Good news, ${first}: a spot opened and you're now confirmed${party} for ${when}.`, ask: "Can't make it after all? Release the spot so the next person gets it." },
    reminder: { subject: `Tomorrow: ${r.title}`, lead: `See you ${when}, ${first}.`, ask: "Can't make it? Please release your spot now. Someone on the waitlist is hoping for it." },
  }[r.kind];

  const lines = [copy.lead, table, book, r.location ? `Where: ${r.location}` : '', `Event page: ${eventUrl}`, '', `${copy.ask}`, manageUrl, '', `— ${r.club_name}`];
  const text = lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f1e7;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #e3dacb;border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b635b">${h(r.club_name)}</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.2">${h(r.title)}</h1>
<p style="margin:0 0 12px">${h(copy.lead)}</p>
${table ? `<p style="margin:0 0 12px;font-weight:700">${h(table)}</p>` : ''}
${book ? `<p style="margin:0 0 12px">${h(book)}</p>` : ''}
<p style="margin:0 0 4px;color:#6b635b">${h(when)}</p>
${r.location ? `<p style="margin:0 0 16px;color:#6b635b">${h(r.location)}</p>` : ''}
<p style="margin:0 0 20px"><a href="${h(eventUrl)}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">Event details</a></p>
<p style="margin:0 0 6px;font-size:14px;color:#6b635b">${h(copy.ask)}</p>
<p style="margin:0;font-size:14px"><a href="${h(manageUrl)}" style="color:#c2412d">Manage or release my spot</a></p>
</td></tr></table>
<p style="font-size:12px;color:#6b635b;margin:12px 0 0">Sent by signmeupdaddy for ${h(r.club_name)} because you signed up for this event.</p>
</td></tr></table></body></html>`;

  const attach = r.kind !== 'waitlisted';
  const ics = attach ? vcalendar([{ id: r.event_id, title: r.title, starts_at: r.starts_at, ends_at: r.ends_at, location: r.location, description: r.description, url: eventUrl }], undefined, 'PUBLISH') : null;
  return { subject: copy.subject, text, html, ics };
}

// deno-lint-ignore no-explicit-any
export async function drainOutbox(db: any, limit = 25, fetchImpl: typeof fetch = fetch) {
  if (!RESEND_KEY) return { sent: 0, failed: 0, skipped: 'RESEND_API_KEY not set' };
  const { data: rows, error } = await db.rpc('claim_mail', { p_limit: limit });
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const r of (rows ?? []) as Row[]) {
    const m = render(r);
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `smud-outbox-${r.outbox_id}` },
        body: JSON.stringify({
          from: FROM, to: [r.email], subject: m.subject, html: m.html, text: m.text,
          ...(r.club_email ? { reply_to: r.club_email } : {}),
          ...(m.ics ? { attachments: [{ filename: 'event.ics', content: b64(m.ics) }] } : {}),
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await db.rpc('mark_mail', { p_id: r.outbox_id, p_error: null });
      sent++;
    } catch (e) {
      await db.rpc('mark_mail', { p_id: r.outbox_id, p_error: String((e as Error).message ?? e).slice(0, 300) });
      failed++;
    }
  }
  return { sent, failed };
}
