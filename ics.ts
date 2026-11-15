// iCalendar helpers shared by the ical feed and email attachments (RFC 5545).
export type CalEvent = {
  id: string; title: string; starts_at: string; ends_at?: string | null;
  location?: string | null; description?: string | null; url?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
};

const stamp = (d: string | Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Lines longer than 75 octets must be folded with CRLF + space.
const fold = (line: string) => {
  const out: string[] = []; let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur); return out.join('\r\n');
};

export function vevent(e: CalEvent) {
  const end = e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 2 * 3600e3).toISOString();
  return [
    'BEGIN:VEVENT',
    `UID:${e.id}@signmeupdaddy.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.starts_at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    `DESCRIPTION:${esc((e.description ?? '') + (e.url ? `\n\n${e.url}` : ''))}`,
    e.url ? `URL:${e.url}` : null,
    `STATUS:${e.status ?? 'CONFIRMED'}`,
    'END:VEVENT',
  ].filter(Boolean).map((l) => fold(l as string)).join('\r\n');
}

export function vcalendar(events: CalEvent[], name?: string, method = 'PUBLISH') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//signmeupdaddy//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    name ? fold(`X-WR-CALNAME:${esc(name)}`) : null,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    ...events.map(vevent),
    'END:VCALENDAR', '',
  ].filter((l) => l !== null).join('\r\n');
}
