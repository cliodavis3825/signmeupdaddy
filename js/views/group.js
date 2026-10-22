// Group page (#/g/<id>) and event page (#/g/<id>/e/<eventId>[/<date>]).
import { html, raw, fmtDate, fmtDateLong, fmtRange, timeAgo, shortName, download, slugify, toast } from '../util.js';
import { occurrences, nextOccurrence, rsvpsFor, isOccurrence, sheetProgressFor, slotStats, RECURRENCE_LABELS } from '../model.js';
import { icon, noAdsBadge, confirmDialog, flash, progressBar } from '../components.js';
import { googleCalendarUrl, buildIcs, groupEventFor } from '../calendar.js';
import { notFound } from './notfound.js';
import { openSignupDialog } from './signup.js';
import {
  avatar, roleBadge, dateChip, eventCard, rsvpControl, rsvpLine, sheetProgressBlock, handleRsvp, openJoinDialog,
  openClaimPrompt, openNewEventDialog, openAttachSheetDialog, shareGroup, eventUrl,
} from './groupsShared.js';
import * as store from '../store.js';

async function sheetsMap(group) {
  const ids = [...new Set(group.events.flatMap((e) => e.sheetIds || []))];
  const list = await store.getSheets(ids);
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

function cover(group, { compact = false } = {}) {
  const v = group.viewer;
  return html`<header class="group-hero">
    <div class="group-cover cover-${group.color} ${compact ? 'is-compact' : ''}"><span class="cover-emoji" aria-hidden="true">${group.emoji}</span></div>
    <div class="group-hero-body">
      <h1 class="group-name" tabindex="-1">${group.name}</h1>
      <p class="group-meta small">
        ${group.location ? html`<span>${icon('pin')}${group.location}</span>` : ''}
        <span>${icon('user')}${group.memberCount} member${group.memberCount === 1 ? '' : 's'}</span>
        <span class="pill">${group.visibility === 'private' ? 'Private group' : 'Public group'}</span>
      </p>
      <div class="btn-row group-actions">
        ${v.member ? html`<span class="pill pill-green pill-lg">${icon('check')}You're a member</span>` : html`<button type="button" class="btn btn-primary" data-join>Join group</button>`}
        <button type="button" class="btn btn-ghost" data-share>${icon('share')} Share</button>
        ${v.canManage ? html`<a class="btn btn-ghost" href="#/g/${group.id}/manage">${icon('chart')} Organizer view</a>` : ''}
      </div>
    </div>
  </header>`;
}

/* =================== Group page =================== */

export async function groupView(root, { id }) {
  let group = await store.getGroup(id);
  if (!group) return notFound(root, "That group must be out on a hike. We can't find it.");

  const render = async () => {
    group = await store.getGroup(id);
    if (!group) return;
    document.title = `${group.name} · SignMeUpDaddy Groups`;
    const v = group.viewer;
    const focusKey = document.activeElement?.dataset?.rsvp ? `[data-rsvp="${document.activeElement.dataset.rsvp}"][data-event="${document.activeElement.dataset.event}"]` : null;

    if (group.locked) {
      root.innerHTML = html`<div class="container group-page">
        ${cover(group)}
        <section class="card locked-card">
          <p class="big-emoji" aria-hidden="true">🔒</p>
          <h2>This is a private group</h2>
          ${group.description ? html`<p>${group.description}</p>` : ''}
          <p class="muted">Join to see upcoming events, announcements and who's in.</p>
          <button type="button" class="btn btn-primary btn-lg" data-join>Join ${group.name}</button>
        </section>
      </div>`.s;
      return;
    }

    const sheets = await sheetsMap(group);
    const upcoming = group.events
      .map((e) => ({ e, d: nextOccurrence(e) }))
      .filter((x) => x.d)
      .sort((a, b) => a.d.localeCompare(b.d));
    const posts = [...group.announcements].sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
    const members = [...group.members].sort((a, b) => ({ organizer: 0, co: 1, member: 2 }[a.role] - { organizer: 0, co: 1, member: 2 }[b.role]) || a.joinedAt - b.joinedAt);
    const shown = members.slice(0, 12);

    root.innerHTML = html`<div class="container group-page">
      ${cover(group)}
      <div class="group-grid">
        <div class="group-main">
          <section aria-labelledby="up-h">
            <div class="section-head-row">
              <h2 id="up-h" class="section-title-sm">Upcoming</h2>
              ${v.canManage ? html`<button type="button" class="btn btn-sm btn-ghost" data-new-event>${icon('plus')} New event</button>` : ''}
            </div>
            ${upcoming.length ? html`<div class="event-list" aria-live="polite">${upcoming.map(({ e }) => eventCard(group, e, sheets))}</div>`
              : html`<div class="card empty-card"><p>No upcoming events yet.${v.canManage ? '' : ' Check back soon!'}</p>${v.canManage ? html`<button type="button" class="btn btn-primary" data-new-event>${icon('plus')} Add an event</button>` : ''}</div>`}
          </section>

          <section aria-labelledby="ann-h" class="announcements">
            <h2 id="ann-h" class="section-title-sm">Announcements</h2>
            ${v.canManage ? html`<form class="card composer" data-composer novalidate>
              <label for="ann-text" class="sr-only">Write an announcement</label>
              <textarea id="ann-text" name="text" rows="2" maxlength="1000" placeholder="Post an update to the group…"></textarea>
              <div class="composer-row">
                <label class="check"><input type="checkbox" name="pinned"> Pin to top</label>
                <button type="submit" class="btn btn-primary btn-sm">Post</button>
              </div>
            </form>` : ''}
            ${posts.length ? html`<ul class="posts">${posts.map((p) => html`<li class="card post ${p.pinned ? 'is-pinned' : ''}">
              <div class="post-head">${avatar(p.author, 'sm')}<div><strong>${p.author}</strong> <span class="muted tiny">${timeAgo(p.createdAt)}</span></div>
                ${p.pinned ? html`<span class="pill pill-mustard">📌 Pinned</span>` : ''}</div>
              <p class="post-text">${p.text}</p>
              ${v.canManage ? html`<div class="post-tools">
                <button type="button" class="link-btn small" data-pin="${p.id}">${p.pinned ? 'Unpin' : 'Pin'}</button>
                <button type="button" class="link-btn small danger" data-del-post="${p.id}">Delete</button></div>` : ''}
            </li>`)}</ul>` : html`<p class="muted">No announcements yet.</p>`}
          </section>
        </div>

        <aside class="group-side">
          <section class="card" aria-labelledby="about-h">
            <h2 id="about-h" class="h3">About</h2>
            ${group.description ? html`<p class="pre-line">${group.description}</p>` : html`<p class="muted">No description yet.</p>`}
            <div class="sheet-badges">${noAdsBadge()}</div>
          </section>
          <section class="card" aria-labelledby="mem-h">
            <h2 id="mem-h" class="h3">Members <span class="muted">(${group.memberCount})</span></h2>
            <ul class="member-list">${shown.map((m) => html`<li>${avatar(m.name)}<span class="member-name">${shortName(m.name)}${v.member?.id === m.id ? ' (you)' : ''}</span>${roleBadge(m.role)}</li>`)}</ul>
            ${members.length > shown.length ? html`<p class="small muted">and ${members.length - shown.length} more</p>` : ''}
            ${v.member && v.member.role !== 'organizer' ? html`<button type="button" class="link-btn small" data-leave>Leave group</button>` : ''}
          </section>
          <section class="card" aria-labelledby="share-h">
            <h2 id="share-h" class="h3">Invite people</h2>
            <p class="small">Link, QR code and a ready-to-send group text.</p>
            <button type="button" class="btn btn-mustard btn-block" data-share>${icon('share')} Share group</button>
          </section>
        </aside>
      </div>
    </div>`.s;
    if (focusKey) root.querySelector(focusKey)?.focus();
  };

  await render();
  if (flash.justCreatedGroup === id) {
    flash.justCreatedGroup = null;
    shareGroup(group, { justCreated: true });
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-share')) return shareGroup(group);
    if (t.hasAttribute('data-join')) {
      return openJoinDialog(group, {
        onSubmit: async (input) => {
          const r = await store.joinGroup(id, input);
          await render();
          toast(r.welcomeBack ? 'Welcome back! You were already a member.' : `Welcome to ${group.name}!`);
        },
      });
    }
    if (t.dataset.rsvp) {
      const ev = group.events.find((x) => x.id === t.dataset.event);
      if (ev) return handleRsvp(group, ev, t.dataset.occ, t.dataset.rsvp, render);
    }
    if (t.dataset.claim) {
      const card = t.closest('[data-event-card]');
      const ev = group.events.find((x) => x.id === card?.dataset.eventCard);
      if (ev) return openClaimPrompt(group, ev, t.dataset.occ, { heading: 'Claim a slot', onChange: render });
    }
    if (t.hasAttribute('data-new-event')) return openNewEventDialog(group, group.viewer.auth, { onCreated: render });
    if (t.dataset.pin) { await store.togglePin(id, group.viewer.auth, t.dataset.pin); await render(); return; }
    if (t.dataset.delPost) {
      if (await confirmDialog({ title: 'Delete this post?', message: "It'll disappear for everyone.", confirmLabel: 'Delete', danger: true })) {
        await store.deleteAnnouncement(id, group.viewer.auth, t.dataset.delPost); await render();
      }
      return;
    }
    if (t.hasAttribute('data-leave')) {
      if (await confirmDialog({ title: `Leave ${group.name}?`, message: 'Your RSVPs will be removed. You can rejoin anytime.', confirmLabel: 'Leave group', danger: true })) {
        try { await store.leaveGroup(id); toast('You left the group.'); await render(); } catch (ex) { toast(ex.message); }
      }
    }
  });

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-composer]')) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await store.postAnnouncement(id, group.viewer.auth, { text: fd.get('text'), pinned: !!fd.get('pinned'), author: group.viewer.member?.name });
      toast('Posted!');
      await render();
      root.querySelector('#ann-text')?.focus();
    } catch (ex) { toast(ex.message); }
  });

  const unsub = store.subscribe(() => { if (!document.querySelector('dialog[open]')) render(); });
  return { cleanup: unsub };
}

/* =================== Event page =================== */

export async function eventView(root, { id, eventId, date }) {
  let group = await store.getGroup(id);
  if (!group) return notFound(root, "That group must be out on a hike. We can't find it.");
  if (group.locked) { location.hash = `#/g/${id}`; return; }
  let ev = group.events.find((e) => e.id === eventId);
  if (!ev) return notFound(root, 'That event was cancelled or moved.');
  let occ = date && isOccurrence(ev, date) ? date : nextOccurrence(ev) || ev.date;

  const render = async () => {
    group = await store.getGroup(id);
    ev = group?.events.find((e) => e.id === eventId);
    if (!ev) return notFound(root, 'That event was cancelled.');
    const v = group.viewer;
    document.title = `${ev.title} · ${group.name}`;
    const occs = occurrences(ev, { count: 6 });
    if (!occs.includes(occ)) occs.unshift(occ);
    const r = rsvpsFor(group, ev.id, occ);
    const sheets = await store.getSheets(ev.sheetIds || []);
    const time = fmtRange(ev.start, ev.end);
    const past = occ < store.todayIso();
    const focusSel = document.activeElement?.dataset?.rsvp ? `[data-rsvp="${document.activeElement.dataset.rsvp}"]` : null;

    const people = (list, label) => list.length ? html`<div class="rsvp-people"><h3 class="h4">${label} <span class="muted">(${list.length})</span></h3>
      <ul class="member-list">${list.map((p) => html`<li>${avatar(p.name, 'sm')}<span class="member-name">${shortName(p.name)}${v.member?.id === p.memberId ? ' (you)' : ''}</span></li>`)}</ul></div>` : '';

    root.innerHTML = html`<div class="container narrow event-page">
      <a class="crumb" href="#/g/${group.id}">${icon('arrowL')} ${group.emoji} ${group.name}</a>
      <header class="event-hero card">
        ${dateChip(occ)}
        <div>
          <h1 tabindex="-1">${ev.title}</h1>
          <p class="event-meta">
            <span>${icon('calendar')}${fmtDateLong(occ)}${time ? ` · ${time}` : ''}</span>
            ${ev.recurrence !== 'none' ? html`<span class="pill">${RECURRENCE_LABELS[ev.recurrence]}</span>` : ''}
            ${ev.location ? html`<span>${icon('pin')}${ev.location}</span>` : ''}
          </p>
          ${ev.description ? html`<p class="pre-line">${ev.description}</p>` : ''}
        </div>
      </header>

      ${occs.length > 1 ? html`<nav class="occ-nav" aria-label="Choose a date"><ul>${occs.map((d) => html`<li><a href="#/g/${group.id}/e/${ev.id}/${d}" class="occ-chip" ${d === occ ? raw('aria-current="date"') : ''}>${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</a></li>`)}</ul></nav>` : ''}

      <section class="card" aria-labelledby="rsvp-h">
        <h2 id="rsvp-h" class="h3">Are you in?</h2>
        ${past ? html`<p class="muted">This date has passed.</p>` : rsvpControl(group, ev, occ)}
        <div aria-live="polite">${rsvpLine(group, ev, occ)}</div>
        <p class="tiny muted">Everyone can see who's coming. (Some sites charge for that. We think that's silly.)</p>
        ${people(r.going, 'Going')}${people(r.maybe, 'Maybe')}${people(r.waitlist, 'Waitlist')}
      </section>

      <section class="card" aria-labelledby="sheets-h">
        <div class="section-head-row"><h2 id="sheets-h" class="h3">Who's bringing what</h2>
          ${v.canManage ? html`<button type="button" class="btn btn-sm btn-ghost" data-attach>${icon('plus')} Attach a sheet</button>` : ''}</div>
        ${sheets.length ? sheets.map((s) => {
          const p = sheetProgressFor(s, occ);
          return html`<div class="event-sheet-full">
            <div class="section-head-row"><h3 class="h4">${s.emoji} ${s.title}</h3>
              <span class="small"><strong>${p.filled}/${p.capacity}</strong> claimed</span></div>
            ${p.capacity ? progressBar(p.filled, p.capacity, `${s.title}: ${p.filled} of ${p.capacity} claimed`) : ''}
            ${p.slots.length ? html`<ul class="claim-list">${p.slots.map((slot) => {
              const st = slotStats(s, slot);
              const names = s.signups.filter((x) => x.slotId === slot.id && x.status === 'confirmed').map((x) => html`<li><span class="who">${shortName(x.name)}</span>${x.note ? html`<span class="what">${x.note}</span>` : ''}</li>`);
              return html`<li class="claim-row ${st.full ? 'is-full' : ''}">
                <div class="claim-main"><strong>${slot.label}</strong> <span class="muted small">${Math.min(st.filled, st.capacity)} of ${st.capacity}</span>
                  ${names.length ? html`<ul class="claimed">${names}</ul>` : ''}</div>
                ${past ? '' : !st.full ? html`<button type="button" class="btn btn-sm btn-primary" data-slot="${slot.id}" data-sheet="${s.id}" aria-label="Claim ${slot.label}">Claim</button>`
                  : s.waitlist ? html`<button type="button" class="btn btn-sm btn-ghost" data-slot="${slot.id}" data-sheet="${s.id}" aria-label="Join waitlist for ${slot.label}">Waitlist</button>` : html`<span class="pill pill-green">Full</span>`}
              </li>`;
            })}</ul>` : html`<p class="muted small">No slots for this date.</p>`}
            <p class="tiny"><a href="#/s/${s.id}">Open the full sheet</a>${v.canManage ? html` · <button type="button" class="link-btn tiny" data-detach="${s.id}">Detach from event</button>` : ''}</p>
          </div>`;
        }) : html`<p class="muted">No sign-up sheet attached.${v.canManage ? ' Attach one so people can claim snacks, rides or roles.' : ''}</p>`}
      </section>

      <section class="card" aria-labelledby="cal-h">
        <h2 id="cal-h" class="h3">${icon('calendar')} Add to calendar</h2>
        <div class="btn-row">
          <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="${googleCalendarUrl(groupEventFor(group, ev, occ, { link: eventUrl(group.id, ev.id, occ) }))}">Google: this date<span class="sr-only"> (opens in new tab)</span></a>
          <button type="button" class="btn btn-ghost btn-sm" data-ics="one">${icon('download')} .ics: this date</button>
          ${ev.recurrence !== 'none' ? html`
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="${googleCalendarUrl(groupEventFor(group, ev, occ, { series: true, link: eventUrl(group.id, ev.id) }))}">Google: whole series<span class="sr-only"> (opens in new tab)</span></a>
            <button type="button" class="btn btn-mustard btn-sm" data-ics="series">${icon('download')} .ics: whole series</button>` : ''}
        </div>
      </section>

      ${v.canManage ? html`<div class="danger-zone"><h2 class="h3">Cancel this event</h2>
        <p class="small">Removes the event${ev.recurrence !== 'none' ? ' and every future date' : ''}, plus its RSVPs. Attached sheets stay in your sheets list.</p>
        <button type="button" class="btn btn-danger-ghost" data-del-event>${icon('trash')} Delete event</button></div>` : ''}
    </div>`.s;
    if (focusSel) root.querySelector(focusSel)?.focus();
  };

  await render();

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.rsvp) return handleRsvp(group, ev, occ, t.dataset.rsvp, render);
    if (t.dataset.slot) {
      const sheet = await store.getSheet(t.dataset.sheet);
      if (!sheet) return;
      const m = group.viewer.member;
      const who = m?.contact ? { name: m.name, contact: m.contact } : null;
      if (who) {
        // Members claim in one tap with their group identity.
        try {
          const res = await store.signUp(sheet.id, t.dataset.slot, { ...who, note: '' });
          location.hash = `#/done/${res.token}`;
        } catch (ex) { toast(ex.message); }
      } else {
        openSignupDialog(sheet, t.dataset.slot);
      }
      return;
    }
    if (t.dataset.ics) {
      const series = t.dataset.ics === 'series';
      const cal = groupEventFor(group, ev, occ, { series, link: eventUrl(group.id, ev.id, series ? '' : occ) });
      download(`${slugify(group.name)}-${slugify(ev.title)}${series ? '-series' : `-${occ}`}.ics`, buildIcs(cal, `${ev.id}-${series ? 'series' : occ}`), 'text/calendar');
      return toast(series ? 'Series calendar file downloaded.' : 'Calendar file downloaded.');
    }
    if (t.hasAttribute('data-attach')) return openAttachSheetDialog(group, group.viewer.auth, ev, { onDone: render });
    if (t.dataset.detach) {
      await store.detachSheet(id, group.viewer.auth, ev.id, t.dataset.detach);
      toast('Sheet detached.');
      return render();
    }
    if (t.hasAttribute('data-del-event')) {
      if (await confirmDialog({ title: 'Delete this event?', message: `"${ev.title}" and its RSVPs will be removed for everyone.`, confirmLabel: 'Delete event', danger: true })) {
        await store.deleteEvent(id, group.viewer.auth, ev.id);
        toast('Event deleted.');
        location.hash = `#/g/${id}`;
      }
    }
  });

  const unsub = store.subscribe(() => { if (!document.querySelector('dialog[open]')) render(); });
  return { cleanup: unsub };
}
