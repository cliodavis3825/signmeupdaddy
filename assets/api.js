// Data layer. Same interface for Supabase (live) and localStorage (demo).
import { CONFIG } from './config.js';

export const ERRORS = {
  EVENT_NOT_FOUND: "That event doesn't exist anymore.",
  EVENT_PAST: 'That event has already happened.',
  EVENT_FULL: "That event is full and isn't taking a waitlist.",
  ALREADY_SIGNED_UP: "You're already on the list for this one (same email).",
  TOO_MANY_GUESTS: 'Too many guests for this event.',
  SIGNUP_NOT_FOUND: "We couldn't find that signup.",
  NOT_ADMIN: "You're not an admin for this club.",
  BOT_SUSPECTED: "That was a little too fast for a human. Give it a second and try again.",
  CAPTCHA_FAILED: "We couldn't confirm you're human. Refresh the page and try again.",
  CAPTCHA_LOAD: "The human-check didn't load. Turn off content blockers for this page, or try another browser.",
  RATE_LIMITED: 'Too many signups from your connection. Try again in an hour.',
  BAD_ORIGIN: 'Signups only work from signmeupdaddy.com.',
  'Token has expired or is invalid': 'That code is wrong or expired. Request a new one.',
  'Invalid TOTP code': "That authenticator code didn't match. Check your app's clock and try again.",
  'Email rate limit exceeded': 'Too many sign-in emails right now. Wait a few minutes.',
  'captcha protection': "We couldn't confirm you're human. Refresh and try again.",
};
export function friendly(err) {
  const msg = String(err?.message || err);
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  return code ? ERRORS[code] : msg;
}

const isLive = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

// ───────────── Supabase backend ─────────────
async function liveApi() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
  return {
    mode: 'live',
    getClub: (id) => q(sb.from('clubs').select('*').eq('id', id).maybeSingle()),
    listEvents: (club, from, to) => rpc('list_events', { p_club: club, p_from: from.toISOString(), p_to: to.toISOString() }),
    // Public signups go through the `signup` Edge Function (CAPTCHA, rate limit), never the RPC directly.
    signUp: async (eventId, f) => {
      const { data, error } = await sb.functions.invoke('signup', { body: { event_id: eventId, ...f } });
      if (error) {
        let code = 'SERVER';
        try { code = (await error.context.json()).error || code; } catch { /* network error */ }
        throw new Error(code);
      }
      return data;
    },
    lookup: async (token) => (await rpc('lookup_signup', { p_token: token }))[0] || null,
    cancel: (token) => rpc('cancel_signup', { p_token: token }),
    // admin
    session: async () => (await sb.auth.getSession()).data.session,
    onAuth: (cb) => sb.auth.onAuthStateChange((_e, s) => cb(s)),
    // Organizer sign-in: emailed code (and link), CAPTCHA-checked by Supabase Auth.
    // shouldCreateUser:false → strangers can't create accounts; organizers are invited by you.
    signIn: async (email, captchaToken) => {
      const { error } = await sb.auth.signInWithOtp({
        email, options: { shouldCreateUser: false, captchaToken, emailRedirectTo: location.origin + location.pathname + '#/admin' },
      });
      // Don't reveal whether an email belongs to an organizer; only surface real failures.
      if (error && !/signups not allowed|user not found/i.test(error.message)) throw new Error(error.message);
    },
    verifyCode: (email, token) => q(sb.auth.verifyOtp({ email, token, type: 'email' })),
    mfaState: async () => {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: f } = await sb.auth.mfa.listFactors();
      const verified = (f?.totp || []).filter((x) => x.status === 'verified');
      return { level: aal.currentLevel, next: aal.nextLevel, factorId: verified[0]?.id || null };
    },
    mfaEnroll: async () => {
      const { data: f } = await sb.auth.mfa.listFactors();
      for (const x of (f?.all || []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
      const d = await q(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `signmeupdaddy ${new Date().toISOString().slice(0, 10)}` }));
      return { factorId: d.id, qr: d.totp.qr_code, secret: d.totp.secret };
    },
    mfaVerify: (factorId, code) => q(sb.auth.mfa.challengeAndVerify({ factorId, code })),
    signOut: (everywhere) => sb.auth.signOut({ scope: everywhere ? 'global' : 'local' }),
    myClubs: async () => {
      const rows = await q(sb.from('club_admins').select('club_id, clubs(*)'));
      return rows.map((r) => r.clubs);
    },
    adminEvents: (club) => q(sb.from('events').select('*').eq('club_id', club).order('starts_at')),
    saveEvent: (ev) => ev.id
      ? q(sb.from('events').update(ev).eq('id', ev.id).select().single())
      : q(sb.from('events').insert(ev).select().single()),
    deleteEvent: (id) => q(sb.from('events').delete().eq('id', id)),
    roster: (eventId) => q(sb.from('signups').select('*').eq('event_id', eventId).order('created_at')),
    adminCancel: (signupId) => rpc('admin_cancel', { p_signup: signupId }),
    setTables: async (byId) => { for (const [id, no] of Object.entries(byId)) await q(sb.from('signups').update({ table_no: no }).eq('id', id)); },
    checkIn: (id, on) => q(sb.from('signups').update({ checked_in_at: on ? new Date().toISOString() : null }).eq('id', id)),
    // Past confirmed signups for this club → per-email show/no-show record (admins only, via RLS).
    history: async (club) => q(sb.from('signups').select('email, checked_in_at, events!inner(club_id, starts_at)')
      .eq('events.club_id', club).eq('status', 'confirmed').lt('events.starts_at', new Date().toISOString())),
    feedUrl: (club) => `${CONFIG.SUPABASE_URL}/functions/v1/ical?club=${encodeURIComponent(club)}`,
  };
}

// ───────────── Demo backend (localStorage) ─────────────
const KEY = 'smud-demo-v2';
const mem = { db: null };
function load() {
  if (mem.db) return mem.db;
  try { mem.db = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
  if (!mem.db) mem.db = seed();
  return mem.db;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem.db)); } catch { /* in-memory only */ } }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());

function seed() {
  const now = new Date();
  const at = (days, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const plus = (iso, hrs) => new Date(new Date(iso).getTime() + hrs * 3600e3).toISOString();
  const ev = (o) => ({ id: uid(), club_id: '518analog', max_guests: 1, waitlist: true, published: true, ...o, ends_at: plus(o.starts_at, o.hours || 2) });
  const events = [
    ev({ title: 'Mahjong Night: Beginners Welcome', kind: 'mahjong', starts_at: at(3, 18, 30), hours: 2.5, capacity: 16, table_size: 4, gear_label: 'mahjong set', ask_skill: true, location: 'The Tile Room, Troy NY', description: 'American mahjong, four tables. We teach the first hour. Have a set? Tick the box so we know how many tables we can run.' }),
    ev({ title: 'Book Club: November Pick', kind: 'book', starts_at: at(6, 19), capacity: 14, max_guests: 0, book_title: 'Piranesi', book_author: 'Susanna Clarke', book_isbn: '9781635577808', location: 'Back room, local café — Albany', description: "Finished or not, come talk. Spoiler line drawn at chapter 20 for anyone still reading." }),
    ev({ title: 'Analog Trivia', kind: 'trivia', starts_at: at(10, 19, 30), capacity: 40, max_guests: 5, location: 'Brewpub, Troy NY', description: 'Teams of up to 6. Pencils, paper, zero phones. Winning team picks next month’s theme.' }),
    ev({ title: 'Craft Circle: Crochet & Mend', kind: 'craft', starts_at: at(13, 14), hours: 3, capacity: 10, location: 'Community room, Schenectady', description: 'Bring a WIP or something to mend. Spare hooks and yarn on hand for first-timers.' }),
    ev({ title: 'Mahjong Night: Open Tables', kind: 'mahjong', starts_at: at(17, 18, 30), hours: 2.5, capacity: 4, table_size: 4, gear_label: 'mahjong set', ask_skill: true, location: 'The Tile Room, Troy NY', description: 'One table, tiny capacity. Try the waitlist.' }),
    ev({ title: 'Book Club: December Pick', kind: 'book', starts_at: at(34, 19), capacity: 14, max_guests: 0, location: 'Back room, local café — Albany', description: 'Cozy winter read. Pick announced at the November meeting.' }),
  ];
  const signups = [];
  const names = ['Ava Brooks', 'Ben Ortiz', 'Chloe Nguyen', 'Dev Patel', 'Ella Fitz', 'Finn Walsh', 'Grace Kim', 'Hugo Lane', 'Iris Moreau', 'Jon Park', 'Kira Shah', 'Leo Dunn', 'Maya Cole', 'Nia Reyes', 'Owen Hart', 'Pia Russo', 'Quinn Adler', 'Rosa Vega'];
  const skills = ['experienced', 'new', 'learning', 'new', 'experienced', 'learning', 'new', 'learning', 'new'];
  const fill = (e, n) => { for (let i = 0; i < n; i++) signups.push({ id: uid(), event_id: e.id, name: names[i % names.length], email: `${names[i % names.length].split(' ')[0].toLowerCase()}@example.com`, guests: 0, note: '', status: 'confirmed', skill: e.ask_skill ? skills[i % skills.length] : null, brings_gear: !!e.gear_label && i % 4 === 0, table_no: null, checked_in_at: null, cancel_token: uid(), created_at: new Date().toISOString() }); };
  fill(events[0], 9); fill(events[1], 11); fill(events[2], 18); fill(events[3], 4); fill(events[4], 4);
  // Two past nights with check-ins, so the roster can show who reliably shows up.
  for (const [days, n] of [[-14, 8], [-28, 8]]) {
    const past = ev({ title: 'Mahjong Night', kind: 'mahjong', starts_at: at(days, 18, 30), hours: 2.5, capacity: 16, table_size: 4, gear_label: 'mahjong set', ask_skill: true, location: 'The Tile Room, Troy NY' });
    events.push(past); fill(past, n);
    signups.filter((s) => s.event_id === past.id).forEach((s, i) => { s.checked_in_at = (i === 1 || i === 3) ? null : past.starts_at; });
  }
  return {
    clubs: [{ id: '518analog', name: '518 Analog Club', tagline: 'Books, tiles, trivia & crafts — offline in the Capital Region', accent: '#2f6b4f', timezone: 'America/New_York' }],
    events, signups,
  };
}

// Placeholder "QR" for demo mode (not scannable; live mode shows Supabase's real QR code).
const demoQr = () => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/>${Array.from({ length: 21 * 21 }, (_, i) => ((i * 7919) % 13 < 6 ? `<rect x="${i % 21}" y="${Math.floor(i / 21)}" width="1" height="1"/>` : '')).join('')}<rect x="0" y="0" width="7" height="7" fill="none" stroke="#000"/><rect x="14" y="0" width="7" height="7" fill="none" stroke="#000"/><rect x="0" y="14" width="7" height="7" fill="none" stroke="#000"/></svg>`);

function demoApi() {
  const db = () => load();
  const taken = (eid) => db().signups.filter((s) => s.event_id === eid && s.status === 'confirmed').reduce((a, s) => a + 1 + s.guests, 0);
  const promote = (eid) => {
    const e = db().events.find((x) => x.id === eid);
    let t = taken(eid);
    for (const w of db().signups.filter((s) => s.event_id === eid && s.status === 'waitlist')) {
      if (e.capacity != null && t + 1 + w.guests > e.capacity) break;
      w.status = 'confirmed'; t += 1 + w.guests;
    }
  };
  const fail = (code) => { throw new Error(code); };
  let session = null; let pendingEmail = ''; let demoAal = null; let demoFactor = null; const authCbs = [];
  return {
    mode: 'demo',
    getClub: async (id) => db().clubs.find((c) => c.id === id) || null,
    listEvents: async (club, from, to) => db().events
      .filter((e) => e.club_id === club && e.published && new Date(e.starts_at) >= from && new Date(e.starts_at) < to)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((e) => ({ ...e, seats_taken: taken(e.id), waitlist_count: db().signups.filter((s) => s.event_id === e.id && s.status === 'waitlist').length,
        gear_count: db().signups.filter((s) => s.event_id === e.id && s.status === 'confirmed' && s.brings_gear).length })),
    signUp: async (eventId, f) => {
      const e = db().events.find((x) => x.id === eventId) || fail('EVENT_NOT_FOUND');
      if (new Date(e.starts_at) < new Date()) fail('EVENT_PAST');
      if (f.website || !(f.elapsed_ms >= 2500)) fail('BOT_SUSPECTED');   // same checks as the Edge Function
      const guests = Number(f.guests || 0);
      if (guests > e.max_guests) fail('TOO_MANY_GUESTS');
      const email = f.email.trim().toLowerCase();
      if (db().signups.some((s) => s.event_id === eventId && s.email === email && s.status !== 'cancelled')) fail('ALREADY_SIGNED_UP');
      let status = 'confirmed';
      if (e.capacity != null && taken(eventId) + 1 + guests > e.capacity) status = e.waitlist ? 'waitlist' : fail('EVENT_FULL');
      const s = { id: uid(), event_id: eventId, name: f.name.trim(), email, guests, note: f.note || '', status, cancel_token: uid(), created_at: new Date().toISOString(),
        skill: e.ask_skill && ['new', 'learning', 'experienced'].includes(f.skill) ? f.skill : null, brings_gear: !!(e.gear_label && f.brings_gear), table_no: null, checked_in_at: null };
      db().signups.push(s); save();
      const pos = status === 'waitlist' ? db().signups.filter((x) => x.event_id === eventId && x.status === 'waitlist').length : null;
      return { status, cancel_token: s.cancel_token, waitlist_position: pos };
    },
    lookup: async (token) => {
      const s = db().signups.find((x) => x.cancel_token === token); if (!s) return null;
      const e = db().events.find((x) => x.id === s.event_id);
      return { name: s.name, status: s.status, guests: s.guests, table_no: s.table_no, event_id: e.id, title: e.title, starts_at: e.starts_at, location: e.location, club_id: e.club_id };
    },
    cancel: async (token) => {
      const s = db().signups.find((x) => x.cancel_token === token) || fail('SIGNUP_NOT_FOUND');
      s.status = 'cancelled'; promote(s.event_id); save(); return 'cancelled';
    },
    session: async () => session,
    onAuth: (cb) => authCbs.push(cb),
    // Demo: walks through the same screens. Any 6-digit code works; nothing is emailed.
    signIn: async (email) => { pendingEmail = email; },
    verifyCode: async (email, code) => { if (!/^\d{6}$/.test(code)) throw new Error('Token has expired or is invalid'); session = { user: { email } }; demoAal = 'aal1'; },
    mfaState: async () => ({ level: demoAal, next: demoFactor ? 'aal2' : 'aal1', factorId: demoFactor }),
    mfaEnroll: async () => ({ factorId: 'demo-factor', secret: 'JBSWY3DPEHPK3PXP', qr: demoQr() }),
    mfaVerify: async (factorId, code) => { if (!/^\d{6}$/.test(code)) throw new Error('Invalid TOTP code'); demoFactor = factorId; demoAal = 'aal2'; },
    signOut: async () => { session = null; demoAal = null; authCbs.forEach((cb) => cb(null)); },
    myClubs: async () => db().clubs,
    adminEvents: async (club) => db().events.filter((e) => e.club_id === club).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    saveEvent: async (ev) => {
      if (ev.id) { const i = db().events.findIndex((e) => e.id === ev.id); db().events[i] = { ...db().events[i], ...ev }; promote(ev.id); save(); return db().events[i]; }
      const n = { ...ev, id: uid() }; db().events.push(n); save(); return n;
    },
    deleteEvent: async (id) => { const d = db(); d.events = d.events.filter((e) => e.id !== id); d.signups = d.signups.filter((s) => s.event_id !== id); save(); },
    roster: async (eventId) => db().signups.filter((s) => s.event_id === eventId),
    adminCancel: async (id) => { const s = db().signups.find((x) => x.id === id); s.status = 'cancelled'; promote(s.event_id); save(); },
    setTables: async (byId) => { for (const s of db().signups) if (s.id in byId) s.table_no = byId[s.id]; save(); },
    checkIn: async (id, on) => { const s = db().signups.find((x) => x.id === id); s.checked_in_at = on ? new Date().toISOString() : null; save(); },
    history: async (club) => {
      const ids = new Set(db().events.filter((e) => e.club_id === club && new Date(e.starts_at) < new Date()).map((e) => e.id));
      return db().signups.filter((s) => ids.has(s.event_id) && s.status === 'confirmed').map((s) => ({ email: s.email, checked_in_at: s.checked_in_at }));
    },
    feedUrl: () => null,
    resetDemo: () => { mem.db = seed(); save(); },
  };
}

let _api;
export async function api() {
  if (!_api) _api = isLive ? await liveApi() : demoApi();
  return _api;
}

// Signups this browser has made (so people can cancel without email).
const MINE = 'smud-mine';
export const mine = {
  all() { try { return JSON.parse(localStorage.getItem(MINE)) || []; } catch { return mine._mem || []; } },
  add(rec) { const a = [rec, ...mine.all().filter((r) => r.token !== rec.token)].slice(0, 50); try { localStorage.setItem(MINE, JSON.stringify(a)); } catch { mine._mem = a; } },
  remove(token) { const a = mine.all().filter((r) => r.token !== token); try { localStorage.setItem(MINE, JSON.stringify(a)); } catch { mine._mem = a; } },
};
