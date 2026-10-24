// Data layer. Everything that touches persistence lives here.
//
// - Data lives in generic collections keyed by type (db.collections.sheets, db.collections.groups),
//   with "mine" refs per type (things this browser created/administers). New types slot in cleanly.
// - All exported functions are async and return plain copies, so this module can be swapped for a
//   fetch()-based API client later without changing any view code.
// - The public/admin split mirrors a server: public getters never expose contacts or tokens.
// - Identity is a token (admin token, member token, signup token), never an email. An email match
//   proves nothing, exactly as it wouldn't on a real backend.
// - Writes either persist or throw StoreError('storage') and roll back. They never report success
//   for a change that won't survive a refresh.

import { uid, isEmail, isPhone, readLocal, writeLocal, isoDate, today, parseDate, contactKey, cleanText, parseCount, shortName } from './util.js';
import { confirmedFor, waitlistFor, rsvpsFor, isOccurrence } from './model.js';
import { buildSeeds } from './seed.js';

const KEY = 'smud:v2';
const BACKUP_KEY = 'smud:v2:backup';
const ME_KEY = 'smud:me';
const MY_SIGNUPS_KEY = 'smud:mysignups';
const MY_MEMBERSHIPS_KEY = 'smud:mymemberships';
const TYPES = ['sheets', 'groups'];
const listeners = new Set();

export class StoreError extends Error {
  constructor(code, message, field = '') { super(message); this.code = code; this.field = field; }
}
const storageError = () => new StoreError('storage',
  "We couldn't save that: this browser's storage is full or blocked, so nothing was changed. Free up some space and try again.");

/* ---------- Storage status ----------
   ok               everything persists
   memory           localStorage is blocked; running in memory (banner)
   quota            the last write failed and was rolled back (banner)
   recovered        saved data was unreadable; a backup copy was kept and we started fresh (banner)
   recovered-memory saved data was unreadable and couldn't be backed up; we leave it untouched and run in memory */
let storageMode = 'ok';
let backupKey = null;
let canWrite = true;
let lastGood = null; // last JSON known to be in localStorage (rollback point)

function setStatus(mode) {
  storageMode = mode;
  window.dispatchEvent(new CustomEvent('smud:storage', { detail: storageStatus() }));
}
export const storageStatus = () => ({ mode: storageMode, backupKey });
export const isPersistent = () => canWrite && storageMode !== 'quota';

function emptyDb() {
  const db = { version: 2, collections: {}, mine: {}, seeded: false };
  for (const t of TYPES) { db.collections[t] = {}; db.mine[t] = []; }
  return db;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v) => (typeof v === 'string' ? v : '');

// Repair or skip malformed records so one bad document can't take down every page.
function sanitizeDb(d) {
  const out = emptyDb();
  out.seeded = !!d.seeded;
  for (const t of TYPES) {
    const src = isObj(d.collections[t]) ? d.collections[t] : {};
    for (const [k, v] of Object.entries(src)) {
      if (!isObj(v) || typeof v.id !== 'string' || v.id !== k) continue;
      if (t === 'sheets') {
        v.title = str(v.title) || 'Untitled sheet';
        v.slots = objs(v.slots).filter((s) => typeof s.id === 'string');
        v.signups = objs(v.signups).filter((s) => typeof s.id === 'string');
        v.organizer = isObj(v.organizer) ? v.organizer : { name: '' };
      } else {
        v.name = str(v.name) || 'Untitled group';
        for (const f of ['members', 'announcements', 'events', 'rsvps']) v[f] = objs(v[f]);
        for (const e of v.events) e.sheetIds = Array.isArray(e.sheetIds) ? e.sheetIds.filter((x) => typeof x === 'string') : [];
      }
      out.collections[t][k] = v;
    }
    out.mine[t] = objs(isObj(d.mine) ? d.mine[t] : null).filter((m) => typeof m.id === 'string');
  }
  return out;
}

function parseDb(raw) {
  try {
    const d = JSON.parse(raw);
    if (isObj(d) && isObj(d.collections) && isObj(d.mine)) return sanitizeDb(d);
  } catch { /* unreadable */ }
  return null;
}

// Keep a copy of unreadable data before anything can overwrite it. Returns the key used, or null.
function backupCorrupt(raw) {
  try {
    let k = BACKUP_KEY;
    if (localStorage.getItem(k) != null) k = `${BACKUP_KEY}:${new Date().toISOString()}`;
    localStorage.setItem(k, raw);
    return k;
  } catch {
    return null;
  }
}

function loadDb() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    canWrite = false;
    storageMode = 'memory';
    return null;
  }
  if (!raw) return null;
  const d = parseDb(raw);
  if (d) { lastGood = raw; return d; }
  backupKey = backupCorrupt(raw);
  if (backupKey) {
    storageMode = 'recovered';
  } else {
    // Couldn't back it up: never overwrite it. Run this session in memory instead.
    canWrite = false;
    storageMode = 'recovered-memory';
  }
  return null;
}

let db = loadDb() || emptyDb();

function save({ rollback = true } = {}) {
  if (!canWrite) { emit(); return; }
  const json = JSON.stringify(db);
  try {
    localStorage.setItem(KEY, json);
    lastGood = json;
    if (storageMode === 'quota') setStatus('ok');
  } catch {
    if (rollback && lastGood) db = parseDb(lastGood) || db;
    else lastGood = json; // first save (seeding) failed: keep the in-memory copy as the rollback point
    setStatus('quota');
    emit();
    if (rollback) throw storageError();
    return;
  }
  emit();
}

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

// Live updates across tabs (stand-in for a websocket/SSE feed).
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !canWrite || !e.newValue) return;
  const d = parseDb(e.newValue);
  if (d) { db = d; lastGood = e.newValue; emit(); }
});

/* ---------- Small per-browser lists (memory fallback when storage is off) ---------- */
const memLocal = new Map();
function readKey(key, fallback) {
  if (!canWrite) return memLocal.has(key) ? clone(memLocal.get(key)) : fallback;
  return readLocal(key, fallback);
}
function writeKey(key, value) {
  if (!canWrite) { memLocal.set(key, clone(value)); return true; }
  return writeLocal(key, value);
}
// Defensive reader: anything that isn't an array of objects reads as [].
const readList = (key) => objs(readKey(key, []));

const clone = (o) => JSON.parse(JSON.stringify(o));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/* ---------- Generic collection helpers ---------- */

const col = (type) => db.collections[type];
const getDoc = (type, id) => (typeof id === 'string' && Object.hasOwn(col(type), id) ? col(type)[id] : null);
function newId(type) {
  let id;
  do { id = uid(8); } while (col(type)[id]);
  return id;
}
function insertDoc(type, doc, { mine = true, demo = false } = {}) {
  col(type)[doc.id] = doc;
  if (mine) db.mine[type].push({ id: doc.id, adminToken: doc.adminToken, ...(demo ? { demo: true } : {}) });
}
function removeDoc(type, id) {
  delete col(type)[id];
  db.mine[type] = db.mine[type].filter((m) => m.id !== id);
}
const mineRef = (type, id) => db.mine[type].find((m) => m.id === id) || null;

/* ---------- Setup ---------- */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function init() {
  if (!db.seeded) {
    const seeds = buildSeeds();
    for (const type of TYPES) {
      for (const doc of seeds[type] || []) {
        if (!getDoc(type, doc.id)) insertDoc(type, doc, { demo: true });
      }
    }
    db.seeded = true;
    save({ rollback: false });
  }
  // A browser holding a group's admin token is its organizer: make sure it also has the organizer's
  // membership, so it shows as a member and can RSVP (covers the demo group and older saved data).
  for (const ref of db.mine.groups) {
    const g = getDoc('groups', ref.id);
    if (!g || g.adminToken !== ref.adminToken || myMemberships().some((m) => m.groupId === g.id)) continue;
    const org = g.members.find((m) => m.role === 'organizer');
    if (org) rememberMembership(g.id, org);
  }
}

function validateParticipant({ name, contact }, { emailOnly = false } = {}) {
  const n = clip(cleanText(name), 80);
  const c = clip(cleanText(contact), 120).replace(/\.+$/, '');
  if (!n) throw new StoreError('invalid', 'Please add your name.', 'name');
  if (emailOnly ? !isEmail(c) : (!isEmail(c) && !isPhone(c))) {
    throw new StoreError('invalid', emailOnly ? 'Please enter a valid email.' : 'Please enter a valid email or phone number.', 'contact');
  }
  return { name: n, contact: c };
}

/* =====================================================================
   SHEETS
   ===================================================================== */

function publicSheet(s) {
  const { adminToken, organizer, signups, ...rest } = s;
  return clone({
    ...rest,
    organizer: { name: organizer?.name || '' },
    signups: signups.map(({ id, slotId, name, note, status, createdAt, queuedAt }) =>
      ({ id, slotId, name, note, status, createdAt, queuedAt })),
  });
}

// Sheets attached to a private group are only visible to its members, its organizers and the sheet's own organizer.
function sheetVisible(sheet) {
  if (!sheet.groupId) return true;
  const g = getDoc('groups', sheet.groupId);
  if (!g || g.visibility !== 'private') return true;
  if (mineRef('sheets', sheet.id)?.adminToken === sheet.adminToken) return true;
  const v = viewerOf(g);
  return v.isAdmin || !!v.member;
}
function lockedSheet(sheet) {
  const g = getDoc('groups', sheet.groupId);
  return { id: sheet.id, locked: true, groupId: g.id, groupName: g.name, groupEmoji: g.emoji };
}

function findSignupByToken(token) {
  if (!token) return null;
  for (const sheet of Object.values(col('sheets'))) {
    const signup = sheet.signups.find((x) => x.token === token);
    if (signup) return { sheet, signup };
  }
  return null;
}

function position(sheet, signup) {
  if (signup.status !== 'waitlist') return 0;
  return waitlistFor(sheet, signup.slotId).findIndex((x) => x.id === signup.id) + 1;
}

// After a confirmed spot frees up, move the first waitlisted person in. Returns their short name.
function promote(sheet, slotId) {
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot || slot.archived) return null;
  if (confirmedFor(sheet, slotId).length >= slot.capacity) return null;
  const next = waitlistFor(sheet, slotId)[0];
  if (!next) return null;
  next.status = 'confirmed';
  next.promotedAt = Date.now();
  return shortName(next.name);
}

function adminSheet(id, adminToken) {
  const sheet = getDoc('sheets', id);
  if (!sheet) throw new StoreError('not_found', "We couldn't find that sheet.");
  if (!adminToken || sheet.adminToken !== adminToken) throw new StoreError('forbidden', 'Only the organizer can do that.');
  return sheet;
}

export async function getSheet(id) {
  const s = getDoc('sheets', id);
  if (!s) return null;
  return sheetVisible(s) ? publicSheet(s) : lockedSheet(s);
}

export async function getSheets(ids) {
  return ids.map((id) => getDoc('sheets', id)).filter((s) => s && sheetVisible(s)).map(publicSheet);
}

export async function listMySheets() {
  const out = [];
  for (const m of db.mine.sheets) {
    const s = getDoc('sheets', m.id);
    if (!s) continue;
    try { out.push({ ...publicSheet(s), demo: !!m.demo }); } catch (e) { console.warn('Skipping unreadable sheet', m.id, e); }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// In a real backend the admin token would come from a magic link / session.
export async function getAdminToken(id) {
  return mineRef('sheets', id)?.adminToken || null;
}

export async function getSheetAdmin(id, adminToken) {
  return clone(adminSheet(id, adminToken));
}

// Validates strictly, like a server would: bad capacities are rejected, not coerced.
export function normalizeDraft(d) {
  const slots = (Array.isArray(d.slots) ? d.slots : []).filter(isObj).map((s, i) => {
    const label = clip(s.label, 100);
    const capacity = parseCount(s.capacity);
    if (!(capacity >= 1 && capacity <= 999)) {
      throw new StoreError('invalid', `${label ? `"${label}"` : `Slot ${i + 1}`} needs a whole number of spots from 1 to 999.`);
    }
    const base = {
      id: clip(s.id, 20) || uid(6),
      type: s.type === 'time' ? 'time' : 'item',
      label,
      note: clip(s.note, 200),
      capacity,
    };
    if (base.type === 'time') Object.assign(base, { date: clip(s.date, 10), start: clip(s.start, 5), end: clip(s.end, 5) });
    return base;
  });
  return {
    title: clip(d.title, 120),
    description: clip(d.description, 2000),
    location: clip(d.location, 200),
    emoji: clip(d.emoji, 8) || '📋',
    templateId: clip(d.templateId, 20),
    date: clip(d.date, 10), start: clip(d.start, 5), end: clip(d.end, 5),
    waitlist: d.waitlist !== false,
    organizer: { name: clip(d.organizer?.name, 80), email: clip(d.organizer?.email, 120) },
    groupId: d.groupId ? clip(d.groupId, 20) : null, // optional: sheet belongs to a group
    eventId: d.eventId ? clip(d.eventId, 20) : null, // optional: sheet attached to a group event
    slots,
  };
}

function checkSheetData(data) {
  if (!data.title) throw new StoreError('invalid', 'Your sheet needs a title.');
  if (!data.organizer.name) throw new StoreError('invalid', 'Add an organizer name.');
  if (!data.slots.length) throw new StoreError('invalid', 'Add at least one slot.');
  if (data.slots.some((s) => !s.label)) throw new StoreError('invalid', 'Every slot needs a name.');
}

export async function createSheet(draft) {
  const data = normalizeDraft(draft);
  checkSheetData(data);
  const id = newId('sheets');
  const adminToken = uid(24);
  insertDoc('sheets', { ...data, id, adminToken, signups: [], createdAt: Date.now() });
  save();
  return { id, adminToken };
}

// Edit after publishing. Signups are never deleted: a removed slot that still has signups is archived
// (hidden from the sheet, people and edit links kept); a smaller capacity keeps everyone already confirmed.
export async function updateSheet(id, adminToken, draft) {
  const sheet = adminSheet(id, adminToken);
  const data = normalizeDraft(draft);
  checkSheetData(data);
  const oldById = new Map(sheet.slots.map((s) => [s.id, s]));
  const seen = new Set();
  const next = data.slots.map((s) => {
    const old = oldById.get(s.id);
    let slot = s;
    if (seen.has(s.id) || (old && old.type !== s.type)) slot = { ...s, id: uid(6) };
    seen.add(slot.id);
    return slot;
  });
  const archived = [];
  let newlyArchived = 0;
  for (const old of sheet.slots) {
    if (seen.has(old.id)) continue;
    if (sheet.signups.some((x) => x.slotId === old.id)) {
      if (!old.archived) newlyArchived++;
      archived.push({ ...old, archived: true, archivedAt: old.archivedAt || Date.now() });
    }
  }
  Object.assign(sheet, {
    title: data.title, description: data.description, location: data.location, emoji: data.emoji,
    date: data.date, start: data.start, end: data.end, waitlist: data.waitlist,
    organizer: data.organizer, slots: [...next, ...archived], updatedAt: Date.now(),
  });
  const promoted = [];
  for (const s of next) { let n; while ((n = promote(sheet, s.id))) promoted.push(n); }
  save();
  return { promoted, archived: newlyArchived };
}

// Bring back a slot that was removed while it had signups.
export async function restoreSlot(id, adminToken, slotId) {
  const sheet = adminSheet(id, adminToken);
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot) throw new StoreError('not_found', 'That slot is gone.');
  delete slot.archived;
  delete slot.archivedAt;
  const promoted = [];
  let n;
  while ((n = promote(sheet, slot.id))) promoted.push(n);
  save();
  return { promoted };
}

// Detach a sheet from its group/event links (used when an event goes away or the sheet is detached).
function unlinkSheet(sheetId) {
  const sheet = getDoc('sheets', sheetId);
  if (sheet) { sheet.groupId = null; sheet.eventId = null; }
}

export async function deleteSheet(id, adminToken) {
  adminSheet(id, adminToken);
  removeDoc('sheets', id);
  for (const g of Object.values(col('groups'))) {
    for (const ev of g.events) ev.sheetIds = (ev.sheetIds || []).filter((s) => s !== id);
  }
  save();
}

/* ---------- Signups ---------- */

export async function signUp(sheetId, slotId, input) {
  const sheet = getDoc('sheets', sheetId);
  if (!sheet) throw new StoreError('not_found', "We couldn't find that sheet.");
  if (!sheetVisible(sheet)) throw new StoreError('forbidden', 'This sheet belongs to a private group. Join the group to sign up.');
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot || slot.archived) throw new StoreError('not_found', 'That slot no longer exists.');
  const { name, contact } = validateParticipant(input);
  const key = contactKey(contact);
  const dup = sheet.signups.find((x) => x.slotId === slotId && contactKey(x.contact) === key);
  if (dup) throw new StoreError('duplicate', "You're already signed up for this one. Use your edit link to make changes.");

  const full = confirmedFor(sheet, slotId).length >= slot.capacity;
  if (full && !sheet.waitlist) throw new StoreError('full', 'Shoot, that one just filled up. Try another slot?');

  const now = Date.now();
  const signup = {
    id: uid(8), slotId, name, contact, note: clip(input.note, 200),
    status: full ? 'waitlist' : 'confirmed', createdAt: now, queuedAt: now, token: uid(24),
  };
  sheet.signups.push(signup);
  save(); // throws (and rolls back) if it can't be stored
  const mine = readList(MY_SIGNUPS_KEY);
  mine.push({ sheetId, signupId: signup.id, token: signup.token });
  writeKey(MY_SIGNUPS_KEY, mine.slice(-300)); // best effort: the edit link on the confirmation still works
  return { token: signup.token, signupId: signup.id, status: signup.status, position: position(sheet, signup) };
}

export async function getSignup(token) {
  const found = findSignupByToken(token);
  if (!found) return null;
  const { sheet, signup } = found;
  return { sheet: publicSheet(sheet), signup: clone(signup), position: position(sheet, signup) };
}

export async function updateSignup(token, patch) {
  const found = findSignupByToken(token);
  if (!found) throw new StoreError('not_found', 'That edit link has expired or was cancelled.');
  const { sheet, signup } = found;
  const { name, contact } = validateParticipant({ name: patch.name ?? signup.name, contact: patch.contact ?? signup.contact });
  const target = patch.slotId || signup.slotId;
  const key = contactKey(contact);
  if (sheet.signups.some((x) => x.id !== signup.id && x.slotId === target && contactKey(x.contact) === key)) {
    throw new StoreError('duplicate', target === signup.slotId
      ? 'Someone with that email or phone is already signed up for this slot.'
      : "You're already signed up for that slot. Use that signup's edit link instead.");
  }
  let promoted = null;
  if (patch.slotId && patch.slotId !== signup.slotId) {
    const slot = sheet.slots.find((s) => s.id === patch.slotId);
    if (!slot || slot.archived) throw new StoreError('not_found', 'That slot no longer exists.');
    const full = confirmedFor(sheet, slot.id).length >= slot.capacity;
    if (full && !sheet.waitlist) throw new StoreError('full', 'That slot is full.');
    const oldSlot = signup.slotId;
    const wasConfirmed = signup.status === 'confirmed';
    signup.slotId = slot.id;
    signup.status = full ? 'waitlist' : 'confirmed';
    signup.queuedAt = Date.now();
    if (wasConfirmed) promoted = promote(sheet, oldSlot);
  }
  signup.name = name;
  signup.contact = contact;
  if (patch.note !== undefined) signup.note = clip(patch.note, 200);
  save();
  return { signup: clone(signup), position: position(sheet, signup), promoted };
}

export async function cancelSignup(token) {
  const found = findSignupByToken(token);
  if (!found) throw new StoreError('not_found', 'That signup was already cancelled.');
  const { sheet, signup } = found;
  sheet.signups = sheet.signups.filter((x) => x.id !== signup.id);
  const promoted = signup.status === 'confirmed' ? promote(sheet, signup.slotId) : null;
  save();
  return { promoted, sheetId: sheet.id };
}

export async function removeSignup(sheetId, signupId, adminToken) {
  const sheet = adminSheet(sheetId, adminToken);
  const signup = sheet.signups.find((x) => x.id === signupId);
  if (!signup) throw new StoreError('not_found', 'That signup is already gone.');
  sheet.signups = sheet.signups.filter((x) => x.id !== signupId);
  const promoted = signup.status === 'confirmed' ? promote(sheet, signup.slotId) : null;
  save();
  return { promoted };
}

// Signups made from this browser (stand-in for "links in your inbox").
export async function getMySignups(sheetId) {
  const sheet = getDoc('sheets', sheetId);
  if (!sheet) return [];
  const ids = new Set(sheet.signups.map((s) => s.id));
  return readList(MY_SIGNUPS_KEY).filter((m) => m.sheetId === sheetId && ids.has(m.signupId));
}

/* =====================================================================
   GROUPS
   Group shape:
   { id, adminToken, name, emoji, color, description, location, visibility: 'public'|'private',
     createdAt,
     members:       [{ id, name, contact, role: 'organizer'|'co'|'member', joinedAt, token }],
     announcements: [{ id, text, author, createdAt, pinned }],
     events:        [{ id, title, description, location, date, start, end,
                       recurrence: 'none'|'weekly'|'biweekly'|'monthly', capacity (0 = no limit),
                       sheetIds: [], createdAt, updatedAt? }],
     rsvps:         [{ id, eventId, occurrence, memberId, name, contact,
                       status: 'going'|'maybe'|'no'|'waitlist', createdAt, queuedAt, updatedAt }] }
   A member's token is their identity (their "personal link"). Joining never hands out an existing token.
   ===================================================================== */

export const GROUP_COLORS = ['ketchup', 'mustard', 'relish', 'denim', 'grape', 'charcoal'];
export const FREE_MEMBER_LIMIT = 50;

const myMemberships = () => readList(MY_MEMBERSHIPS_KEY).filter((m) => typeof m.groupId === 'string');
function rememberMembership(groupId, member) {
  const list = myMemberships().filter((m) => m.groupId !== groupId);
  list.push({ groupId, memberId: member.id, token: member.token });
  return writeKey(MY_MEMBERSHIPS_KEY, list.slice(-100));
}
function forgetMembership(groupId) {
  writeKey(MY_MEMBERSHIPS_KEY, myMemberships().filter((m) => m.groupId !== groupId));
}

// Who is this browser, relative to a group? Decided only by tokens this browser holds.
function viewerOf(g) {
  const adminToken = mineRef('groups', g.id)?.adminToken === g.adminToken ? g.adminToken : null;
  const ref = myMemberships().find((m) => m.groupId === g.id);
  let member = ref && ref.token ? g.members.find((m) => m.id === ref.memberId && m.token === ref.token) : null;
  // Holding the admin token proves you're the organizer, even if the membership ref went missing.
  if (!member && adminToken) member = g.members.find((m) => m.role === 'organizer') || null;
  const canManage = !!adminToken || (member && (member.role === 'organizer' || member.role === 'co'));
  return {
    isAdmin: !!adminToken,
    canManage: !!canManage,
    auth: adminToken || (canManage ? member.token : null),
    member: member ? { id: member.id, name: member.name, contact: member.contact, role: member.role, token: member.token } : null,
  };
}

// Authorise a caller the way a server would: by the credential presented, checked against the current data
// on every call. The group's admin token belongs to the organizer's browser only. A co-organizer is
// authorised by their OWN member token plus their current role, so demoting or removing them takes effect
// immediately. Returns { g, by: 'admin' | 'organizer' | 'co', member }.
function authCaller(id, auth, { organizerOnly = false } = {}) {
  const g = getDoc('groups', id);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  let by = null;
  let member = null;
  if (auth && auth === g.adminToken) {
    by = 'admin';
  } else if (auth) {
    member = g.members.find((x) => x.token === auth) || null;
    if (member?.role === 'organizer') by = 'organizer';
    else if (member?.role === 'co') by = 'co';
  }
  if (!by) throw new StoreError('forbidden', 'Only organizers can do that.');
  if (organizerOnly && by === 'co') throw new StoreError('forbidden', "Only the group's organizer can do that.");
  return { g, by, member };
}
const authGroup = (id, auth, opts) => authCaller(id, auth, opts).g;

// After a co-organizer loses their role (or is removed), replace every secret that grants organizer rights,
// so anything they might have saved stops working. The organizer's own browser is updated in place.
function rotateOrganizerSecrets(g) {
  const oldAdmin = g.adminToken;
  g.adminToken = uid(24);
  for (const ref of db.mine.groups) if (ref.id === g.id && ref.adminToken === oldAdmin) ref.adminToken = g.adminToken;
  const org = g.members.find((m) => m.role === 'organizer');
  const swap = org ? { from: org.token, to: uid(24) } : null;
  if (org) org.token = swap.to;
  return swap;
}
// Runs after a successful save: keep this browser's own organizer membership pointing at the new token.
function applyTokenSwap(g, swap) {
  if (!swap) return;
  const list = myMemberships();
  let changed = false;
  for (const m of list) if (m.groupId === g.id && m.token === swap.from) { m.token = swap.to; changed = true; }
  if (changed) writeKey(MY_MEMBERSHIPS_KEY, list);
}

function publicGroup(g) {
  const viewer = viewerOf(g);
  const { adminToken, members, rsvps, ...rest } = g;
  const base = {
    ...clone(rest),
    memberCount: members.length,
    members: members.map(({ id, name, role, joinedAt }) => ({ id, name, role, joinedAt })),
    rsvps: rsvps.map(({ id, eventId, occurrence, memberId, name, status, createdAt, queuedAt }) =>
      ({ id, eventId, occurrence, memberId, name, status, createdAt, queuedAt })),
    viewer: { isAdmin: viewer.isAdmin, canManage: viewer.canManage, auth: viewer.auth, member: viewer.member },
    locked: false,
  };
  // Private groups: non-members only see the cover, not members/events/posts.
  if (g.visibility === 'private' && !viewer.member && !viewer.isAdmin) {
    return { ...base, members: [], rsvps: [], events: [], announcements: [], locked: true };
  }
  return base;
}

export async function getGroup(id) {
  const g = getDoc('groups', id);
  return g ? publicGroup(g) : null;
}

export async function listMyGroups() {
  const ids = new Set([...db.mine.groups.map((m) => m.id), ...myMemberships().map((m) => m.groupId)]);
  return [...ids].map((id) => getDoc('groups', id)).filter(Boolean)
    .map((g) => ({ ...publicGroup(g), demo: !!mineRef('groups', g.id)?.demo }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Organizer view data: contacts and roles, but never the admin token or anyone's member token.
// (A viewer's own token comes from getGroup().viewer only.)
export async function getGroupAdmin(id, auth) {
  const { adminToken, members, ...rest } = authGroup(id, auth);
  return clone({ ...rest, members: members.map(({ token, ...m }) => m) });
}

function normalizeEvent(d) {
  const rec = ['weekly', 'biweekly', 'monthly'].includes(d.recurrence) ? d.recurrence : 'none';
  return {
    title: clip(d.title, 120),
    description: clip(d.description, 1000),
    location: clip(d.location, 200),
    date: clip(d.date, 10), start: clip(d.start, 5), end: clip(d.end, 5),
    recurrence: rec,
    capacity: d.capacity == null ? 0 : parseCount(d.capacity), // NaN for "-3", "2.5", "" etc.
  };
}

function validateEvent(ev, { checkPast = true } = {}) {
  if (!ev.title) throw new StoreError('invalid', 'Give the event a name.', 'title');
  if (!ev.date || !parseDate(ev.date)) throw new StoreError('invalid', 'Pick a date for the event.', 'date');
  if (ev.start && ev.end && ev.end <= ev.start) throw new StoreError('invalid', 'End time should be after the start time.', 'end');
  if (!(ev.capacity >= 0 && ev.capacity <= 9999)) throw new StoreError('invalid', 'Spots should be a whole number from 0 (no limit) to 9999.', 'capacity');
  if (checkPast && ev.recurrence === 'none' && ev.date < todayIso()) {
    throw new StoreError('invalid', 'That date has already passed. Pick an upcoming date.', 'date');
  }
}

export async function createGroup(draft) {
  const name = clip(draft.name, 80);
  if (!name) throw new StoreError('invalid', 'Your group needs a name.');
  const orgName = clip(draft.organizer?.name, 80);
  if (!orgName) throw new StoreError('invalid', 'Add your name as organizer.');
  const orgEmail = clip(draft.organizer?.email, 120);
  if (orgEmail && !isEmail(orgEmail)) throw new StoreError('invalid', "That organizer email doesn't look right.");
  const id = newId('groups');
  const now = Date.now();
  const organizer = { id: uid(8), name: orgName, contact: orgEmail, role: 'organizer', joinedAt: now, token: uid(24) };
  const g = {
    id, adminToken: uid(24), name,
    emoji: clip(draft.emoji, 8) || '🏕️',
    color: GROUP_COLORS.includes(draft.color) ? draft.color : 'ketchup',
    description: clip(draft.description, 2000),
    location: clip(draft.location, 200),
    visibility: draft.visibility === 'private' ? 'private' : 'public',
    createdAt: now,
    members: [organizer],
    announcements: [],
    events: [],
    rsvps: [],
  };
  if (draft.welcome) g.announcements.push({ id: uid(8), text: clip(draft.welcome, 1000), author: orgName, createdAt: now, pinned: true });
  insertDoc('groups', g);
  save();
  rememberMembership(id, organizer); // best effort: the admin token already identifies the organizer
  return { id, adminToken: g.adminToken };
}

// Join with name + email. An email that's already in the group is refused: the email proves nothing,
// and handing over that member's token would let anyone become them (or the organizer).
export async function joinGroup(id, input) {
  const g = getDoc('groups', id);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  const { name, contact } = validateParticipant(input, { emailOnly: true });
  const current = viewerOf(g).member;
  if (current) return { memberId: current.id, already: true };
  const key = contactKey(contact);
  if (g.members.some((m) => m.contact && contactKey(m.contact) === key)) {
    throw new StoreError('exists', 'That email is already in this group. Use your personal link to get back in.', 'contact');
  }
  if (g.members.length >= FREE_MEMBER_LIMIT && !g.plus) {
    throw new StoreError('limit', `This group is at the free plan's ${FREE_MEMBER_LIMIT}-member limit. Ask the organizer about Group Plus.`);
  }
  const member = { id: uid(8), name, contact, role: 'member', joinedAt: Date.now(), token: uid(24) };
  g.members.push(member);
  if (!rememberMembership(id, member)) { g.members.pop(); throw storageError(); }
  try { save(); } catch (e) { forgetMembership(id); throw e; }
  return { memberId: member.id, token: member.token };
}

// Personal link (#/g/<id>/me/<token>): the token is the identity. Stand-in for an emailed magic link.
export async function useMemberLink(id, token) {
  const g = getDoc('groups', id);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  const m = token ? g.members.find((x) => x.token === token) : null;
  if (!m) throw new StoreError('not_found', "That personal link doesn't match anyone in this group. Maybe you left, or it was copied incompletely.");
  if (!rememberMembership(id, m)) throw storageError();
  return { name: m.name };
}

export async function leaveGroup(id) {
  const g = getDoc('groups', id);
  const ref = myMemberships().find((m) => m.groupId === id);
  if (!g || !ref) return;
  const member = g.members.find((m) => m.id === ref.memberId && m.token === ref.token);
  if (member?.role === 'organizer') throw new StoreError('forbidden', "Organizers can't leave their own group.");
  if (member) {
    const swap = member.role === 'co' ? rotateOrganizerSecrets(g) : null;
    g.members = g.members.filter((m) => m.id !== member.id);
    const affected = new Set();
    g.rsvps = g.rsvps.filter((r) => {
      if (r.memberId !== member.id) return true;
      if (r.status === 'going') affected.add(`${r.eventId}|${r.occurrence}`);
      return false;
    });
    for (const k of affected) { const [e, o] = k.split('|'); promoteRsvp(g, e, o); }
    save();
    applyTokenSwap(g, swap);
  }
  forgetMembership(id);
}

// Role changes are the organizer's call. A co-organizer may only step down themselves.
export async function setMemberRole(id, auth, memberId, role) {
  const { g, by, member: caller } = authCaller(id, auth);
  const m = g.members.find((x) => x.id === memberId);
  if (!m) throw new StoreError('not_found', 'Member not found.');
  if (m.role === 'organizer') throw new StoreError('forbidden', "The group's organizer stays the organizer.");
  const next = role === 'co' ? 'co' : 'member';
  if (by === 'co' && !(caller.id === m.id && next === 'member')) {
    throw new StoreError('forbidden', "Only the group's organizer can change roles.");
  }
  const demoted = m.role === 'co' && next !== 'co';
  m.role = next;
  const swap = demoted ? rotateOrganizerSecrets(g) : null;
  save();
  applyTokenSwap(g, swap);
}

// Organizers can remove anyone but themselves; co-organizers can remove regular members only.
export async function removeMember(id, auth, memberId) {
  const { g, by } = authCaller(id, auth);
  const m = g.members.find((x) => x.id === memberId);
  if (!m) return;
  if (m.role === 'organizer') throw new StoreError('forbidden', "You can't remove the organizer.");
  if (by === 'co' && m.role === 'co') throw new StoreError('forbidden', "Only the group's organizer can remove a co-organizer.");
  const swap = m.role === 'co' ? rotateOrganizerSecrets(g) : null;
  m.token = uid(24); // their personal link stops working at once
  g.members = g.members.filter((x) => x.id !== memberId);
  const affected = new Set();
  g.rsvps = g.rsvps.filter((r) => {
    if (r.memberId !== memberId) return true;
    if (r.status === 'going') affected.add(`${r.eventId}|${r.occurrence}`);
    return false;
  });
  for (const k of affected) { const [e, o] = k.split('|'); promoteRsvp(g, e, o); }
  save();
  applyTokenSwap(g, swap);
}

/* ---------- Announcements ---------- */

export async function postAnnouncement(id, auth, { text, pinned = false, author }) {
  const g = authGroup(id, auth);
  const t = clip(text, 1000);
  if (!t) throw new StoreError('invalid', 'Write something first.');
  if (pinned) g.announcements.forEach((a) => { a.pinned = false; });
  g.announcements.push({ id: uid(8), text: t, author: clip(author, 80) || 'Organizer', createdAt: Date.now(), pinned: !!pinned });
  save();
}

export async function togglePin(id, auth, annId) {
  const g = authGroup(id, auth);
  const a = g.announcements.find((x) => x.id === annId);
  if (!a) return;
  const next = !a.pinned;
  g.announcements.forEach((x) => { x.pinned = false; }); // only one pinned post
  a.pinned = next;
  save();
}

export async function deleteAnnouncement(id, auth, annId) {
  const g = authGroup(id, auth);
  g.announcements = g.announcements.filter((x) => x.id !== annId);
  save();
}

/* ---------- Events ---------- */

export async function createEvent(id, auth, data) {
  const g = authGroup(id, auth);
  const ev = normalizeEvent(data);
  validateEvent(ev);
  const event = { ...ev, id: uid(8), sheetIds: [], createdAt: Date.now() };
  g.events.push(event);
  save();
  return { eventId: event.id };
}

// Edit after publishing. RSVPs are never deleted: ones on dates that drop out of the series are kept
// (and come back if the change is undone); more spots move waitlisted people in.
export async function updateEvent(id, auth, eventId, data) {
  const g = authGroup(id, auth);
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) throw new StoreError('not_found', 'That event no longer exists.');
  const next = normalizeEvent(data);
  validateEvent(next, { checkPast: next.date !== ev.date || next.recurrence !== ev.recurrence });
  Object.assign(ev, next, { updatedAt: Date.now() });
  let promoted = 0;
  for (const occ of new Set(g.rsvps.filter((r) => r.eventId === eventId).map((r) => r.occurrence))) {
    while (promoteRsvp(g, eventId, occ)) promoted++;
  }
  save();
  return { promoted };
}

export async function deleteEvent(id, auth, eventId) {
  const g = authGroup(id, auth);
  const ev = g.events.find((e) => e.id === eventId);
  for (const sid of ev?.sheetIds || []) {
    const s = getDoc('sheets', sid);
    if (s && s.eventId === eventId) unlinkSheet(sid);
  }
  g.events = g.events.filter((e) => e.id !== eventId);
  g.rsvps = g.rsvps.filter((r) => r.eventId !== eventId);
  save();
}

// Attach a sheet to an event. Needs the group's auth AND the sheet's admin token (you can only attach
// sheets you organize). A sheet belongs to one event at a time.
export async function attachSheet(id, auth, eventId, sheetId, sheetToken) {
  const g = authGroup(id, auth);
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) throw new StoreError('not_found', 'Event not found.');
  const sheet = getDoc('sheets', sheetId);
  if (!sheet) throw new StoreError('not_found', 'Sheet not found.');
  if (!sheetToken || sheetToken !== sheet.adminToken) throw new StoreError('forbidden', 'You can only attach sheets you organize.');
  for (const og of Object.values(col('groups'))) {
    for (const e of og.events) {
      if (e !== ev) e.sheetIds = (e.sheetIds || []).filter((s) => s !== sheetId);
    }
  }
  ev.sheetIds = [...new Set([...(ev.sheetIds || []), sheetId])];
  sheet.groupId = g.id;
  sheet.eventId = ev.id;
  save();
}

export async function detachSheet(id, auth, eventId, sheetId) {
  const g = authGroup(id, auth);
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) return;
  ev.sheetIds = (ev.sheetIds || []).filter((s) => s !== sheetId);
  const sheet = getDoc('sheets', sheetId);
  if (sheet && sheet.eventId === eventId) unlinkSheet(sheetId);
  save();
}

/* ---------- RSVPs ---------- */

// Move the next waitlisted person in if there's room. Returns their short name.
function promoteRsvp(g, eventId, occurrence) {
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) return null;
  const r = rsvpsFor(g, eventId, occurrence);
  if (ev.capacity && r.going.length >= ev.capacity) return null;
  const next = r.waitlist[0];
  if (!next) return null;
  next.status = 'going';
  next.promotedAt = Date.now();
  next.updatedAt = next.promotedAt;
  return shortName(next.name);
}

// RSVP as the current browser's member (joining the group first if needed via `input`).
export async function rsvp(groupId, eventId, occurrence, status, input = null) {
  const g = getDoc('groups', groupId);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) throw new StoreError('not_found', 'That event no longer exists.');
  if (!isOccurrence(ev, occurrence)) throw new StoreError('invalid', "That date isn't part of this event.");
  if (!['going', 'maybe', 'no'].includes(status)) throw new StoreError('invalid', 'Pick Going, Maybe or Can\'t.');

  let member = viewerOf(g).member;
  if (!member) {
    if (!input) throw new StoreError('need_join', 'Join the group to RSVP.');
    await joinGroup(groupId, input); // refuses emails already in the group
    member = viewerOf(g).member;
    if (!member) throw new StoreError('need_join', 'Join the group to RSVP.');
  }
  const full = g.members.find((m) => m.id === member.id);
  let rec = g.rsvps.find((r) => r.eventId === eventId && r.occurrence === occurrence && r.memberId === member.id);
  const wasGoing = rec?.status === 'going';
  const now = Date.now();
  let finalStatus = status;
  if (status === 'going' && !wasGoing && rec?.status !== 'waitlist') {
    const counts = rsvpsFor(g, eventId, occurrence);
    if (ev.capacity && counts.going.length >= ev.capacity) finalStatus = 'waitlist';
  } else if (status === 'going' && rec?.status === 'waitlist') {
    finalStatus = 'waitlist'; // keep their place in line
  }
  if (!rec) {
    rec = { id: uid(8), eventId, occurrence, memberId: member.id, name: full.name, contact: full.contact, status: finalStatus, createdAt: now, queuedAt: now, updatedAt: now };
    g.rsvps.push(rec);
  } else {
    if (finalStatus === 'waitlist' && rec.status !== 'waitlist') rec.queuedAt = now;
    if (rec.status !== finalStatus) rec.updatedAt = now;
    rec.status = finalStatus;
  }
  const promoted = wasGoing && finalStatus !== 'going' ? promoteRsvp(g, eventId, occurrence) : null;
  save();
  const counts = rsvpsFor(g, eventId, occurrence);
  const pos = finalStatus === 'waitlist' ? counts.waitlist.findIndex((r) => r.id === rec.id) + 1 : 0;
  return { status: finalStatus, position: pos, promoted, member: { name: full.name, contact: full.contact } };
}

/* ---------- Remembered participant (one identity across sheets + groups) ---------- */

export function getMe() {
  const v = readKey(ME_KEY, null);
  return isObj(v) ? { name: str(v.name), contact: str(v.contact) } : { name: '', contact: '' };
}
export const setMe = (me) => writeKey(ME_KEY, { name: clip(me.name, 80), contact: clip(me.contact, 120) });

export const todayIso = () => isoDate(today());
