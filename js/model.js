import { parseDate, addDays, isoDate, today, contactKey } from './util.js';

// Pure helpers over the sheet data shape. No storage, no DOM.
//
// Sheet shape:
// {
//   id, title, description, location, emoji, templateId,
//   date, start, end,            // event date/time (used by item slots + calendar)
//   waitlist: boolean,
//   organizer: { name, email? },
//   slots: [{ id, type: 'time'|'item', label, note, capacity, date?, start?, end?, archived? }],
//          (archived = removed by the organizer while it still had signups; hidden, signups kept)
//   signups: [{ id, slotId, name, contact?, note, status: 'confirmed'|'waitlist', createdAt, queuedAt, token? }],
//   createdAt
// }

// Slots people can see and sign up for (removed-with-signups slots are archived, not deleted).
export const activeSlots = (sheet) => sheet.slots.filter((s) => !s.archived);

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
  const active = new Set();
  for (const slot of activeSlots(sheet)) {
    active.add(slot.id);
    const s = slotStats(sheet, slot);
    filled += Math.min(s.filled, s.capacity);
    capacity += s.capacity;
    waiting += s.waiting;
  }
  const people = new Set(sheet.signups.filter((s) => s.status === 'confirmed' && active.has(s.slotId))
    .map((s) => contactKey(s.contact) || String(s.name || '').toLowerCase())).size;
  return { filled, capacity, waiting, open: capacity - filled, people };
}

// Groups slots for display: item slots first ("What to bring"), then time slots by date.
export function groupSlots(sheet) {
  const groups = [];
  const all = activeSlots(sheet);
  const items = all.filter((s) => s.type === 'item');
  if (items.length) groups.push({ key: 'items', kind: 'items', date: sheet.date || '', slots: items });
  const times = all.filter((s) => s.type === 'time')
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
  const all = activeSlots(sheet);
  const dated = all.filter((s) => s.type === 'time' && s.date === date);
  if (dated.length) return dated;
  // Item slots (and undated time slots) apply to every occurrence; otherwise nothing is due that day.
  return all.filter((s) => s.type === 'item' || !s.date);
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

/* ---------- Edit-after-publish impact (used to warn before saving) ---------- */

// What an edit to a sheet's slots does to people already signed up. `nextSlots` is the edited slot list.
export function sheetEditImpact(sheet, nextSlots, { waitlist = sheet.waitlist } = {}) {
  const byId = new Map(nextSlots.map((s) => [s.id, s]));
  const removed = [], shrunk = [], moved = [];
  // Turning the waitlist off doesn't remove anyone who is already queued.
  const queued = waitlist === false && sheet.waitlist !== false
    ? sheet.signups.filter((x) => x.status === 'waitlist' && byId.has(x.slotId)).length : 0;
  for (const old of activeSlots(sheet)) {
    const conf = confirmedFor(sheet, old.id).length;
    const wait = waitlistFor(sheet, old.id).length;
    const total = conf + wait;
    const next = byId.get(old.id);
    if (!next) { if (total) removed.push({ label: old.label, count: total }); continue; }
    const cap = Number(next.capacity);
    if (Number.isFinite(cap) && cap < conf) shrunk.push({ label: next.label || old.label, count: conf, capacity: cap });
    const when = (s) => (s.type === 'time' ? `${s.date || ''} ${s.start || ''} ${s.end || ''}` : '');
    if (total && old.type === 'time' && when(old) !== when(next)) moved.push({ label: next.label || old.label, count: total });
  }
  return { removed, shrunk, moved, queued };
}

// What an edit to a group event does to existing RSVPs (upcoming dates only).
export function eventEditImpact(group, ev, next, { from = isoDate(today()) } = {}) {
  const mine = group.rsvps.filter((r) => r.eventId === ev.id && r.occurrence >= from && r.status !== 'no');
  const orphaned = mine.filter((r) => !isOccurrence(next, r.occurrence)).length;
  const shrunk = [];
  if (next.capacity) {
    const dates = [...new Set(mine.map((r) => r.occurrence))].filter((d) => isOccurrence(next, d)).sort();
    for (const d of dates) {
      const going = rsvpsFor(group, ev.id, d).going.length;
      if (going > next.capacity) shrunk.push({ date: d, going });
    }
  }
  const datesChanged = ev.date !== next.date || ev.recurrence !== next.recurrence;
  return { orphaned, shrunk, sheetsAffected: datesChanged && (ev.sheetIds || []).length > 0 };
}
