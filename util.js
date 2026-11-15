import { CONFIG } from './config.js';

export const TZ = CONFIG.TIMEZONE;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
export const fDay = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(d));
export const fLong = (d) => fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(d));
export const fTime = (d) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(d));
export const fMonth = (d) => fmt({ month: 'long', year: 'numeric' }).format(new Date(d));
export const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

export const KINDS = {
  book:    { label: 'Book Club', color: '#7a4b8c' },
  mahjong: { label: 'Mahjong',   color: '#2f6b4f' },
  trivia:  { label: 'Trivia',    color: '#c8452c' },
  craft:   { label: 'Crafting',  color: '#b8860b' },
  other:   { label: 'Event',     color: '#4a4a4a' },
};
export const kind = (k) => KINDS[k] || KINDS.other;

// ── Calendar exports ──
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const endOf = (e) => e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600e3).toISOString();

export function icsFor(e, url) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//signmeupdaddy//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@signmeupdaddy.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.starts_at)}`,
    `DTEND:${icsDate(endOf(e))}`,
    `SUMMARY:${icsEsc(e.title)}`,
    `LOCATION:${icsEsc(e.location)}`,
    `DESCRIPTION:${icsEsc((e.description || '') + (url ? `\n\n${url}` : ''))}`,
    url ? `URL:${url}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
export function downloadIcs(e, url) {
  const blob = new Blob([icsFor(e, url)], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${e.title.replace(/[^\w]+/g, '-').toLowerCase()}.ics` });
  document.body.append(a); a.click(); a.remove();
}
export function googleCalUrl(e, url) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${icsDate(e.starts_at)}/${icsDate(endOf(e))}`, details: (e.description || '') + (url ? `\n\n${url}` : ''), location: e.location || '' });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function toCsv(rows, cols) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}
export function download(name, text, type = 'text/csv') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// datetime-local <-> ISO (browser-local; admins are expected to be in the club's timezone)
export const toLocalInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v) => new Date(v).toISOString();

// ── Cloudflare Turnstile (explicit render) ──
let tsLoad;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  tsLoad ||= new Promise((res, rej) => {
    const sc = Object.assign(document.createElement('script'), {
      src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true,
    });
    sc.onload = () => res(window.turnstile); sc.onerror = () => rej(new Error('CAPTCHA_LOAD'));
    document.head.append(sc);
  });
  return tsLoad;
}
// Renders a widget into `el`. Returns { token(), reset() }. With no site key (demo) it's a no-op.
export async function captcha(el, siteKey, action) {
  if (!siteKey) { el.remove(); return { token: () => 'demo', wait: async () => 'demo', reset() {} }; }
  let tok = '';
  const ts = await loadTurnstile();
  const id = ts.render(el, {
    sitekey: siteKey, action, appearance: 'interaction-only', theme: 'light',
    callback: (t) => { tok = t; }, 'expired-callback': () => { tok = ''; }, 'error-callback': () => { tok = ''; },
  });
  return {
    token: () => tok,
    // Invisible mode issues the token a moment after render; wait briefly for it.
    wait: async (ms = 8000) => { const t0 = Date.now(); while (!tok && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150)); return tok; },
    reset: () => { tok = ''; ts.reset(id); },
  };
}

// ── Game tables ──
// Public nudge: how full the current table is. Mahjong is 4 per table, so 9 players = 2 full tables + 1 waiting for 3 more.
export function tableProgress(e) {
  if (!e.table_size) return null;
  const n = e.seats_taken, size = e.table_size;
  const tables = Math.ceil(n / size);
  const rem = n % size;
  return { tables, full: Math.floor(n / size), openTable: rem ? tables : null, need: rem ? size - rem : 0, size };
}
export function gearProgress(e) {
  if (!e.gear_label || !e.table_size) return null;
  const tablesNeeded = Math.max(1, Math.ceil(e.seats_taken / e.table_size));
  return { have: e.gear_count || 0, need: tablesNeeded, label: e.gear_label };
}

// Organizer seating. Parties (a person + their guests) always sit together.
// Goals, in order: fill tables to `size`; spread experienced players so every table has one;
// keep brand-new players next to someone experienced; spread gear so each table has a set.
const RANK = { experienced: 2, learning: 1, new: 0 };
export function assignTables(signups, size) {
  const parties = signups.filter((s) => s.status === 'confirmed').map((s) => ({
    id: s.id, seats: 1 + (s.guests || 0), rank: RANK[s.skill] ?? 1, isNew: s.skill === 'new', gear: !!s.brings_gear,
  }));
  const total = parties.reduce((a, p) => a + p.seats, 0);
  if (!total) return { tables: [], byId: {} };
  const tables = Array.from({ length: Math.ceil(total / size) }, (_, i) => ({ no: i + 1, free: size, exp: 0, fresh: 0, gear: 0, ids: [] }));
  // Place experienced first (anchors), then brand-new players (so they land next to an anchor),
  // then everyone else; within each group, gear-bringers and larger parties go first.
  const order = (p) => (p.rank === 2 ? 0 : p.isNew ? 1 : 2);
  parties.sort((a, b) => order(a) - order(b) || Number(b.gear) - Number(a.gear) || b.seats - a.seats);
  for (const p of parties) {
    let fit = tables.filter((t) => t.free >= p.seats);
    if (!fit.length) { const t = { no: tables.length + 1, free: size, exp: 0, fresh: 0, gear: 0, ids: [] }; tables.push(t); fit = [t]; }
    const score = (t) =>
      (p.rank === 2 ? -t.exp * 10 : 0) +                    // experienced: go where there are fewest experienced
      (p.isNew ? t.exp * 6 - t.fresh * 3 : 0) +              // brand new: go next to experienced, away from other new players
      (p.gear ? -t.gear * 8 : 0) +                           // gear: spread sets across tables
      (size - t.free) * 2 +                                  // otherwise fill tables up (fewest half-empty tables)
      (t.free === p.seats ? 3 : 0);                          // bonus for an exact fit
    fit.sort((a, b) => score(b) - score(a) || a.no - b.no);
    const t = fit[0];
    t.free -= p.seats; t.ids.push(p.id); if (p.rank === 2) t.exp++; if (p.isNew) t.fresh++; if (p.gear) t.gear++;
  }
  const byId = {}; tables.forEach((t) => t.ids.forEach((id) => (byId[id] = t.no)));
  return { tables, byId };
}

// Print a block of HTML on its own page (roster, table cards). Works on GitHub Pages; sandboxed previews may block printing.
export function printHtml(html) {
  let el = document.getElementById('print-area');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'print-area' }); document.body.append(el); }
  el.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  try { window.print(); } catch { /* blocked in sandbox */ }
  setTimeout(done, 60000);
}
