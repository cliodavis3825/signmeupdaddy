// Groups home (#/groups) and the 3-step group builder (#/groups/new, #/groups/new/from/<sheetId>).
import { html, raw, isEmail, isoDate, nextDow, fmtDate, fmtRange, toast } from '../util.js';
import { nextOccurrence, RECURRENCE_LABELS } from '../model.js';
import { icon, flash, confirmDialog } from '../components.js';
import { getTemplate } from '../templates.js';
import { avatar, pricingSection, sheetChoiceSelect, applySheetChoice } from './groupsShared.js';
import * as store from '../store.js';

const EMOJIS = ['🏕️', '🥾', '📚', '🏃', '🚴', '🎲', '🧶', '🍳', '⚽', '🎸', '🌱', '🧘', '🐕', '🎣', '🛶', '⛪', '👶', '🍻', '☕', '🎮'];
export const COLOR_LABELS = { ketchup: 'Ketchup', mustard: 'Mustard', relish: 'Relish', denim: 'Denim', grape: 'Grape soda', charcoal: 'Charcoal' };

/* ---------- Groups home ---------- */

export async function groupsHomeView(root) {
  document.title = 'Groups · SignMeUpDaddy';
  const mine = await store.listMyGroups();
  root.innerHTML = html`
  <section class="hero hero-groups">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">New: SignMeUpDaddy Groups</p>
        <h1 class="hero-title" tabindex="-1">A home for your crew. <span class="accent">$5, not $45.</span></h1>
        <p class="lede">Recurring meetups, one-tap RSVPs and "who's bringing what" in one link. The cheap, ad-free home for hiking clubs, book clubs, playgroups and every crew that meets regularly.</p>
        <div class="btn-row">
          <a class="btn btn-primary btn-lg" href="#/groups/new">Start a group ${icon('arrowR')}</a>
          <a class="btn btn-ghost btn-lg" href="#/g/trail-dads">See a demo group</a>
        </div>
        <p class="muted small hero-fine">${icon('check')} Free up to 50 members &nbsp; ${icon('check')} No ads &nbsp; ${icon('check')} 90 days' notice on any price change</p>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="mini-group card">
          <div class="group-cover cover-relish"><span class="cover-emoji">🥾</span></div>
          <div class="mini-group-body">
            <p class="mini-title">Saturday Trail Dads</p>
            <div class="mini-event"><span class="date-chip sm"><span class="dc-mon">Sat</span><span class="dc-day">7:30</span></span>
              <div><p><strong>Saturday morning hike</strong></p><p class="small">7 going · 3 spots left</p>
              <div class="bar"><span style="width:70%"></span></div>
              <p class="small mini-sheet">🥨 <strong>3/4</strong> snacks claimed</p></div></div>
            <div class="mini-rsvp"><span class="rsvp-btn" aria-pressed="true">${icon('check')}Going</span><span class="rsvp-btn">Maybe</span><span class="rsvp-btn">Can't</span></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="mygroups-h">
    <div class="container">
      <h2 id="mygroups-h" class="section-title">My groups</h2>
      ${mine.length ? html`<ul class="group-list">${mine.map((g) => {
        const next = g.events.map((e) => ({ e, d: nextOccurrence(e) })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d))[0];
        return html`<li><a class="card group-row" href="#/g/${g.id}">
          <span class="group-row-cover cover-${g.color}" aria-hidden="true">${g.emoji}</span>
          <span class="group-row-main"><span class="group-row-name">${g.name}${g.demo ? html` <span class="pill">Demo</span>` : ''}</span>
            <span class="muted small">${g.memberCount} member${g.memberCount === 1 ? '' : 's'}${g.viewer.canManage ? ' · You organize' : ' · Member'}${next ? ` · Next: ${next.e.title}, ${fmtDate(next.d)}` : ''}</span></span>
          ${icon('arrowR')}
        </a></li>`;
      })}</ul>` : html`<div class="card empty-card"><p>You're not in any groups yet.</p><a class="btn btn-primary" href="#/groups/new">${icon('plus')} Start a group</a></div>`}
    </div>
  </section>

  <section class="section section-alt" aria-labelledby="how-h">
    <div class="container">
      <h2 id="how-h" class="section-title">Event = RSVP + sign-up sheet</h2>
      <p class="section-lede">Nobody else puts "who's coming" and "who's bringing what" in the same tap. We do.</p>
      <ol class="how">
        <li class="card"><span class="how-num">1</span><h3>Set your regular meetup</h3><p>Every Saturday at 7:30? Every other Tuesday? Monthly? Set it once and the dates roll forward.</p></li>
        <li class="card"><span class="how-num">2</span><h3>Attach a sheet</h3><p>Snacks, carpools, coffee duty, trail lead. Each date gets its own slots with live progress: "3/4 snacks claimed."</p></li>
        <li class="card"><span class="how-num">3</span><h3>RSVP, then claim</h3><p>Members tap Going and we ask, "Want to bring something?" One more tap and it's handled.</p></li>
      </ol>
    </div>
  </section>

  ${pricingSection('-groups')}`.s;
}

/* ---------- Group builder ---------- */

const STEPS = ['About your group', 'First event', 'Review & launch'];
let draft = null;

function freshDraft(fromSheet) {
  const me = store.getMe();
  const sat = nextDow(6);
  const d = {
    step: 1,
    name: '', emoji: '🏕️', color: 'ketchup', description: '', location: '', visibility: 'public',
    organizer: { name: me.name || '', email: isEmail(me.contact || '') ? me.contact : '' },
    addEvent: true,
    event: { title: '', date: isoDate(sat), start: '09:00', end: '10:30', recurrence: 'weekly', capacity: 0, location: '' },
    sheetChoice: 'tpl:snacks',
    welcome: '',
    fromSheet: null,
  };
  if (fromSheet) {
    d.fromSheet = fromSheet.id;
    d.name = fromSheet.title;
    d.emoji = EMOJIS.includes(fromSheet.emoji) ? fromSheet.emoji : '🏕️';
    d.description = fromSheet.description;
    d.location = fromSheet.location;
    d.organizer.name = fromSheet.organizer?.name || d.organizer.name;
    d.event.title = fromSheet.title;
    d.event.location = fromSheet.location;
    if (fromSheet.date) { d.event.date = fromSheet.date; d.event.start = fromSheet.start || d.event.start; d.event.end = fromSheet.end || d.event.end; }
    d.sheetChoice = `sheet:${fromSheet.id}`;
  }
  return d;
}

function validate(step) {
  const e = [];
  if (step === 1) {
    if (!draft.name.trim()) e.push({ id: 'g-name', msg: 'Give your group a name.' });
    if (!draft.organizer.name.trim()) e.push({ id: 'g-org', msg: 'Add your name as the organizer.' });
    if (draft.organizer.email && !isEmail(draft.organizer.email.trim())) e.push({ id: 'g-orgemail', msg: "That email doesn't look right." });
  }
  if (step === 2 && draft.addEvent) {
    if (!draft.event.title.trim()) e.push({ id: 'g-ev-title', msg: 'Name your first event.' });
    if (!draft.event.date) e.push({ id: 'g-ev-date', msg: 'Pick a date.' });
    if (draft.event.start && draft.event.end && draft.event.end <= draft.event.start) e.push({ id: 'g-ev-end', msg: 'End time should be after start.' });
  }
  return e;
}

function coverPreview() {
  return html`<div class="card group-preview">
    <div class="group-cover cover-${draft.color}"><span class="cover-emoji">${draft.emoji}</span></div>
    <div class="group-preview-body">
      <p class="group-preview-name">${draft.name || 'Your group name'}</p>
      <p class="muted small">${draft.location ? html`${icon('pin')}${draft.location} · ` : ''}${draft.visibility === 'private' ? 'Private group' : 'Public group'} · 1 member</p>
      ${draft.description ? html`<p class="small clamp">${draft.description}</p>` : ''}
      ${draft.addEvent && draft.event.title ? html`<div class="mini-event"><span class="date-chip sm"><span class="dc-mon">${fmtDate(draft.event.date, { month: 'short' })}</span><span class="dc-day">${fmtDate(draft.event.date, { day: 'numeric' })}</span></span>
        <div><p><strong>${draft.event.title}</strong></p><p class="small muted">${RECURRENCE_LABELS[draft.event.recurrence]}${fmtRange(draft.event.start, draft.event.end) ? ` · ${fmtRange(draft.event.start, draft.event.end)}` : ''}</p>
        ${draft.sheetChoice ? html`<p class="small mini-sheet">${icon('list')} Sign-up sheet attached</p>` : ''}</div></div>` : ''}
      <div class="mini-rsvp"><span class="rsvp-btn">Going</span><span class="rsvp-btn">Maybe</span><span class="rsvp-btn">Can't</span></div>
    </div>
  </div>`;
}

export async function groupBuilderView(root, params) {
  document.title = 'Start a group · SignMeUpDaddy';
  const fromSheet = params.fromSheet ? await store.getSheet(params.fromSheet) : null;
  if (fromSheet || !draft || params.fresh) draft = freshDraft(fromSheet);
  let errors = [];
  const mySheets = await store.listMySheets();

  root.innerHTML = html`<div class="container builder">
    <div class="builder-head"><h1 tabindex="-1">Start a group</h1>
      <button type="button" class="btn btn-ghost btn-sm" data-reset>Start over</button></div>
    <div id="g-stepper"></div>
    <div class="builder-grid">
      <form id="g-form" class="builder-main card" novalidate></form>
      <aside class="builder-preview" aria-label="Live preview"><p class="preview-label">Live preview</p><div id="g-preview" inert></div></aside>
    </div>
  </div>`.s;
  const form = root.querySelector('#g-form');
  const pv = root.querySelector('#g-preview');
  const stepEl = root.querySelector('#g-stepper');
  const inv = (id) => (errors.some((e) => e.id === id) ? raw('aria-invalid="true"') : '');

  const step1 = () => html`
    <div class="field"><label for="g-name">Group name <span class="req" aria-hidden="true">*</span></label>
      <input id="g-name" data-p="name" type="text" maxlength="80" required value="${draft.name}" placeholder="e.g. Saturday Trail Dads" ${inv('g-name')}></div>
    <div class="field-row">
      <div class="field"><label for="g-emoji">Icon</label><select id="g-emoji" data-p="emoji">${EMOJIS.map((e) => html`<option ${e === draft.emoji ? raw('selected') : ''}>${e}</option>`)}</select></div>
      <fieldset class="field color-field"><legend>Cover colour</legend>
        <div class="swatches">${Object.entries(COLOR_LABELS).map(([k, v]) => html`<label class="swatch cover-${k}"><input type="radio" name="g-color" data-p="color" value="${k}" ${draft.color === k ? raw('checked') : ''}><span class="sr-only">${v}</span></label>`)}</div>
      </fieldset>
    </div>
    <div class="field"><label for="g-desc">What's the group about? <span class="muted">(optional)</span></label>
      <textarea id="g-desc" data-p="description" rows="3" maxlength="2000" placeholder="Who it's for, what you do, how often you meet.">${draft.description}</textarea></div>
    <div class="field"><label for="g-loc">Usual location <span class="muted">(optional)</span></label>
      <input id="g-loc" data-p="location" type="text" maxlength="200" value="${draft.location}" placeholder="e.g. Eagle Creek Trailhead"></div>
    <fieldset class="field-group"><legend>Who can see it?</legend>
      <div class="radio-cards">
        <label class="radio-card"><input type="radio" name="g-vis" data-p="visibility" value="public" ${draft.visibility === 'public' ? raw('checked') : ''}><span><strong>Public</strong><span class="small muted">Anyone with the link sees events and members.</span></span></label>
        <label class="radio-card"><input type="radio" name="g-vis" data-p="visibility" value="private" ${draft.visibility === 'private' ? raw('checked') : ''}><span><strong>Private</strong><span class="small muted">Only members see events, posts and members.</span></span></label>
      </div></fieldset>
    <div class="field-row">
      <div class="field"><label for="g-org">Your name <span class="req" aria-hidden="true">*</span></label><input id="g-org" data-p="organizer.name" type="text" autocomplete="name" maxlength="80" value="${draft.organizer.name}" ${inv('g-org')}></div>
      <div class="field"><label for="g-orgemail">Your email <span class="muted">(optional)</span></label><input id="g-orgemail" data-p="organizer.email" type="email" autocomplete="email" maxlength="120" value="${draft.organizer.email}" ${inv('g-orgemail')}></div>
    </div>`;

  const step2 = () => html`
    <label class="switch"><input type="checkbox" data-p="addEvent" ${draft.addEvent ? raw('checked') : ''}><span class="switch-ui" aria-hidden="true"></span>
      <span><strong>Add a first event now</strong> <span class="muted">(you can add more later)</span></span></label>
    ${draft.addEvent ? html`
      <div class="field"><label for="g-ev-title">Event name</label><input id="g-ev-title" data-p="event.title" type="text" maxlength="120" value="${draft.event.title}" placeholder="e.g. Saturday morning hike" ${inv('g-ev-title')}></div>
      <div class="field-row three">
        <div class="field"><label for="g-ev-date">${draft.event.recurrence === 'none' ? 'Date' : 'First date'}</label><input id="g-ev-date" data-p="event.date" type="date" value="${draft.event.date}" ${inv('g-ev-date')}></div>
        <div class="field"><label for="g-ev-start">Starts</label><input id="g-ev-start" data-p="event.start" type="time" value="${draft.event.start}"></div>
        <div class="field"><label for="g-ev-end">Ends</label><input id="g-ev-end" data-p="event.end" type="time" value="${draft.event.end}" ${inv('g-ev-end')}></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="g-ev-rec">Repeats</label><select id="g-ev-rec" data-p="event.recurrence">${Object.entries(RECURRENCE_LABELS).map(([k, v]) => html`<option value="${k}" ${k === draft.event.recurrence ? raw('selected') : ''}>${v}</option>`)}</select></div>
        <div class="field"><label for="g-ev-cap">Spots <span class="muted">(0 = no limit)</span></label><input id="g-ev-cap" data-p="event.capacity" type="number" min="0" max="9999" inputmode="numeric" value="${draft.event.capacity}"></div>
      </div>
      <div class="field"><label for="g-ev-loc">Location <span class="muted">(defaults to the group's)</span></label><input id="g-ev-loc" data-p="event.location" type="text" maxlength="200" value="${draft.event.location}" placeholder="${draft.location}"></div>
      <div class="field highlight-field"><label for="g-ev-sheet">${icon('list')} Attach a sign-up sheet <span class="muted">(who's bringing what)</span></label>
        ${sheetChoiceSelect('g-ev-sheet', mySheets, [], draft.sheetChoice)}
        <p class="hint">When someone RSVPs "Going," we'll ask if they want to claim a slot. Recurring events get slots for each of the next few dates.</p></div>` : ''}`;

  const step3 = () => {
    const ev = draft.event;
    const sheetLabel = !draft.sheetChoice ? 'None' : draft.sheetChoice.startsWith('tpl:') ? `New ${getTemplate(draft.sheetChoice.slice(4)).name} sheet` : (mySheets.find((s) => `sheet:${s.id}` === draft.sheetChoice)?.title || 'Existing sheet');
    return html`
      <div class="step-intro"><h2>Ready to launch?</h2><p class="muted">Free for up to 50 members. No ads, ever.</p></div>
      <dl class="review card">
        <div><dt>Group</dt><dd>${draft.emoji} ${draft.name}</dd></div>
        <div><dt>Visibility</dt><dd>${draft.visibility === 'private' ? 'Private' : 'Public'}</dd></div>
        <div><dt>Organizer</dt><dd>${draft.organizer.name}</dd></div>
        ${draft.addEvent ? html`<div><dt>First event</dt><dd>${ev.title} · ${fmtDate(ev.date)}${fmtRange(ev.start, ev.end) ? ` · ${fmtRange(ev.start, ev.end)}` : ''} · ${RECURRENCE_LABELS[ev.recurrence]}${Number(ev.capacity) ? ` · ${ev.capacity} spots` : ''}</dd></div>
        <div><dt>Sign-up sheet</dt><dd>${sheetLabel}</dd></div>` : html`<div><dt>First event</dt><dd>None yet</dd></div>`}
      </dl>
      <div class="field"><label for="g-welcome">Pinned welcome post <span class="muted">(optional)</span></label>
        <textarea id="g-welcome" data-p="welcome" rows="3" maxlength="1000" placeholder="Welcome! Here's how we roll…">${draft.welcome}</textarea></div>`;
  };

  const render = (focusFirst = false) => {
    stepEl.innerHTML = html`<ol class="stepper">${STEPS.map((n, i) => {
      const k = i + 1;
      const st = k === draft.step ? 'current' : k < draft.step ? 'done' : 'todo';
      return html`<li class="step is-${st}">${k < draft.step
        ? html`<button type="button" class="step-btn" data-goto="${k}"><span class="step-num">${icon('check')}</span><span class="step-name">${n}</span></button>`
        : html`<span class="step-btn" ${k === draft.step ? raw('aria-current="step"') : ''}><span class="step-num">${k}</span><span class="step-name">${n}</span></span>`}</li>`;
    })}</ol>`.s;
    form.innerHTML = html`
      ${errors.length ? html`<div class="form-errors" role="alert" tabindex="-1"><p><strong>Hold the tongs, a few things need fixing:</strong></p><ul>${errors.map((e) => html`<li><button type="button" class="link-btn" data-focus="${e.id}">${e.msg}</button></li>`)}</ul></div>` : ''}
      ${draft.step === 1 ? step1() : draft.step === 2 ? step2() : step3()}
      <div class="builder-nav">
        ${draft.step > 1 ? html`<button type="button" class="btn btn-ghost" data-back>${icon('arrowL')} Back</button>` : html`<span></span>`}
        <button type="submit" class="btn btn-primary ${draft.step === 3 ? 'btn-lg' : ''}">${draft.step < 3 ? html`Next: ${STEPS[draft.step]} ${icon('arrowR')}` : html`Launch group ${icon('arrowR')}`}</button>
      </div>`.s;
    form.setAttribute('aria-label', `Step ${draft.step} of 3: ${STEPS[draft.step - 1]}`);
    pv.innerHTML = coverPreview().s;
    if (focusFirst) (form.querySelector('.form-errors') || form.querySelector('input:not([type=radio]), select, textarea'))?.focus();
  };

  const onInput = (e) => {
    const el = e.target;
    if (el.id === 'g-ev-sheet') { draft.sheetChoice = el.value; pv.innerHTML = coverPreview().s; return; }
    const p = el.dataset.p;
    if (!p) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (p === 'event.capacity') v = el.value.replace(/\D/g, '');
    const parts = p.split('.');
    if (parts.length === 2) draft[parts[0]][parts[1]] = v; else draft[p] = v;
    el.removeAttribute('aria-invalid');
    if (p === 'addEvent' || (p === 'event.recurrence' && e.type === 'change')) { render(); form.querySelector(`[data-p="${p}"]`)?.focus(); return; }
    pv.innerHTML = coverPreview().s;
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errors = validate(draft.step);
    if (errors.length) return render(true);
    if (draft.step < 3) { draft.step++; render(true); root.querySelector('.builder-head').scrollIntoView({ block: 'start' }); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { id, adminToken } = await store.createGroup({ ...draft, welcome: draft.welcome });
      if (draft.addEvent) {
        const evData = { ...draft.event, location: draft.event.location || draft.location };
        const { eventId } = await store.createEvent(id, adminToken, evData);
        if (draft.sheetChoice) {
          const g = await store.getGroup(id);
          await applySheetChoice(g, adminToken, g.events.find((x) => x.id === eventId), draft.sheetChoice);
        }
      }
      store.setMe({ ...store.getMe(), name: store.getMe().name || draft.organizer.name });
      draft = null;
      flash.justCreatedGroup = id;
      location.hash = `#/g/${id}`;
    } catch (ex) {
      btn.disabled = false;
      toast(ex.message);
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.goto) { draft.step = Number(t.dataset.goto); errors = []; render(true); }
    else if (t.hasAttribute('data-back')) { draft.step--; errors = []; render(true); }
    else if (t.dataset.focus) document.getElementById(t.dataset.focus)?.focus();
    else if (t.hasAttribute('data-reset')) {
      if (await confirmDialog({ title: 'Start over?', message: 'This clears everything you entered.', confirmLabel: 'Start over', danger: true })) {
        draft = freshDraft(null); errors = []; render(true);
      }
    }
  });

  if (fromSheet) history.replaceState(null, '', '#/groups/new');
  render();
}
