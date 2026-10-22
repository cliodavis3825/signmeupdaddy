// Participant screens: confirmation (#/done/<token>) and edit/cancel (#/edit/<token>).
import { html, raw, fmtDateLong, fmtRange, firstName, copyText, toast, download, slugify, randomJoke } from '../util.js';
import { slotStats, slotWhen } from '../model.js';
import { icon, confirmDialog, openShareDialog } from '../components.js';
import { eventFor, googleCalendarUrl, buildIcs } from '../calendar.js';
import { notFound } from './notfound.js';
import * as store from '../store.js';

export const editUrl = (token) => `${location.origin}${location.pathname}#/edit/${token}`;

function whenText(sheet, slot) {
  const w = slotWhen(sheet, slot);
  if (!w.date) return '';
  const r = fmtRange(w.start, w.end);
  return `${fmtDateLong(w.date)}${r ? ` · ${r}` : ''}`;
}

// Calendar buttons + private-link box; reused by the confirmation screen and group claim flow.
export function calendarAndLink(sheet, slot, token) {
  const link = editUrl(token);
  const ev = eventFor(sheet, slot, link);
  return html`
    <div class="confirm-block">
      <h2 class="h3">${icon('calendar')} Add it to your calendar</h2>
      ${ev ? html`<div class="btn-row">
        <a class="btn btn-ghost" href="${googleCalendarUrl(ev)}" target="_blank" rel="noopener noreferrer">Google Calendar<span class="sr-only"> (opens in new tab)</span></a>
        <button type="button" class="btn btn-ghost" data-ics="${token}">${icon('download')} Download .ics</button>
      </div>
      <p class="muted small">The .ics file works with Apple Calendar, Outlook and most others.</p>`
      : html`<p class="muted small">This slot doesn't have a date yet, so there's nothing to add. The organizer will fill you in.</p>`}
    </div>
    <div class="confirm-block">
      <h2 class="h3">${icon('link')} Your private edit link</h2>
      <p class="small">We'd normally email this to you. It's how you change or cancel later, no login needed. Keep it to yourself.</p>
      <div class="input-row">
        <label class="sr-only" for="edit-link-${token}">Private edit link</label>
        <input id="edit-link-${token}" type="text" readonly value="${link}">
        <button type="button" class="btn btn-primary" data-copylink="${link}">${icon('copy')} Copy</button>
      </div>
      <p><a href="#/edit/${token}">Open my edit page</a></p>
    </div>`;
}

export function wireCalendarAndLink(root, sheet, slot, token) {
  root.addEventListener('click', async (e) => {
    const ics = e.target.closest('[data-ics]');
    if (ics && ics.dataset.ics === token) {
      const ev = eventFor(sheet, slot, editUrl(token));
      if (ev) { download(`${slugify(sheet.title)}-${slugify(slot.label)}.ics`, buildIcs(ev, token), 'text/calendar'); toast('Calendar file downloaded.'); }
    }
    const c = e.target.closest('[data-copylink]');
    if (c) toast((await copyText(c.dataset.copylink)) ? 'Edit link copied. Stash it somewhere safe!' : 'Copy failed. Select the link and copy it manually.');
  });
}

export async function doneView(root, { token }) {
  const data = await store.getSignup(token);
  if (!data) return notFound(root, 'That signup was cancelled or the link is incomplete.');
  const { sheet, signup, position } = data;
  const slot = sheet.slots.find((s) => s.id === signup.slotId);
  const waitlisted = signup.status === 'waitlist';
  const st = slotStats(sheet, slot);
  document.title = `${waitlisted ? "You're on the waitlist" : "You're in"} · SignMeUpDaddy`;

  root.innerHTML = html`<div class="container narrow">
    <section class="card confirm">
      <div class="confirm-hero ${waitlisted ? 'is-wait' : ''}">
        <div class="confirm-check" aria-hidden="true">${waitlisted ? '⏳' : icon('check')}</div>
        <h1 tabindex="-1">${waitlisted ? `You're #${position} on the waitlist, ${firstName(signup.name)}.` : `You're in, ${firstName(signup.name)}!`}</h1>
        <p class="lede">${waitlisted
          ? "If a spot opens up, you'll move up automatically. We'll let you know."
          : slot.type === 'item' ? "Don't forget the serving spoon." : 'Thanks for pitching in. You make this whole thing work.'}</p>
      </div>
      <dl class="review">
        <div><dt>Sheet</dt><dd><a href="#/s/${sheet.id}">${sheet.emoji} ${sheet.title}</a></dd></div>
        <div><dt>${slot.type === 'item' ? 'Bringing' : 'Slot'}</dt><dd>${slot.label}${signup.note ? html` <span class="muted">· ${signup.note}</span>` : ''}</dd></div>
        ${whenText(sheet, slot) ? html`<div><dt>When</dt><dd>${whenText(sheet, slot)}</dd></div>` : ''}
        ${sheet.location ? html`<div><dt>Where</dt><dd>${sheet.location}</dd></div>` : ''}
        <div><dt>Slot status</dt><dd>${Math.min(st.filled, st.capacity)} of ${st.capacity} filled</dd></div>
      </dl>
      ${calendarAndLink(sheet, slot, token)}
      <div class="btn-row confirm-actions">
        <a class="btn btn-ghost" href="#/s/${sheet.id}">${icon('arrowL')} Back to the sheet</a>
        <button type="button" class="btn btn-mustard" data-share>${icon('share')} Invite others</button>
        ${sheet.groupId ? html`<a class="btn btn-ghost" href="#/g/${sheet.groupId}">Back to the group</a>` : ''}
      </div>
      <p class="joke">${randomJoke()}</p>
    </section>
  </div>`.s;

  wireCalendarAndLink(root, sheet, slot, token);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-share]')) openShareDialog(sheet); });
}

export async function editView(root, { token }) {
  const data = await store.getSignup(token);
  if (!data) {
    document.title = 'Link expired · SignMeUpDaddy';
    root.innerHTML = html`<div class="container narrow center-page">
      <p class="big-emoji" aria-hidden="true">🌭</p>
      <h1 tabindex="-1">This link has gone cold.</h1>
      <p class="lede">Like a hot dog left on the grill too long. The signup was cancelled or removed.</p>
      <a class="btn btn-primary" href="#/">Back home</a></div>`.s;
    return;
  }
  const { sheet, signup, position } = data;
  const slot = sheet.slots.find((s) => s.id === signup.slotId);
  document.title = `Edit your signup · ${sheet.title}`;

  const slotOptions = sheet.slots.map((s) => {
    const st = slotStats(sheet, s);
    const mineHere = s.id === signup.slotId;
    const w = s.type === 'time' ? ` · ${whenText(sheet, s)}` : '';
    let tag = '';
    if (!mineHere && st.full) tag = sheet.waitlist ? ' (full, join waitlist)' : ' (full)';
    const disabled = !mineHere && st.full && !sheet.waitlist;
    return html`<option value="${s.id}" ${mineHere ? raw('selected') : ''} ${disabled ? raw('disabled') : ''}>${s.label}${w}${tag}</option>`;
  });

  root.innerHTML = html`<div class="container narrow">
    <section class="card edit-card">
      <p class="eyebrow">Your signup</p>
      <h1 tabindex="-1">${sheet.emoji} ${sheet.title}</h1>
      <p class="callout ${signup.status === 'waitlist' ? 'callout-mustard' : 'callout-green'}">
        ${signup.status === 'waitlist'
          ? html`You're <strong>#${position} on the waitlist</strong> for <strong>${slot.label}</strong>.`
          : html`You're <strong>confirmed</strong> for <strong>${slot.label}</strong>${whenText(sheet, slot) ? ` · ${whenText(sheet, slot)}` : ''}.`}
      </p>
      <form class="edit-form" novalidate>
        <div class="form-error" role="alert" hidden></div>
        <div class="field-row">
          <div class="field"><label for="ed-name">Your name</label><input id="ed-name" name="name" type="text" autocomplete="name" maxlength="80" required value="${signup.name}"></div>
          <div class="field"><label for="ed-contact">Email or phone</label><input id="ed-contact" name="contact" type="text" autocomplete="email" maxlength="120" required value="${signup.contact}"></div>
        </div>
        <div class="field"><label for="ed-slot">Slot</label><select id="ed-slot" name="slotId">${slotOptions}</select>
          <p class="hint">Switching gives up your current spot${sheet.waitlist ? '; the next person on the waitlist moves in' : ''}.</p></div>
        <div class="field"><label for="ed-note">Note <span class="muted">(optional)</span></label><input id="ed-note" name="note" type="text" maxlength="200" value="${signup.note}"></div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">${icon('check')} Save changes</button>
          <a class="btn btn-ghost" href="#/s/${sheet.id}">View sheet</a>
        </div>
      </form>
      <div class="danger-zone">
        <h2 class="h3">Can't make it anymore?</h2>
        <p class="small">No guilt. Life happens. ${sheet.waitlist ? "If someone's on the waitlist, they'll get your spot automatically." : 'Your spot opens back up for someone else.'}</p>
        <button type="button" class="btn btn-danger-ghost" data-cancel>${icon('trash')} Cancel my signup</button>
      </div>
    </section>
  </div>`.s;

  const form = root.querySelector('form');
  const err = root.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    err.hidden = true;
    try {
      const res = await store.updateSignup(token, { name: fd.get('name'), contact: fd.get('contact'), note: fd.get('note'), slotId: fd.get('slotId') });
      store.setMe({ name: fd.get('name'), contact: fd.get('contact') });
      toast(res.signup.status === 'waitlist' ? `Saved. You're #${res.position} on that waitlist.` : 'Saved! All set.');
      editView(root, { token }).then(() => root.querySelector('h1')?.focus());
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  root.querySelector('[data-cancel]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Cancel your signup?', message: `You'll be removed from "${slot.label}". This can't be undone, but you can always sign up again.`, confirmLabel: 'Yes, cancel it', danger: true });
    if (!ok) return;
    try {
      const { promoted } = await store.cancelSignup(token);
      document.title = 'Signup cancelled · SignMeUpDaddy';
      root.innerHTML = html`<div class="container narrow center-page">
        <p class="big-emoji" aria-hidden="true">👋</p>
        <h1 tabindex="-1">You're off the hook.</h1>
        <p class="lede">Your signup for ${slot.label} is cancelled.${promoted ? ` ${promoted} moved up from the waitlist, so it's covered.` : ''}</p>
        <div class="btn-row center-row"><a class="btn btn-primary" href="#/s/${sheet.id}">Back to the sheet</a></div>
      </div>`.s;
      root.querySelector('h1').focus();
    } catch (ex) {
      toast(ex.message);
    }
  });
}
