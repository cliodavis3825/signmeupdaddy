// Group organizer view: #/g/<id>/manage
import { html, fmtDate, fmtRange, timeAgo, download, slugify, toast, isEmail } from '../util.js';
import { occurrences, rsvpsFor, sheetProgressFor, RECURRENCE_LABELS } from '../model.js';
import { icon, confirmDialog, progressBar } from '../components.js';
import { notFound } from './notfound.js';
import { avatar, roleBadge, openNewEventDialog, shareGroup } from './groupsShared.js';
import { toCsv } from './manage.js';
import * as store from '../store.js';

export async function groupManageView(root, { id }) {
  const pub = await store.getGroup(id);
  if (!pub) return notFound(root);
  const auth = pub.viewer.auth;
  if (!pub.viewer.canManage || !auth) {
    document.title = 'Organizers only · SignMeUpDaddy';
    root.innerHTML = html`<div class="container narrow center-page">
      <p class="big-emoji" aria-hidden="true">🔒</p>
      <h1 tabindex="-1">Organizers only.</h1>
      <p class="lede">This view is for the organizer and co-organizers of ${pub.name}. In this prototype, access lives in the browser that created the group (or a co-organizer's browser).</p>
      <a class="btn btn-primary" href="#/g/${id}">Back to the group</a></div>`.s;
    return;
  }

  const render = async () => {
    const g = await store.getGroupAdmin(id, auth);
    const viewerId = (await store.getGroup(id)).viewer.member?.id;
    document.title = `Organize: ${g.name} · SignMeUpDaddy`;
    const members = [...g.members].sort((a, b) => ({ organizer: 0, co: 1, member: 2 }[a.role] - { organizer: 0, co: 1, member: 2 }[b.role]) || a.joinedAt - b.joinedAt);
    const today = store.todayIso();
    const upcomingRsvps = g.rsvps.filter((r) => r.occurrence >= today && r.status === 'going').length;
    const sheets = Object.fromEntries((await store.getSheets([...new Set(g.events.flatMap((e) => e.sheetIds || []))])).map((s) => [s.id, s]));
    const pct = Math.round((g.members.length / store.FREE_MEMBER_LIMIT) * 100);

    root.innerHTML = html`<div class="container manage">
      <div class="manage-head">
        <div>
          <p class="eyebrow">Organizer view</p>
          <h1 tabindex="-1">${g.emoji} ${g.name}</h1>
          <p class="muted">${g.visibility === 'private' ? 'Private' : 'Public'} group · created ${timeAgo(g.createdAt)}</p>
        </div>
        <div class="btn-row">
          <a class="btn btn-ghost" href="#/g/${g.id}">View group</a>
          <button type="button" class="btn btn-primary" data-share>${icon('share')} Invite</button>
          <button type="button" class="btn btn-ghost" data-new-event>${icon('plus')} New event</button>
        </div>
      </div>

      <ul class="stats">
        <li class="stat card"><span class="stat-num">${g.members.length}<span class="stat-of">/${store.FREE_MEMBER_LIMIT}</span></span><span class="stat-label">Members (free plan)</span>${progressBar(g.members.length, store.FREE_MEMBER_LIMIT, `${g.members.length} of ${store.FREE_MEMBER_LIMIT} free members`)}</li>
        <li class="stat card"><span class="stat-num">${g.events.length}</span><span class="stat-label">Events</span></li>
        <li class="stat card"><span class="stat-num">${upcomingRsvps}</span><span class="stat-label">Upcoming "going" RSVPs</span></li>
        <li class="stat card"><span class="stat-num">${g.members.filter((m) => m.role !== 'member').length}</span><span class="stat-label">Organizers</span></li>
      </ul>
      ${pct >= 80 ? html`<p class="callout callout-mustard">You're at ${g.members.length} of ${store.FREE_MEMBER_LIMIT} free members. Group Plus ($5/mo) lifts the cap.</p>` : ''}

      <section aria-labelledby="ev-h" class="manage-group">
        <div class="manage-toolbar"><h2 id="ev-h" class="section-title-sm">RSVPs by event</h2>
          <button type="button" class="btn btn-sm btn-ghost" data-csv="rsvps">${icon('download')} RSVPs CSV</button></div>
        ${g.events.length ? g.events.map((ev) => {
          const occs = occurrences(ev, { count: 3 });
          return html`<article class="card manage-slot">
            <header class="manage-slot-head"><div>
              <h3 class="h4"><a href="#/g/${g.id}/e/${ev.id}">${ev.title}</a></h3>
              <p class="small muted">${RECURRENCE_LABELS[ev.recurrence]}${fmtRange(ev.start, ev.end) ? ` · ${fmtRange(ev.start, ev.end)}` : ''}${ev.capacity ? ` · ${ev.capacity} spots` : ' · no limit'}</p>
            </div></header>
            ${occs.length ? html`<div class="table-wrap"><table class="rsvp-table">
              <caption class="sr-only">RSVP counts for ${ev.title}</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Going</th><th scope="col">Maybe</th><th scope="col">Can't</th><th scope="col">Waitlist</th>${(ev.sheetIds || []).length ? html`<th scope="col">Sheet</th>` : ''}</tr></thead>
              <tbody>${occs.map((d) => {
                const r = rsvpsFor(g, ev.id, d);
                const sh = (ev.sheetIds || []).map((sid) => sheets[sid]).filter(Boolean);
                return html`<tr><th scope="row"><a href="#/g/${g.id}/e/${ev.id}/${d}">${fmtDate(d)}</a></th>
                  <td><strong>${r.going.length}</strong>${ev.capacity ? `/${ev.capacity}` : ''}</td><td>${r.maybe.length}</td><td>${r.no.length}</td><td>${r.waitlist.length}</td>
                  ${(ev.sheetIds || []).length ? html`<td>${sh.map((s) => { const p = sheetProgressFor(s, d); return html`${p.filled}/${p.capacity} `; })}</td>` : ''}</tr>`;
              })}</tbody></table></div>` : html`<p class="muted small">No upcoming dates.</p>`}
          </article>`;
        }) : html`<p class="muted">No events yet.</p>`}
      </section>

      <section aria-labelledby="mem-h" class="manage-group">
        <div class="manage-toolbar"><h2 id="mem-h" class="section-title-sm">Members</h2>
          <button type="button" class="btn btn-sm btn-ghost" data-csv="members">${icon('download')} Members CSV</button></div>
        <ul class="people card member-admin">${members.map((m) => html`<li>
          <div class="person person-row">${avatar(m.name)}<div><strong>${m.name}</strong>${m.id === viewerId ? ' (you)' : ''} ${roleBadge(m.role)}
            <span class="muted small">${m.contact ? (isEmail(m.contact) ? html`<a href="mailto:${encodeURIComponent(m.contact)}">${m.contact}</a>` : m.contact) : 'No email'} · joined ${timeAgo(m.joinedAt)}</span></div></div>
          ${m.role === 'organizer' ? '' : html`<div class="btn-row">
            <button type="button" class="btn btn-sm btn-ghost" data-role="${m.id}" data-to="${m.role === 'co' ? 'member' : 'co'}" aria-label="${m.role === 'co' ? `Remove co-organizer role from ${m.name}` : `Make ${m.name} a co-organizer`}">${m.role === 'co' ? 'Remove co-organizer' : 'Make co-organizer'}</button>
            <button type="button" class="btn btn-sm btn-danger-ghost" data-remove="${m.id}" data-name="${m.name}" aria-label="Remove ${m.name} from the group">${icon('trash')} Remove</button>
          </div>`}
        </li>`)}</ul>
        <p class="tiny muted">Co-organizers can post announcements, create events, attach sheets and see this view. Free on every plan in this prototype.</p>
      </section>
    </div>`.s;
    return g;
  };

  let g = await render();

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-share')) return shareGroup(await store.getGroup(id));
    if (t.hasAttribute('data-new-event')) return openNewEventDialog(await store.getGroup(id), auth, { onCreated: async () => { g = await render(); } });
    if (t.dataset.role) {
      try {
        await store.setMemberRole(id, auth, t.dataset.role, t.dataset.to);
        toast(t.dataset.to === 'co' ? 'Promoted to co-organizer. Hand them the spatula.' : 'Co-organizer role removed.');
        g = await render();
        root.querySelector(`[data-role="${t.dataset.role}"]`)?.focus();
      } catch (ex) { toast(ex.message); }
      return;
    }
    if (t.dataset.remove) {
      if (!(await confirmDialog({ title: `Remove ${t.dataset.name}?`, message: 'They leave the group and their RSVPs are removed. Waitlisted folks move up.', confirmLabel: 'Remove', danger: true }))) return;
      try { await store.removeMember(id, auth, t.dataset.remove); toast('Member removed.'); g = await render(); root.querySelector('h1')?.focus(); } catch (ex) { toast(ex.message); }
      return;
    }
    if (t.dataset.csv) {
      g = await store.getGroupAdmin(id, auth);
      if (t.dataset.csv === 'members') {
        const rows = [['Name', 'Email', 'Role', 'Joined']];
        for (const m of g.members) rows.push([m.name, m.contact, m.role === 'co' ? 'co-organizer' : m.role, new Date(m.joinedAt).toISOString()]);
        download(`${slugify(g.name)}-members.csv`, toCsv(rows), 'text/csv;charset=utf-8');
      } else {
        const rows = [['Event', 'Date', 'Start', 'End', 'Name', 'Email', 'RSVP', 'Updated']];
        const evs = Object.fromEntries(g.events.map((x) => [x.id, x]));
        for (const r of [...g.rsvps].sort((a, b) => a.occurrence.localeCompare(b.occurrence))) {
          const ev = evs[r.eventId];
          if (ev) rows.push([ev.title, r.occurrence, ev.start, ev.end, r.name, r.contact, r.status, new Date(r.queuedAt || r.createdAt).toISOString()]);
        }
        download(`${slugify(g.name)}-rsvps.csv`, toCsv(rows), 'text/csv;charset=utf-8');
      }
      toast('CSV downloaded.');
    }
  });

  const unsub = store.subscribe(async () => { if (!document.querySelector('dialog[open]')) g = await render(); });
  return { cleanup: unsub };
}
