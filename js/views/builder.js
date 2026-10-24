// 3-step sheet builder: Basics -> Slots -> Review/Publish, with live preview.
// Also the organizer's editor for a published sheet (#/s/<id>/edit): same steps, "Save changes" at the end.
import { html, raw, isEmail, fmtDateLong, fmtRange, isoDate, addDays, parseDate, toast, parseCount } from '../util.js';
import { icon, renderSheet, confirmDialog, flash, leaveGuard } from '../components.js';
import { TEMPLATES, getTemplate, findTemplate, timeSlot, itemSlot } from '../templates.js';
import { sheetTotals, activeSlots, confirmedFor, waitlistFor, sheetEditImpact } from '../model.js';
import { notFound } from './notfound.js';
import * as store from '../store.js';

const DRAFT_KEY = 'smud:draft';
const EMOJIS = ['📋', '🥗', '🥧', '🍲', '🍊', '🌭', '🧁', '🎃', '🎄', '🎉', '🙋', '🚐', '⚽', '🏈', '🏀', '📚', '🎭', '⛪', '👶', '🛠️'];
const STEPS = ['Basics', 'Slots', 'Review & publish'];
const EDIT_STEPS = ['Basics', 'Slots', 'Review & save'];

let draft = null;     // the new-sheet draft (also kept in sessionStorage)
let errors = [];
let mode = 'new';     // 'new' | 'edit'
let editCtx = null;   // { id, token, original } while editing a published sheet
let pendingTpl = null; // template the organizer picked but hasn't confirmed (draft has edits)

const isEdit = () => mode === 'edit';
const stepNames = () => (isEdit() ? EDIT_STEPS : STEPS);

/* ---------- Draft persistence ---------- */

// Drafts from sessionStorage may be from an older version or hand-edited: rebuild them field by field,
// and throw them away if they're not even shaped like a draft.
function sanitizeDraft(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.slots)) return null;
  const s = (v) => (typeof v === 'string' ? v : '');
  const slots = d.slots.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id).map((x) => {
    const base = { id: x.id, type: x.type === 'time' ? 'time' : 'item', label: s(x.label), note: s(x.note),
      capacity: typeof x.capacity === 'number' ? String(x.capacity) : s(x.capacity) };
    if (base.type === 'time') Object.assign(base, { date: s(x.date), start: s(x.start), end: s(x.end) });
    return base;
  });
  return {
    step: [1, 2, 3].includes(d.step) ? d.step : 1,
    templateId: findTemplate(d.templateId) ? d.templateId : 'blank',
    emoji: s(d.emoji) || '📋',
    waitlist: d.waitlist !== false,
    dirty: !!d.dirty,
    organizer: { name: s(d.organizer?.name), email: s(d.organizer?.email) },
    title: s(d.title), description: s(d.description), location: s(d.location),
    date: s(d.date), start: s(d.start), end: s(d.end),
    slots,
  };
}
function loadDraft() {
  try { const r = sessionStorage.getItem(DRAFT_KEY); return r ? sanitizeDraft(JSON.parse(r)) : null; } catch { return null; }
}
function saveDraft() {
  if (isEdit()) return; // edits of a published sheet live in memory until saved
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  draft = null;
}

function fromTemplate(id, keep = null) {
  const t = getTemplate(id);
  const me = store.getMe();
  return {
    step: 1,
    templateId: t.id,
    emoji: t.emoji,
    waitlist: true,
    dirty: false,
    organizer: {
      name: keep?.organizer?.name ?? me.name ?? '',
      email: keep?.organizer?.email ?? (isEmail(me.contact || '') ? me.contact : ''),
    },
    ...t.build(),
  };
}

function editDraftFrom(sheet) {
  return {
    step: 1,
    templateId: sheet.templateId || 'blank',
    emoji: sheet.emoji || '📋',
    waitlist: sheet.waitlist !== false,
    dirty: false,
    organizer: { name: sheet.organizer?.name || '', email: sheet.organizer?.email || '' },
    title: sheet.title || '', description: sheet.description || '', location: sheet.location || '',
    date: sheet.date || '', start: sheet.start || '', end: sheet.end || '',
    slots: activeSlots(sheet).map((s) => ({ ...s, capacity: String(s.capacity) })),
  };
}

// People already on a slot of the sheet being edited (confirmed + waitlist).
function signupCount(slotId) {
  if (!editCtx) return 0;
  return confirmedFor(editCtx.original, slotId).length + waitlistFor(editCtx.original, slotId).length;
}

/* ---------- Validation ---------- */

function validate(step) {
  const errs = [];
  const today = store.todayIso();
  const orig = editCtx?.original;
  if (step === 1) {
    if (!draft.title.trim()) errs.push({ id: 'f-title', msg: 'Give your sheet a title.' });
    if (!draft.organizer.name.trim()) errs.push({ id: 'f-org', msg: 'Add an organizer name (yours, or your group\'s).' });
    if (draft.organizer.email && !isEmail(draft.organizer.email.trim())) errs.push({ id: 'f-orgemail', msg: 'That organizer email doesn\'t look right.' });
    if (draft.date && draft.date < today && !(orig && orig.date === draft.date)) errs.push({ id: 'f-date', msg: 'That event date has already passed. Pick an upcoming date, or leave it blank.' });
    if (draft.start && draft.end && draft.end <= draft.start) errs.push({ id: 'f-end', msg: 'Event end time should be after the start time.' });
  }
  if (step === 2) {
    if (!draft.slots.length) errs.push({ id: 'add-item', msg: 'Add at least one slot.' });
    draft.slots.forEach((s, i) => {
      const n = `Slot ${i + 1}`;
      if (!s.label.trim()) errs.push({ id: `s-${s.id}-label`, msg: `${n}: give it a name.` });
      const cap = s.capBad ? NaN : parseCount(s.capacity);
      if (!(cap >= 1 && cap <= 999)) errs.push({ id: `s-${s.id}-cap`, msg: `${n}: spots must be a whole number from 1 to 999.` });
      if (s.type === 'time' && !s.date) errs.push({ id: `s-${s.id}-date`, msg: `${n}: pick a date.` });
      const was = orig?.slots.find((x) => x.id === s.id);
      if (s.type === 'time' && s.date && s.date < today && !(was && was.date === s.date)) errs.push({ id: `s-${s.id}-date`, msg: `${n}: that date has already passed.` });
      if (s.type === 'time' && s.start && s.end && s.end <= s.start) errs.push({ id: `s-${s.id}-end`, msg: `${n}: end time should be after start.` });
    });
  }
  return errs;
}

/* ---------- Rendering ---------- */

const invalid = (id) => (errors.some((e) => e.id === id) ? raw('aria-invalid="true"') : '');

function stepper() {
  return html`<ol class="stepper">
    ${stepNames().map((name, i) => {
      const n = i + 1;
      const state = n === draft.step ? 'current' : n < draft.step ? 'done' : 'todo';
      const canJump = n < draft.step || (isEdit() && n !== draft.step);
      return html`<li class="step is-${state}">
        ${canJump
          ? html`<button type="button" class="step-btn" data-goto="${n}"><span class="step-num">${n < draft.step ? icon('check') : n}</span><span class="step-name">${name}</span></button>`
          : html`<span class="step-btn" ${n === draft.step ? raw('aria-current="step"') : ''}><span class="step-num">${n}</span><span class="step-name">${name}</span></span>`}
      </li>`;
    })}
  </ol>`;
}

function errorSummary() {
  if (!errors.length) return '';
  return html`<div class="form-errors" role="alert" tabindex="-1">
    <p><strong>Hold the tongs, a few things need fixing:</strong></p>
    <ul>${errors.map((e) => html`<li><button type="button" class="link-btn" data-focus="${e.id}">${e.msg}</button></li>`)}</ul>
  </div>`;
}

function tplPrompt() {
  const t = pendingTpl && findTemplate(pendingTpl);
  if (!t) return '';
  return html`<div class="callout callout-mustard tpl-prompt">
    <p><strong>Switch to the ${t.emoji} ${t.name} template?</strong> It replaces your title, description and slots. Your organizer info stays.</p>
    <div class="btn-row">
      <button type="button" class="btn btn-primary btn-sm" data-action="tpl-yes">Switch template</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="tpl-no">Keep my sheet</button>
    </div>
  </div>`;
}

function step1() {
  const emojis = EMOJIS.includes(draft.emoji) ? EMOJIS : [draft.emoji, ...EMOJIS];
  return html`
  ${isEdit() ? '' : html`<fieldset class="tpl-picker">
    <legend>Start from a template</legend>
    <div class="tpl-options">
      ${TEMPLATES.map((t) => html`<label class="tpl-option">
        <input type="radio" name="template" value="${t.id}" ${t.id === draft.templateId ? raw('checked') : ''}>
        <span class="tpl-option-card"><span class="tpl-emoji" aria-hidden="true">${t.emoji}</span><span class="tpl-name">${t.name}</span></span>
      </label>`)}
    </div>
  </fieldset>`}

  <div class="field-row title-row">
    <div class="field field-emoji">
      <label for="f-emoji">Icon</label>
      <select id="f-emoji" data-field="emoji">
        ${emojis.map((e) => html`<option value="${e}" ${e === draft.emoji ? raw('selected') : ''}>${e}</option>`)}
      </select>
    </div>
    <div class="field grow">
      <label for="f-title">Sheet title <span class="req" aria-hidden="true">*</span></label>
      <input id="f-title" type="text" data-field="title" value="${draft.title}" maxlength="120" required placeholder="e.g. Room 12 Fall Potluck" ${invalid('f-title')}>
    </div>
  </div>

  <div class="field-row">
    <div class="field">
      <label for="f-org">Organizer name <span class="req" aria-hidden="true">*</span></label>
      <input id="f-org" type="text" data-field="organizer.name" value="${draft.organizer.name}" maxlength="80" autocomplete="name" required placeholder="You, or your group" ${invalid('f-org')}>
    </div>
    <div class="field">
      <label for="f-orgemail">Organizer email <span class="muted">(optional)</span></label>
      <input id="f-orgemail" type="email" data-field="organizer.email" value="${draft.organizer.email}" maxlength="120" autocomplete="email" aria-describedby="f-orgemail-hint" ${invalid('f-orgemail')}>
      <p class="hint" id="f-orgemail-hint">Never shown on the sheet.</p>
    </div>
  </div>

  <div class="field">
    <label for="f-desc">Description <span class="muted">(optional)</span></label>
    <textarea id="f-desc" data-field="description" rows="3" maxlength="2000" placeholder="What's it for? Anything people should know?">${draft.description}</textarea>
  </div>

  <div class="field">
    <label for="f-loc">Location <span class="muted">(optional)</span></label>
    <input id="f-loc" type="text" data-field="location" value="${draft.location}" maxlength="200" placeholder="e.g. Maple Street Elementary, Cafeteria">
  </div>

  <fieldset class="field-group">
    <legend>Event date &amp; time <span class="muted">(optional; used for item slots and calendar invites)</span></legend>
    <div class="field-row three">
      <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" data-field="date" value="${draft.date}" ${invalid('f-date')}></div>
      <div class="field"><label for="f-start">Starts</label><input id="f-start" type="time" data-field="start" value="${draft.start}"></div>
      <div class="field"><label for="f-end">Ends</label><input id="f-end" type="time" data-field="end" value="${draft.end}" ${invalid('f-end')}></div>
    </div>
  </fieldset>

  <label class="switch">
    <input type="checkbox" data-field="waitlist" ${draft.waitlist ? raw('checked') : ''}>
    <span class="switch-ui" aria-hidden="true"></span>
    <span><strong>Free waitlist</strong> when a slot fills up. Folks move up automatically when someone cancels. <span class="muted">(Other sites charge for this.)</span></span>
  </label>`;
}

function slotEditor(s, i, total) {
  const isTime = s.type === 'time';
  const p = `s-${s.id}`;
  const taken = signupCount(s.id);
  return html`<li class="card slot-edit" data-id="${s.id}">
    <div class="slot-edit-head">
      <span class="pill ${isTime ? 'pill-blue' : 'pill-mustard'}">${isTime ? icon('clock') : icon('list')}${isTime ? 'Time slot' : 'Item'}</span>
      <span class="muted small">#${i + 1}</span>
      ${taken ? html`<span class="pill pill-green">${taken} signed up</span>` : ''}
      <div class="slot-tools">
        <button type="button" class="icon-btn" data-action="up" data-sid="${s.id}" aria-label="Move slot ${i + 1} up" ${i === 0 ? raw('disabled') : ''}>${icon('up')}</button>
        <button type="button" class="icon-btn" data-action="down" data-sid="${s.id}" aria-label="Move slot ${i + 1} down" ${i === total - 1 ? raw('disabled') : ''}>${icon('down')}</button>
        <button type="button" class="icon-btn" data-action="dup" data-sid="${s.id}" aria-label="Duplicate slot ${i + 1}${isTime ? ' to the next day' : ''}" title="${isTime ? 'Duplicate to next day' : 'Duplicate'}">${icon('dup')}</button>
        <button type="button" class="icon-btn danger" data-action="del" data-sid="${s.id}" aria-label="Delete slot ${i + 1}">${icon('trash')}</button>
      </div>
    </div>
    <div class="field">
      <label for="${p}-label">${isTime ? 'Shift or job name' : 'Item or category'}</label>
      <input id="${p}-label" type="text" data-sid="${s.id}" data-sfield="label" value="${s.label}" maxlength="100" placeholder="${isTime ? 'e.g. Setup crew' : 'e.g. Desserts'}" ${invalid(`${p}-label`)}>
    </div>
    ${isTime ? html`<div class="field-row three">
      <div class="field"><label for="${p}-date">Date</label><input id="${p}-date" type="date" data-sid="${s.id}" data-sfield="date" value="${s.date}" ${invalid(`${p}-date`)}></div>
      <div class="field"><label for="${p}-start">Starts</label><input id="${p}-start" type="time" data-sid="${s.id}" data-sfield="start" value="${s.start}"></div>
      <div class="field"><label for="${p}-end">Ends</label><input id="${p}-end" type="time" data-sid="${s.id}" data-sfield="end" value="${s.end}" ${invalid(`${p}-end`)}></div>
    </div>` : ''}
    <div class="field-row cap-row">
      <div class="field field-cap">
        <label for="${p}-cap">${isTime ? 'People needed' : 'How many'}</label>
        <input id="${p}-cap" type="number" inputmode="numeric" min="1" max="999" step="1" data-sid="${s.id}" data-sfield="capacity" value="${s.capacity}" ${invalid(`${p}-cap`)}>
      </div>
      <div class="field grow">
        <label for="${p}-note">Note <span class="muted">(optional)</span></label>
        <input id="${p}-note" type="text" data-sid="${s.id}" data-sfield="note" value="${s.note}" maxlength="200" placeholder="${isTime ? 'e.g. Wear closed-toe shoes' : 'e.g. Feeds 8 or more'}">
      </div>
    </div>
  </li>`;
}

function step2() {
  return html`
  <div class="step-intro">
    <h2>${isEdit() ? 'Slots' : 'What do you need?'}</h2>
    <p class="muted">Mix and match: <strong>items</strong> for things to bring ("Desserts ×3") and <strong>time slots</strong> for shifts, dates and drivers. Each slot stops at the number you set${draft.waitlist ? ', then the free waitlist takes over' : ''}.</p>
    ${isEdit() ? html`<p class="small">People who already signed up never lose their signup. If you remove a slot that has people, it's hidden from the sheet and kept on your dashboard.</p>` : ''}
  </div>
  ${draft.slots.length ? html`<ol class="slot-editor">${draft.slots.map((s, i) => slotEditor(s, i, draft.slots.length))}</ol>` : html`<p class="empty">No slots yet. Add one below.</p>`}
  <div class="btn-row add-row">
    <button type="button" class="btn btn-ghost" id="add-item" data-action="add-item">${icon('plus')} Add item</button>
    <button type="button" class="btn btn-ghost" data-action="add-time">${icon('plus')} Add time slot</button>
  </div>`;
}

// Plain-language warnings for edits that affect people already signed up.
function impactDetails(impact) {
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  return [
    ...impact.removed.map((x) => `"${x.label}" has ${people(x.count)} on it. It will be hidden from the sheet, but their signups are kept on your dashboard, where you can restore the slot.`),
    ...impact.shrunk.map((x) => `"${x.label}": ${people(x.count)} ${x.count === 1 ? 'is' : 'are'} confirmed but you set ${x.capacity} spot${x.capacity === 1 ? '' : 's'}. Everyone keeps their spot; the slot just shows as full.`),
    ...impact.moved.map((x) => `"${x.label}": the date or time changed and ${people(x.count)} signed up. Let them know (the real app would email them).`),
    ...(impact.queued ? [`You're turning the waitlist off, but ${people(impact.queued)} ${impact.queued === 1 ? 'is' : 'are'} still on a waitlist. They stay in line (we never delete signups) and move up if a spot opens; nobody new can join a full slot.`] : []),
  ];
}
const draftSlotsForImpact = () => draft.slots.map((s) => ({ ...s, capacity: parseCount(s.capacity) }));
const draftImpact = () => sheetEditImpact(editCtx.original, draftSlotsForImpact(), { waitlist: draft.waitlist });

function step3() {
  const sheet = previewSheet();
  const t = sheetTotals(sheet);
  const when = draft.date ? `${fmtDateLong(draft.date)}${fmtRange(draft.start, draft.end) ? ` · ${fmtRange(draft.start, draft.end)}` : ''}` : 'No single event date (slots have their own)';
  const details = isEdit() ? impactDetails(draftImpact()) : [];
  return html`
  <div class="step-intro">
    <h2>${isEdit() ? 'Review your changes' : 'Looking good. Ready to fire it up?'}</h2>
    <p class="muted">${isEdit() ? 'Same link, same signups. Your changes show up for everyone as soon as you save.' : 'Double-check the details. You can preview exactly what people will see.'}</p>
  </div>
  ${details.length ? html`<div class="callout callout-mustard"><p><strong>Heads up: this affects people who already signed up.</strong></p><ul>${details.map((d) => html`<li>${d}</li>`)}</ul></div>` : ''}
  <dl class="review card">
    <div><dt>Title</dt><dd>${draft.emoji} ${draft.title}</dd></div>
    <div><dt>Organizer</dt><dd>${draft.organizer.name}${draft.organizer.email ? html` <span class="muted">(${draft.organizer.email})</span>` : ''}</dd></div>
    <div><dt>When</dt><dd>${when}</dd></div>
    ${draft.location ? html`<div><dt>Where</dt><dd>${draft.location}</dd></div>` : ''}
    <div><dt>Slots</dt><dd>${draft.slots.length} slot${draft.slots.length === 1 ? '' : 's'}, ${t.capacity} total spot${t.capacity === 1 ? '' : 's'}</dd></div>
    <div><dt>Waitlist</dt><dd>${draft.waitlist ? 'On (free, obviously)' : 'Off'}</dd></div>
  </dl>
  ${isEdit() ? '' : html`<ul class="checklist">
    <li>${icon('check')} No ads on your sheet. Ever.</li>
    <li>${icon('check')} People sign up with just a name and email or phone.</li>
    <li>${icon('check')} You'll get a share link, QR code and a ready-to-send group text.</li>
  </ul>`}`;
}

function navButtons() {
  const names = stepNames();
  return html`<div class="builder-nav">
    ${draft.step > 1 ? html`<button type="button" class="btn btn-ghost" data-action="back">${icon('arrowL')} Back</button>` : html`<span></span>`}
    ${draft.step < 3
      ? html`<button type="submit" class="btn btn-primary">Next: ${names[draft.step]} ${icon('arrowR')}</button>`
      : html`<button type="submit" class="btn btn-primary btn-lg">${isEdit() ? html`${icon('check')} Save changes` : html`Publish sheet ${icon('arrowR')}`}</button>`}
  </div>`;
}

function previewSheet() {
  const ids = new Set(draft.slots.map((s) => s.id));
  const signups = isEdit() ? editCtx.original.signups.filter((x) => ids.has(x.slotId)) : [];
  return { ...draft, id: 'preview', signups, slots: draft.slots.map((s) => ({ ...s, capacity: Math.max(1, parseCount(s.capacity) || 1) })) };
}

/* ---------- View ---------- */

export async function builderView(root, params) {
  let notice = '';
  pendingTpl = null;
  if (params.editId) {
    const id = params.editId;
    const pub = await store.getSheet(id);
    if (!pub || pub.locked) return notFound(root);
    const token = await store.getAdminToken(id);
    if (!token) {
      document.title = 'Organizers only · SignMeUpDaddy';
      root.innerHTML = html`<div class="container narrow center-page">
        <p class="big-emoji" aria-hidden="true">🔒</p>
        <h1 tabindex="-1">Only the organizer can edit this sheet.</h1>
        <p class="lede">Editing "${pub.title}" works from the browser that created it. (A real account system would send the organizer a magic link.)</p>
        <a class="btn btn-primary" href="#/s/${id}">View the sheet</a></div>`.s;
      return;
    }
    const original = await store.getSheetAdmin(id, token);
    mode = 'edit';
    editCtx = { id, token, original };
    draft = editDraftFrom(original);
    document.title = `Edit: ${original.title} · SignMeUpDaddy`;
    leaveGuard.path = `/s/${id}/edit`;
    leaveGuard.active = () => isEdit() && !!draft?.dirty;
    leaveGuard.message = "Your changes to this sheet haven't been saved. Leave anyway?";
  } else {
    if (mode === 'edit') draft = null; // don't carry an edit session into a new sheet
    mode = 'new';
    editCtx = null;
    document.title = 'Build a sheet · SignMeUpDaddy';
    const existing = draft || loadDraft();
    if (params.template) {
      history.replaceState(null, '', '#/new');
      const tpl = findTemplate(params.template);
      if (!tpl) {
        draft = existing || fromTemplate('potluck');
        notice = existing ? "We don't have that template, so here's the draft you were working on." : "We don't have that template, so we started you with a Potluck.";
      } else if (existing?.dirty && existing.templateId !== tpl.id) {
        draft = existing; // don't silently throw away their work: ask first
        pendingTpl = tpl.id;
      } else if (existing?.dirty) {
        draft = existing;
      } else {
        draft = fromTemplate(tpl.id, existing);
      }
    } else {
      draft = existing || fromTemplate('potluck');
    }
  }
  errors = [];
  saveDraft();

  root.innerHTML = html`<div class="container builder">
    <div class="builder-head">
      <h1 tabindex="-1">${isEdit() ? 'Edit your sheet' : 'Build your sheet'}</h1>
      ${isEdit()
        ? html`<a class="btn btn-ghost btn-sm" href="#/s/${editCtx.id}/manage">Cancel</a>`
        : html`<button type="button" class="btn btn-ghost btn-sm" data-action="reset">Start over</button>`}
    </div>
    <div id="b-stepper"></div>
    <div class="builder-grid">
      <form id="b-form" class="builder-main card" novalidate></form>
      <aside class="builder-preview" aria-label="Live preview">
        <details id="b-details" ${matchMedia('(min-width: 960px)').matches ? raw('open') : ''}>
          <summary>Live preview <span class="muted small">(what people will see)</span></summary>
          <div class="preview-frame" id="b-preview" inert></div>
        </details>
      </aside>
    </div>
  </div>`.s;

  const form = root.querySelector('#b-form');
  const stepEl = root.querySelector('#b-stepper');
  const previewEl = root.querySelector('#b-preview');

  let raf = 0;
  const updatePreview = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!draft || !previewEl.isConnected) return; // draft cleared after publish / navigated away
      previewEl.innerHTML = renderSheet(previewSheet(), { preview: true }).s;
    });
  };

  const updatePrompt = () => {
    const box = form.querySelector('#b-tplprompt');
    if (box) box.innerHTML = tplPrompt().s ?? '';
  };

  const renderStep = (focusId) => {
    stepEl.innerHTML = stepper().s;
    const body = draft.step === 1 ? step1() : draft.step === 2 ? step2() : step3();
    form.innerHTML = html`<div id="b-tplprompt" aria-live="polite"></div>${errorSummary()}${body}${navButtons()}`.s;
    form.setAttribute('aria-label', `Step ${draft.step} of 3: ${stepNames()[draft.step - 1]}`);
    updatePrompt();
    updatePreview();
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const goto = (n) => {
    draft.step = n;
    errors = [];
    saveDraft();
    renderStep();
    const h = form.querySelector('h2') || form.querySelector('legend');
    root.querySelector('.builder-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
    (form.querySelector('input:not([type=radio]), button[data-action="add-item"]') || h)?.focus({ preventScroll: true });
  };

  const showErrors = (errs) => {
    errors = errs;
    renderStep();
    form.querySelector('.form-errors')?.focus();
  };

  // Field edits: update state + preview without re-rendering the form (keeps focus/caret).
  const onField = (e) => {
    const el = e.target;
    if (el.name === 'template') return;
    if (el.dataset.field) {
      const val = el.type === 'checkbox' ? el.checked : el.value;
      const path = el.dataset.field.split('.');
      if (path.length === 2) draft[path[0]][path[1]] = val; else draft[path[0]] = val;
      if (el.dataset.field === 'waitlist' && draft.step === 2) renderStep();
    } else if (el.dataset.sid && el.dataset.sfield) {
      const slot = draft.slots.find((s) => s.id === el.dataset.sid);
      if (slot) {
        // Keep exactly what was typed; validation rejects "2.5", "-5", "1e3" instead of silently rewriting them.
        slot[el.dataset.sfield] = el.value;
        if (el.dataset.sfield === 'capacity') slot.capBad = !!el.validity?.badInput;
      }
    } else return;
    el.removeAttribute('aria-invalid');
    draft.dirty = true;
    saveDraft();
    updatePreview();
  };
  form.addEventListener('input', onField);

  const applyTemplate = (id) => {
    draft = fromTemplate(id, draft);
    pendingTpl = null;
    saveDraft();
    renderStep();
    form.querySelector(`input[name="template"][value="${id}"]`)?.focus();
  };

  form.addEventListener('change', (e) => {
    if (e.target.name !== 'template') return onField(e);
    const next = e.target.value;
    if (!draft.dirty) return applyTemplate(next);
    // Unsaved edits: ask inline instead of popping a dialog on every arrow-key press.
    pendingTpl = next === draft.templateId ? null : next;
    updatePrompt();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs = validate(draft.step);
    if (errs.length) return showErrors(errs);
    if (draft.step < 3) return goto(draft.step + 1);
    const all = [...validate(1), ...validate(2)];
    if (all.length) { draft.step = validate(1).length ? 1 : 2; return showErrors(all); }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (isEdit()) {
        // Re-check against the latest signups, then warn before anything that affects people.
        editCtx.original = await store.getSheetAdmin(editCtx.id, editCtx.token);
        const details = impactDetails(draftImpact());
        if (details.length && !(await confirmDialog({
          title: 'Save these changes?',
          message: "Some changes affect people who already signed up. Nobody's signup gets deleted.",
          details,
          confirmLabel: 'Save changes',
        }))) { btn.disabled = false; return; }
        const res = await store.updateSheet(editCtx.id, editCtx.token, draft);
        const id = editCtx.id;
        toast('Changes saved. Same link, updated sheet.');
        if (res.promoted.length) toast(`${res.promoted.join(', ')} moved up from the waitlist.`);
        draft = null;
        mode = 'new';
        editCtx = null;
        location.hash = `#/s/${id}/manage`;
        return;
      }
      const { id } = await store.createSheet(draft);
      store.setMe({ ...store.getMe(), name: store.getMe().name || draft.organizer.name });
      clearDraft();
      flash.justPublished = id;
      location.hash = `#/s/${id}/manage`;
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'Something went wrong publishing.');
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.goto) return goto(Number(t.dataset.goto));
    if (t.dataset.focus) {
      const target = document.getElementById(t.dataset.focus);
      target?.scrollIntoView({ block: 'center' });
      return target?.focus();
    }
    const action = t.dataset.action;
    if (!action) return;
    if (action === 'back') return goto(draft.step - 1);
    if (action === 'tpl-yes' && pendingTpl) {
      draft.step = 1;
      return applyTemplate(pendingTpl);
    }
    if (action === 'tpl-no') {
      pendingTpl = null;
      renderStep();
      (form.querySelector(`input[name="template"][value="${draft.templateId}"]`) || form.querySelector('input'))?.focus();
      return;
    }
    if (action === 'reset') {
      const ok = await confirmDialog({ title: 'Start over?', message: 'This clears everything you\'ve entered so far.', confirmLabel: 'Start over', danger: true });
      if (!ok) return;
      clearDraft();
      draft = fromTemplate('potluck');
      pendingTpl = null;
      saveDraft();
      errors = [];
      renderStep();
      return;
    }
    const idx = draft.slots.findIndex((s) => s.id === t.dataset.sid);
    let focusId;
    if (action === 'add-item') {
      const s = itemSlot({ capacity: 1 });
      draft.slots.push(s);
      focusId = `s-${s.id}-label`;
    } else if (action === 'add-time') {
      const last = [...draft.slots].reverse().find((s) => s.type === 'time');
      let start = '', end = '';
      if (last?.end) {
        start = last.end;
        if (last.start && last.end > last.start) {
          const toMin = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
          const e2 = Math.min(23 * 60 + 59, toMin(last.end) + (toMin(last.end) - toMin(last.start)));
          end = `${String(Math.floor(e2 / 60)).padStart(2, '0')}:${String(e2 % 60).padStart(2, '0')}`;
        }
      }
      const s = timeSlot({ date: last?.date || draft.date || isoDate(addDays(new Date(), 7)), start, end, capacity: last?.capacity || 1 });
      draft.slots.push(s);
      focusId = `s-${s.id}-label`;
    } else if (idx === -1) {
      return;
    } else if (action === 'del') {
      const taken = signupCount(draft.slots[idx].id);
      if (taken) {
        const label = draft.slots[idx].label || `Slot ${idx + 1}`;
        const ok = await confirmDialog({
          title: `Remove "${label}"?`,
          message: `${taken} ${taken === 1 ? 'person is' : 'people are'} signed up for this slot. Their signups are kept, never deleted: the slot is hidden from the sheet and listed on your dashboard, where you can restore it.`,
          confirmLabel: 'Remove slot',
          danger: true,
        });
        if (!ok) return;
      }
      draft.slots.splice(idx, 1);
      const neighbor = draft.slots[Math.min(idx, draft.slots.length - 1)];
      focusId = neighbor ? `s-${neighbor.id}-label` : 'add-item';
    } else if (action === 'dup') {
      const src = draft.slots[idx];
      const copy = src.type === 'time' ? timeSlot({ ...src, id: undefined }) : itemSlot({ ...src, id: undefined });
      copy.id = timeSlot().id;
      if (copy.type === 'time' && parseDate(copy.date)) copy.date = isoDate(addDays(parseDate(copy.date), 1));
      draft.slots.splice(idx + 1, 0, copy);
      focusId = `s-${copy.id}-label`;
    } else if (action === 'up' || action === 'down') {
      const j = action === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= draft.slots.length) return;
      [draft.slots[idx], draft.slots[j]] = [draft.slots[j], draft.slots[idx]];
      renderStep();
      // keep focus on the moved slot's same button (or the other if it became disabled)
      const btns = form.querySelectorAll(`.slot-edit[data-id="${t.dataset.sid}"] [data-action="${action}"], .slot-edit[data-id="${t.dataset.sid}"] [data-action="${action === 'up' ? 'down' : 'up'}"]`);
      const b = [...btns].find((x) => !x.disabled);
      b?.focus();
      draft.dirty = true;
      saveDraft();
      return;
    }
    draft.dirty = true;
    saveDraft();
    renderStep(focusId);
  });

  renderStep();
  if (notice) toast(notice);
}
