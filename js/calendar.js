// Add-to-calendar helpers: Google Calendar template URL + RFC 5545 .ics file.
import { addDays, parseDate, isoDate, pad } from './util.js';
import { slotWhen } from './model.js';

const ymd = (date) => date.replace(/-/g, '');
const stamp = (date, time) => `${ymd(date)}T${time.replace(':', '')}00`;

function plusHour(t) {
  const [h, m] = t.split(':').map(Number);
  return h >= 23 ? '23:59' : `${pad(h + 1)}:${pad(m)}`;
}

// Returns null when the slot has no date (nothing to put on a calendar).
export function eventFor(sheet, slot, link) {
  const when = slotWhen(sheet, slot);
  if (!when.date || !parseDate(when.date)) return null;
  const end = when.start ? (when.end && when.end > when.start ? when.end : plusHour(when.start)) : '';
  const details = [
    `You signed up for: ${slot.label}`,
    slot.note ? `Note: ${slot.note}` : '',
    sheet.organizer?.name ? `Organizer: ${sheet.organizer.name}` : '',
    link ? `Change or cancel: ${link}` : '',
    'Sent with SignMeUpDaddy. No ads, ever.',
  ].filter(Boolean).join('\n');
  return {
    title: `${slot.label} · ${sheet.title}`,
    date: when.date, start: when.start, end,
    location: sheet.location || '', details,
  };
}

export function googleCalendarUrl(ev) {
  let dates;
  if (ev.start) dates = `${stamp(ev.date, ev.start)}/${stamp(ev.date, ev.end)}`;
  else dates = `${ymd(ev.date)}/${ymd(isoDate(addDays(parseDate(ev.date), 1)))}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates, details: ev.details, location: ev.location });
  if (ev.rrule) p.set('recur', `RRULE:${ev.rrule}`);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = ' ' + rest.slice(73); }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(ev, uidSeed) {
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SignMeUpDaddy//Prototype//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uidSeed}@signmeupdaddy.com`,
    `DTSTAMP:${dtstamp}`,
  ];
  if (ev.start) {
    lines.push(`DTSTART:${stamp(ev.date, ev.start)}`, `DTEND:${stamp(ev.date, ev.end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd(ev.date)}`, `DTEND;VALUE=DATE:${ymd(isoDate(addDays(parseDate(ev.date), 1)))}`);
  }
  if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
  lines.push(`SUMMARY:${icsEscape(ev.title)}`, `DESCRIPTION:${icsEscape(ev.details)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// RRULE for a group event's recurrence ('weekly' | 'biweekly' | 'monthly'); null for one-offs.
export function rruleFor(recurrence, date) {
  if (recurrence === 'weekly') return 'FREQ=WEEKLY;INTERVAL=1';
  if (recurrence === 'biweekly') return 'FREQ=WEEKLY;INTERVAL=2';
  if (recurrence === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${parseDate(date)?.getDate() || 1}`;
  return null;
}

// Calendar event for a group event: one occurrence, or (series=true) the whole series from its first date.
export function groupEventFor(group, ev, occurrence, { series = false, link = '' } = {}) {
  const date = series ? ev.date : occurrence;
  if (!date || !parseDate(date)) return null;
  const end = ev.start ? (ev.end && ev.end > ev.start ? ev.end : plusHour(ev.start)) : '';
  const details = [
    ev.description,
    `Group: ${group.name}`,
    link ? `RSVP & details: ${link}` : '',
    'Sent with SignMeUpDaddy Groups. No ads, ever.',
  ].filter(Boolean).join('\n');
  return {
    title: `${ev.title} · ${group.name}`,
    date, start: ev.start, end,
    location: ev.location || group.location || '',
    details,
    rrule: series ? rruleFor(ev.recurrence, ev.date) : null,
  };
}
