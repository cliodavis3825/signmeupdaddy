// One-tap signup dialog, shared by sheet pages and group event pages.
import { html, fmtDateLong, fmtRange, firstName } from '../util.js';
import { slotStats, slotWhen } from '../model.js';
import { openDialog, icon } from '../components.js';
import * as store from '../store.js';

export function openSignupDialog(sheet, slotId, { onDone } = {}) {
  const slot = sheet.slots.find((s) => s.id === slotId);
  if (!slot) return;
  const st = slotStats(sheet, slot);
  const waitlist = st.full;
  const me = store.getMe();
  const when = slotWhen(sheet, slot);
  const whenText = when.date ? `${fmtDateLong(when.date)}${fmtRange(when.start, when.end) ? ` · ${fmtRange(when.start, when.end)}` : ''}` : '';
  const known = !!(me.name && me.contact);

  openDialog({
    title: waitlist ? `Join the waitlist: ${slot.label}` : `Sign up: ${slot.label}`,
    className: 'dialog-signup',
    body: html`<form class="signup-form" novalidate>
      <div class="signup-summary">
        <p class="signup-sheet">${sheet.emoji} ${sheet.title}</p>
        ${whenText ? html`<p class="muted small">${icon('calendar')} ${whenText}</p>` : ''}
        <p class="small">${waitlist
          ? html`This one's full. Join the <strong>free waitlist</strong> (${st.waiting} ahead of you) and you'll move up automatically if someone cancels.`
          : html`<strong>${st.open} of ${st.capacity}</strong> spot${st.capacity === 1 ? '' : 's'} left.`}</p>
      </div>
      <div class="form-error" role="alert" hidden></div>
      ${known ? html`<p class="known-me">Signing up as <strong>${me.name}</strong> (${me.contact}). <button type="button" class="link-btn" data-notme>Not you?</button></p>` : ''}
      <div class="me-fields" ${known ? 'hidden' : ''}>
        <div class="field">
          <label for="su-name">Your name</label>
          <input id="su-name" name="name" type="text" autocomplete="name" maxlength="80" required value="${me.name}" ${known ? '' : 'autofocus'}>
        </div>
        <div class="field">
          <label for="su-contact">Email or phone</label>
          <input id="su-contact" name="contact" type="text" autocomplete="email" maxlength="120" required value="${me.contact}" aria-describedby="su-contact-hint">
          <p class="hint" id="su-contact-hint">We'll send your private edit link here. Never shown publicly, never spammed.</p>
        </div>
      </div>
      <div class="field">
        <label for="su-note">${slot.type === 'item' ? 'What are you bringing?' : 'Note'} <span class="muted">(optional)</span></label>
        <input id="su-note" name="note" type="text" maxlength="200" placeholder="${slot.type === 'item' ? 'e.g. Mac & cheese, big tray' : 'e.g. Can stay late'}" ${known ? 'autofocus' : ''}>
      </div>
      <button type="submit" class="btn ${waitlist ? 'btn-mustard' : 'btn-primary'} btn-lg btn-block">${waitlist ? 'Join the waitlist' : 'Sign me up'}</button>
      <p class="muted small center">No account. No ads. No spam. Just you and the potato salad.</p>
    </form>`,
    onMount(dlg) {
      const form = dlg.querySelector('form');
      const err = dlg.querySelector('.form-error');
      dlg.querySelector('[data-notme]')?.addEventListener('click', () => {
        dlg.querySelector('.known-me').remove();
        const f = dlg.querySelector('.me-fields');
        f.hidden = false;
        f.querySelector('#su-name').value = '';
        f.querySelector('#su-contact').value = '';
        f.querySelector('#su-name').focus();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const input = { name: fd.get('name'), contact: fd.get('contact'), note: fd.get('note') };
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        err.hidden = true;
        try {
          const res = await store.signUp(sheet.id, slot.id, input);
          store.setMe({ name: input.name, contact: input.contact });
          dlg.close();
          if (onDone) onDone(res, { name: firstName(input.name) });
          else location.hash = `#/done/${res.token}`;
        } catch (ex) {
          btn.disabled = false;
          err.textContent = ex.message || 'Something went wrong. Try again?';
          err.hidden = false;
          if (ex.code === 'invalid') {
            form.querySelector('.me-fields').hidden = false;
            form.querySelector('.known-me')?.remove();
          }
        }
      });
    },
  });
}
