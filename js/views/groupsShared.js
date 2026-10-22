// Shared Groups UI: avatars, event cards, RSVP + "claim a slot" flow, join dialog,
// event creation / sheet attachment dialogs, pricing section.
import { html, raw, parseDate, fmtDate, fmtDateLong, fmtRange, firstName, isEmail, toast, shortName } from '../util.js';
import { occurrences, nextOccurrence, rsvpsFor, sheetProgressFor, slotStats, RECURRENCE_LABELS } from '../model.js';
import { icon, openDialog, progressBar, openShareLinkDialog } from '../components.js';
import { TEMPLATES, getTemplate, timeSlot } from '../templates.js';
import { calendarAndLink, wireCalendarAndLink } from './participant.js';
import { openSignupDialog } from './signup.js';
import * as store from '../store.js';

export const groupUrl = (id) => `${location.origin}${location.pathname}#/g/${encodeURIComponent(id)}`;
export const eventUrl = (gid, eid, occ) => `${location.origin}${location.pathname}#/g/${encodeURIComponent(gid)}/e/${encodeURIComponent(eid)}${occ ? `/${occ}` : ''}`;

/* ---------- Small pieces ---------- */

const AV_COLORS = ['ketchup', 'mustard', 'relish', 'denim', 'grape', 'charcoal'];
export function avatar(name, size = '') {
  const parts = String(name || '?').trim().split(/\s+/);
  const initials = ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return html`<span class="avatar av-${AV_COLORS[h % AV_COLORS.length]} ${size}" aria-hidden="true">${initials}</span>`;
}

export function roleBadge(role) {
  if (role === 'organizer') return html`<span class="pill pill-primary">Organizer</span>`;
  if (role === 'co') return html`<span class="pill pill-blue">Co-organizer</span>`;
  return '';
}

export function dateChip(date) {
  const d = parseDate(date);
  if (!d) return '';
  return html`<div class="date-chip" aria-hidden="true">
    <span class="dc-mon">${d.toLocaleDateString(undefined, { month: 'short' })}</span>
    <span class="dc-day">${d.getDate()}</span>
    <span class="dc-dow">${d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
  </div>`;
}

export function myRsvp(group, eventId, occ) {
  const m = group.viewer?.member;
  if (!m) return null;
  return group.rsvps.find((r) => r.eventId === eventId && r.occurrence === occ && r.memberId === m.id) || null;
}

export function rsvpControl(group, ev, occ) {
  const mine = myRsvp(group, ev.id, occ);
  const cur = mine?.status === 'waitlist' ? 'going' : mine?.status;
  const opt = (val, label) => html`<button type="button" class="rsvp-btn rsvp-${val}" data-rsvp="${val}" data-event="${ev.id}" data-occ="${occ}" aria-pressed="${cur === val ? 'true' : 'false'}">${cur === val ? icon('check') : ''}${label}</button>`;
  return html`<div class="rsvp-group" role="group" aria-label="RSVP for ${ev.title} on ${fmtDateLong(occ)}">
    ${opt('going', 'Going')}${opt('maybe', 'Maybe')}${opt('no', "Can't")}
  </div>
  ${mine?.status === 'waitlist' ? html`<p class="small rsvp-note">${icon('clock')} You're on the waitlist. You'll move up automatically if a spot opens.</p>` : ''}`;
}

export function rsvpLine(group, ev, occ) {
  const r = rsvpsFor(group, ev.id, occ);
  const bits = [html`<strong>${r.going.length} going</strong>`];
  if (ev.capacity) bits.push(r.going.length >= ev.capacity ? html`<span class="text-green">full</span>` : `${ev.capacity - r.going.length} spots left`);
  if (r.maybe.length) bits.push(`${r.maybe.length} maybe`);
  if (r.waitlist.length) bits.push(`${r.waitlist.length} on waitlist`);
  return html`<p class="rsvp-line small">${bits.map((b, i) => html`${i ? ' · ' : ''}${b}`)}</p>
    ${ev.capacity ? progressBar(r.going.length, ev.capacity, `${ev.title}: ${r.going.length} of ${ev.capacity} spots taken`) : ''}`;
}

export function sheetProgressBlock(sheet, occ, { compact = false } = {}) {
  const p = sheetProgressFor(sheet, occ);
  if (!p.capacity) return '';
  return html`<div class="event-sheet">
    <div class="event-sheet-row">
      <span class="event-sheet-label">${sheet.emoji} <strong>${p.filled}/${p.capacity}</strong> claimed · ${sheet.title}</span>
      ${!compact && p.open ? html`<button type="button" class="btn btn-sm btn-mustard" data-claim="${sheet.id}" data-occ="${occ}">Claim a slot</button>` : ''}
      ${p.open ? '' : html`<span class="pill pill-green">${icon('check')}Covered</span>`}
    </div>
    ${progressBar(p.filled, p.capacity, `${sheet.title}: ${p.filled} of ${p.capacity} claimed`)}
  </div>`;
}

export function eventCard(group, ev, sheetsById) {
  const occs = occurrences(ev, { count: 4 });
  const occ = occs[0];
  if (!occ) return '';
  const sheets = (ev.sheetIds || []).map((id) => sheetsById[id]).filter(Boolean);
  const time = fmtRange(ev.start, ev.end);
  return html`<article class="card event-card" data-event-card="${ev.id}">
    ${dateChip(occ)}
    <div class="event-main">
      <h3 class="event-title"><a href="#/g/${group.id}/e/${ev.id}/${occ}">${ev.title}</a></h3>
      <p class="event-meta small">
        <span>${icon('calendar')}${fmtDate(occ, { weekday: 'long', month: 'short', day: 'numeric' })}${time ? ` · ${time}` : ''}</span>
        ${ev.recurrence !== 'none' ? html`<span class="pill">${RECURRENCE_LABELS[ev.recurrence]}</span>` : ''}
        ${ev.location ? html`<span>${icon('pin')}${ev.location}</span>` : ''}
      </p>
      ${rsvpLine(group, ev, occ)}
      ${sheets.map((s) => sheetProgressBlock(s, occ))}
      ${rsvpControl(group, ev, occ)}
      ${occs.length > 1 ? html`<p class="small muted next-dates">Next: ${occs.slice(1).map((d, i) => html`${i ? ', ' : ''}<a href="#/g/${group.id}/e/${ev.id}/${d}">${fmtDate(d, { month: 'short', day: 'numeric' })}</a>`)}</p>` : ''}
    </div>
  </article>`;
}

/* ---------- Join dialog (name + email, no account) ---------- */

export function openJoinDialog(group, { title, intro, submitLabel = 'Join the group', onSubmit }) {
  const me = store.getMe();
  openDialog({
    title: title || `Join ${group.name}`,
    className: 'dialog-signup',
    body: html`<form novalidate>
      <p class="small">${intro || 'Just your name and email. No account, no password, no ads.'}</p>
      <div class="form-error" role="alert" hidden></div>
      <div class="field"><label for="jn-name">Your name</label><input id="jn-name" name="name" type="text" autocomplete="name" maxlength="80" required value="${me.name}" autofocus></div>
      <div class="field"><label for="jn-email">Email</label><input id="jn-email" name="contact" type="email" autocomplete="email" maxlength="120" required value="${isEmail(me.contact || '') ? me.contact : ''}" aria-describedby="jn-hint">
        <p class="hint" id="jn-hint">For event updates from the organizers. Never shown to other members.</p></div>
      <button type="submit" class="btn btn-primary btn-lg btn-block">${submitLabel}</button>
    </form>`,
    onMount(dlg) {
      const form = dlg.querySelector('form');
      const err = dlg.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const input = { name: String(fd.get('name') || ''), contact: String(fd.get('contact') || '') };
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        err.hidden = true;
        try {
          const after = await onSubmit(input);
          store.setMe(input);
          dlg.close();
          if (typeof after === 'function') after();
        } catch (ex) {
          btn.disabled = false;
          err.textContent = ex.message || 'Something went wrong.';
          err.hidden = false;
        }
      });
    },
  });
}

/* ---------- Claim-a-slot prompt (the headline flow) ---------- */

function claimIdentity(group) {
  const m = group.viewer?.member;
  if (m?.name && m?.contact) return { name: m.name, contact: m.contact };
  const me = store.getMe();
  return me.name && me.contact ? me : null;
}

export async function openClaimPrompt(group, ev, occ, { heading, intro, onChange } = {}) {
  const sheets = await store.getSheets(ev.sheetIds || []);
  const who = claimIdentity(group);
  const slotRow = (sheet, slot) => {
    const st = slotStats(sheet, slot);
    const names = sheet.signups.filter((s) => s.slotId === slot.id && s.status === 'confirmed').map((s) => shortName(s.name));
    let btn;
    if (!st.full) btn = html`<button type="button" class="btn btn-primary btn-sm" data-claim-slot="${slot.id}" data-sheet="${sheet.id}" aria-label="Claim ${slot.label}">Claim</button>`;
    else if (sheet.waitlist) btn = html`<button type="button" class="btn btn-ghost btn-sm" data-claim-slot="${slot.id}" data-sheet="${sheet.id}" aria-label="Join waitlist for ${slot.label}">Waitlist</button>`;
    else btn = html`<span class="pill pill-green">Full</span>`;
    return html`<li class="claim-row ${st.full ? 'is-full' : ''}">
      <div class="claim-main"><strong>${slot.label}</strong> <span class="muted small">${Math.min(st.filled, st.capacity)} of ${st.capacity} claimed</span>
        ${progressBar(st.filled, st.capacity, `${slot.label}: ${st.filled} of ${st.capacity} claimed`)}
        ${names.length ? html`<span class="tiny muted">${names.join(', ')}</span>` : ''}</div>
      ${btn}
    </li>`;
  };
  const anyOpen = sheets.some((s) => sheetProgressFor(s, occ).open > 0);

  openDialog({
    title: heading || 'Want to bring something?',
    className: 'dialog-claim',
    body: html`<div class="claim-body">
      <p class="claim-intro">${intro || html`${ev.title} · ${fmtDateLong(occ)}`}</p>
      ${who ? html`<p class="small muted">One tap claims it as <strong>${who.name}</strong>.</p>` : ''}
      ${anyOpen ? '' : html`<p class="callout callout-green">Everything's covered already. Just bring yourself (and maybe a dad joke).</p>`}
      ${sheets.map((s) => {
        const slots = sheetProgressFor(s, occ).slots;
        if (!slots.length) return '';
        return html`<section class="claim-sheet"><h3 class="h4">${s.emoji} ${s.title}</h3><ul class="claim-list">${slots.map((sl) => slotRow(s, sl))}</ul>
          <p class="tiny"><a href="#/s/${s.id}">Open the full sheet</a></p></section>`;
      })}
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-close>${anyOpen ? 'Maybe later' : 'Sounds good'}</button></div>
    </div>`,
    onMount(dlg) {
      dlg.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-claim-slot]');
        if (!b) return;
        const sheet = sheets.find((s) => s.id === b.dataset.sheet);
        const slot = sheet?.slots.find((s) => s.id === b.dataset.claimSlot);
        if (!slot) return;
        const showSuccess = async (res, name) => {
          const fresh = await store.getSheet(sheet.id);
          const body = dlg.querySelector('.dialog-body');
          body.innerHTML = html`<div class="claim-success">
            <div class="confirm-check" aria-hidden="true">${res.status === 'waitlist' ? '⏳' : icon('check')}</div>
            <p class="h3" tabindex="-1">${res.status === 'waitlist' ? `You're #${res.position} on the waitlist for ${slot.label}.` : `Nice, ${firstName(name)}! You've got ${slot.label}.`}</p>
            ${calendarAndLink(fresh, slot, res.token)}
            <div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div>
          </div>`.s;
          wireCalendarAndLink(body, fresh, slot, res.token);
          body.querySelector('[tabindex="-1"]').focus();
          onChange?.();
        };
        if (!who) {
          dlg.close();
          openSignupDialog(sheet, slot.id, {
            onDone: async (res) => { onChange?.(); toast(res.status === 'waitlist' ? "You're on the waitlist." : `You've got ${slot.label}!`); location.hash = `#/done/${res.token}`; },
          });
          return;
        }
        b.disabled = true;
        try {
          const res = await store.signUp(sheet.id, slot.id, { ...who, note: '' });
          await showSuccess(res, who.name);
        } catch (ex) {
          b.disabled = false;
          toast(ex.message);
        }
      });
    },
  });
}

/* ---------- RSVP handling ---------- */

export async function handleRsvp(group, ev, occ, status, rerender) {
  const run = async (input) => {
    const res = await store.rsvp(group.id, ev.id, occ, status, input);
    const fresh = await store.getGroup(group.id);
    await rerender?.();
    // Follow-ups run after any join dialog has closed, so focus lands in the right place.
    return async () => {
    if (res.status === 'going') {
      const sheets = await store.getSheets(ev.sheetIds || []);
      const open = sheets.some((s) => sheetProgressFor(s, occ).open > 0);
      if (sheets.length && open) {
        openClaimPrompt(fresh, ev, occ, { heading: `You're in, ${firstName(res.member.name)}! Want to bring something?`, onChange: rerender });
      } else {
        toast(`You're going! See you ${fmtDate(occ)}.`);
      }
    } else if (res.status === 'waitlist') {
      toast(`It's full, so you're #${res.position} on the waitlist. You'll move up automatically.`);
    } else {
      toast(status === 'maybe' ? 'Marked as maybe.' : "Got it, you can't make it. Maybe next time!");
    }
    if (res.promoted) toast(`${res.promoted} moved up from the waitlist.`);
    };
  };

  if (group.viewer?.member) {
    try { (await run(null))(); } catch (ex) { toast(ex.message); }
  } else {
    openJoinDialog(group, {
      title: `RSVP: ${ev.title}`,
      intro: html`RSVPing also adds you to <strong>${group.name}</strong>. Just your name and email. No account, no ads.`,
      submitLabel: status === 'going' ? "I'm going" : status === 'maybe' ? 'Mark me as maybe' : "I can't make it",
      onSubmit: (input) => run(input),
    });
  }
}

/* ---------- Event creation + sheet attachment ---------- */

const SHEET_TEMPLATES = ['snacks', 'potluck', 'carpool', 'volunteer', 'mealtrain'];

export function sheetChoiceSelect(id, mySheets, exclude = [], selected = '') {
  return html`<select id="${id}" name="sheet">
    <option value="">No sheet for now</option>
    <optgroup label="New sheet from a template">
      ${SHEET_TEMPLATES.map((t) => { const tp = getTemplate(t); return html`<option value="tpl:${t}" ${selected === `tpl:${t}` ? raw('selected') : ''}>${tp.emoji} ${tp.name}</option>`; })}
    </optgroup>
    ${mySheets.filter((s) => !exclude.includes(s.id)).length ? html`<optgroup label="Attach one of my sheets">
      ${mySheets.filter((s) => !exclude.includes(s.id)).map((s) => html`<option value="sheet:${s.id}" ${selected === `sheet:${s.id}` ? raw('selected') : ''}>${s.emoji} ${s.title}</option>`)}
    </optgroup>` : ''}
  </select>`;
}

// Builds a sheet draft from a template, aligned to the event's next occurrences.
export function buildEventSheet(templateId, ev, organizerName) {
  const tpl = getTemplate(templateId);
  const t = tpl.build();
  const from = store.todayIso();
  const occs = ev.recurrence === 'none' ? [ev.date] : occurrences(ev, { count: 4, from: ev.date > from ? ev.date : from });
  const itemOnly = t.slots.every((s) => s.type === 'item');
  let slots;
  if (itemOnly) {
    slots = t.slots;
  } else {
    const uniq = [];
    for (const s of t.slots) if (s.type === 'time' && !uniq.some((u) => u.label === s.label)) uniq.push(s);
    slots = occs.flatMap((d) => uniq.map((u) => timeSlot({
      label: templateId === 'snacks' ? 'Snacks' : u.label, note: u.note, capacity: u.capacity, date: d,
      start: templateId === 'volunteer' ? u.start : (ev.start || u.start), end: templateId === 'volunteer' ? u.end : (ev.end || u.end),
    })));
  }
  return {
    title: `${tpl.name}: ${ev.title}`,
    emoji: tpl.emoji,
    templateId,
    description: t.description,
    location: ev.location,
    date: itemOnly && ev.recurrence === 'none' ? ev.date : '',
    start: itemOnly ? ev.start : '', end: itemOnly ? ev.end : '',
    waitlist: true,
    organizer: { name: organizerName },
    slots,
  };
}

export async function applySheetChoice(group, auth, ev, choice) {
  if (!choice) return;
  if (choice.startsWith('tpl:')) {
    const organizer = group.viewer?.member?.name || group.members.find((m) => m.role === 'organizer')?.name || group.name;
    const draft = { ...buildEventSheet(choice.slice(4), ev, organizer), groupId: group.id, eventId: ev.id };
    const { id } = await store.createSheet(draft);
    await store.attachSheet(group.id, auth, ev.id, id);
  } else if (choice.startsWith('sheet:')) {
    await store.attachSheet(group.id, auth, ev.id, choice.slice(6));
  }
}

export function eventFields(prefix, ev = {}) {
  const rec = ev.recurrence || 'weekly';
  return html`
    <div class="field"><label for="${prefix}-title">Event name</label>
      <input id="${prefix}-title" name="title" type="text" maxlength="120" required value="${ev.title || ''}" placeholder="e.g. Saturday morning hike"></div>
    <div class="field-row three">
      <div class="field"><label for="${prefix}-date">${rec === 'none' ? 'Date' : 'First date'}</label><input id="${prefix}-date" name="date" type="date" required value="${ev.date || ''}"></div>
      <div class="field"><label for="${prefix}-start">Starts</label><input id="${prefix}-start" name="start" type="time" value="${ev.start || ''}"></div>
      <div class="field"><label for="${prefix}-end">Ends</label><input id="${prefix}-end" name="end" type="time" value="${ev.end || ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="${prefix}-rec">Repeats</label>
        <select id="${prefix}-rec" name="recurrence">
          ${Object.entries(RECURRENCE_LABELS).map(([k, v]) => html`<option value="${k}" ${k === rec ? raw('selected') : ''}>${v}</option>`)}
        </select></div>
      <div class="field"><label for="${prefix}-cap">Spots <span class="muted">(0 = no limit)</span></label>
        <input id="${prefix}-cap" name="capacity" type="number" min="0" max="9999" inputmode="numeric" value="${ev.capacity ?? 0}" aria-describedby="${prefix}-cap-hint">
        <p class="hint" id="${prefix}-cap-hint">When it's full, a free waitlist kicks in.</p></div>
    </div>
    <div class="field"><label for="${prefix}-loc">Location <span class="muted">(optional)</span></label>
      <input id="${prefix}-loc" name="location" type="text" maxlength="200" value="${ev.location || ''}"></div>
    <div class="field"><label for="${prefix}-desc">Details <span class="muted">(optional)</span></label>
      <textarea id="${prefix}-desc" name="description" rows="2" maxlength="1000">${ev.description || ''}</textarea></div>`;
}

export const readEventForm = (form) => {
  const fd = new FormData(form);
  const o = {};
  for (const k of ['title', 'date', 'start', 'end', 'recurrence', 'capacity', 'location', 'description']) o[k] = String(fd.get(k) ?? '');
  return o;
};

export async function openNewEventDialog(group, auth, { onCreated } = {}) {
  const mySheets = await store.listMySheets();
  const nextSat = new Date();
  nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7 || 7));
  const iso = `${nextSat.getFullYear()}-${String(nextSat.getMonth() + 1).padStart(2, '0')}-${String(nextSat.getDate()).padStart(2, '0')}`;
  openDialog({
    title: 'New event',
    className: 'dialog-wide',
    body: html`<form novalidate>
      <div class="form-error" role="alert" hidden></div>
      ${eventFields('ne', { date: iso, start: '10:00', end: '11:30', location: group.location, recurrence: 'none', capacity: 0 })}
      <div class="field"><label for="ne-sheet">Attach a sign-up sheet <span class="muted">(who's bringing what)</span></label>
        ${sheetChoiceSelect('ne-sheet', mySheets)}</div>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Create event</button></div>
    </form>`,
    onMount(dlg) {
      const form = dlg.querySelector('form');
      dlg.querySelector('#ne-title').focus();
      const err = dlg.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        try {
          const data = readEventForm(form);
          const { eventId } = await store.createEvent(group.id, auth, data);
          const g = await store.getGroup(group.id);
          const ev = g.events.find((x) => x.id === eventId);
          await applySheetChoice(g, auth, ev, String(new FormData(form).get('sheet') || ''));
          dlg.close();
          toast('Event created!');
          onCreated?.(eventId);
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    },
  });
}

export async function openAttachSheetDialog(group, auth, ev, { onDone } = {}) {
  const mySheets = await store.listMySheets();
  openDialog({
    title: `Attach a sheet to ${ev.title}`,
    body: html`<form novalidate>
      <p class="small">Snacks, carpools, roles: let people claim what they're bringing or doing right from the event.</p>
      <div class="form-error" role="alert" hidden></div>
      <div class="field"><label for="at-sheet">Sheet</label>${sheetChoiceSelect('at-sheet', mySheets, ev.sheetIds || [], 'tpl:snacks')}</div>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Attach</button></div>
    </form>`,
    onMount(dlg) {
      const form = dlg.querySelector('form');
      dlg.querySelector('#at-sheet').focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const choice = String(new FormData(form).get('sheet') || '');
        if (!choice) return dlg.close();
        try {
          await applySheetChoice(group, auth, ev, choice);
          dlg.close();
          toast('Sheet attached. People can claim slots when they RSVP.');
          onDone?.();
        } catch (ex) {
          const err = dlg.querySelector('.form-error');
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    },
  });
}

export function shareGroup(group, { justCreated = false } = {}) {
  const next = group.events.map((e) => ({ e, d: nextOccurrence(e) })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d))[0];
  const text = `Hey! ${group.emoji} Come join ${group.name}${next ? `. Next up: ${next.e.title}, ${fmtDate(next.d)}` : ''}. RSVP in one tap, no account, no ads:\n${groupUrl(group.id)}`;
  openShareLinkDialog({
    url: groupUrl(group.id), text, label: group.name, linkLabel: 'Group link',
    title: justCreated ? 'Your group is live! Invite the crew' : `Share ${group.name}`,
    lede: justCreated ? 'Send this to the group chat. Members join with just a name and email.' : '',
  });
}

/* ---------- Pricing ---------- */

export function pricingSection(idSuffix = '') {
  const hid = `pricing-h${idSuffix}`;
  return html`<section class="section pricing" aria-labelledby="${hid}">
    <div class="container">
      <h2 id="${hid}" class="section-title">Honest pricing. No ads on any plan.</h2>
      <p class="section-lede">Sign-up sheets are free, forever. Groups are free for small crews, and about $40 a month cheaper than Meetup when you grow.</p>
      <ul class="tiers">
        <li class="card tier">
          <h3>Free</h3><p class="price"><span class="amt">$0</span> <span class="per">forever</span></p>
          <ul class="tier-list"><li>${icon('check')}Unlimited sign-up sheets</li><li>${icon('check')}1 group, up to 50 members</li><li>${icon('check')}Unlimited events, RSVPs &amp; sheets</li><li>${icon('check')}Waitlists &amp; email reminders</li><li>${icon('check')}No ads. Ever.</li></ul>
          <a class="btn btn-ghost btn-block" href="#/groups/new">Start free</a>
        </li>
        <li class="card tier tier-featured">
          <span class="tier-flag">Best for growing groups</span>
          <h3>Group Plus</h3><p class="price"><span class="amt">$5</span> <span class="per">/mo per group, or $48/yr</span></p>
          <p class="tier-compare">vs. about $45/mo for Meetup Standard</p>
          <ul class="tier-list"><li>${icon('check')}Unlimited members</li><li>${icon('check')}SMS reminders (fair-use cap)</li><li>${icon('check')}Co-organizers</li><li>${icon('check')}Custom cover &amp; branding</li><li>${icon('check')}Member import, priority support</li></ul>
          <a class="btn btn-primary btn-block" href="#/groups/new">Start a group</a>
        </li>
        <li class="card tier">
          <h3>Organizer Pro</h3><p class="price"><span class="amt">$12</span> <span class="per">/mo</span></p>
          <ul class="tier-list"><li>${icon('check')}Up to 10 groups</li><li>${icon('check')}Analytics</li><li>${icon('check')}Custom domain</li><li>${icon('check')}Everything in Group Plus</li></ul>
          <a class="btn btn-ghost btn-block" href="#/groups/new">Start free, upgrade later</a>
        </li>
        <li class="card tier">
          <h3>Payments</h3><p class="price"><span class="amt">2%</span> <span class="per">+ Stripe fees</span></p>
          <ul class="tier-list"><li>${icon('check')}Dues, donations, paid events</li><li>${icon('check')}No platform fee on Plus or Pro</li></ul>
          <p class="muted small">Coming soon.</p>
        </li>
      </ul>
      <div class="promise-strip">${icon('shield')}<p><strong>Our promise:</strong> no ads, no surprise price hikes, and at least <strong>90 days' notice</strong> before any price change. In writing. Dad's honor.</p></div>
      <p class="muted small">Prototype: plans aren't enforced except the free 50-member cap. Prices are proposals, October 2026.</p>
    </div>
  </section>`;
}
