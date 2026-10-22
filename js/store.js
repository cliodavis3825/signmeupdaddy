// Data layer. Everything that touches persistence lives here.
//
// - Data lives in generic collections keyed by type (db.collections.sheets, db.collections.groups),
//   with "mine" refs per type (things this browser created/administers). New types slot in cleanly.
// - All exported functions are async and return plain copies, so this module can be swapped for a
//   fetch()-based API client later without changing any view code.
// - The public/admin split mirrors a server: public getters never expose contacts or tokens.

import { uid, isEmail, isPhone, readLocal, writeLocal, isoDate, today } from './util.js';
import { confirmedFor, waitlistFor, rsvpsFor, isOccurrence } from './model.js';
import { buildSeeds } from './seed.js';

const KEY = 'smud:v2';
const ME_KEY = 'smud:me';
const MY_SIGNUPS_KEY = 'smud:mysignups';
const MY_MEMBERSHIPS_KEY = 'smud:mymemberships';
const TYPES = ['sheets', 'groups'];
const listeners = new Set();
let persistent = true;

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function emptyDb() {
  const db = { version: 2, collections: {}, mine: {}, seeded: false };
  for (const t of TYPES) { db.collections[t] = {}; db.mine[t] = []; }
  return db;
}

function loadDb() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.collections !== 'object' || typeof d.mine !== 'object') return null;
    for (const t of TYPES) { d.collections[t] ||= {}; d.mine[t] ||= []; }
    return d;
  } catch {
    persistent = false;
    return null;
  }
}

// In-memory copy; falls back to memory-only if localStorage is unavailable.
let db = loadDb() || emptyDb();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    persistent = true;
  } catch {
    persistent = false;
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
  if (e.key === KEY) {
    db = loadDb() || db;
    emit();
  }
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const lc = (s) => String(s || '').toLowerCase();

/* ---------- Generic collection helpers ---------- */

const col = (type) => db.collections[type];
const getDoc = (type, id) => col(type)[id] || null;
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
export const isPersistent = () => persistent;

export function init() {
  if (db.seeded) return;
  const seeds = buildSeeds();
  for (const type of TYPES) {
    for (const doc of seeds[type] || []) {
      if (!getDoc(type, doc.id)) insertDoc(type, doc, { demo: true });
    }
  }
  db.seeded = true;
  save();
}

function validateParticipant({ name, contact }, { emailOnly = false } = {}) {
  const n = clip(name, 80);
  const c = clip(contact, 120);
  if (!n) throw new StoreError('invalid', 'Please add your name.');
  if (emailOnly ? !isEmail(c) : (!isEmail(c) && !isPhone(c))) {
    throw new StoreError('invalid', emailOnly ? 'Please enter a valid email.' : 'Please enter a valid email or phone number.');
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

function findSignupByToken(token) {
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

// After a confirmed spot frees up, move the first waitlisted person in. Returns their name.
function promote(sheet, slotId) {
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot) return null;
  if (confirmedFor(sheet, slotId).length >= slot.capacity) return null;
  const next = waitlistFor(sheet, slotId)[0];
  if (!next) return null;
  next.status = 'confirmed';
  next.promotedAt = Date.now();
  return next.name;
}

function adminSheet(id, adminToken) {
  const sheet = getDoc('sheets', id);
  if (!sheet) throw new StoreError('not_found', "We couldn't find that sheet.");
  if (!adminToken || sheet.adminToken !== adminToken) throw new StoreError('forbidden', 'Only the organizer can do that.');
  return sheet;
}

export async function getSheet(id) {
  const s = getDoc('sheets', id);
  return s ? publicSheet(s) : null;
}

export async function getSheets(ids) {
  return ids.map((id) => getDoc('sheets', id)).filter(Boolean).map(publicSheet);
}

export async function listMySheets() {
  return db.mine.sheets
    .filter((m) => getDoc('sheets', m.id))
    .map((m) => ({ ...publicSheet(getDoc('sheets', m.id)), demo: !!m.demo }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// In a real backend the admin token would come from a magic link / session.
export async function getAdminToken(id) {
  return mineRef('sheets', id)?.adminToken || null;
}

export async function getSheetAdmin(id, adminToken) {
  return clone(adminSheet(id, adminToken));
}

export function normalizeDraft(d) {
  const slots = (d.slots || []).map((s) => {
    const base = {
      id: clip(s.id, 20) || uid(6),
      type: s.type === 'time' ? 'time' : 'item',
      label: clip(s.label, 100),
      note: clip(s.note, 200),
      capacity: Math.min(999, Math.max(1, parseInt(s.capacity, 10) || 1)),
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

export async function createSheet(draft) {
  const data = normalizeDraft(draft);
  if (!data.title) throw new StoreError('invalid', 'Your sheet needs a title.');
  if (!data.organizer.name) throw new StoreError('invalid', 'Add an organizer name.');
  if (!data.slots.length) throw new StoreError('invalid', 'Add at least one slot.');
  const id = newId('sheets');
  const adminToken = uid(24);
  insertDoc('sheets', { ...data, id, adminToken, signups: [], createdAt: Date.now() });
  save();
  return { id, adminToken };
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
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot) throw new StoreError('not_found', 'That slot no longer exists.');
  const { name, contact } = validateParticipant(input);
  const dup = sheet.signups.find((x) => x.slotId === slotId && lc(x.contact) === lc(contact));
  if (dup) throw new StoreError('duplicate', "You're already signed up for this one. Use your edit link to make changes.");

  const full = confirmedFor(sheet, slotId).length >= slot.capacity;
  if (full && !sheet.waitlist) throw new StoreError('full', 'Shoot, that one just filled up. Try another slot?');

  const now = Date.now();
  const signup = {
    id: uid(8), slotId, name, contact, note: clip(input.note, 200),
    status: full ? 'waitlist' : 'confirmed', createdAt: now, queuedAt: now, token: uid(24),
  };
  sheet.signups.push(signup);
  const mine = readLocal(MY_SIGNUPS_KEY, []) || [];
  mine.push({ sheetId, signupId: signup.id, token: signup.token });
  writeLocal(MY_SIGNUPS_KEY, mine.slice(-300));
  save();
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
  let promoted = null;
  if (patch.slotId && patch.slotId !== signup.slotId) {
    const slot = sheet.slots.find((s) => s.id === patch.slotId);
    if (!slot) throw new StoreError('not_found', 'That slot no longer exists.');
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
  return (readLocal(MY_SIGNUPS_KEY, []) || []).filter((m) => m.sheetId === sheetId && ids.has(m.signupId));
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
                       sheetIds: [], createdAt }],
     rsvps:         [{ id, eventId, occurrence, memberId, name, contact,
                       status: 'going'|'maybe'|'no'|'waitlist', createdAt, queuedAt }] }
   ===================================================================== */

export const GROUP_COLORS = ['ketchup', 'mustard', 'relish', 'denim', 'grape', 'charcoal'];
export const FREE_MEMBER_LIMIT = 50;

const myMemberships = () => readLocal(MY_MEMBERSHIPS_KEY, []) || [];
function rememberMembership(groupId, member) {
  const list = myMemberships().filter((m) => m.groupId !== groupId);
  list.push({ groupId, memberId: member.id, token: member.token });
  writeLocal(MY_MEMBERSHIPS_KEY, list.slice(-100));
}
function forgetMembership(groupId) {
  writeLocal(MY_MEMBERSHIPS_KEY, myMemberships().filter((m) => m.groupId !== groupId));
}

// Who is this browser, relative to a group?
function viewerOf(g) {
  const adminToken = mineRef('groups', g.id)?.adminToken === g.adminToken ? g.adminToken : null;
  const ref = myMemberships().find((m) => m.groupId === g.id);
  const member = ref ? g.members.find((m) => m.id === ref.memberId && m.token === ref.token) : null;
  const canManage = !!adminToken || (member && (member.role === 'organizer' || member.role === 'co'));
  return {
    isAdmin: !!adminToken,
    canManage: !!canManage,
    auth: adminToken || (canManage ? member.token : null),
    member: member ? { id: member.id, name: member.name, contact: member.contact, role: member.role, token: member.token } : null,
  };
}

// Auth = the group's admin token, or a co-organizer's member token.
function authGroup(id, auth) {
  const g = getDoc('groups', id);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  if (!auth) throw new StoreError('forbidden', 'Only organizers can do that.');
  if (auth === g.adminToken) return g;
  const m = g.members.find((x) => x.token === auth);
  if (m && (m.role === 'organizer' || m.role === 'co')) return g;
  throw new StoreError('forbidden', 'Only organizers can do that.');
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

export async function getGroupAdmin(id, auth) {
  return clone(authGroup(id, auth));
}

function normalizeEvent(d) {
  const rec = ['weekly', 'biweekly', 'monthly'].includes(d.recurrence) ? d.recurrence : 'none';
  return {
    title: clip(d.title, 120),
    description: clip(d.description, 1000),
    location: clip(d.location, 200),
    date: clip(d.date, 10), start: clip(d.start, 5), end: clip(d.end, 5),
    recurrence: rec,
    capacity: Math.min(9999, Math.max(0, parseInt(d.capacity, 10) || 0)),
  };
}

function validateEvent(ev) {
  if (!ev.title) throw new StoreError('invalid', 'Give the event a name.');
  if (!ev.date) throw new StoreError('invalid', 'Pick a date for the event.');
  if (ev.start && ev.end && ev.end <= ev.start) throw new StoreError('invalid', 'End time should be after the start time.');
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
  rememberMembership(id, organizer);
  save();
  return { id, adminToken: g.adminToken };
}

export async function joinGroup(id, input) {
  const g = getDoc('groups', id);
  if (!g) throw new StoreError('not_found', "We couldn't find that group.");
  const { name, contact } = validateParticipant(input, { emailOnly: true });
  let member = g.members.find((m) => lc(m.contact) === lc(contact));
  let welcomeBack = false;
  if (member) {
    welcomeBack = true;
  } else {
    if (g.members.length >= FREE_MEMBER_LIMIT && !g.plus) {
      throw new StoreError('limit', `This group is at the free plan's ${FREE_MEMBER_LIMIT}-member limit. Ask the organizer about Group Plus.`);
    }
    member = { id: uid(8), name, contact, role: 'member', joinedAt: Date.now(), token: uid(24) };
    g.members.push(member);
  }
  rememberMembership(id, member);
  save();
  return { memberId: member.id, welcomeBack };
}

export async function leaveGroup(id) {
  const g = getDoc('groups', id);
  const ref = myMemberships().find((m) => m.groupId === id);
  if (!g || !ref) return;
  const member = g.members.find((m) => m.id === ref.memberId && m.token === ref.token);
  if (member?.role === 'organizer') throw new StoreError('forbidden', "Organizers can't leave their own group.");
  if (member) {
    g.members = g.members.filter((m) => m.id !== member.id);
    const affected = new Set();
    g.rsvps = g.rsvps.filter((r) => {
      if (r.memberId !== member.id) return true;
      if (r.status === 'going') affected.add(`${r.eventId}|${r.occurrence}`);
      return false;
    });
    for (const k of affected) { const [e, o] = k.split('|'); promoteRsvp(g, e, o); }
  }
  forgetMembership(id);
  save();
}

export async function setMemberRole(id, auth, memberId, role) {
  const g = authGroup(id, auth);
  const m = g.members.find((x) => x.id === memberId);
  if (!m) throw new StoreError('not_found', 'Member not found.');
  if (m.role === 'organizer') throw new StoreError('forbidden', "The group's organizer stays the organizer.");
  m.role = role === 'co' ? 'co' : 'member';
  save();
}

export async function removeMember(id, auth, memberId) {
  const g = authGroup(id, auth);
  const m = g.members.find((x) => x.id === memberId);
  if (!m) return;
  if (m.role === 'organizer') throw new StoreError('forbidden', "You can't remove the organizer.");
  g.members = g.members.filter((x) => x.id !== memberId);
  const affected = new Set();
  g.rsvps = g.rsvps.filter((r) => {
    if (r.memberId !== memberId) return true;
    if (r.status === 'going') affected.add(`${r.eventId}|${r.occurrence}`);
    return false;
  });
  for (const k of affected) { const [e, o] = k.split('|'); promoteRsvp(g, e, o); }
  save();
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

export async function deleteEvent(id, auth, eventId) {
  const g = authGroup(id, auth);
  g.events = g.events.filter((e) => e.id !== eventId);
  g.rsvps = g.rsvps.filter((r) => r.eventId !== eventId);
  save();
}

// Attach an existing sheet (must be administered from this browser) to an event.
export async function attachSheet(id, auth, eventId, sheetId) {
  const g = authGroup(id, auth);
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev) throw new StoreError('not_found', 'Event not found.');
  const sheet = getDoc('sheets', sheetId);
  if (!sheet) throw new StoreError('not_found', 'Sheet not found.');
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
  if (sheet && sheet.eventId === eventId) { sheet.eventId = null; }
  save();
}

/* ---------- RSVPs ---------- */

function promoteRsvp(g, eventId, occurrence) {
  const ev = g.events.find((e) => e.id === eventId);
  if (!ev || !ev.capacity) return null;
  const r = rsvpsFor(g, eventId, occurrence);
  if (r.going.length >= ev.capacity) return null;
  const next = r.waitlist[0];
  if (!next) return null;
  next.status = 'going';
  next.promotedAt = Date.now();
  return next.name;
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
    await joinGroup(groupId, input);
    member = viewerOf(g).member;
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
    rec = { id: uid(8), eventId, occurrence, memberId: member.id, name: full.name, contact: full.contact, status: finalStatus, createdAt: now, queuedAt: now };
    g.rsvps.push(rec);
  } else {
    if (finalStatus === 'waitlist' && rec.status !== 'waitlist') rec.queuedAt = now;
    rec.status = finalStatus;
  }
  const promoted = wasGoing && finalStatus !== 'going' ? promoteRsvp(g, eventId, occurrence) : null;
  save();
  const counts = rsvpsFor(g, eventId, occurrence);
  const pos = finalStatus === 'waitlist' ? counts.waitlist.findIndex((r) => r.id === rec.id) + 1 : 0;
  return { status: finalStatus, position: pos, promoted, member: { name: full.name, contact: full.contact } };
}

/* ---------- Remembered participant (one identity across sheets + groups) ---------- */

export const getMe = () => readLocal(ME_KEY, { name: '', contact: '' }) || { name: '', contact: '' };
export const setMe = (me) => writeLocal(ME_KEY, { name: clip(me.name, 80), contact: clip(me.contact, 120) });

export const todayIso = () => isoDate(today());
