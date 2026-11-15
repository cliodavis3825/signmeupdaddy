import { CONFIG } from './config.js';
import { api, friendly, mine } from './api.js';
import { captcha, tableProgress, gearProgress, assignTables, printHtml, esc, fDay, fLong, fTime, fMonth, dayKey, kind, KINDS, downloadIcs, googleCalUrl, toCsv, download, toLocalInput, fromLocalInput } from './util.js';

const params = new URLSearchParams(location.search);
const EMBED = params.has('embed');
const CLUB = params.get('club') || CONFIG.DEFAULT_CLUB;
const $app = document.getElementById('app');
const state = { month: startOfMonth(new Date()), day: null, filter: 'all', club: null, events: [] };

if (EMBED) document.documentElement.classList.add('embed');

function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
const eventUrl = (id) => `${CONFIG.SITE_URL}/?club=${encodeURIComponent(CLUB)}#/e/${id}`;
const go = (hash) => { location.hash = hash; };
const toast = (msg) => {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t); setTimeout(() => t.remove(), 2600);
};

// In-page confirm dialog (native confirm() is blocked in some embeds/sandboxes).
function ask(msg, yes = 'Yes') {
  return new Promise((res) => {
    const d = document.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="panel" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="acts"><button class="btn danger" data-y>${esc(yes)}</button><button class="btn ghost" data-n>Never mind</button></div></div>`;
    const done = (v) => { d.remove(); res(v); };
    d.querySelector('[data-y]').onclick = () => done(true);
    d.querySelector('[data-n]').onclick = () => done(false);
    d.onclick = (e) => { if (e.target === d) done(false); };
    document.body.append(d); d.querySelector('[data-n]').focus();
  });
}

// Tell a parent page (iframe embed) how tall we are.
function postHeight() {
  if (EMBED && parent !== window) parent.postMessage({ type: 'smud:height', club: CLUB, height: document.documentElement.scrollHeight }, '*');
}
new ResizeObserver(postHeight).observe(document.body);

async function loadClub(a) {
  if (!state.club) state.club = (await a.getClub(CLUB)) || { id: CLUB, name: CLUB, accent: '#222' };
  document.documentElement.style.setProperty('--accent', state.club.accent || '#222');
  const brand = document.getElementById('club-name'); if (brand) brand.textContent = state.club.name;
  return state.club;
}

// ───────────────────────── Router ─────────────────────────
async function route() {
  const a = await api();
  document.body.dataset.mode = a.mode;
  const banner = document.getElementById('demo-banner'); if (banner) banner.hidden = a.mode !== 'demo';
  await loadClub(a);
  const [, view, arg] = (location.hash.slice(1) || '/').split('/');
  try {
    if (view === 'e') await viewEvent(a, arg);
    else if (view === 'cancel') await viewCancel(a, arg);
    else if (view === 'mine') viewMine();
    else if (view === 'admin') await viewAdmin(a);
    else await viewCalendar(a);
  } catch (err) {
    $app.innerHTML = `<div class="panel error"><h2>Something went sideways</h2><p>${esc(friendly(err))}</p><a class="btn" href="#/">Back to calendar</a></div>`;
  }
  document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('on', n.getAttribute('href') === '#/' + (view || '')));
  if (!EMBED) window.scrollTo(0, 0);
  postHeight();
}
addEventListener('hashchange', route);

// ───────────────────────── Calendar ─────────────────────────
async function viewCalendar(a) {
  const from = new Date(state.month); from.setDate(from.getDate() - 7);
  const to = new Date(state.month); to.setMonth(to.getMonth() + 2);
  state.events = await a.listEvents(CLUB, from, to);
  renderCalendar();
}

function renderCalendar() {
  const m = state.month;
  const now = new Date();
  const byDay = {};
  state.events.forEach((e) => (byDay[dayKey(e.starts_at)] ||= []).push(e));

  const first = new Date(m); const lead = first.getDay();
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cell pad"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d, 12);
    const key = dayKey(date);
    const evs = (byDay[key] || []).filter(match);
    const isToday = key === dayKey(now);
    const past = date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cells.push(`<button class="cell${isToday ? ' today' : ''}${past ? ' past' : ''}${evs.length ? ' has' : ''}${state.day === key ? ' sel' : ''}" data-day="${key}" ${evs.length ? '' : 'tabindex="-1"'} aria-label="${fDay(date)}${evs.length ? `, ${evs.length} event${evs.length > 1 ? 's' : ''}` : ''}">
      <span class="num">${d}</span>
      <span class="dots">${evs.slice(0, 3).map((e) => `<i style="background:${kind(e.kind).color}"></i>`).join('')}</span>
      <span class="mini">${evs.slice(0, 2).map((e) => `<em style="--k:${kind(e.kind).color}">${esc(e.title)}</em>`).join('')}</span>
    </button>`);
  }

  const list = state.events
    .filter((e) => new Date(e.starts_at) >= (state.day ? new Date(0) : now))
    .filter((e) => !state.day || dayKey(e.starts_at) === state.day)
    .filter(match);

  const kindsPresent = [...new Set(state.events.map((e) => e.kind))];
  $app.innerHTML = `
    <section class="cal">
      <div class="cal-head">
        <button class="icon" data-act="prev" aria-label="Previous month">‹</button>
        <h2>${fMonth(m)}</h2>
        <button class="icon" data-act="next" aria-label="Next month">›</button>
      </div>
      <div class="chips" role="group" aria-label="Filter by type">
        <button class="chip${state.filter === 'all' ? ' on' : ''}" data-filter="all">All</button>
        ${kindsPresent.map((k) => `<button class="chip${state.filter === k ? ' on' : ''}" data-filter="${k}" style="--k:${kind(k).color}"><i></i>${kind(k).label}</button>`).join('')}
      </div>
      <div class="grid dow">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="grid days">${cells.join('')}</div>
    </section>
    <section class="list">
      <div class="list-head">
        <h3>${state.day ? fLong(state.day + 'T12:00:00') : 'Coming up'}</h3>
        ${state.day ? '<button class="link" data-act="clear">Show all upcoming</button>' : '<button class="btn ghost sm" data-act="follow">Follow in my calendar</button>'}
      </div>
      <div id="follow"></div>
      ${list.length ? list.map(card).join('') : `<p class="empty">${state.day ? 'Nothing on this day.' : 'No upcoming events this stretch — check next month.'}</p>`}
    </section>`;

  $app.querySelector('[data-act=prev]').onclick = () => { state.month.setMonth(state.month.getMonth() - 1); state.day = null; route(); };
  $app.querySelector('[data-act=next]').onclick = () => { state.month.setMonth(state.month.getMonth() + 1); state.day = null; route(); };
  $app.querySelector('[data-act=clear]')?.addEventListener('click', () => { state.day = null; renderCalendar(); });
  $app.querySelector('[data-act=follow]')?.addEventListener('click', followPanel);
  $app.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { if (!b.classList.contains('has')) return; state.day = state.day === b.dataset.day ? null : b.dataset.day; renderCalendar(); });
  $app.querySelectorAll('[data-filter]').forEach((b) => b.onclick = () => { state.filter = b.dataset.filter; renderCalendar(); });
}
const match = (e) => state.filter === 'all' || e.kind === state.filter;

// Subscribe to the whole club once; new nights show up in the member's own calendar app.
async function followPanel() {
  const a = await api();
  const box = $app.querySelector('#follow');
  if (box.innerHTML) { box.innerHTML = ''; return postHeight(); }
  const url = a.feedUrl(CLUB);
  if (!url) {
    box.innerHTML = `<div class="panel follow"><strong>Follow ${esc(state.club.name)}</strong><p class="hint">In the live site this gives you a calendar link that updates itself: new nights appear in Apple, Google or Outlook Calendar automatically. (Not available in demo mode.)</p></div>`;
    return postHeight();
  }
  const webcal = url.replace(/^https?:/, 'webcal:');
  box.innerHTML = `
    <div class="panel follow">
      <strong>Follow ${esc(state.club.name)}</strong>
      <p class="hint">New nights appear in your calendar automatically. You still sign up for the ones you want.</p>
      <div class="cal-links">
        <a class="btn primary sm" href="${webcal}">Apple / Outlook</a>
        <a class="btn ghost sm" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener">Google Calendar ↗</a>
        <button class="btn ghost sm" data-act="copyfeed">Copy link</button>
      </div>
    </div>`;
  box.querySelector('[data-act=copyfeed]').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Calendar link copied'); } catch { prompt?.('Copy this link', url); } };
  postHeight();
}

function tableLine(e) {
  const t = tableProgress(e);
  if (!t || !t.need || (e.capacity != null && e.seats_taken >= e.capacity)) return '';
  return `<span class="nudge">${t.need} more ${t.need === 1 ? 'player completes' : 'players complete'} Table ${t.openTable}</span>`;
}
function gearLine(e) {
  const g = gearProgress(e);
  if (!g) return '';
  const short = g.need - g.have;
  return `<span class="gear${short > 0 ? ' short' : ''}">${g.have} of ${g.need} ${esc(g.label)}${g.need === 1 ? '' : 's'} covered${short > 0 ? ' · bring one?' : ''}</span>`;
}
const coverUrl = (isbn) => isbn ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn.replace(/-/g, ''))}-M.jpg?default=false` : '';
function bookLine(e) {
  if (!e.book_title) return '';
  return `<span class="book">Reading <em>${esc(e.book_title)}</em>${e.book_author ? ` by ${esc(e.book_author)}` : ''}</span>`;
}

function seatsLine(e) {
  if (e.capacity == null) return `<span class="seats">${e.seats_taken} going · open seating</span>`;
  const left = Math.max(e.capacity - e.seats_taken, 0);
  const pct = Math.min(100, Math.round((e.seats_taken / e.capacity) * 100));
  const label = left === 0 ? (e.waitlist ? `Full · waitlist open${e.waitlist_count ? ` (${e.waitlist_count})` : ''}` : 'Full') : `${left} of ${e.capacity} spots left`;
  return `<span class="seats${left === 0 ? ' full' : left <= 3 ? ' low' : ''}"><span class="bar"><b style="width:${pct}%"></b></span>${label}</span>`;
}

function card(e) {
  const k = kind(e.kind);
  return `<a class="card" href="#/e/${e.id}" style="--k:${k.color}">
    <div class="stub"><span class="mo">${fDay(e.starts_at).split(', ')[1]?.split(' ')[0] || ''}</span><span class="dd">${fDay(e.starts_at).split(' ').pop()}</span><span class="wd">${fDay(e.starts_at).split(',')[0]}</span></div>
    <div class="body">
      <span class="tag">${k.label}</span>
      <h4>${esc(e.title)}</h4>
      <p class="meta">${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</p>
      ${bookLine(e)}
      ${seatsLine(e)}
      ${tableLine(e)}
    </div>
    <span class="go" aria-hidden="true">→</span>
  </a>`;
}

// ───────────────────────── Event + signup ─────────────────────────
async function findEvent(a, id) {
  const from = new Date(); from.setFullYear(from.getFullYear() - 1);
  const to = new Date(); to.setFullYear(to.getFullYear() + 2);
  const all = await a.listEvents(CLUB, from, to);
  return all.find((e) => e.id === id);
}

async function viewEvent(a, id) {
  const e = await findEvent(a, id);
  if (!e) throw new Error('EVENT_NOT_FOUND');
  const k = kind(e.kind);
  const past = new Date(e.starts_at) < new Date();
  const full = e.capacity != null && e.seats_taken >= e.capacity;
  const closed = past || (full && !e.waitlist);
  const guestOpts = Array.from({ length: e.max_guests + 1 }, (_, i) => `<option value="${i}">${i === 0 ? 'Just me' : `Me + ${i}`}</option>`).join('');

  $app.innerHTML = `
    <a class="back" href="#/">← All events</a>
    <article class="event" style="--k:${k.color}">
      <span class="tag">${k.label}</span>
      <h2>${esc(e.title)}</h2>
      <dl class="facts">
        <div><dt>When</dt><dd>${fLong(e.starts_at)}<br>${fTime(e.starts_at)}${e.ends_at ? ` – ${fTime(e.ends_at)}` : ''}</dd></div>
        ${e.location ? `<div><dt>Where</dt><dd>${esc(e.location)}<br><a href="https://maps.google.com/?q=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">Map ↗</a></dd></div>` : ''}
        <div><dt>Spots</dt><dd>${seatsLine(e)}${tableLine(e) ? `<br>${tableLine(e)}` : ''}</dd></div>
        ${e.gear_label ? `<div><dt>Gear</dt><dd>${gearLine(e)}</dd></div>` : ''}
      </dl>
      ${e.book_title ? `<div class="bookbox">${e.book_isbn ? `<img src="${coverUrl(e.book_isbn)}" alt="" width="72" class="cover">` : ''}<div><span class="tag">This month's book</span><strong>${esc(e.book_title)}</strong>${e.book_author ? `<span>${esc(e.book_author)}</span>` : ''}</div></div>` : ''}
      ${e.description ? `<p class="desc">${esc(e.description).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="cal-links">
        <button class="btn ghost" data-act="ics">Add to calendar (.ics)</button>
        <a class="btn ghost" href="${googleCalUrl(e, eventUrl(e.id))}" target="_blank" rel="noopener">Google Calendar ↗</a>
        <button class="btn ghost" data-act="share">Share</button>
      </div>
    </article>
    <section class="panel signup" id="signup">
      ${closed ? `<h3>${past ? 'This one already happened' : 'This event is full'}</h3><p>Check the calendar for the next one.</p>` : `
      <h3>${full ? 'Join the waitlist' : 'Save my spot'}</h3>
      ${full ? '<p class="hint">If someone cancels, the waitlist moves up automatically in order.</p>' : ''}
      <form id="f" novalidate>
        <label>Name<input name="name" required maxlength="80" autocomplete="name"></label>
        <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
        ${e.max_guests > 0 ? `<label>Party<select name="guests">${guestOpts}</select></label>` : ''}
        ${e.ask_skill ? `<label>How well do you know it?<select name="skill"><option value="new">Brand new: teach me</option><option value="learning" selected>Still learning</option><option value="experienced">Experienced: happy to help others</option></select></label>` : ''}
        ${e.gear_label ? `<label class="check"><input type="checkbox" name="brings_gear" value="1"> I can bring a ${esc(e.gear_label)}</label>` : ''}
        <label>Note <span class="opt">(optional — dietary needs, first-timer, etc.)</span><textarea name="note" maxlength="500" rows="2"></textarea></label>
        <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <div class="cf"></div>
        <button class="btn primary" type="submit">${full ? 'Join waitlist' : 'Sign me up'}</button>
        <p class="err" role="alert"></p>
      </form>`}
    </section>`;

  $app.querySelector('img.cover')?.addEventListener('error', (x) => x.target.remove());
  $app.querySelector('[data-act=ics]').onclick = () => downloadIcs(e, eventUrl(e.id));
  $app.querySelector('[data-act=share]').onclick = async () => {
    const url = eventUrl(e.id);
    if (navigator.share) { try { await navigator.share({ title: e.title, url }); } catch { /* dismissed */ } }
    else { await navigator.clipboard?.writeText(url); toast('Link copied'); }
  };

  const f = $app.querySelector('#f');
  if (!f) return;
  const shownAt = Date.now();
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'signup'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const err = f.querySelector('.err');
    if (d.website) return; // honeypot: bots get silence
    if (!d.name.trim()) return (err.textContent = 'Add your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return (err.textContent = 'That email looks off.');
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const cap = await capP; const captchaToken = await cap.wait();
      if (!captchaToken) throw new Error('CAPTCHA_FAILED');
      const r = await a.signUp(e.id, { ...d, guests: Number(d.guests || 0), brings_gear: !!d.brings_gear, captcha: captchaToken, elapsed_ms: Date.now() - shownAt });
      mine.add({ token: r.cancel_token, event_id: e.id, title: e.title, starts_at: e.starts_at, status: r.status, club: CLUB });
      confirmPanel(e, r, d.name);
    } catch (x) {
      err.textContent = friendly(x); btn.disabled = false; (await capP.catch(() => null))?.reset(); btn.textContent = full ? 'Join waitlist' : 'Sign me up';
    }
  };
}

function confirmPanel(e, r, name) {
  const cancelUrl = `${CONFIG.SITE_URL}/?club=${encodeURIComponent(CLUB)}#/cancel/${r.cancel_token}`;
  const wl = r.status === 'waitlist';
  $app.querySelector('#signup').innerHTML = `
    <div class="done ${wl ? 'wl' : ''}">
      <span class="big">${wl ? '⏳' : '✓'}</span>
      <h3>${wl ? `You're #${r.waitlist_position} on the waitlist` : `You're in, ${esc(name.split(' ')[0])}!`}</h3>
      <p>${wl ? "If a spot opens, you're moved up automatically. Check back under My signups." : `See you ${fDay(e.starts_at)} at ${fTime(e.starts_at)}.`}</p>
      <div class="cal-links">
        <button class="btn primary" data-act="ics2">Add to calendar</button>
        <a class="btn ghost" href="${googleCalUrl(e, eventUrl(e.id))}" target="_blank" rel="noopener">Google Calendar ↗</a>
      </div>
      ${document.body.dataset.mode === 'live' ? `<p class="small">${wl ? "We'll email you if a spot opens." : "A confirmation with the calendar invite is on its way to your inbox, and we'll remind you the day before."}</p>` : ''}
      <p class="small">Can't make it? Your cancel link (saved in <a href="#/mine">My signups</a> on this device):</p>
      <div class="copy"><input readonly value="${cancelUrl}"><button class="btn ghost" data-act="copy">Copy</button></div>
    </div>`;
  $app.querySelector('[data-act=ics2]').onclick = () => downloadIcs(e, eventUrl(e.id));
  $app.querySelector('[data-act=copy]').onclick = async () => { await navigator.clipboard?.writeText(cancelUrl); toast('Cancel link copied'); };
  postHeight();
}

// ───────────────────────── Cancel ─────────────────────────
async function viewCancel(a, token) {
  const s = await a.lookup(token);
  if (!s) throw new Error('SIGNUP_NOT_FOUND');
  const done = s.status === 'cancelled';
  $app.innerHTML = `
    <section class="panel">
      <h2>${done ? 'Already cancelled' : 'Cancel your spot?'}</h2>
      <p><strong>${esc(s.title)}</strong><br>${fLong(s.starts_at)} · ${fTime(s.starts_at)}</p>
      <p>Signed up as ${esc(s.name)}${s.guests ? ` + ${s.guests}` : ''} · <span class="status ${s.status}">${s.status}</span></p>
      ${s.table_no && !done ? `<p class="tableno">Your table: <strong>${s.table_no}</strong></p>` : ''}
      ${done ? '<a class="btn" href="#/">Back to calendar</a>' : '<button class="btn danger" data-act="cancel">Yes, cancel</button> <a class="btn ghost" href="#/">Keep it</a>'}
    </section>`;
  $app.querySelector('[data-act=cancel]')?.addEventListener('click', async () => {
    await a.cancel(token); mine.remove(token); toast('Cancelled — your spot went to the next person'); route();
  });
}

function viewMine() {
  const rows = mine.all().filter((r) => r.club === CLUB);
  $app.innerHTML = `
    <section class="panel">
      <h2>My signups</h2>
      <p class="hint">Saved on this device only.</p>
      ${rows.length ? `<ul class="mine">${rows.map((r) => `<li><a href="#/e/${r.event_id}"><strong>${esc(r.title)}</strong><br><span>${fDay(r.starts_at)} · ${fTime(r.starts_at)}</span></a><a class="btn ghost sm" href="#/cancel/${r.token}">Manage</a></li>`).join('')}</ul>` : '<p class="empty">Nothing yet. <a href="#/">Find something fun →</a></p>'}
    </section>`;
}

// ───────────────────────── Admin ─────────────────────────
async function viewAdmin(a) {
  const s = await a.session();
  if (!s) return loginStep(a);
  // MFA is required for organizers. The database enforces it too (is_club_admin needs aal2).
  const m = await a.mfaState();
  if (m.level !== 'aal2') return m.factorId ? mfaChallenge(a, m.factorId) : mfaEnroll(a, s.user.email);
  startIdleTimer(a);
  const clubs = await a.myClubs();
  if (!clubs.length) {
    $app.innerHTML = `<section class="panel"><h2>No clubs yet</h2><p>You're signed in as ${esc(s.user.email)}, but not an admin of any club. Run the <code>club_admins</code> insert from <code>supabase/schema.sql</code>.</p><button class="btn ghost" data-act="out">Sign out</button></section>`;
    $app.querySelector('[data-act=out]').onclick = async () => { await a.signOut(); route(); };
    return;
  }
  const club = clubs.find((c) => c.id === CLUB) || clubs[0];
  const events = await a.adminEvents(club.id);
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.starts_at) >= now);
  const pastEv = events.filter((e) => new Date(e.starts_at) < now).reverse();

  const row = (e) => `<li><div><strong>${esc(e.title)}</strong>${e.published ? '' : ' <span class="status waitlist">draft</span>'}<br><span>${fDay(e.starts_at)} · ${fTime(e.starts_at)} · ${kind(e.kind).label}${e.capacity ? ` · cap ${e.capacity}` : ''}</span></div>
    <div class="row-acts"><button class="btn ghost sm" data-roster="${e.id}">Roster</button><button class="btn ghost sm" data-edit="${e.id}">Edit</button><button class="btn ghost sm" data-dup="${e.id}" title="Copy one week later">+1 wk</button></div></li>`;

  $app.innerHTML = `
    <section class="admin">
      <div class="admin-head"><div><h2>${esc(club.name)}</h2><p class="hint">Signed in as ${esc(s.user.email)} ${a.mode === 'demo' ? '· <button class="link" data-act="reset">reset demo data</button>' : ''}</p></div>
      <div><button class="btn primary" data-act="new">+ New event</button> <button class="btn ghost" data-act="out">Sign out</button> <button class="link" data-act="outall" title="Ends sessions on every device">Sign out everywhere</button></div></div>
      <div id="editor"></div>
      <h3>Upcoming (${upcoming.length})</h3><ul class="admin-list">${upcoming.map(row).join('') || '<li class="empty">No upcoming events.</li>'}</ul>
      ${pastEv.length ? `<details><summary>Past (${pastEv.length})</summary><ul class="admin-list">${pastEv.map(row).join('')}</ul></details>` : ''}
      <div class="embed-help panel">
        <h3>Embed this calendar</h3>
        <p class="hint">Paste on any site (the 518 Analog Club home page already has it):</p>
        <textarea readonly rows="3">&lt;iframe src="${CONFIG.SITE_URL}/?club=${club.id}&amp;embed=1" style="width:100%;border:0;min-height:640px" title="${esc(club.name)} events" loading="lazy"&gt;&lt;/iframe&gt;</textarea>
      </div>
    </section>`;

  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  $app.querySelector('[data-act=new]').onclick = () => editor(a, club, null);
  $app.querySelector('[data-act=out]').onclick = async () => { await a.signOut(); route(); };
  $app.querySelector('[data-act=outall]').onclick = async () => { await a.signOut(true); toast('Signed out on all devices'); route(); };
  $app.querySelector('[data-act=reset]')?.addEventListener('click', () => { a.resetDemo(); toast('Demo data reset'); route(); });
  $app.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editor(a, club, byId[b.dataset.edit]));
  $app.querySelectorAll('[data-roster]').forEach((b) => b.onclick = () => roster(a, byId[b.dataset.roster]));
  $app.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => {
    const src = byId[b.dataset.dup]; const wk = 7 * 864e5;
    const copy = { ...src, id: undefined, starts_at: new Date(new Date(src.starts_at).getTime() + wk).toISOString(), ends_at: src.ends_at ? new Date(new Date(src.ends_at).getTime() + wk).toISOString() : null };
    editor(a, club, copy);
  });
}


// ───────────────────────── Organizer auth ─────────────────────────
// Step 1: email + CAPTCHA → Supabase emails a 6-digit code (and a link, for convenience).
function loginStep(a) {
  $app.innerHTML = `
    <section class="panel narrow auth">
      <p class="step">Organizer sign-in · step 1 of 2</p>
      <h2>Sign in</h2>
      <p class="hint">${a.mode === 'demo' ? 'Demo mode: any email works, nothing is sent.' : "We'll email you a 6-digit code. No passwords to leak."}</p>
      <form id="login"><label>Email<input name="email" type="email" required autocomplete="username email"></label>
      <div class="cf"></div>
      <button class="btn primary">Email me a code</button><p class="err" role="alert"></p></form>
    </section>`;
  const f = $app.querySelector('#login');
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'login'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const email = String(new FormData(f).get('email')).trim().toLowerCase();
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const cap = await capP; const token = await cap.wait();
      if (!token) throw new Error('CAPTCHA_FAILED');
      await a.signIn(email, token);
      codeStep(a, email);
    } catch (x) { f.querySelector('.err').textContent = friendly(x); btn.disabled = false; (await capP.catch(() => null))?.reset(); }
  };
}

// Step 1b: type the code. Works even when a corporate mail scanner "clicks" the link first,
// or when the email is opened on a different device than the browser.
function codeStep(a, email) {
  $app.innerHTML = `
    <section class="panel narrow auth">
      <p class="step">Organizer sign-in · step 1 of 2</p>
      <h2>Check your email</h2>
      <p class="hint">If <strong>${esc(email)}</strong> is an organizer account, a 6-digit code is on its way. Use it within 15 minutes. ${a.mode === 'demo' ? '(Demo: type any 6 digits.)' : ''}</p>
      <form id="code"><label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="code"></label>
      <button class="btn primary">Continue</button><p class="err" role="alert"></p></form>
      <button class="link" data-act="back">Use a different email</button>
    </section>`;
  const f = $app.querySelector('#code');
  f.querySelector('input').focus();
  $app.querySelector('[data-act=back]').onclick = () => loginStep(a);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await a.verifyCode(email, String(new FormData(f).get('code')).trim()); route(); }
    catch (x) { f.querySelector('.err').textContent = friendly(x); }
  };
}

// Step 2a (first sign-in only): set up an authenticator app.
async function mfaEnroll(a, email) {
  const e = await a.mfaEnroll();
  $app.innerHTML = `
    <section class="panel narrow auth">
      <p class="step">Organizer sign-in · step 2 of 2</p>
      <h2>Set up your authenticator</h2>
      <p class="hint">Organizer accounts can see attendee names and emails, so they need a second factor. Scan this with 1Password, Google Authenticator, Authy or similar.</p>
      <img class="qr" src="${e.qr}" alt="QR code for your authenticator app" width="180" height="180">
      <details><summary>Can't scan? Enter this key</summary><code class="secret">${esc(e.secret)}</code></details>
      <form id="mfa"><label>6-digit code from the app<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="code"></label>
      <button class="btn primary">Turn on and continue</button><p class="err" role="alert"></p></form>
      <button class="link" data-act="out">Cancel and sign out</button>
    </section>`;
  bindMfaForm(a, e.factorId);
}

// Step 2b (every sign-in after that): enter the current authenticator code.
function mfaChallenge(a, factorId) {
  $app.innerHTML = `
    <section class="panel narrow auth">
      <p class="step">Organizer sign-in · step 2 of 2</p>
      <h2>Authenticator code</h2>
      <p class="hint">Open your authenticator app and enter the current code for signmeupdaddy.</p>
      <form id="mfa"><label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="code"></label>
      <button class="btn primary">Verify</button><p class="err" role="alert"></p></form>
      <p class="hint small">Lost your phone? Another organizer, or you in the Supabase dashboard (Authentication → Users → this user → remove MFA factor), can reset it.</p>
      <button class="link" data-act="out">Sign out</button>
    </section>`;
  bindMfaForm(a, factorId);
}

function bindMfaForm(a, factorId) {
  const f = $app.querySelector('#mfa');
  f.querySelector('input').focus();
  $app.querySelector('[data-act=out]').onclick = async () => { await a.signOut(); route(); };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await a.mfaVerify(factorId, String(new FormData(f).get('code')).trim()); route(); }
    catch (x) { f.querySelector('.err').textContent = friendly(x); f.reset(); }
  };
}

// Organizer sessions end after a stretch of inactivity (shared/borrowed devices at venues).
let idleTimer, idleBound = false;
function startIdleTimer(a) {
  const mins = Number(CONFIG.ORGANIZER_IDLE_MINUTES || 30);
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => { await a.signOut(); toast('Signed out after inactivity'); if (location.hash.startsWith('#/admin')) route(); }, mins * 60e3);
  };
  if (!idleBound) { ['pointerdown', 'keydown', 'scroll', 'visibilitychange'].forEach((t) => addEventListener(t, reset, { passive: true })); idleBound = true; }
  reset();
}

const KIND_DEFAULTS = {
  mahjong: { table_size: 4, gear_label: 'mahjong set', ask_skill: true },
  trivia: { table_size: 6, gear_label: null, ask_skill: false },
  craft: { table_size: null, gear_label: null, ask_skill: true },
  book: { table_size: null, gear_label: null, ask_skill: false },
};

function editor(a, club, e) {
  const box = $app.querySelector('#editor');
  const isNew = !e?.id;
  const ev = e || { kind: 'mahjong', capacity: 16, max_guests: 1, waitlist: true, published: true, starts_at: new Date(Date.now() + 7 * 864e5).toISOString(), ...KIND_DEFAULTS.mahjong };
  const hrs = ev.ends_at ? (new Date(ev.ends_at) - new Date(ev.starts_at)) / 3600e3 : 2;
  box.innerHTML = `
    <form class="panel editor" id="ef">
      <h3>${isNew ? 'New event' : 'Edit event'}</h3>
      <div class="two">
        <label>Title<input name="title" required maxlength="120" value="${esc(ev.title || '')}"></label>
        <label>Type<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${ev.kind === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label>Starts<input name="starts_at" type="datetime-local" required value="${toLocalInput(ev.starts_at)}"></label>
        <label>Length (hours)<input name="hours" type="number" min="0.5" max="24" step="0.5" value="${hrs}"></label>
        <label>Capacity <span class="opt">(blank = unlimited)</span><input name="capacity" type="number" min="1" value="${ev.capacity ?? ''}"></label>
        <label>Guests per signup<input name="max_guests" type="number" min="0" max="10" value="${ev.max_guests}"></label>
      </div>
      <label>Location<input name="location" maxlength="200" value="${esc(ev.location || '')}"></label>
      <label>Description<textarea name="description" rows="4">${esc(ev.description || '')}</textarea></label>
      <fieldset class="opts"><legend>Tables &amp; gear <span class="opt">(game nights)</span></legend>
        <div class="two">
          <label>Players per table <span class="opt">(blank = no tables)</span><input name="table_size" type="number" min="2" max="12" value="${ev.table_size ?? ''}"></label>
          <label>Gear each table needs <span class="opt">(e.g. mahjong set)</span><input name="gear_label" maxlength="40" value="${esc(ev.gear_label || '')}"></label>
        </div>
        <label class="check"><input type="checkbox" name="ask_skill"${ev.ask_skill ? ' checked' : ''}> Ask experience level (used to seat beginners with experienced players)</label>
      </fieldset>
      <fieldset class="opts"><legend>Book <span class="opt">(book club)</span></legend>
        <div class="two">
          <label>Title<input name="book_title" maxlength="160" value="${esc(ev.book_title || '')}"></label>
          <label>Author<input name="book_author" maxlength="120" value="${esc(ev.book_author || '')}"></label>
          <label>ISBN <span class="opt">(shows the cover)</span><input name="book_isbn" maxlength="17" pattern="[0-9Xx-]{10,17}" value="${esc(ev.book_isbn || '')}"></label>
        </div>
      </fieldset>
      <div class="checks"><label><input type="checkbox" name="waitlist"${ev.waitlist ? ' checked' : ''}> Waitlist when full</label>
      <label><input type="checkbox" name="published"${ev.published ? ' checked' : ''}> Published</label></div>
      <div class="acts"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-act="x">Close</button>
      ${isNew ? '' : '<button class="btn danger" type="button" data-act="del">Delete</button>'}</div>
      <p class="err" role="alert"></p>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const f = box.querySelector('#ef');
  f.querySelector('[data-act=x]').onclick = () => (box.innerHTML = '');
  if (isNew) f.kind.onchange = () => {
    const d = KIND_DEFAULTS[f.kind.value] || {};
    f.table_size.value = d.table_size ?? ''; f.gear_label.value = d.gear_label ?? ''; f.ask_skill.checked = !!d.ask_skill;
  };
  f.querySelector('[data-act=del]')?.addEventListener('click', async () => {
    if (!(await ask(`Delete "${ev.title}" and all its signups? This can't be undone.`, 'Delete'))) return;
    await a.deleteEvent(ev.id); toast('Deleted'); route();
  });
  f.onsubmit = async (x) => {
    x.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const starts = fromLocalInput(d.starts_at);
    const out = {
      ...(isNew ? {} : { id: ev.id }), club_id: club.id, title: d.title.trim(), kind: d.kind,
      starts_at: starts, ends_at: new Date(new Date(starts).getTime() + Number(d.hours || 2) * 3600e3).toISOString(),
      capacity: d.capacity ? Number(d.capacity) : null, max_guests: Number(d.max_guests || 0),
      location: d.location.trim(), description: d.description.trim(), waitlist: !!d.waitlist, published: !!d.published,
      table_size: d.table_size ? Number(d.table_size) : null, gear_label: d.gear_label.trim() || null, ask_skill: !!d.ask_skill,
      book_title: d.book_title.trim() || null, book_author: d.book_author.trim() || null, book_isbn: d.book_isbn.trim() || null,
    };
    try { await a.saveEvent(out); toast('Saved'); route(); } catch (y) { f.querySelector('.err').textContent = friendly(y); }
  };
}

const SKILL = { new: 'New', learning: 'Learning', experienced: 'Experienced' };

// Per-email attendance at past nights: how many they showed up for vs. signed up and didn't.
async function attendance(a, clubId) {
  const rows = await a.history(clubId).catch(() => []);
  const m = {};
  for (const r of rows) { const k = r.email.toLowerCase(); (m[k] ||= { came: 0, missed: 0 }); r.checked_in_at ? m[k].came++ : m[k].missed++; }
  return m;
}
function badge(h) {
  if (!h) return '<span class="badge newface" title="No past nights on record">first time</span>';
  if (h.missed >= 2 || (h.missed && h.missed >= h.came)) return `<span class="badge warn" title="Came ${h.came}, missed ${h.missed}">${h.missed} no-show${h.missed > 1 ? 's' : ''}</span>`;
  return `<span class="badge ok" title="Came ${h.came}, missed ${h.missed}">${h.came}× regular</span>`;
}

async function roster(a, e, mode = 'list') {
  const box = $app.querySelector('#editor');
  const [rows, hist] = await Promise.all([a.roster(e.id), attendance(a, e.club_id)]);
  const active = rows.filter((r) => r.status !== 'cancelled');
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  const seats = confirmed.reduce((n, r) => n + 1 + r.guests, 0);
  const inCount = confirmed.filter((r) => r.checked_in_at).length;
  const tablesNeeded = e.table_size ? Math.ceil(seats / e.table_size) : 0;
  const gearHave = confirmed.filter((r) => r.brings_gear).length;
  const seated = confirmed.some((r) => r.table_no);
  const isPast = new Date(e.starts_at) < new Date(Date.now() - 6 * 3600e3);

  const head = `
    <div class="admin-head"><div><h3>${esc(e.title)}</h3>
      <p class="hint">${fDay(e.starts_at)} · ${seats}${e.capacity ? ` / ${e.capacity}` : ''} seats · ${rows.filter((r) => r.status === 'waitlist').length} waitlisted · <strong>${inCount}/${confirmed.length} checked in</strong>
      ${e.table_size ? ` · ${tablesNeeded} table${tablesNeeded === 1 ? '' : 's'}` : ''}${e.gear_label ? ` · <span class="${gearHave < tablesNeeded ? 'short' : ''}">${gearHave} ${esc(e.gear_label)}${gearHave === 1 ? '' : 's'} for ${tablesNeeded} table${tablesNeeded === 1 ? '' : 's'}</span>` : ''}</p></div>
      <div class="row-acts">
        ${mode === 'door' ? '<button class="btn primary sm" data-act="list">Done checking in</button>' : `<button class="btn primary sm" data-act="door">Door check-in</button>`}
        ${e.table_size && mode !== 'door' ? `<button class="btn ghost sm" data-act="seat">${seated ? 'Re-seat' : 'Seat'} tables</button>` : ''}
        <button class="btn ghost sm" data-act="print">Print roster</button>
        ${seated ? '<button class="btn ghost sm" data-act="cards">Print table cards</button>' : ''}
        <button class="btn ghost sm" data-act="csv">CSV</button>
        <button class="btn ghost sm" data-act="emails">Copy emails</button>
        <button class="btn ghost sm" data-act="x">Close</button>
      </div></div>`;

  if (mode === 'door') {
    // Big tap targets, alphabetical, with a search box: built for a phone at the door.
    const list = confirmed.slice().sort((x, y) => x.name.localeCompare(y.name));
    box.innerHTML = `<div class="panel door">${head}
      <input class="door-search" type="search" placeholder="Type a name…" aria-label="Find attendee">
      <ul class="door-list">${list.map((r) => `<li data-name="${esc(r.name.toLowerCase())}"><button class="door-row${r.checked_in_at ? ' in' : ''}" data-ci="${r.id}" data-on="${r.checked_in_at ? 1 : 0}">
        <span class="tick">${r.checked_in_at ? '✓' : ''}</span><span class="who"><strong>${esc(r.name)}</strong>${r.guests ? ` <span>+${r.guests}</span>` : ''}${r.skill === 'new' ? ' <span class="badge newface">teach me</span>' : ''}</span>
        ${r.table_no ? `<span class="tbl">T${r.table_no}</span>` : ''}</button></li>`).join('')}</ul></div>`;
    const search = box.querySelector('.door-search');
    search.oninput = () => box.querySelectorAll('.door-list li').forEach((li) => { li.hidden = !li.dataset.name.includes(search.value.trim().toLowerCase()); });
    search.focus();
  } else {
    box.innerHTML = `<div class="panel">${head}
      <div id="seating"></div>
      <div class="table-wrap"><table><thead><tr><th>In</th><th>Name</th><th>Email</th><th>Party</th>${e.ask_skill ? '<th>Level</th>' : ''}${e.gear_label ? '<th>Gear</th>' : ''}${e.table_size ? '<th>Table</th>' : ''}<th>Status</th><th>Note</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.status}">
        <td>${r.status === 'confirmed' ? `<input type="checkbox" class="ci" data-ci="${r.id}" data-on="${r.checked_in_at ? 1 : 0}" ${r.checked_in_at ? 'checked' : ''} aria-label="Checked in">` : ''}</td>
        <td>${esc(r.name)} ${r.status !== 'cancelled' ? badge(hist[r.email.toLowerCase()]) : ''}</td><td>${esc(r.email)}</td><td>${1 + r.guests}</td>
        ${e.ask_skill ? `<td>${SKILL[r.skill] || ''}</td>` : ''}${e.gear_label ? `<td>${r.brings_gear ? '✓' : ''}</td>` : ''}${e.table_size ? `<td>${r.table_no ?? ''}</td>` : ''}
        <td><span class="status ${r.status}">${r.status}</span></td><td>${esc(r.note)}</td>
        <td>${r.status !== 'cancelled' && !isPast ? `<button class="link" data-cx="${r.id}">cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">No signups yet.</td></tr>'}
      </tbody></table></div>
      <p class="hint small">Badges come from check-ins at past nights: “first time” means no history yet.</p>
    </div>`;
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const on = (sel, fn) => box.querySelector(sel)?.addEventListener('click', fn);
  on('[data-act=x]', () => (box.innerHTML = ''));
  on('[data-act=door]', () => roster(a, e, 'door'));
  on('[data-act=list]', () => roster(a, e, 'list'));
  on('[data-act=csv]', () => download(`${e.title.replace(/\W+/g, '-')}-roster.csv`, toCsv(rows, ['name', 'email', 'guests', 'skill', 'brings_gear', 'table_no', 'status', 'checked_in_at', 'note', 'created_at'])));
  on('[data-act=emails]', async () => { try { await navigator.clipboard.writeText(active.map((r) => r.email).join(', ')); toast(`${active.length} emails copied`); } catch { toast('Copy blocked by the browser'); } });
  on('[data-act=print]', () => printHtml(printRoster(e, confirmed)));
  on('[data-act=cards]', () => printHtml(printCards(e, confirmed)));
  on('[data-act=seat]', () => seatingPanel(a, e, rows));
  box.querySelectorAll('[data-ci]').forEach((b) => b.addEventListener(b.tagName === 'INPUT' ? 'change' : 'click', async () => {
    const turnOn = b.dataset.on !== '1';
    await a.checkIn(b.dataset.ci, turnOn);
    if (b.tagName === 'BUTTON') { b.dataset.on = turnOn ? 1 : 0; b.classList.toggle('in', turnOn); b.querySelector('.tick').textContent = turnOn ? '✓' : ''; }
    else b.dataset.on = turnOn ? 1 : 0;
    const n = box.querySelectorAll('[data-ci][data-on="1"]').length;
    const strong = box.querySelector('.admin-head strong'); if (strong) strong.textContent = `${n}/${confirmed.length} checked in`;
  }));
  box.querySelectorAll('[data-cx]').forEach((b) => b.onclick = async () => {
    if (!(await ask('Cancel this signup? The waitlist will move up.', 'Cancel signup'))) return;
    await a.adminCancel(b.dataset.cx); roster(a, e);
  });
}

// Suggested seating, shown before saving so the organizer can sanity-check it.
function seatingPanel(a, e, rows) {
  const box = $app.querySelector('#seating');
  const { tables, byId } = assignTables(rows, e.table_size);
  const who = Object.fromEntries(rows.map((r) => [r.id, r]));
  const warnings = [];
  tables.forEach((t) => {
    const seatedHere = e.table_size - t.free;
    if (seatedHere < e.table_size) warnings.push(`Table ${t.no} has ${seatedHere} of ${e.table_size}. Pull from the waitlist or merge.`);
    if (e.gear_label && !t.gear) warnings.push(`Table ${t.no} has nobody bringing a ${e.gear_label}.`);
    if (e.ask_skill && t.fresh && !t.exp) warnings.push(`Table ${t.no} has beginners but no experienced player.`);
  });
  box.innerHTML = `
    <div class="seating">
      <div class="seat-grid">${tables.map((t) => `<div class="seat-card"><span class="tno">Table ${t.no}</span>
        <ul>${t.ids.map((id) => { const r = who[id]; return `<li>${esc(r.name)}${r.guests ? ` +${r.guests}` : ''} ${r.skill === 'experienced' ? '<span class="badge ok">exp</span>' : r.skill === 'new' ? '<span class="badge newface">new</span>' : ''}${r.brings_gear ? ' <span class="badge gear">set</span>' : ''}</li>`; }).join('')}</ul></div>`).join('')}</div>
      ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="hint">Every table is full, has an experienced player and has gear.</p>'}
      <div class="acts"><button class="btn primary sm" data-act="saveseat">Save seating</button><button class="btn ghost sm" data-act="noseat">Discard</button></div>
    </div>`;
  box.querySelector('[data-act=noseat]').onclick = () => (box.innerHTML = '');
  box.querySelector('[data-act=saveseat]').onclick = async () => { await a.setTables(byId); toast('Seating saved. Attendees see their table on their signup page.'); roster(a, e); };
  postHeight();
}

function printRoster(e, rows) {
  const list = rows.slice().sort((x, y) => (x.table_no ?? 999) - (y.table_no ?? 999) || x.name.localeCompare(y.name));
  return `<div class="print-roster"><h1>${esc(e.title)}</h1><p>${fLong(e.starts_at)} · ${fTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</p>
    <table><thead><tr><th>✓</th><th>Name</th><th>Party</th>${e.table_size ? '<th>Table</th>' : ''}${e.ask_skill ? '<th>Level</th>' : ''}<th>Note</th></tr></thead><tbody>
    ${list.map((r) => `<tr><td class="box">☐</td><td>${esc(r.name)}</td><td>${1 + r.guests}</td>${e.table_size ? `<td>${r.table_no ?? ''}</td>` : ''}${e.ask_skill ? `<td>${SKILL[r.skill] || ''}</td>` : ''}<td>${esc(r.note)}</td></tr>`).join('')}
    </tbody></table><p class="foot-note">Printed from signmeupdaddy · ${list.length} signups</p></div>`;
}
function printCards(e, rows) {
  const by = {};
  rows.filter((r) => r.table_no).forEach((r) => (by[r.table_no] ||= []).push(r));
  return Object.keys(by).sort((x, y) => x - y).map((no) => `<section class="table-card"><p class="club">${esc(state.club?.name || '')} · ${esc(e.title)}</p>
    <div class="big">${no}</div><p class="lbl">TABLE</p><ul>${by[no].map((r) => `<li>${esc(r.name)}${r.guests ? ` + ${r.guests}` : ''}</li>`).join('')}</ul></section>`).join('');
}

route();
