// Small shared helpers: safe HTML templating, ids, dates, clipboard, downloads, toasts.

/* ---------- Safe HTML ---------- */
// Every interpolated value in html`` is escaped unless wrapped with raw() or produced by html``.
export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);

function fmt(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/* ---------- IDs ---------- */
const ALPH = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 chars, no l/o/0/1
export function uid(n = 8) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => ALPH[b % ALPH.length]).join('');
}

/* ---------- Dates ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseDate(s) {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
// Next given weekday (0=Sun) strictly after `from`.
export function nextDow(dow, from = today()) {
  let diff = (dow - from.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(from, diff);
}
export function fmtDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(undefined, opts) : '';
}
export const fmtDateLong = (s) => fmtDate(s, { weekday: 'long', month: 'long', day: 'numeric' });

export function fmtTime(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function fmtRange(start, end) {
  if (start && end) return `${fmtTime(start)} – ${fmtTime(end)}`;
  return start ? fmtTime(start) : '';
}
export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/* ---------- People ---------- */
// "Dana Rodriguez" -> "Dana R." (public sheets show short names)
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Someone';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'friend';

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const isPhone = (s) => /^[\d\s()+.\-]+$/.test(s) && s.replace(/\D/g, '').length >= 7;

/* ---------- Browser helpers ---------- */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s) {
  return String(s || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sheet';
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Polite screen-reader announcement (e.g. progress updates).
export function announce(msg) {
  const el = document.getElementById('live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

export function readLocal(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DAD_JOKES = [
  "I'd tell you a potluck joke, but you'd have to bring your own punchline.",
  'Why did the scarecrow get volunteer of the year? He was outstanding in his field.',
  "What do you call a fake noodle? An impasta. Please bring real pasta.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm reading a book on anti-gravity. It's impossible to put down.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "I only know 25 letters of the alphabet. I don't know y.",
  "What's a grill's favorite music? Anything with a good beet.",
];
export const randomJoke = () => DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
