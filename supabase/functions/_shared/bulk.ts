// Plain-email helpers for list / update mail (no per-signup outbox): Resend batch API + a simple layout.
const SITE = Deno.env.get('SITE_URL') ?? 'https://signmeupdaddy.com';
const FROM = Deno.env.get('MAIL_FROM') ?? 'signmeupdaddy <hello@signmeupdaddy.com>';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

export type Msg = { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; reply_to?: string };
export const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const appUrl = (club: string, hash: string) => `${SITE}/app/?club=${encodeURIComponent(club)}${hash}`;

export function layout(clubName: string, bodyHtml: string, footerHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f1e7;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #e3dacb;border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b635b">${h(clubName)}</p>
${bodyHtml}
</td></tr></table>
<p style="font-size:12px;color:#6b635b;margin:12px 0 0;max-width:520px">${footerHtml}</p>
</td></tr></table></body></html>`;
}
export const button = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${h(href)}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">${h(label)}</a></p>`;

// Sends in chunks of 100 (Resend batch limit). Throws if any chunk fails so callers can report it.
export async function sendAll(msgs: Msg[]): Promise<number> {
  if (!RESEND_KEY) throw new Error('MAIL_NOT_CONFIGURED');
  let sent = 0;
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100).map((m) => ({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers, reply_to: m.reply_to }));
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error('MAIL_FAILED');
    sent += chunk.length;
  }
  return sent;
}

export const unsubFooter = (club: string, token: string, why: string) => {
  const url = appUrl(club, `#/list/unsub/${token}`);
  return { url, html: `${why} <a href="${h(url)}" style="color:#6b635b">Unsubscribe</a>`, text: `${why} Unsubscribe: ${url}` };
};
