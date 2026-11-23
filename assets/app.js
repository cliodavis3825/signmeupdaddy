import { CONFIG } from './config.js';
import { api, friendly, mine } from './api.js';
import { captcha, tableProgress, gearProgress, assignTables, printHtml, esc, fDay, fLong, fTime, fMonth, dayKey, kind, KINDS, downloadIcs, googleCalUrl, toCsv, shortName, download, toLocalInput, fromLocalInput } from './util.js';

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
  // Coming back from the emailed sign-in link: let the auth library read the tokens in the URL first, then land on the admin page.
  // (The link used to point at '#/admin', which collides with the token hash and bounced people back to the sign-in form.)
  if (params.has('admin') || /access_token|error_code/.test(location.hash)) {
    await a.session();
    if (/error_code=otp_expired|error_code=access_denied/.test(location.hash)) toast('That sign-in link expired. Request a new code.');
    if (params.has('admin') || /error_code/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + '?club=' + encodeURIComponent(CLUB) + '#/admin');
    }
  }
  const [, view, arg, arg2] = (location.hash.slice(1) || '/').split('/');
  try {
    if (view === 'e') await viewEvent(a, arg);
    else if (view === 'cancel') await viewCancel(a, arg);
    else if (view === 'mine' || view === 'me') await viewMe(a, view === 'me' ? arg : null);
    else if (view === 'subscribe') viewSubscribe(a);
    else if (view === 'report') viewReport(a);
    else if (view === 'list') await viewList(a, arg, arg2);
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
    </section>
    ${EMBED ? '' : '<section class="panel subbox" id="subbox"></section>'}`;
  if (!EMBED) api().then((a) => subscribeBox(a, $app.querySelector('#subbox')));

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
    </section>
    <section class="panel posts" id="posts"><p class="hint">Loading updates…</p></section>`;
  postsPanel(a, e);

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
      <p class="small">Can't make it? Your cancel link (saved in <a href="#/me">My signups</a> on this device):</p>
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

// ───────────────────────── My signups (all clubs) ─────────────────────────
// No account needed: enter your email, tap the emailed link, and this device stays signed in for 60 days.
const MEM = 'smud-member';
const memGet = () => { try { return JSON.parse(localStorage.getItem(MEM)); } catch { return null; } };
const memSet = (v) => { try { v ? localStorage.setItem(MEM, JSON.stringify(v)) : localStorage.removeItem(MEM); } catch { /* storage blocked */ } };

async function viewMe(a, token) {
  if (token) {
    $app.innerHTML = '<section class="panel"><p class="empty">Signing you in…</p></section>';
    try { const r = await a.member({ action: 'redeem', token }); memSet({ session: r.session, email: r.email }); }
    catch (err) { memSet(null); return meLogin(a, friendly(err)); }
    history.replaceState(null, '', location.pathname + location.search + '#/me');
  }
  const m = memGet();
  if (!m) return meLogin(a);
  let d;
  try { d = await a.member({ action: 'list', session: m.session }); }
  catch (err) { memSet(null); return meLogin(a, String(err.message).includes('SESSION_EXPIRED') ? friendly(err) : '' ); }
  const now = Date.now();
  const up = d.signups.filter((r) => new Date(r.event.starts_at) >= now).sort((x, y) => x.event.starts_at.localeCompare(y.event.starts_at));
  const past = d.signups.filter((r) => new Date(r.event.starts_at) < now).sort((x, y) => y.event.starts_at.localeCompare(x.event.starts_at));
  const link = (e) => `${CONFIG.SITE_URL}/app/?club=${encodeURIComponent(e.club_id)}#/e/${e.id}`;
  // one colour per club so the single calendar stays readable
  const PAL = ['#2f6b4f', '#b4472f', '#3b5f9c', '#8a5a9e', '#b88a1f', '#2a7f86'];
  const clubIds = [...new Set([...d.signups.map((r) => r.event.club_id), ...d.lists.map((l) => l.club_id)])];
  const clubName = (id) => d.signups.find((r) => r.event.club_id === id)?.event.club_name || d.lists.find((l) => l.club_id === id)?.club_name || id;
  const col = (id) => PAL[clubIds.indexOf(id) % PAL.length];
  const m0 = state.meMonth ||= startOfMonth(new Date());
  const byDay = {};
  d.signups.forEach((r) => (byDay[dayKey(r.event.starts_at)] ||= []).push(r));
  const lead = new Date(m0).getDay(); const daysIn = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
  const todayKey = dayKey(new Date()); const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cell pad"></div>');
  for (let n = 1; n <= daysIn; n++) {
    const date = new Date(m0.getFullYear(), m0.getMonth(), n, 12); const key = dayKey(date); const evs = byDay[key] || [];
    cells.push(`<button class="cell${key === todayKey ? ' today' : ''}${date < new Date(new Date().setHours(0, 0, 0, 0)) ? ' past' : ''}${evs.length ? ' has' : ''}${state.meDay === key ? ' sel' : ''}" data-day="${key}" ${evs.length ? '' : 'tabindex="-1"'} aria-label="${fDay(date)}${evs.length ? `, ${evs.length} signup${evs.length > 1 ? 's' : ''}` : ''}">
      <span class="num">${n}</span><span class="dots">${evs.slice(0, 3).map((r) => `<i style="background:${col(r.event.club_id)}"></i>`).join('')}</span>
      <span class="mini">${evs.slice(0, 2).map((r) => `<em style="--k:${col(r.event.club_id)}">${esc(r.event.title)}</em>`).join('')}</span></button>`);
  }
  const row = (r, canCancel) => `<li><div><span class="clubtag" style="--k:${col(r.event.club_id)}">${esc(r.event.club_name || r.event.club_id)}</span><br><a href="${esc(link(r.event))}"><strong>${esc(r.event.title)}</strong></a>${r.status === 'waitlist' ? ' <span class="status waitlist">waitlist</span>' : ''}<br><span>${fDay(r.event.starts_at)} · ${fTime(r.event.starts_at)}${r.guests ? ` · +${r.guests} guest${r.guests > 1 ? 's' : ''}` : ''}</span></div>
    ${canCancel ? `<div class="row-acts"><button class="btn ghost sm" data-cancel="${esc(r.id)}">Cancel</button></div>` : ''}</li>`;
  const shown = state.meDay ? d.signups.filter((r) => dayKey(r.event.starts_at) === state.meDay).sort((x, y) => x.event.starts_at.localeCompare(y.event.starts_at)) : up;
  $app.innerHTML = `
    <section class="panel"><div class="admin-head"><div><h2>My signups</h2><p class="hint">${esc(d.email)} · ${clubIds.length} club${clubIds.length === 1 ? '' : 's'}</p></div><button class="btn ghost" data-out>Sign out</button></div>
      <div class="cal-head"><button class="icon" data-mm="-1" aria-label="Previous month">‹</button><h3 style="margin:0">${fMonth(m0)}</h3><button class="icon" data-mm="1" aria-label="Next month">›</button></div>
      ${clubIds.length > 1 ? `<p class="legend">${clubIds.map((id) => `<span class="clubtag" style="--k:${col(id)}">${esc(clubName(id))}</span>`).join(' ')}</p>` : ''}
      <div class="grid dow">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="grid days">${cells.join('')}</div>
      <div class="list-head"><h3>${state.meDay ? fLong(state.meDay + 'T12:00:00') : 'Coming up'}</h3>${state.meDay ? '<button class="link" data-clear>Show all upcoming</button>' : ''}</div>
      <ul class="admin-list">${shown.map((r) => row(r, new Date(r.event.starts_at) >= now)).join('') || `<li class="empty">${state.meDay ? 'Nothing on this day.' : 'Nothing coming up. Find something fun on a club calendar.'}</li>`}</ul>
      ${past.length ? `<details><summary>Past (${past.length})</summary><ul class="admin-list">${past.map((r) => row(r, false)).join('')}</ul></details>` : ''}
    </section>
    <section class="panel"><h3>Email lists</h3>
      <ul class="admin-list">${d.lists.map((l) => `<li><div><span class="clubtag" style="--k:${col(l.club_id)}">${esc(l.club_name || l.club_id)}</span>${l.status === 'pending' ? ' <span class="status waitlist">waiting for your confirmation</span>' : ''}</div><div class="row-acts"><button class="btn ghost sm" data-unsub="${l.id}">Unsubscribe</button></div></li>`).join('') || '<li class="empty">You\'re not on any club email lists.</li>'}</ul>
    </section>`;
  $app.querySelectorAll('[data-mm]').forEach((b) => b.onclick = () => { state.meMonth = new Date(m0.getFullYear(), m0.getMonth() + Number(b.dataset.mm), 1); state.meDay = null; viewMe(a, null); });
  $app.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { if (!b.classList.contains('has')) return; state.meDay = state.meDay === b.dataset.day ? null : b.dataset.day; viewMe(a, null); });
  $app.querySelector('[data-clear]')?.addEventListener('click', () => { state.meDay = null; viewMe(a, null); });
  $app.querySelector('[data-out]').onclick = async () => { try { await a.member({ action: 'logout', session: m.session }); } catch { /* already gone */ } memSet(null); viewMe(a, null); };
  const act = async (body, ok) => { try { await a.member({ ...body, session: m.session }); toast(ok); viewMe(a, null); } catch (err) { toast(friendly(err)); } };
  $app.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => { if (await ask('Cancel this signup? Your spot goes to the next person.', 'Cancel signup')) act({ action: 'cancel', signup_id: b.dataset.cancel }, 'Signup cancelled'); });
  $app.querySelectorAll('[data-unsub]').forEach((b) => b.onclick = async () => { if (await ask('Stop emails from this club?', 'Unsubscribe')) act({ action: 'unsubscribe', list_id: Number(b.dataset.unsub) }, 'Unsubscribed'); });
}

function meLogin(a, msg = '') {
  const local = mine.all();
  $app.innerHTML = `
    <section class="panel narrow auth">
      <h2>My signups</h2>
      <p class="hint">See everything you've signed up for, across every club. Enter the email you used and we'll send a one-tap link. No password.</p>
      <form id="ml"><label>Email<input name="email" type="email" required autocomplete="email" maxlength="120"></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="cf"></div><button class="btn primary">Email me a link</button><p class="err" role="alert">${esc(msg)}</p></form>
      ${local.length ? `<p class="hint">On this device only: ${local.map((r) => `<a href="#/cancel/${esc(r.token)}">${esc(r.title)}</a>`).join(', ')}</p>` : ''}
    </section>`;
  const f = $app.querySelector('#ml'); const shownAt = Date.now();
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'member'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f)); if (d.website) return;
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const cap = await capP; const token = await cap.wait();
      if (!token) throw new Error('CAPTCHA_FAILED');
      await a.member({ action: 'request', email: d.email.trim().toLowerCase(), captcha: token, elapsed_ms: Date.now() - shownAt, website: '' });
      $app.querySelector('.auth').innerHTML = `<h2>Check your email</h2><p>If <strong>${esc(d.email)}</strong> has signed up for anything, a link is on its way. It works for 20 minutes. Nothing arrived? Check spam, or make sure you used the same email you signed up with.</p>`;
    } catch (x) { f.querySelector('.err').textContent = friendly(x); btn.disabled = false; (await capP.catch(() => null))?.reset(); }
  };
}

// ───────────────────────── Admin ─────────────────────────
const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const fWhen = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const ROLE = { site: 'Site owner', owner: 'Club owner', organizer: 'Organizer' };

async function viewAdmin(a) {
  const s = await a.session();
  if (!s) return loginStep(a);
  // MFA is required for organizers. The database enforces it too (is_club_admin needs aal2).
  const m = await a.mfaState();
  if (m.level !== 'aal2') return m.factorId ? mfaChallenge(a, m.factorId) : mfaEnroll(a, s.user.email);
  startIdleTimer(a);
  const clubs = await a.myClubs();
  if (!clubs.length) {
    $app.innerHTML = `<section class="panel"><h2>No clubs yet</h2><p>You're signed in as ${esc(s.user.email)}, but you haven't been added to a club. Ask a club owner to add you from <strong>People &amp; settings</strong>.</p><button class="btn ghost" data-act="out">Sign out</button></section>`;
    $app.querySelector('[data-act=out]').onclick = async () => { await a.signOut(); route(); };
    return;
  }
  const club = clubs.find((c) => c.id === state.adminClub) || clubs.find((c) => c.id === CLUB) || clubs[0];
  const isSite = clubs[0].role === 'site';
  const canManage = club.role === 'site' || club.role === 'owner';
  const tabs = [['events', 'Events'], ['list', 'Email list'], ['news', 'Newsletter'], ...(canManage ? [['people', 'People & settings']] : []), ['activity', 'Activity'],
    ...(isSite ? [['requests', 'New clubs'], ['reports', 'Issue reports']] : [])];
  if (!tabs.some(([k]) => k === state.adminTab)) state.adminTab = 'events';

  $app.innerHTML = `
    <section class="admin">
      <div class="admin-head"><div>
        ${clubs.length > 1 ? `<select id="clubsel" aria-label="Club">${clubs.map((c) => `<option value="${esc(c.id)}"${c.id === club.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : `<h2>${esc(club.name)}</h2>`}
        <p class="hint">${esc(s.user.email)} · ${ROLE[club.role] || 'Organizer'} ${a.mode === 'demo' ? '· <button class="link" data-act="reset">reset demo data</button>' : ''}</p></div>
      <div><button class="btn ghost" data-act="out">Sign out</button> <button class="link" data-act="outall" title="Ends sessions on every device">Sign out everywhere</button></div></div>
      <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="tab${k === state.adminTab ? ' on' : ''}" data-tab="${k}" aria-selected="${k === state.adminTab}">${l}</button>`).join('')}</nav>
      <div id="tab"></div>
    </section>`;
  $app.querySelector('#clubsel')?.addEventListener('change', (e) => { state.adminClub = e.target.value; viewAdmin(a); });
  $app.querySelector('[data-act=out]').onclick = async () => { await a.signOut(); route(); };
  $app.querySelector('[data-act=outall]').onclick = async () => { await a.signOut(true); toast('Signed out on all devices'); route(); };
  $app.querySelector('[data-act=reset]')?.addEventListener('click', () => { a.resetDemo(); toast('Demo data reset'); route(); });
  $app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { state.adminTab = b.dataset.tab; viewAdmin(a); });
  const el = $app.querySelector('#tab');
  const tab = { events: eventsTab, list: listTab, news: newsTab, people: peopleTab, activity: activityTab, requests: requestsTab, reports: reportsTab }[state.adminTab];
  try { await tab(a, club, el, s); } catch (err) { el.innerHTML = `<p class="err">${esc(friendly(err))}</p>`; }
}

async function eventsTab(a, club, el) {
  const events = await a.adminEvents(club.id);
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.starts_at) >= now);
  const pastEv = events.filter((e) => new Date(e.starts_at) < now).reverse();
  const row = (e) => `<li><div><strong>${esc(e.title)}</strong>${e.published ? '' : ' <span class="status waitlist">draft</span>'}<br><span>${fDay(e.starts_at)} · ${fTime(e.starts_at)} · ${kind(e.kind).label}${e.capacity ? ` · cap ${e.capacity}` : ''}</span></div>
    <div class="row-acts"><button class="btn ghost sm" data-roster="${e.id}">Roster</button><button class="btn ghost sm" data-posts="${e.id}">Updates</button><button class="btn ghost sm" data-edit="${e.id}">Edit</button><button class="btn ghost sm" data-dup="${e.id}" title="Copy one week later">+1 wk</button></div></li>`;
  el.innerHTML = `
    <p><button class="btn primary" data-act="new">+ New event</button></p>
    <div id="editor"></div>
    <h3>Upcoming (${upcoming.length})</h3><ul class="admin-list">${upcoming.map(row).join('') || '<li class="empty">No upcoming events.</li>'}</ul>
    ${pastEv.length ? `<details><summary>Past (${pastEv.length})</summary><ul class="admin-list">${pastEv.map(row).join('')}</ul></details>` : ''}
    <div class="embed-help panel">
      <h3>Embed this calendar</h3>
      <p class="hint">Paste on any site (the 518 Analog Club home page already has it):</p>
      <textarea readonly rows="3">&lt;iframe src="${CONFIG.SITE_URL}/?club=${club.id}&amp;embed=1" style="width:100%;border:0;min-height:640px" title="${esc(club.name)} events" loading="lazy"&gt;&lt;/iframe&gt;</textarea>
    </div>`;
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  el.querySelector('[data-act=new]').onclick = () => editor(a, club, null);
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editor(a, club, byId[b.dataset.edit]));
  el.querySelectorAll('[data-posts]').forEach((b) => b.onclick = () => eventPosts(a, club, byId[b.dataset.posts]));
  el.querySelectorAll('[data-roster]').forEach((b) => b.onclick = () => roster(a, byId[b.dataset.roster]));
  el.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => {
    const src = byId[b.dataset.dup]; const wk = 7 * 864e5;
    editor(a, club, { ...src, id: undefined, starts_at: new Date(new Date(src.starts_at).getTime() + wk).toISOString(), ends_at: src.ends_at ? new Date(new Date(src.ends_at).getTime() + wk).toISOString() : null });
  });
}

async function listTab(a, club, el) {
  const rows = await a.subscribers(club.id);
  const n = (st) => rows.filter((r) => r.status === st).length;
  const f = state.listFilter || 'active';
  const shown = rows.filter((r) => f === 'all' || r.status === f);
  el.innerHTML = `
    <section class="panel"><h3>${n('active')} confirmed · ${n('pending')} waiting to confirm · ${n('unsubscribed')} unsubscribed</h3>
      <div class="row-acts" style="justify-content:flex-start"><select id="lf" aria-label="Show">${[['active', 'Confirmed'], ['pending', 'Waiting to confirm'], ['unsubscribed', 'Unsubscribed'], ['all', 'Everyone']].map(([k, l]) => `<option value="${k}"${k === f ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn ghost sm" data-csv>Download CSV</button></div>
      <ul class="admin-list">${shown.map((r, i) => `<li><div><strong>${esc(r.name || r.email)}</strong> <span class="status ${r.status === 'active' ? '' : 'waitlist'}">${r.status}</span><br><span>${esc(r.email)}</span></div>
        <div class="row-acts">${r.status === 'active' ? `<button class="btn ghost sm" data-unsub="${i}">Unsubscribe</button>` : ''}<button class="btn ghost sm" data-rm="${i}">Remove</button></div></li>`).join('') || '<li class="empty">Nobody here yet.</li>'}</ul>
    </section>
    <section class="panel"><h3>Invite people</h3>
      <p class="hint">Paste emails (commas, spaces or new lines; up to 50). Each person gets a confirmation email and only joins the list when they tap it.</p>
      <textarea id="inv" rows="3" placeholder="pat@example.com, sam@example.com"></textarea>
      <p><button class="btn primary" data-inv>Send invitations</button></p><p class="hint" id="invmsg"></p>
    </section>
    <p class="hint">To email the list about an event, open it under <strong>Events → Updates</strong>.</p>`;
  el.querySelector('#lf').onchange = (e) => { state.listFilter = e.target.value; viewAdmin(a); };
  el.querySelector('[data-csv]').onclick = () => download(`${club.id}-email-list.csv`, toCsv(rows, ['email', 'name', 'status', 'created_at']), 'text/csv');
  el.querySelectorAll('[data-unsub]').forEach((b) => b.onclick = async () => { await a.setSubStatus(club.id, shown[b.dataset.unsub].email, 'unsubscribed'); toast('Unsubscribed'); viewAdmin(a); });
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
    if (!await ask(`Remove ${shown[b.dataset.rm].email} from the list entirely?`, 'Remove')) return;
    await a.removeSub(club.id, shown[b.dataset.rm].email); toast('Removed'); viewAdmin(a);
  });
  el.querySelector('[data-inv]').onclick = async (ev) => {
    const emails = el.querySelector('#inv').value.split(/[\s,;]+/).filter(Boolean);
    if (!emails.length) return;
    ev.target.disabled = true; const msg = el.querySelector('#invmsg'); msg.textContent = 'Sending…';
    try { const r = await a.admin({ action: 'invite_to_list', club_id: club.id, emails }); msg.textContent = `Sent ${r.sent} invitation${r.sent === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped: already on the list or invalid)` : ''}.`; el.querySelector('#inv').value = ''; }
    catch (err) { msg.textContent = friendly(err); } finally { ev.target.disabled = false; }
  };
}

async function newsTab(a, club, el) {
  const rows = await a.newsletters(club.id);
  const editing = state.newsEdit === 'new' ? { id: null, club_id: club.id, subject: '', issue_title: '', intro: '', sections: [], include_events: true, status: 'draft' } : rows.find((r) => r.id === state.newsEdit);
  if (editing) return newsEditor(a, club, el, editing);
  const issue = (r) => `<li><div><strong>${esc(r.subject || '(no subject yet)')}</strong> <span class="status ${r.status === 'sent' ? '' : 'waitlist'}">${r.status === 'sent' ? `sent · issue ${r.issue_no}` : 'draft'}</span><br><span>${r.status === 'sent' ? `${esc(fWhen(r.sent_at))} · ${r.sent_count} recipient${r.sent_count === 1 ? '' : 's'}` : `edited ${esc(fWhen(r.updated_at))}`}</span></div>
    <div class="row-acts">${r.status === 'draft' ? `<button class="btn ghost sm" data-edit="${r.id}">Edit</button><button class="btn ghost sm" data-del="${r.id}">Delete</button>` : `<button class="btn ghost sm" data-view="${r.id}">View</button>`}</div></li>`;
  el.innerHTML = `<section class="panel"><div class="admin-head"><h3>Newsletter</h3><button class="btn primary" data-new>+ New issue</button></div>
    <p class="hint">A zine-style email for your confirmed email list: a letter from the organizers, an automatic "Coming up" list, and any extra sections you like. Always send yourself a test first.</p>
    <ul class="admin-list">${rows.map(issue).join('') || '<li class="empty">No issues yet.</li>'}</ul></section>`;
  el.querySelector('[data-new]').onclick = () => { state.newsEdit = 'new'; viewAdmin(a); };
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { state.newsEdit = Number(b.dataset.edit); viewAdmin(a); });
  el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => previewNews(a, Number(b.dataset.view)));
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await ask('Delete this draft?', 'Delete')) { await a.deleteNewsletter(Number(b.dataset.del)); viewAdmin(a); } });
}

async function previewNews(a, id) {
  const w = window.open('', '_blank');
  try {
    const r = await a.newsFn({ action: 'render', id });
    if (!w) return toast('Your browser blocked the preview window');
    w.document.open(); w.document.write(r.html); w.document.close();
  } catch (err) { w?.close(); toast(friendly(err)); }
}

async function newsEditor(a, club, el, n) {
  const subs = await a.subscribers(club.id); const live = subs.filter((r) => r.status === 'active').length;
  const month = new Date().toLocaleString([], { month: 'long', year: 'numeric' });
  const secs = (n.sections || []).map((s) => ({ ...s }));
  const secHtml = () => secs.map((s, i) => `<div class="panel sec" data-i="${i}"><label>Section heading<input data-f="heading" maxlength="80" value="${esc(s.heading)}" placeholder="e.g. Book club pick"></label>
    <label>Text<textarea data-f="body" rows="4" maxlength="3000">${esc(s.body)}</textarea></label><button type="button" class="link" data-rm="${i}">Remove this section</button></div>`).join('');
  el.innerHTML = `<section class="panel"><div class="admin-head"><h3>${n.id ? 'Edit issue' : 'New issue'}</h3><button class="link" data-back>← All issues</button></div>
    <form id="nf" class="form">
      <label>Email subject<input name="subject" maxlength="120" required value="${esc(n.subject)}" placeholder="518 Analog Club: ${esc(month)}"></label>
      <label>Headline <span class="opt">(big text at the top)</span><input name="issue_title" maxlength="80" value="${esc(n.issue_title)}" placeholder="Winter is for board games"></label>
      <label>Letter from the organizers<textarea name="intro" rows="6" maxlength="4000" placeholder="Hi everyone! Here's what's happening this month…">${esc(n.intro)}</textarea></label>
      <label class="check"><input type="checkbox" name="include_events" ${n.include_events ? 'checked' : ''}> Add an automatic "Coming up" list (published events in the next 45 days, filled in when it sends)</label>
      <div id="secs">${secHtml()}</div>
      <p><button type="button" class="btn ghost sm" data-add ${secs.length >= 8 ? 'disabled' : ''}>+ Add a section</button> <span class="hint">Book pick, member spotlight, a tip, a photo link, anything.</span></p>
      <p class="hint">Plain text. Blank line = new paragraph. Web addresses become links automatically.</p>
      <div class="row-acts" style="justify-content:flex-start"><button class="btn primary" data-act="save">Save draft</button><button type="button" class="btn ghost" data-act="preview">Preview</button><button type="button" class="btn ghost" data-act="test">Email me a test</button><button type="button" class="btn danger" data-act="send">Send to ${live} subscriber${live === 1 ? '' : 's'}</button></div>
      <p class="err" role="alert"></p>
    </form></section>`;
  const f = el.querySelector('#nf'); const err = f.querySelector('.err');
  const read = () => {
    const d = new FormData(f);
    f.querySelectorAll('.sec').forEach((sec) => { const i = Number(sec.dataset.i); secs[i] = { heading: sec.querySelector('[data-f=heading]').value, body: sec.querySelector('[data-f=body]').value }; });
    return { ...n, subject: String(d.get('subject')).trim(), issue_title: String(d.get('issue_title')).trim(), intro: String(d.get('intro')), include_events: f.include_events.checked, sections: secs.filter((s) => s.heading.trim() || s.body.trim()) };
  };
  const save = async () => { const saved = await a.saveNewsletter(read()); n = saved; state.newsEdit = saved.id; return saved; };
  const redraw = () => { read(); el.querySelector('#secs').innerHTML = secHtml(); bindSecs(); el.querySelector('[data-add]').disabled = secs.length >= 8; };
  const bindSecs = () => el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { secs.splice(Number(b.dataset.rm), 1); redraw(); });
  bindSecs();
  el.querySelector('[data-back]').onclick = () => { state.newsEdit = null; viewAdmin(a); };
  el.querySelector('[data-add]').onclick = () => { read(); secs.push({ heading: '', body: '' }); redraw(); };
  const run = async (btn, fn) => { err.textContent = ''; btn.disabled = true; try { await fn(); } catch (x) { err.textContent = friendly(x); } finally { btn.disabled = false; } };
  f.onsubmit = (ev) => { ev.preventDefault(); run(ev.submitter || f.querySelector('[data-act=save]'), async () => { await save(); toast('Draft saved'); }); };
  el.querySelector('[data-act=preview]').onclick = (ev) => run(ev.target, async () => { const s = await save(); await previewNews(a, s.id); });
  el.querySelector('[data-act=test]').onclick = (ev) => run(ev.target, async () => { const s = await save(); const r = await a.newsFn({ action: 'test', id: s.id }); toast(`Test sent to ${r.to || 'you'}`); });
  el.querySelector('[data-act=send]').onclick = (ev) => run(ev.target, async () => {
    if (!f.subject.value.trim()) throw new Error('NEWS_EMPTY');
    const s = await save();
    if (!await ask(`Send "${s.subject}" to ${live} confirmed subscriber${live === 1 ? '' : 's'} now? This can't be undone.`, 'Send it')) return;
    const r = await a.newsFn({ action: 'send', id: s.id });
    toast(`Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}`); state.newsEdit = null; viewAdmin(a);
  });
}

async function peopleTab(a, club, el, s) {
  const [team, cs] = await Promise.all([a.team(club.id), a.clubSettings(club.id)]);
  const owners = team.filter((t) => t.role === 'owner').length;
  el.innerHTML = `
    <section class="panel"><h3>Who can manage ${esc(club.name)}</h3>
      <ul class="admin-list">${team.map((t) => `<li><div><strong>${esc(t.email || 'Organizer')}</strong> <span class="status ${t.role === 'owner' ? '' : 'waitlist'}">${t.role}</span></div>
        <div class="row-acts"><button class="btn ghost sm" data-role="${esc(t.user_id)}" data-to="${t.role === 'owner' ? 'organizer' : 'owner'}">Make ${t.role === 'owner' ? 'organizer' : 'owner'}</button><button class="btn ghost sm" data-revoke="${esc(t.user_id)}">Remove</button></div></li>`).join('') || '<li class="empty">Nobody yet.</li>'}</ul>
      <p class="hint"><strong>Owners</strong> manage people and club settings. <strong>Organizers</strong> run events, the email list and comments.</p>
      <h4>Add someone</h4>
      <div class="row-acts" style="justify-content:flex-start"><input id="gemail" type="email" placeholder="their@email.com" autocomplete="off"><select id="grole"><option value="organizer">Organizer</option><option value="owner">Owner</option></select><button class="btn primary" data-grant>Add &amp; email them</button></div>
      <p class="hint" id="gmsg">They get an email with sign-in steps (email code, then an authenticator app).</p>
    </section>
    <section class="panel"><h3>Club settings</h3>
      <form id="cs" class="form"><label>Name<input name="name" required maxlength="80" value="${esc(cs.name)}"></label>
      <label>Tagline<input name="tagline" maxlength="140" value="${esc(cs.tagline || '')}"></label>
      <label>Reply-to email (optional)<input name="contact_email" type="email" maxlength="120" value="${esc(cs.contact_email || '')}"></label>
      <label>Accent color<input name="accent" type="color" value="${esc(cs.accent || '#2f6b4f')}"></label>
      <p><button class="btn primary">Save settings</button></p></form>
    </section>`;
  const refresh = () => viewAdmin(a);
  const run = async (fn, ok) => { try { await fn(); toast(ok); refresh(); } catch (err) { toast(friendly(err)); } };
  el.querySelectorAll('[data-role]').forEach((b) => b.onclick = async () => {
    if (b.dataset.to === 'organizer' && owners < 2 && club.role !== 'site') return toast(friendly('LAST_OWNER'));
    if (!await ask(`Make this person ${b.dataset.to === 'owner' ? 'an owner' : 'an organizer'}?`, 'Yes')) return;
    run(() => a.setRole(club.id, b.dataset.role, b.dataset.to), 'Role updated');
  });
  el.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
    if (!await ask('Remove this person\'s access to the club?', 'Remove')) return;
    run(() => a.admin({ action: 'revoke', club_id: club.id, user_id: b.dataset.revoke }), 'Access removed');
  });
  el.querySelector('[data-grant]').onclick = async (ev) => {
    const email = el.querySelector('#gemail').value.trim(); if (!email) return;
    ev.target.disabled = true;
    try { const r = await a.admin({ action: 'grant', club_id: club.id, email, role: el.querySelector('#grole').value }); toast(r.mailed ? 'Added — they were emailed' : 'Added, but the email failed. Tell them to sign in.'); refresh(); }
    catch (err) { el.querySelector('#gmsg').textContent = friendly(err); ev.target.disabled = false; }
  };
  el.querySelector('#cs').onsubmit = (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    run(() => a.updateClub(club.id, { name: f.get('name').trim(), tagline: f.get('tagline').trim() || null, contact_email: f.get('contact_email').trim() || null, accent: f.get('accent') }), 'Saved');
  };
}

async function activityTab(a, club, el) {
  const rows = await a.audit(club.id);
  const what = { INVITE_LIST: 'Invited people to the email list', GRANT: 'Added a teammate', REVOKE: 'Removed a teammate', APPROVE_CLUB: 'Approved the club', INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted' };
  const tbl = { events: 'an event', signups: 'a signup', club_admins: '', };
  const detail = (c) => { try { const t = JSON.stringify(c ?? {}); return t.length > 140 ? t.slice(0, 140) + '…' : t; } catch { return ''; } };
  el.innerHTML = `<section class="panel"><h3>Recent activity</h3><ul class="admin-list">${rows.map((r) => `<li><div><strong>${esc(what[r.action] || r.action)} ${esc(tbl[r.tbl] ?? '')}</strong><br><span>${esc(fWhen(r.at))} · ${esc(detail(r.changes))}</span></div></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul><p class="hint">Last 100 changes to this club's events, signups and team.</p></section>`;
}

async function requestsTab(a, club, el) {
  const rows = await a.requests();
  el.innerHTML = `<section class="panel"><h3>New club requests</h3><ul class="admin-list">${rows.map((r) => `<li><div><strong>${esc(r.club_name)}</strong> <span class="status ${r.status === 'approved' ? '' : 'waitlist'}">${r.status}</span><br>
    <span>${esc(r.contact)} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.place ? ' · ' + esc(r.place) : ''} · ${esc(fWhen(r.created_at))}</span>${r.about ? `<br><span>${esc(r.about)}</span>` : ''}</div>
    ${r.status === 'new' ? `<div class="row-acts"><input data-slug="${r.id}" value="${esc(slugify(r.club_name))}" aria-label="Web address" size="16"><button class="btn primary sm" data-ok="${r.id}">Approve</button><button class="btn ghost sm" data-no="${r.id}">Decline</button></div>` : ''}</li>`).join('') || '<li class="empty">No requests.</li>'}</ul>
    <p class="hint">Approving creates the club at signmeupdaddy.com/?club=<em>web-address</em>, makes the requester its owner, and emails them sign-in steps.</p></section>`;
  el.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const slug = el.querySelector(`[data-slug="${b.dataset.ok}"]`).value.trim().toLowerCase();
    b.disabled = true;
    try { const r = await a.admin({ action: 'approve_request', request_id: b.dataset.ok, club_id: slug }); toast(r.mailed ? 'Approved — owner emailed' : 'Approved, but the email failed'); viewAdmin(a); }
    catch (err) { toast(friendly(err)); b.disabled = false; }
  });
  el.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    if (!await ask('Decline this request? (No email is sent.)', 'Decline')) return;
    await a.setRequestStatus(b.dataset.no, 'declined'); viewAdmin(a);
  });
}

async function reportsTab(a, club, el) {
  const rows = await a.reports();
  el.innerHTML = `<section class="panel"><h3>Issue reports</h3><ul class="admin-list">${rows.map((r) => `<li><div><strong>${esc(r.topic)}</strong> <span class="status ${r.status === 'handled' ? '' : 'waitlist'}">${r.status}</span><br>
    <span>${esc(r.name)} · <a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: ' + r.topic)}">${esc(r.email)}</a> · ${esc(fWhen(r.created_at))}${r.club_id ? ' · ' + esc(r.club_id) : ''}</span><br>${esc(r.what)}${r.expected ? `<br><em>Expected:</em> ${esc(r.expected)}` : ''}${r.page || r.device ? `<br><span class="hint">${esc(r.page || '')} ${esc(r.device || '')}</span>` : ''}</div>
    <div class="row-acts"><button class="btn ghost sm" data-flip="${r.id}" data-to="${r.status === 'new' ? 'handled' : 'new'}">${r.status === 'new' ? 'Mark handled' : 'Reopen'}</button></div></li>`).join('') || '<li class="empty">No reports.</li>'}</ul></section>`;
  el.querySelectorAll('[data-flip]').forEach((b) => b.onclick = async () => { await a.setReportStatus(b.dataset.flip, b.dataset.to); viewAdmin(a); });
}



// ───────────────────────── Email list ─────────────────────────
// Double opt-in: the form asks the `subscribe` function to send a confirmation email; the link in it lands on #/list/confirm/<token>.
function subscribeBox(a, el) {
  if (!el) return;
  el.innerHTML = `
    <h3>Get event emails</h3>
    <p class="hint">New nights from ${esc(state.club.name)} in your inbox. No spam, and every email has an unsubscribe link.</p>
    <form id="sf" novalidate>
      <div class="two">
        <label>Name <span class="opt">(optional)</span><input name="name" maxlength="80" autocomplete="name"></label>
        <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
      </div>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="cf"></div>
      <button class="btn primary" type="submit">Keep me posted</button>
      <p class="err" role="alert"></p>
    </form>`;
  const f = el.querySelector('#sf'); const shownAt = Date.now();
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'subscribe'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const err = f.querySelector('.err'); err.textContent = '';
    if (d.website) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return (err.textContent = 'That email looks off.');
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const cap = await capP; const token = await cap.wait();
      if (!token) throw new Error('CAPTCHA_FAILED');
      await a.subscribe(CLUB, { name: d.name, email: d.email, captcha: token, elapsed_ms: Date.now() - shownAt });
      el.innerHTML = `<h3>Check your email</h3><p>We sent a confirmation link to <strong>${esc(d.email)}</strong>. Tap it to finish joining the list. (Check spam if it doesn't show up in a minute or two.)</p>`;
    } catch (x) {
      err.textContent = friendly(x); btn.disabled = false; btn.textContent = 'Keep me posted'; (await capP.catch(() => null))?.reset();
    }
    postHeight();
  };
}
function viewSubscribe(a) {
  $app.innerHTML = '<section class="panel subbox" id="subbox"></section>';
  subscribeBox(a, $app.querySelector('#subbox'));
}
async function viewList(a, action, token) {
  let name = null, ok = true;
  try { name = action === 'unsub' ? await a.unsubscribe(token) : await a.confirmSub(token); } catch { ok = false; }
  const club = esc(name || state.club.name);
  $app.innerHTML = `<section class="panel narrow">${!ok || !name
    ? '<h2>That link didn\'t work</h2><p>It may have expired or already been used. Try joining the list again from the calendar.</p>'
    : action === 'unsub'
      ? `<h2>You're unsubscribed</h2><p>You won't get any more emails from ${club}. Changed your mind? You can rejoin any time from the calendar.</p>`
      : `<h2>You're on the list</h2><p>Thanks! You'll hear from ${club} when new events go up.</p>`}
    <a class="btn" href="#/">See the calendar</a></section>`;
}


// ───────────────────────── Report an issue ─────────────────────────
// Goes to the site owner by email (report-issue function), with a few set questions so reports are actionable.
function viewReport(a) {
  const topics = ['Signing up for an event', "Didn't get an email", 'Email list', 'Problem at an event', 'Website problem', 'Something else'];
  $app.innerHTML = `
    <section class="panel" id="rep">
      <h3>Report an issue</h3>
      <p class="hint">Tell us what went wrong and we'll email you back. A real person reads every report.</p>
      <form id="rf" novalidate>
        <label>What kind of problem?<select name="topic">${topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label>Which event or page? <span class="opt">(optional)</span><input name="page" maxlength="200" placeholder="e.g. Mahjong Night on Nov 29"></label>
        <label>What happened?<textarea name="what" required maxlength="2000" rows="4"></textarea></label>
        <label>What did you expect to happen? <span class="opt">(optional)</span><textarea name="expected" maxlength="1000" rows="2"></textarea></label>
        <div class="two">
          <label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
          <label>Your email (so we can reply)<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
        </div>
        <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <div class="cf"></div>
        <button class="btn primary" type="submit">Send report</button>
        <p class="err" role="alert"></p>
      </form>
    </section>`;
  const f = $app.querySelector('#rf'); const shownAt = Date.now();
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'report'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const err = f.querySelector('.err'); err.textContent = '';
    if (d.website) return;
    if (!d.what.trim()) return (err.textContent = 'Tell us what happened.');
    if (!d.name.trim()) return (err.textContent = 'Add your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return (err.textContent = 'That email looks off.');
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const cap = await capP; const token = await cap.wait();
      if (!token) throw new Error('CAPTCHA_FAILED');
      await a.reportIssue(CLUB, { ...d, device: navigator.userAgent.slice(0, 300), captcha: token, elapsed_ms: Date.now() - shownAt });
      $app.querySelector('#rep').innerHTML = '<h3>Thank you</h3><p>We got your report and will email you back at the address you gave us.</p>';
    } catch (x) {
      err.textContent = friendly(x); btn.disabled = false; btn.textContent = 'Send report'; (await capP.catch(() => null))?.reset();
    }
    postHeight();
  };
}

// ───────────────────────── Event updates & comments ─────────────────────────
const fPost = (iso) => `${fDay(iso)}, ${fTime(iso)}`;
async function postsPanel(a, e) {
  const box = $app.querySelector('#posts'); if (!box) return;
  let posts = [];
  try { posts = await a.listPosts(e.id); } catch { /* show the form anyway */ }
  const updates = posts.filter((p) => p.kind === 'update').reverse();
  const comments = posts.filter((p) => p.kind === 'comment');
  box.innerHTML = `
    ${updates.length ? `<div class="updates"><h3>Updates from the organizers</h3>${updates.map((p) => `<div class="post upd"><p>${esc(p.body).replace(/\n/g, '<br>')}</p><small>${fPost(p.created_at)}</small></div>`).join('')}</div>` : ''}
    <h3>Comments &amp; questions${comments.length ? ` (${comments.length})` : ''}</h3>
    ${comments.map((p) => `<div class="post"><strong>${esc(p.kind === 'comment' ? shortName(p.author_name) : p.author_name)}</strong> <small>${fPost(p.created_at)}</small><p>${esc(p.body).replace(/\n/g, '<br>')}</p></div>`).join('') || '<p class="hint">No comments yet. Ask a question or say hi.</p>'}
    <form id="cf2" novalidate>
      <label>Your name <span class="opt">(shown as first name and last initial)</span><input name="name" required maxlength="60" autocomplete="name"></label>
      <label>Comment<textarea name="body" required maxlength="1000" rows="3"></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="cf"></div>
      <button class="btn primary" type="submit">Post comment</button>
      <p class="err" role="alert"></p>
    </form>`;
  const f = box.querySelector('#cf2'); const shownAt = Date.now();
  const capP = captcha(f.querySelector('.cf'), CONFIG.TURNSTILE_SITE_KEY, 'comment'); capP.catch(() => {});
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const err = f.querySelector('.err'); err.textContent = '';
    if (d.website) return;
    if (!d.name.trim()) return (err.textContent = 'Add your name.');
    if (!d.body.trim()) return (err.textContent = 'Write a comment first.');
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const cap = await capP; const token = await cap.wait();
      if (!token) throw new Error('CAPTCHA_FAILED');
      await a.postComment(e.id, { name: d.name, body: d.body, captcha: token, elapsed_ms: Date.now() - shownAt });
      await postsPanel(a, e); postHeight();
    } catch (x) {
      err.textContent = friendly(x); btn.disabled = false; btn.textContent = 'Post comment'; (await capP.catch(() => null))?.reset();
    }
  };
  postHeight();
}

// Organizer: post an update (optionally emailed to everyone signed up), email the list about the event, moderate comments.
async function eventPosts(a, club, e) {
  const box = $app.querySelector('#editor');
  const posts = await a.adminPosts(e.id);
  box.innerHTML = `
    <section class="panel">
      <div class="admin-head"><div><h3>${esc(e.title)}: updates &amp; comments</h3><p class="hint">${fDay(e.starts_at)} · ${fTime(e.starts_at)}</p></div>
        <div class="row-acts"><button class="btn ghost sm" data-act="announce">Email the list about this event</button> <button class="btn ghost sm" data-act="close">Close</button></div></div>
      <form id="uf">
        <label>Post an update <span class="opt">(room change, what to bring…)</span><textarea name="body" rows="3" maxlength="2000" required></textarea></label>
        <label class="check"><input type="checkbox" name="mail" checked> Also email everyone signed up (including the waitlist)</label>
        <button class="btn primary" type="submit">Post update</button> <span class="err" role="alert"></span>
      </form>
      <h4>Posts (${posts.length})</h4>
      ${posts.map((p) => `<div class="post ${p.kind === 'update' ? 'upd' : ''}${p.hidden ? ' hid' : ''}">
        <strong>${p.kind === 'update' ? 'Update' : esc(p.author_name)}</strong> <small>${fPost(p.created_at)}${p.emailed_at ? ' · emailed' : ''}${p.hidden ? ' · hidden' : ''}</small>
        <p>${esc(p.body).replace(/\n/g, '<br>')}</p>
        <div class="row-acts">${p.kind === 'comment' ? `<button class="btn ghost sm" data-hide="${p.id}" data-to="${p.hidden ? 0 : 1}">${p.hidden ? 'Show' : 'Hide'}</button>` : (!p.emailed_at && !p.hidden ? `<button class="btn ghost sm" data-mail="${p.id}">Email it</button>` : '')}
        <button class="btn ghost sm" data-del="${p.id}">Delete</button></div></div>`).join('') || '<p class="hint">Nothing yet.</p>'}
    </section>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const again = () => eventPosts(a, club, e);
  const send = async (body, what) => {
    try { const r = await a.notify(body); toast(r.sent ? `Emailed ${r.sent} ${r.sent === 1 ? 'person' : 'people'}` : `Nobody to email yet (${what})`); } catch (x) { toast(friendly(x)); }
  };
  box.querySelector('[data-act=close]').onclick = () => { box.innerHTML = ''; };
  box.querySelector('[data-act=announce]').onclick = async () => {
    if (!(await ask(`Email everyone on the ${club.name} list about "${e.title}"?`, 'Send'))) return;
    await send({ kind: 'announce', event_id: e.id }, 'no confirmed subscribers');
  };
  const f = box.querySelector('#uf');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = new FormData(f); const body = String(d.get('body') || '').trim(); if (!body) return;
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const post = await a.addUpdate(e.id, body);
      if (d.get('mail')) await send({ kind: 'update', post_id: post.id }, 'no signups');
      else toast('Update posted');
      again();
    } catch (x) { f.querySelector('.err').textContent = friendly(x); btn.disabled = false; }
  };
  box.querySelectorAll('[data-hide]').forEach((b) => b.onclick = async () => { await a.setHidden(Number(b.dataset.hide) || b.dataset.hide, b.dataset.to === '1'); again(); });
  box.querySelectorAll('[data-mail]').forEach((b) => b.onclick = async () => { await send({ kind: 'update', post_id: Number(b.dataset.mail) || b.dataset.mail }, 'no signups'); again(); });
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await ask('Delete this post for good?', 'Delete')) { await a.deletePost(Number(b.dataset.del) || b.dataset.del); again(); } });
}

// ───────────────────────── Organizer auth ─────────────────────────
// Step 1: email + CAPTCHA → Supabase emails a 6-digit code (and a link, for convenience).
function loginStep(a) {
  $app.innerHTML = `
    <section class="panel narrow auth">
      <p class="step">Organizer sign-in · step 1 of 2</p>
      <h2>Manage my club</h2>
      <p class="hint">For club owners and organizers. Create events, see rosters and the email list, add teammates.</p>
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
      <p class="hint">If <strong>${esc(email)}</strong> is an organizer account, a sign-in code is on its way (6 to 8 digits). Use it within 15 minutes. ${a.mode === 'demo' ? '(Demo: type any 6 digits.)' : ''}</p>
      <form id="code"><label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required class="code"></label>
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
