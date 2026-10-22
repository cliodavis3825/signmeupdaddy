// Shared UI pieces: icons, sheet renderer (public + preview), dialogs, share panel.
import { html, raw, uid, fmtDate, fmtDateLong, fmtRange, shortName, copyText, toast } from './util.js';
import { slotStats, sheetTotals, groupSlots } from './model.js';
import { qrSvg } from './qr.js';

// Cross-route one-shot state (e.g. open the share panel right after publishing).
export const flash = { justPublished: null };

/* ---------- Icons (inline SVG, decorative) ---------- */
const PATHS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c1.3-3.8 4.2-5.5 7.5-5.5s6.2 1.7 7.5 5.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  msg: '<path d="M4 5.5h16v10H9l-5 4v-14z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  tap: '<path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v3.5c0 3.6-2.4 6.5-6 6.5h-.5c-2 0-3.4-.9-4.6-2.5L4.5 15a1.6 1.6 0 012.6-1.8L9 15"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
export const icon = (name, cls = '') =>
  raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`);

export const logoMark = () => raw(`<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <rect x="2" y="2" width="36" height="36" rx="11" fill="var(--primary)"/>
  <path d="M12 17.5l5 5 11-11" fill="none" stroke="var(--on-primary)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 27.2c-1.6-1.9-4.6-2.5-6.6-1.2-1.1.7-1.7 2.2-1 3.1.4-1.3 1.8-1.4 2.8-.8 1.4.8 3 .9 4.8-.4 1.8 1.3 3.4 1.2 4.8.4 1-.6 2.4-.5 2.8.8.7-.9.1-2.4-1-3.1-2-1.3-5-.7-6.6 1.2z" fill="var(--mustard)"/>
</svg>`);

export const noAdsBadge = (extra = '') =>
  html`<span class="badge badge-noads ${extra}">${icon('shield')} No ads, ever</span>`;

export function progressBar(filled, capacity, label) {
  const pct = capacity ? Math.min(100, Math.round((filled / capacity) * 100)) : 0;
  const full = filled >= capacity;
  return html`<div class="bar ${full ? 'is-full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${capacity}" aria-valuenow="${Math.min(filled, capacity)}" aria-label="${label}"><span style="width:${pct}%"></span></div>`;
}

/* ---------- Sheet renderer ---------- */

export function sheetUrl(id) {
  return `${location.origin}${location.pathname}#/s/${encodeURIComponent(id)}`;
}

function whenLine(date, start, end) {
  if (!date) return '';
  const r = fmtRange(start, end);
  return `${fmtDateLong(date)}${r ? ` · ${r}` : ''}`;
}

function slotCard(sheet, slot, { preview, myIds = new Set() }) {
  const st = slotStats(sheet, slot);
  const confirmed = sheet.signups.filter((s) => s.slotId === slot.id && s.status === 'confirmed').sort((a, b) => a.createdAt - b.createdAt);
  const label = slot.label || (preview ? 'Untitled slot' : 'Slot');
  const time = slot.type === 'time' ? fmtRange(slot.start, slot.end) : '';
  let cta;
  if (!st.full) cta = html`<button type="button" class="btn btn-primary slot-cta" data-signup="${slot.id}" ${preview ? raw('disabled') : ''} aria-label="Sign up for ${label}${time ? `, ${time}` : ''}">Sign me up</button>`;
  else if (sheet.waitlist) cta = html`<button type="button" class="btn btn-mustard slot-cta" data-signup="${slot.id}" ${preview ? raw('disabled') : ''} aria-label="Join the waitlist for ${label}">Join waitlist</button>`;
  else cta = html`<button type="button" class="btn slot-cta" disabled>Full</button>`;

  return html`<li class="slot ${st.full ? 'is-full' : ''}" data-slot="${slot.id}">
    <div class="slot-main">
      <div class="slot-head">
        <h3 class="slot-title">${label}${slot.type === 'item' && st.capacity > 1 ? html` <span class="qty">×${st.capacity}</span>` : ''}</h3>
        ${time ? html`<span class="slot-time">${icon('clock')}${time}</span>` : ''}
      </div>
      ${slot.note ? html`<p class="slot-note">${slot.note}</p>` : ''}
      ${progressBar(st.filled, st.capacity, `${label}: ${Math.min(st.filled, st.capacity)} of ${st.capacity} filled`)}
      <p class="slot-count"><strong>${Math.min(st.filled, st.capacity)} of ${st.capacity}</strong> filled${st.full ? html` <span class="pill pill-green">${icon('check')}All set</span>` : ''}${st.waiting ? html` <span class="pill pill-mustard">${st.waiting} on waitlist</span>` : ''}</p>
      ${confirmed.length ? html`<ul class="claimed" aria-label="Signed up">
        ${confirmed.map((s) => html`<li class="${myIds.has(s.id) ? 'is-me' : ''}"><span class="who">${shortName(s.name)}${myIds.has(s.id) ? ' (you)' : ''}</span>${s.note ? html`<span class="what">${s.note}</span>` : ''}</li>`)}
      </ul>` : ''}
    </div>
    <div class="slot-action">${cta}</div>
  </li>`;
}

export function renderSheet(sheet, opts = {}) {
  const { preview = false } = opts;
  const totals = sheetTotals(sheet);
  const groups = groupSlots(sheet);
  const when = whenLine(sheet.date, sheet.start, sheet.end);
  return html`<article class="sheet ${preview ? 'is-preview' : ''}">
    <header class="sheet-hero">
      <div class="sheet-emoji" aria-hidden="true">${sheet.emoji || '📋'}</div>
      <div class="sheet-hero-text">
        ${preview ? html`<p class="sheet-title">${sheet.title || 'Your sheet title'}</p>` : html`<h1 class="sheet-title" tabindex="-1">${sheet.title}</h1>`}
        <ul class="sheet-meta">
          ${when ? html`<li>${icon('calendar')}${when}</li>` : ''}
          ${sheet.location ? html`<li>${icon('pin')}${sheet.location}</li>` : ''}
          ${sheet.organizer?.name ? html`<li>${icon('user')}Organized by ${sheet.organizer.name}</li>` : ''}
        </ul>
      </div>
    </header>
    ${sheet.description ? html`<p class="sheet-desc">${sheet.description}</p>` : ''}
    <div class="sheet-badges">
      ${noAdsBadge()}
      ${sheet.waitlist ? html`<span class="badge">${icon('list')} Free waitlist</span>` : ''}
      <span class="badge">${icon('tap')} One-tap signup</span>
    </div>
    <div class="overall">
      <div class="overall-row"><span class="overall-label"><strong>${totals.filled} of ${totals.capacity}</strong> spots filled</span><span class="overall-open">${totals.open ? `${totals.open} open` : 'All filled!'}</span></div>
      ${progressBar(totals.filled, totals.capacity, `Overall: ${totals.filled} of ${totals.capacity} spots filled`)}
    </div>
    ${groups.length ? groups.map((g) => html`<section class="slot-group" aria-label="${g.kind === 'items' ? 'What to bring' : g.date ? fmtDateLong(g.date) : 'Date to be decided'}">
      <h2 class="group-title">${g.kind === 'items' ? html`What to bring${g.date ? html` <span class="group-sub">${fmtDate(g.date)}</span>` : ''}` : g.date ? fmtDateLong(g.date) : 'Date TBD'}</h2>
      <ul class="slots">${g.slots.map((s) => slotCard(sheet, s, opts))}</ul>
    </section>`) : html`<p class="empty">No slots yet. Add some in step 2.</p>`}
    <p class="sheet-foot">${icon('shield')} This sheet will never show ads. Not now, not later, not ever.</p>
  </article>`;
}

/* ---------- Dialogs ---------- */

export function openDialog({ title, body, className = '', onMount, onClose }) {
  const opener = document.activeElement;
  const dlg = document.createElement('dialog');
  const tid = `dlg-${uid(5)}`;
  dlg.className = `dialog ${className}`;
  dlg.setAttribute('aria-labelledby', tid);
  dlg.innerHTML = html`<div class="dialog-inner">
    <div class="dialog-head"><h2 id="${tid}">${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="dialog-body">${body}</div>
  </div>`.s;
  document.body.appendChild(dlg);
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => {
    if ((e.target === dlg && downOnBackdrop) || e.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.(dlg.returnValue);
    if (opener && document.contains(opener)) opener.focus();
  });
  dlg.showModal();
  onMount?.(dlg);
  return dlg;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    openDialog({
      title,
      className: 'dialog-sm',
      body: html`<p>${message}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-close>Never mind</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok autofocus>${confirmLabel}</button>
        </div>`,
      onMount(dlg) {
        dlg.querySelector('[data-ok]').addEventListener('click', () => { ok = true; dlg.close(); });
      },
      onClose: () => resolve(ok),
    });
  });
}

/* ---------- Share panel ---------- */

export function groupText(sheet) {
  const t = sheetTotals(sheet);
  const when = sheet.date ? ` on ${fmtDate(sheet.date)}` : '';
  const spots = t.open ? ` ${t.open} of ${t.capacity} spots still open.` : '';
  return `Hi all! ${sheet.emoji || '📋'} Please sign up for "${sheet.title}"${when}.${spots} It takes one tap, no account, no ads:\n${sheetUrl(sheet.id)}`;
}

export function openShareDialog(sheet, { justPublished = false } = {}) {
  openShareLinkDialog({
    url: sheetUrl(sheet.id),
    text: groupText(sheet),
    label: sheet.title,
    title: justPublished ? 'Your sheet is live! Now spread the word' : 'Share this sheet',
    lede: justPublished ? 'Fresh off the grill. Send it to the group chat and watch the slots fill.' : '',
    linkLabel: 'Sheet link',
  });
}

// Generic share panel: copy link, QR code, editable group-text message.
export function openShareLinkDialog({ url, text, label, title, lede = '', linkLabel = 'Link' }) {
  const svg = qrSvg(url, `QR code linking to ${label}`);
  openDialog({
    title,
    className: 'dialog-share',
    body: html`
      ${lede ? html`<p class="lede-sm">${lede}</p>` : ''}
      <div class="field">
        <label for="share-link">${linkLabel}</label>
        <div class="input-row">
          <input id="share-link" type="text" readonly value="${url}">
          <button type="button" class="btn btn-primary" data-copy="link">${icon('copy')} Copy</button>
        </div>
      </div>
      <div class="share-grid">
        <div class="qr-box">
          ${svg ? raw(svg) : html`<p class="muted">QR code unavailable offline.</p>`}
          <p class="muted small">Print it for the classroom door, the fridge or the trailhead sign.</p>
        </div>
        <div class="field">
          <label for="share-text">Message for the group text</label>
          <textarea id="share-text" rows="6">${text}</textarea>
          <div class="btn-row">
            <button type="button" class="btn btn-mustard" data-copy="text">${icon('msg')} Copy message</button>
            <a class="btn btn-ghost" data-sms href="sms:?&body=${encodeURIComponent(text)}">Open in Messages</a>
            ${navigator.share ? html`<button type="button" class="btn btn-ghost" data-native>${icon('share')} More…</button>` : ''}
          </div>
        </div>
      </div>`,
    onMount(dlg) {
      const ta = dlg.querySelector('#share-text');
      ta.addEventListener('input', () => {
        dlg.querySelector('[data-sms]').href = `sms:?&body=${encodeURIComponent(ta.value)}`;
      });
      dlg.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-copy]');
        if (c) {
          const ok = await copyText(c.dataset.copy === 'link' ? url : ta.value);
          toast(ok ? (c.dataset.copy === 'link' ? 'Link copied!' : 'Message copied. Paste it in the group chat!') : 'Copy failed. Select and copy manually.');
        }
        if (e.target.closest('[data-native]')) {
          try { await navigator.share({ title: label, text: ta.value }); } catch { /* cancelled */ }
        }
      });
    },
  });
}
