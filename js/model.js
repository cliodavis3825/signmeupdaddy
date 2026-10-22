import { parseDate, addDays, isoDate, today } from './util.js';

// Pure helpers over the sheet data shape. No storage, no DOM.
//
// Sheet shape:
// {
//   id, title, description, location, emoji, templateId,
//   date, start, end,            // event date/time (used by item slots + calendar)
//   waitlist: boolean,
//   organizer: { name, email? },
//   slots: [{ id, type: 'time'|'item', label, note, capacity, date?, start?, end? }],
//   signups: [{ id, slotId, name, contact?, note, status: 'confirmed'|'waitlist', createdAt, queuedAt, token? }],
//   createdAt
// }

export const confirmedFor = (sheet, slotId) =>
  sheet.signups.filter((s) => s.slotId === slotId && s.status === 'confirmed')
    .sort((a, b) => a.createdAt - b.createdAt);

export const waitlistFor = (sheet, slotId) =>
  sheet.signups.filter((s) => s.slotId === slotId && s.status === 'waitlist')
    .sort((a, b) => (a.queuedAt || a.createdAt) - (b.queuedAt || b.createdAt));

export function slotStats(sheet, slot) {
  const filled = confirmedFor(sheet, slot.id).length;
  const waiting = waitlistFor(sheet, slot.id).length;
  const capacity = Math.max(1, Number(slot.capacity) || 1);
  return { filled, waiting, capacity, open: Math.max(0, capacity - filled), full: filled >= capacity };
}

export function sheetTotals(sheet) {
  let filled = 0, capacity = 0, waiting = 0;
  for (const slot of sheet.slots) {
    const s = slotStats(sheet, slot);
    filled += Math.min(s.filled, s.capacity);
    capacity += s.capacity;
    waiting += s.waiting;
  }
  const people = new Set(sheet.signups.filter((s) => s.status === 'confirmed').map((s) => (s.contact || s.name).toLowerCase())).size;
  return { filled, capacity, waiting, open: capacity - filled, people };
}

// Groups slots for display: item slots first ("What to bring"), then time slots by date.
export function groupSlots(sheet) {
  const groups = [];
  const items = sheet.slots.filter((s) => s.type === 'item');
  if (items.length) groups.push({ key: 'items', kind: 'items', date: sheet.date || '', slots: items });
  const times = sheet.slots.filter((s) => s.type === 'time')
    .slice()
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '').localeCompare(b.start || ''));
  for (const slot of times) {
    const key = slot.date || 'tbd';
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, kind: 'date', date: slot.date || '', slots: [] }; groups.push(g); }
    g.slots.push(slot);
  }
  return groups;
}

// Date/time a slot happens at (time slots carry their own; item slots use the event's).
export function slotWhen(sheet, slot) {
  if (slot.type === 'time') return { date: slot.date || '', start: slot.start || '', end: slot.end || '' };
  return { date: sheet.date || '', start: sheet.start || '', end: sheet.end || '' };
}

/* ---------- Groups ---------- */

export const RECURRENCE_LABELS = { none: 'One-time', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

// Occurrence dates (YYYY-MM-DD) of an event on/after `from`, up to `count`.
export function occurrences(ev, { from = isoDate(today()), count = 4 } = {}) {
  const start = parseDate(ev.date);
  if (!start) return [];
  if (!ev.recurrence || ev.recurrence === 'none') return ev.date >= from ? [ev.date] : [];
  const out = [];
  for (let i = 0; out.length < count && i < 600; i++) {
    let d;
    if (ev.recurrence === 'monthly') {
      d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
      if (d.getDate() !== start.getDate()) continue; // e.g. no Feb 30th
    } else {
      d = addDays(start, i * (ev.recurrence === 'biweekly' ? 14 : 7));
    }
    const s = isoDate(d);
    if (s >= from) out.push(s);
  }
  return out;
}

export function isOccurrence(ev, date) {
  const start = parseDate(ev.date);
  const d = parseDate(date);
  if (!start || !d) return false;
  if (!ev.recurrence || ev.recurrence === 'none') return ev.date === date;
  if (d < start) return false;
  if (ev.recurrence === 'monthly') return d.getDate() === start.getDate();
  const days = Math.round((d - start) / 86400000);
  return days % (ev.recurrence === 'biweekly' ? 14 : 7) === 0;
}

export const nextOccurrence = (ev) => occurrences(ev, { count: 1 })[0] || null;

export function rsvpsFor(group, eventId, occurrence) {
  const list = group.rsvps.filter((r) => r.eventId === eventId && r.occurrence === occurrence);
  const by = (st) => list.filter((r) => r.status === st).sort((a, b) => (a.queuedAt || a.createdAt) - (b.queuedAt || b.createdAt));
  return { going: by('going'), maybe: by('maybe'), no: by('no'), waitlist: by('waitlist') };
}

// Slots of a sheet relevant to one occurrence: time slots dated that day if any exist, else all slots.
export function slotsForOccurrence(sheet, date) {
  const dated = sheet.slots.filter((s) => s.type === 'time' && s.date === date);
  if (dated.length) return dated;
  // Item slots (and undated time slots) apply to every occurrence; otherwise nothing is due that day.
  return sheet.slots.filter((s) => s.type === 'item' || !s.date);
}

export function sheetProgressFor(sheet, date) {
  const slots = slotsForOccurrence(sheet, date);
  let filled = 0, capacity = 0;
  for (const slot of slots) {
    const st = slotStats(sheet, slot);
    filled += Math.min(st.filled, st.capacity);
    capacity += st.capacity;
  }
  return { filled, capacity, open: capacity - filled, slots };
}
