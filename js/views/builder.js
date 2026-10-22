// 3-step sheet builder: Basics -> Slots -> Review/Publish, with live preview.
import { html, raw, isEmail, fmtDateLong, fmtRange, isoDate, addDays, parseDate, toast } from '../util.js';
import { icon, renderSheet, confirmDialog, flash } from '../components.js';
import { TEMPLATES, getTemplate, timeSlot, itemSlot } from '../templates.js';
import { sheetTotals } from '../model.js';
import * as store from '../store.js';

const DRAFT_KEY = 'smud:draft';
const EMOJIS = ['📋', '🥗', '🥧', '🍲', '🍊', '🌭', '🧁', '🎃', '🎄', '🎉', '🙋', '🚐', '⚽', '🏈', '🏀', '📚', '🎭', '⛪', '👶', '🛠️'];
const STEPS = ['Basics', 'Slots', 'Review & publish'];

let draft = null;
let errors = [];

function loadDraft() {
  try { const r = sessionStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveDraft() {
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

/* ---------- Validation ---------- */

function validate(step) {
  const errs = [];
  if (step === 1) {
    if (!draft.title.trim()) errs.push({ id: 'f-title', msg: 'Give your sheet a title.' });
    if (!draft.organizer.name.trim()) errs.push({ id: 'f-org', msg: 'Add an organizer name (yours, or your group\'s).' });
    if (draft.organizer.email && !isEmail(draft.organizer.email.trim())) errs.push({ id: 'f-orgemail', msg: 'That organizer email doesn\'t look right.' });
    if (draft.start && draft.end && draft.end <= draft.start) errs.push({ id: 'f-end', msg: 'Event end time should be after the start time.' });
  }
  if (step === 2) {
    if (!draft.slots.length) errs.push({ id: 'add-item', msg: 'Add at least one slot.' });
    draft.slots.forEach((s, i) => {
      const n = `Slot ${i + 1}`;
      if (!s.label.trim()) errs.push({ id: `s-${s.id}-label`, msg: `${n}: give it a name.` });
      const cap = Number(s.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 999) errs.push({ id: `s-${s.id}-cap`, msg: `${n}: needs between 1 and 999 spots.` });
      if (s.type === 'time' && !s.date) errs.push({ id: `s-${s.id}-date`, msg: `${n}: pick a date.` });
      if (s.type === 'time' && s.start && s.end && s.end <= s.start) errs.push({ id: `s-${s.id}-end`, msg: `${n}: end time should be after start.` });
    });
  }
  return errs;
}

/* ---------- Rendering ---------- */

const invalid = (id) => (errors.some((e) => e.id === id) ? raw('aria-invalid="true"') : '');

function stepper() {
  return html`<ol class="stepper">
    ${STEPS.map((name, i) => {
      const n = i + 1;
      const state = n === draft.step ? 'current' : n < draft.step ? 'done' : 'todo';
      return html`<li class="step is-${state}">
        ${n < draft.step
          ? html`<button type="button" class="step-btn" data-goto="${n}"><span class="step-num">${icon('check')}</span><span class="step-name">${name}</span></button>`
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

function step1() {
  return html`
  <fieldset class="tpl-picker">
    <legend>Start from a template</legend>
    <div class="tpl-options">
      ${TEMPLATES.map((t) => html`<label class="tpl-option">
        <input type="radio" name="template" value="${t.id}" ${t.id === draft.templateId ? raw('checked') : ''}>
        <span class="tpl-option-card"><span class="tpl-emoji" aria-hidden="true">${t.emoji}</span><span class="tpl-name">${t.name}</span></span>
      </label>`)}
    </div>
  </fieldset>

  <div class="field-row title-row">
    <div class="field field-emoji">
      <label for="f-emoji">Icon</label>
      <select id="f-emoji" data-field="emoji">
        ${EMOJIS.map((e) => html`<option value="${e}" ${e === draft.emoji ? raw('selected') : ''}>${e}</option>`)}
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
      <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" data-field="date" value="${draft.date}"></div>
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
  return html`<li class="card slot-edit" data-id="${s.id}">
    <div class="slot-edit-head">
      <span class="pill ${isTime ? 'pill-blue' : 'pill-mustard'}">${isTime ? icon('clock') : icon('list')}${isTime ? 'Time slot' : 'Item'}</span>
      <span class="muted small">#${i + 1}</span>
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
        <input id="${p}-cap" type="number" inputmode="numeric" min="1" max="999" data-sid="${s.id}" data-sfield="capacity" value="${s.capacity}" ${invalid(`${p}-cap`)}>
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
    <h2>What do you need?</h2>
    <p class="muted">Mix and match: <strong>items</strong> for things to bring ("Desserts ×3") and <strong>time slots</strong> for shifts, dates and drivers. Each slot stops at the number you set${draft.waitlist ? ', then the free waitlist takes over' : ''}.</p>
  </div>
  ${draft.slots.length ? html`<ol class="slot-editor">${draft.slots.map((s, i) => slotEditor(s, i, draft.slots.length))}</ol>` : html`<p class="empty">No slots yet. Add one below.</p>`}
  <div class="btn-row add-row">
    <button type="button" class="btn btn-ghost" id="add-item" data-action="add-item">${icon('plus')} Add item</button>
    <button type="button" class="btn btn-ghost" data-action="add-time">${icon('plus')} Add time slot</button>
  </div>`;
}

function step3() {
  const sheet = previewSheet();
  const t = sheetTotals(sheet);
  const when = draft.date ? `${fmtDateLong(draft.date)}${fmtRange(draft.start, draft.end) ? ` · ${fmtRange(draft.start, draft.end)}` : ''}` : 'No single event date (slots have their own)';
  return html`
  <div class="step-intro">
    <h2>Looking good. Ready to fire it up?</h2>
    <p class="muted">Double-check the details. You can preview exactly what people will see.</p>
  </div>
  <dl class="review card">
    <div><dt>Title</dt><dd>${draft.emoji} ${draft.title}</dd></div>
    <div><dt>Organizer</dt><dd>${draft.organizer.name}${draft.organizer.email ? html` <span class="muted">(${draft.organizer.email})</span>` : ''}</dd></div>
    <div><dt>When</dt><dd>${when}</dd></div>
    ${draft.location ? html`<div><dt>Where</dt><dd>${draft.location}</dd></div>` : ''}
    <div><dt>Slots</dt><dd>${draft.slots.length} slot${draft.slots.length === 1 ? '' : 's'}, ${t.capacity} total spot${t.capacity === 1 ? '' : 's'}</dd></div>
    <div><dt>Waitlist</dt><dd>${draft.waitlist ? 'On (free, obviously)' : 'Off'}</dd></div>
  </dl>
  <ul class="checklist">
    <li>${icon('check')} No ads on your sheet. Ever.</li>
    <li>${icon('check')} People sign up with just a name and email or phone.</li>
    <li>${icon('check')} You'll get a share link, QR code and a ready-to-send group text.</li>
  </ul>`;
}

function navButtons() {
  return html`<div class="builder-nav">
    ${draft.step > 1 ? html`<button type="button" class="btn btn-ghost" data-action="back">${icon('arrowL')} Back</button>` : html`<span></span>`}
    ${draft.step < 3
      ? html`<button type="submit" class="btn btn-primary">Next: ${STEPS[draft.step]} ${icon('arrowR')}</button>`
      : html`<button type="submit" class="btn btn-primary btn-lg">Publish sheet ${icon('arrowR')}</button>`}
  </div>`;
}

function previewSheet() {
  return { ...draft, id: 'preview', signups: [], slots: draft.slots.map((s) => ({ ...s, capacity: Math.max(1, parseInt(s.capacity, 10) || 1) })) };
}

/* ---------- View ---------- */

export async function builderView(root, params) {
  document.title = 'Build a sheet · SignMeUpDaddy';
  if (params.template) {
    draft = fromTemplate(params.template, draft || loadDraft());
    history.replaceState(null, '', '#/new');
  } else {
    draft = draft || loadDraft() || fromTemplate('potluck');
  }
  errors = [];
  saveDraft();

  root.innerHTML = html`<div class="container builder">
    <div class="builder-head">
      <h1 tabindex="-1">Build your sheet</h1>
      <button type="button" class="btn btn-ghost btn-sm" data-action="reset">Start over</button>
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

  const renderStep = (focusId) => {
    stepEl.innerHTML = stepper().s;
    const body = draft.step === 1 ? step1() : draft.step === 2 ? step2() : step3();
    form.innerHTML = html`${errorSummary()}${body}${navButtons()}`.s;
    form.setAttribute('aria-label', `Step ${draft.step} of 3: ${STEPS[draft.step - 1]}`);
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
      if (slot) slot[el.dataset.sfield] = el.dataset.sfield === 'capacity' ? el.value.replace(/\D/g, '') : el.value;
    } else return;
    el.removeAttribute('aria-invalid');
    draft.dirty = true;
    saveDraft();
    updatePreview();
  };
  form.addEventListener('input', onField);
  form.addEventListener('change', async (e) => {
    if (e.target.name !== 'template') return onField(e);
    const next = e.target.value;
    if (draft.dirty) {
      const ok = await confirmDialog({
        title: 'Switch templates?',
        message: 'This replaces your title, description and slots with the template\'s. Your organizer info stays.',
        confirmLabel: 'Switch template',
      });
      if (!ok) {
        const prev = form.querySelector(`input[name="template"][value="${draft.templateId}"]`);
        if (prev) { prev.checked = true; prev.focus(); }
        return;
      }
    }
    draft = fromTemplate(next, draft);
    saveDraft();
    renderStep();
    form.querySelector(`input[name="template"][value="${next}"]`)?.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs = validate(draft.step);
    if (errs.length) return showErrors(errs);
    if (draft.step < 3) return goto(draft.step + 1);
    // Publish
    const all = [...validate(1), ...validate(2)];
    if (all.length) { draft.step = validate(1).length ? 1 : 2; return showErrors(all); }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
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
    if (action === 'reset') {
      const ok = await confirmDialog({ title: 'Start over?', message: 'This clears everything you\'ve entered so far.', confirmLabel: 'Start over', danger: true });
      if (!ok) return;
      clearDraft();
      draft = fromTemplate('potluck');
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
}
