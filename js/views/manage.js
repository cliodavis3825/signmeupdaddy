// Organizer dashboard: #/s/<id>/manage
import { html, fmtDate, fmtDateLong, fmtRange, timeAgo, download, slugify, toast, isEmail } from '../util.js';
import { slotStats, sheetTotals, groupSlots, confirmedFor, waitlistFor, slotWhen } from '../model.js';
import { icon, progressBar, openShareDialog, confirmDialog, flash } from '../components.js';
import { notFound } from './notfound.js';
import * as store from '../store.js';

// CSV cell: quote, and neutralize spreadsheet formula injection.
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

function contactLink(c) {
  if (!c) return '';
  if (isEmail(c)) return html`<a href="mailto:${encodeURIComponent(c)}">${c}</a>`;
  return html`<a href="tel:${c.replace(/[^\d+]/g, '')}">${c}</a>`;
}

export async function manageView(root, { id }) {
  const token = await store.getAdminToken(id);
  const pub = await store.getSheet(id);
  if (!pub) return notFound(root);
  if (!token) {
    document.title = 'Organizers only · SignMeUpDaddy';
    root.innerHTML = html`<div class="container narrow center-page">
      <p class="big-emoji" aria-hidden="true">🔒</p>
      <h1 tabindex="-1">This dashboard is for the organizer.</h1>
      <p class="lede">The dashboard for "${pub.title}" lives in the browser that created it. (A real account system would send the organizer a magic link.)</p>
      <a class="btn btn-primary" href="#/s/${id}">View the sheet</a></div>`.s;
    return;
  }

  let onlyOpen = false;

  const render = async () => {
    const sheet = await store.getSheetAdmin(id, token);
    const t = sheetTotals(sheet);
    const groups = groupSlots(sheet);
    document.title = `Manage: ${sheet.title} · SignMeUpDaddy`;
    root.innerHTML = html`<div class="container manage">
      <div class="manage-head">
        <div>
          <p class="eyebrow">Organizer dashboard</p>
          <h1 tabindex="-1">${sheet.emoji} ${sheet.title}</h1>
          <p class="muted">${sheet.date ? `${fmtDateLong(sheet.date)} · ` : ''}Created ${timeAgo(sheet.createdAt)}${sheet.groupId ? html` · <a href="#/g/${sheet.groupId}">Group sheet</a>` : ''}</p>
        </div>
        <div class="btn-row">
          <a class="btn btn-ghost" href="#/s/${sheet.id}">View sheet</a>
          <button type="button" class="btn btn-primary" data-share>${icon('share')} Share</button>
          <button type="button" class="btn btn-ghost" data-csv>${icon('download')} Export CSV</button>
        </div>
      </div>

      <ul class="stats" aria-live="polite">
        <li class="stat card"><span class="stat-num">${t.filled}<span class="stat-of">/${t.capacity}</span></span><span class="stat-label">Spots filled</span>${progressBar(t.filled, t.capacity, `${t.filled} of ${t.capacity} spots filled`)}</li>
        <li class="stat card"><span class="stat-num">${t.people}</span><span class="stat-label">People signed up</span></li>
        <li class="stat card"><span class="stat-num">${t.open}</span><span class="stat-label">Open spots</span></li>
        <li class="stat card"><span class="stat-num">${t.waiting}</span><span class="stat-label">On waitlists</span></li>
      </ul>

      <div class="manage-toolbar">
        <h2 class="section-title-sm">Who's doing what</h2>
        <label class="check"><input type="checkbox" data-onlyopen ${onlyOpen ? 'checked' : ''}> Only show slots with open spots</label>
      </div>

      ${groups.map((g) => {
        const slots = g.slots.filter((s) => !onlyOpen || !slotStats(sheet, s).full);
        if (!slots.length) return '';
        return html`<section class="manage-group">
          <h3 class="group-title">${g.kind === 'items' ? 'What to bring' : g.date ? fmtDateLong(g.date) : 'Date TBD'}</h3>
          ${slots.map((slot) => {
            const st = slotStats(sheet, slot);
            const conf = confirmedFor(sheet, slot.id);
            const wait = waitlistFor(sheet, slot.id);
            const w = slotWhen(sheet, slot);
            return html`<article class="card manage-slot">
              <header class="manage-slot-head">
                <div><h4>${slot.label}${slot.type === 'time' && fmtRange(w.start, w.end) ? html` <span class="muted small">${fmtRange(w.start, w.end)}</span>` : ''}</h4>
                <p class="small"><strong>${Math.min(st.filled, st.capacity)} of ${st.capacity}</strong> filled${st.open ? html` · <span class="text-primary">${st.open} open</span>` : html` · <span class="text-green">full</span>`}${st.waiting ? ` · ${st.waiting} waiting` : ''}</p></div>
                <div class="manage-bar">${progressBar(st.filled, st.capacity, `${slot.label}: ${st.filled} of ${st.capacity} filled`)}</div>
              </header>
              ${conf.length ? html`<ul class="people">${conf.map((p) => html`<li>
                <div class="person"><strong>${p.name}</strong> <span class="muted small">${contactLink(p.contact)}</span>
                ${p.note ? html`<span class="person-note">${p.note}</span>` : ''}
                <span class="muted tiny">Signed up ${timeAgo(p.createdAt)}${p.promotedAt ? ' · moved up from waitlist' : ''}</span></div>
                <button type="button" class="btn btn-sm btn-danger-ghost" data-remove="${p.id}" data-name="${p.name}" aria-label="Remove ${p.name} from ${slot.label}">${icon('trash')} Remove</button>
              </li>`)}</ul>` : html`<p class="muted small empty-slot">Nobody yet.</p>`}
              ${wait.length ? html`<div class="waitlist"><p class="small"><strong>Waitlist</strong></p><ol class="people">${wait.map((p, i) => html`<li>
                <div class="person"><span class="pill pill-mustard">#${i + 1}</span> <strong>${p.name}</strong> <span class="muted small">${contactLink(p.contact)}</span>${p.note ? html`<span class="person-note">${p.note}</span>` : ''}</div>
                <button type="button" class="btn btn-sm btn-danger-ghost" data-remove="${p.id}" data-name="${p.name}" aria-label="Remove ${p.name} from the ${slot.label} waitlist">${icon('trash')} Remove</button>
              </li>`)}</ol></div>` : ''}
            </article>`;
          })}
        </section>`;
      })}

      <div class="danger-zone">
        <h2 class="h3">Delete this sheet</h2>
        <p class="small">Removes the sheet and all signups. People's edit links will stop working.</p>
        <button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash')} Delete sheet</button>
      </div>
    </div>`.s;
    return sheet;
  };

  let sheet = await render();
  if (flash.justPublished === id) {
    flash.justPublished = null;
    openShareDialog(await store.getSheet(id), { justPublished: true });
  }

  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-onlyopen]')) { onlyOpen = e.target.checked; sheet = await render(); root.querySelector('[data-onlyopen]')?.focus(); }
  });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-share]')) return openShareDialog(await store.getSheet(id));
    if (e.target.closest('[data-csv]')) {
      const s = await store.getSheetAdmin(id, token);
      const rows = [['Slot', 'Type', 'Date', 'Start', 'End', 'Status', 'Waitlist #', 'Name', 'Email or phone', 'Note', 'Signed up']];
      for (const slot of s.slots) {
        const w = slotWhen(s, slot);
        const people = [...confirmedFor(s, slot.id), ...waitlistFor(s, slot.id)];
        const wl = waitlistFor(s, slot.id);
        if (!people.length) rows.push([slot.label, slot.type, w.date, w.start, w.end, 'open', '', '', '', '', '']);
        for (const p of people) {
          rows.push([slot.label, slot.type, w.date, w.start, w.end, p.status, p.status === 'waitlist' ? wl.indexOf(p) + 1 : '', p.name, p.contact, p.note, new Date(p.createdAt).toISOString()]);
        }
      }
      download(`${slugify(s.title)}-signups.csv`, toCsv(rows), 'text/csv;charset=utf-8');
      return toast('CSV downloaded.');
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const ok = await confirmDialog({ title: `Remove ${rm.dataset.name}?`, message: 'They lose their spot. If anyone is on the waitlist, the first person moves up.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      try {
        const { promoted } = await store.removeSignup(id, rm.dataset.remove, token);
        toast(promoted ? `Removed. ${promoted} moved up from the waitlist.` : 'Removed.');
        sheet = await render();
        root.querySelector('h1')?.focus();
      } catch (ex) { toast(ex.message); }
      return;
    }
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({ title: 'Delete this sheet?', message: `"${sheet.title}" and all its signups will be gone for good.`, confirmLabel: 'Delete forever', danger: true });
      if (!ok) return;
      await store.deleteSheet(id, token);
      toast('Sheet deleted.');
      location.hash = '#/';
    }
  });

  // Keep the dashboard live when signups happen in other tabs.
  const unsub = store.subscribe(async () => {
    if (!document.querySelector('dialog[open]') && (await store.getSheet(id))) sheet = await render();
  });
  return { cleanup: unsub };
}
