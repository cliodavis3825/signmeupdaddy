import { CONFIG } from './assets/config.js';

const API = CONFIG.SUPABASE_URL;
const hdr = { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Coffee ──
if (CONFIG.VENMO_HANDLE) {
  const v = $('#venmo');
  v.href = 'https://venmo.com/u/' + encodeURIComponent(CONFIG.VENMO_HANDLE);
  v.hidden = false;
} else {
  $('#coffee .cta-row').innerHTML = '<span class="muted">Coffee link coming soon.</span>';
}

// ── Club search ──
let clubs = [];
const list = $('#results');
const clubUrl = (c) => (c.id === '518analog' ? '/518analog/' : `/app/?club=${encodeURIComponent(c.id)}#/`);
function render() {
  const q = $('#q').value.trim().toLowerCase();
  const hits = clubs.filter((c) => !q || `${c.name} ${c.tagline ?? ''} ${c.id}`.toLowerCase().includes(q));
  list.innerHTML = hits.length
    ? hits.map((c) => `<li><a class="club" href="${esc(clubUrl(c))}"><b>${esc(c.name)}</b>${c.tagline ? `<span>${esc(c.tagline)}</span>` : ''}</a></li>`).join('')
    : `<li class="muted">No clubs match “${esc(q)}”. <a href="#start">Start one?</a></li>`;
}
async function loadClubs() {
  try {
    const r = await fetch(`${API}/rest/v1/clubs?select=id,name,tagline&order=name&limit=200`, { headers: hdr });
    if (!r.ok) throw new Error(r.status);
    clubs = await r.json(); render();
  } catch {
    list.innerHTML = '<li class="muted">Couldn\'t load clubs just now. Please refresh in a moment.</li>';
  }
}
$('#q').addEventListener('input', render);
loadClubs();

// ── Start a club ──
let tsId, tok = '', tsReady;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((res, rej) => {
    const sc = Object.assign(document.createElement('script'), { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    sc.onload = () => res(window.turnstile); sc.onerror = () => rej(new Error('CAPTCHA_LOAD'));
    document.head.append(sc);
  });
}
tsReady = loadTurnstile().then((ts) => {
  tsId = ts.render('#cf', { sitekey: CONFIG.TURNSTILE_SITE_KEY, action: 'club-request', appearance: 'interaction-only', theme: 'light',
    callback: (t) => { tok = t; }, 'expired-callback': () => { tok = ''; }, 'error-callback': () => { tok = ''; } });
  return ts;
});
const waitToken = async (ms = 8000) => { const t0 = Date.now(); while (!tok && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150)); return tok; };

const MSG = {
  BOT_SUSPECTED: 'That went through too fast. Please take a moment and try again.',
  CAPTCHA_FAILED: 'We couldn\'t verify you\'re human. Please try again.',
  RATE_LIMITED: 'You\'ve sent a few requests already. Please try again tomorrow.',
  BAD_REQUEST: 'Please check the form: club name, your name and a valid email are required.',
};
const form = $('#club-form'); const shownAt = Date.now();
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#club-err'); err.textContent = '';
  const d = Object.fromEntries(new FormData(form));
  if (d.website) return;
  if (d.club_name.trim().length < 2) return (err.textContent = 'Add your club\'s name.');
  if (!d.contact.trim()) return (err.textContent = 'Add your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return (err.textContent = 'That email looks off.');
  const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await tsReady; const captcha = await waitToken();
    if (!captcha) throw { code: 'CAPTCHA_FAILED' };
    const r = await fetch(`${API}/functions/v1/club-request`, {
      method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...d, captcha, elapsed_ms: Date.now() - shownAt }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: j.error };
    form.hidden = true; $('#club-done').hidden = false;
  } catch (x) {
    err.textContent = MSG[x?.code] || 'Something went wrong. Please try again in a moment.';
    btn.disabled = false; btn.textContent = 'Send my request';
    tok = ''; try { window.turnstile?.reset(tsId); } catch { /* ignore */ }
  }
});
