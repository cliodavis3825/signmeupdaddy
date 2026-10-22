// Public sheet page: #/s/<id>
import { html, announce } from '../util.js';
import { slotStats } from '../model.js';
import { icon, renderSheet, openShareDialog } from '../components.js';
import { openSignupDialog } from './signup.js';
import { notFound } from './notfound.js';
import * as store from '../store.js';

export async function sheetView(root, { id }) {
  let sheet = await store.getSheet(id);
  if (!sheet) return notFound(root, "That sheet wandered off. Maybe it's at the hardware store.");
  document.title = `${sheet.title} · SignMeUpDaddy`;
  const isOwner = !!(await store.getAdminToken(id));
  const group = sheet.groupId ? await store.getGroup(sheet.groupId) : null;

  const counts = (s) => Object.fromEntries(s.slots.map((sl) => [sl.id, slotStats(s, sl).filled]));
  let prev = counts(sheet);

  const render = async () => {
    const mine = await store.getMySignups(id);
    const myIds = new Set(mine.map((m) => m.signupId));
    const mySlots = mine.map((m) => {
      const su = sheet.signups.find((s) => s.id === m.signupId);
      const slot = su && sheet.slots.find((s) => s.id === su.slotId);
      return su && slot ? { ...m, slot, status: su.status } : null;
    }).filter(Boolean);

    const focusedSlot = document.activeElement?.closest?.('[data-signup]')?.dataset.signup;
    root.innerHTML = html`<div class="container narrow sheet-page">
      <div class="page-tools">
        ${group && !group.locked ? html`<a class="crumb" href="#/g/${group.id}">${icon('arrowL')} ${group.emoji} ${group.name}</a>` : html`<span></span>`}
        <div class="btn-row">
          ${isOwner ? html`<a class="btn btn-ghost btn-sm" href="#/s/${sheet.id}/manage">${icon('chart')} Manage</a>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-share>${icon('share')} Share</button>
        </div>
      </div>
      ${mySlots.length ? html`<div class="callout callout-green" role="status">
        <p><strong>You're on this sheet.</strong></p>
        <ul>${mySlots.map((m) => html`<li>${m.slot.label}${m.status === 'waitlist' ? ' (waitlist)' : ''} · <a href="#/edit/${m.token}">Change or cancel</a></li>`)}</ul>
      </div>` : ''}
      ${renderSheet(sheet, { myIds })}
      ${isOwner && !sheet.groupId ? html`<aside class="callout callout-nudge">
        <div><p><strong>Doing this regularly? Turn it into a Group.</strong></p>
        <p class="small">Recurring meetups, RSVPs and this sheet in one link. Free for up to 50 members, no ads.</p></div>
        <a class="btn btn-mustard btn-sm" href="#/groups/new/from/${sheet.id}">Make it a Group ${icon('arrowR')}</a>
      </aside>` : ''}
    </div>`.s;
    if (focusedSlot) root.querySelector(`[data-signup="${focusedSlot}"]`)?.focus();
  };

  await render();

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-signup]');
    if (b && !b.disabled) return openSignupDialog(sheet, b.dataset.signup);
    if (e.target.closest('[data-share]')) openShareDialog(sheet);
  });

  // Live progress: re-render when the store changes (other tabs, or this one) and announce changes.
  const unsub = store.subscribe(async () => {
    const next = await store.getSheet(id);
    if (!next) return;
    sheet = next;
    const now = counts(sheet);
    const changed = sheet.slots.find((s) => now[s.id] !== prev[s.id]);
    prev = now;
    await render();
    if (changed) {
      const st = slotStats(sheet, changed);
      announce(`${changed.label}: now ${Math.min(st.filled, st.capacity)} of ${st.capacity} filled.`);
    }
  });
  return { cleanup: unsub };
}
