import { html, fmtDate, randomJoke } from '../util.js';
import { sheetTotals } from '../model.js';
import { icon, renderSheet, progressBar, noAdsBadge } from '../components.js';
import { TEMPLATES } from '../templates.js';
import { pricingSection } from './groupsShared.js';
import * as store from '../store.js';

// Static mini sheet for the hero phone mockup.
const HERO_SHEET = {
  id: 'hero', title: 'Room 12 Potluck', emoji: '🥧', waitlist: true,
  date: '', organizer: { name: 'Jordan W.' }, description: '',
  slots: [
    { id: 'a', type: 'item', label: 'Mains', capacity: 4 },
    { id: 'b', type: 'item', label: 'Desserts', capacity: 3 },
    { id: 'c', type: 'item', label: 'Napkins', capacity: 1 },
  ],
  signups: [
    { id: '1', slotId: 'a', name: 'Dana Rodriguez', note: 'Mac & cheese', status: 'confirmed', createdAt: 1 },
    { id: '2', slotId: 'a', name: 'Mike Thompson', note: 'Smoked brisket', status: 'confirmed', createdAt: 2 },
    { id: '3', slotId: 'a', name: 'Priya Natarajan', note: '', status: 'confirmed', createdAt: 3 },
    { id: '4', slotId: 'b', name: 'Aisha Grant', note: 'Brownies', status: 'confirmed', createdAt: 4 },
    { id: '5', slotId: 'c', name: 'Greg Molina', note: '', status: 'confirmed', createdAt: 5 },
  ],
};

function mySheetsSection(sheets) {
  if (!sheets.length) {
    return html`<section class="section" id="mine" aria-labelledby="mine-h">
      <div class="container">
        <h2 id="mine-h" class="section-title">My sheets</h2>
        <div class="card empty-card"><p>No sheets yet. The grill is cold.</p><a class="btn btn-primary" href="#/new">${icon('plus')} Fire up a sheet</a></div>
      </div></section>`;
  }
  return html`<section class="section" id="mine" aria-labelledby="mine-h">
    <div class="container">
      <div class="section-head">
        <h2 id="mine-h" class="section-title">My sheets</h2>
        <p class="muted small">Sheets created in this browser.</p>
      </div>
      <ul class="sheet-list">
        ${sheets.map((s) => {
          const t = sheetTotals(s);
          return html`<li class="card sheet-row">
            <div class="sheet-row-emoji" aria-hidden="true">${s.emoji}</div>
            <div class="sheet-row-main">
              <h3><a href="#/s/${s.id}">${s.title}</a>${s.demo ? html` <span class="pill">Demo</span>` : ''}</h3>
              <p class="muted small">${s.date ? fmtDate(s.date) + ' · ' : ''}${s.slots.length} slot${s.slots.length === 1 ? '' : 's'}${t.waiting ? ` · ${t.waiting} waitlisted` : ''}</p>
              ${progressBar(t.filled, t.capacity, `${s.title}: ${t.filled} of ${t.capacity} spots filled`)}
              <p class="small"><strong>${t.filled} of ${t.capacity}</strong> spots filled</p>
            </div>
            <div class="sheet-row-actions">
              <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/manage">${icon('chart')} Manage</a>
              <a class="btn btn-ghost btn-sm" href="#/s/${s.id}">View</a>
            </div>
          </li>`;
        })}
      </ul>
    </div></section>`;
}

export async function landingView(root, params) {
  document.title = 'SignMeUpDaddy · Sign-up sheets with dad energy';
  const mine = await store.listMySheets();

  root.innerHTML = html`
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">The sign-up sheet with dad energy</p>
        <h1 class="hero-title" tabindex="-1">Who's bringing the potato salad? <span class="accent">Sign 'em up.</span></h1>
        <p class="lede">Free sign-up sheets for potlucks, volunteer shifts, snack duty and carpools. One tap to sign up, waitlists included, and <strong>no ads, ever</strong>.</p>
        <div class="btn-row">
          <a class="btn btn-primary btn-lg" href="#/new">Fire up a sheet ${icon('arrowR')}</a>
          <a class="btn btn-ghost btn-lg" href="#/s/room12-potluck">See a demo sheet</a>
        </div>
        <p class="muted small hero-fine">${icon('check')} Free &nbsp; ${icon('check')} No ads &nbsp; ${icon('check')} No account to sign up</p>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="phone" inert>
          <div class="phone-notch"></div>
          <div class="phone-screen">${renderSheet(HERO_SHEET, { preview: true })}</div>
        </div>
        <div class="sticker">No ads.<br>Ever.</div>
      </div>
    </div>
  </section>

  ${mySheetsSection(mine)}

  <section class="promise" aria-labelledby="promise-h">
    <div class="container promise-inner">
      ${noAdsBadge('badge-lg')}
      <h2 id="promise-h">No ads. Ever. That's a dad promise.</h2>
      <p>Not on the free plan. Not on your sheet. Not wedged between the casserole slots. Not even after you pay us someday for the fancy org stuff. The only banner we'll ever fly is on the minivan.</p>
    </div>
  </section>

  <section class="section" aria-labelledby="feat-h">
    <div class="container">
      <h2 id="feat-h" class="section-title">Everything you need. Nothing held hostage.</h2>
      <p class="section-lede">The features other sign-up sites put behind a paywall come standard here.</p>
      <ul class="features">
        <li class="card feature">${icon('tap', 'feature-icon')}<h3>One-tap signup</h3><p>Name plus email or phone. That's it. No accounts, no five-screen obstacle course.</p></li>
        <li class="card feature">${icon('list', 'feature-icon')}<h3>Slot caps &amp; waitlists, free</h3><p>Slots stop at the number you set. Extras join a waitlist and move up when someone cancels.</p></li>
        <li class="card feature">${icon('check', 'feature-icon')}<h3>Potluck-native</h3><p>"Desserts ×3" with live counts, so you get a balanced spread instead of nine bags of chips.</p></li>
        <li class="card feature">${icon('share', 'feature-icon')}<h3>Built for the group chat</h3><p>Copy link, QR code for the classroom door, and a ready-to-send group text.</p></li>
        <li class="card feature">${icon('calendar', 'feature-icon')}<h3>Add to calendar</h3><p>Google Calendar or .ics, right on the confirmation. Fewer "wait, that was today?!" moments.</p></li>
        <li class="card feature">${icon('edit', 'feature-icon')}<h3>Change or cancel anytime</h3><p>Everyone gets a private edit link. Cancel a spot and the next person on the waitlist moves up.</p></li>
      </ul>
    </div>
  </section>

  <section class="section section-alt" aria-labelledby="tpl-h">
    <div class="container">
      <h2 id="tpl-h" class="section-title">Start from a template</h2>
      <p class="section-lede">Set up in about 30 seconds. Tweak anything.</p>
      <ul class="tpl-grid">
        ${TEMPLATES.filter((t) => t.id !== 'blank').map((t) => html`<li><a class="card tpl-card" href="#/new/${t.id}">
          <span class="tpl-emoji" aria-hidden="true">${t.emoji}</span>
          <span class="tpl-name">${t.name}</span>
          <span class="tpl-blurb">${t.blurb}</span>
        </a></li>`)}
      </ul>
    </div>
  </section>

  <section class="section groups-teaser" aria-labelledby="grp-h">
    <div class="container teaser-grid">
      <div>
        <p class="eyebrow">New: Groups</p>
        <h2 id="grp-h" class="section-title">Meet regularly? Give your crew a home.</h2>
        <p class="section-lede">Recurring meetups, one-tap RSVPs and "who's bringing what" in one link. Free up to 50 members. Group Plus is <strong>$5/mo</strong>, not the ~$45 Meetup charges.</p>
        <ul class="checklist">
          <li>${icon('check')} Weekly, every-other-week or monthly events</li>
          <li>${icon('check')} RSVP Going / Maybe / Can't, with caps and a free waitlist</li>
          <li>${icon('check')} Attach a sign-up sheet: "3/4 snacks claimed"</li>
          <li>${icon('check')} Announcements, co-organizers, CSV export</li>
        </ul>
        <div class="btn-row">
          <a class="btn btn-primary" href="#/groups/new">Start a group ${icon('arrowR')}</a>
          <a class="btn btn-ghost" href="#/g/trail-dads">See Saturday Trail Dads</a>
        </div>
      </div>
      <a class="card teaser-card" href="#/g/trail-dads" aria-label="Demo group: Saturday Trail Dads">
        <div class="group-cover cover-relish"><span class="cover-emoji" aria-hidden="true">🥾</span></div>
        <div class="mini-group-body">
          <p class="mini-title">Saturday Trail Dads</p>
          <p class="small muted">10 members · Every Saturday, 7:30 AM</p>
          <div class="bar" aria-hidden="true"><span style="width:70%"></span></div>
          <p class="small">7 going · 3 spots left</p>
          <p class="small mini-sheet">🥨 <strong>3/4</strong> snacks claimed</p>
        </div>
      </a>
    </div>
  </section>

  <section class="section" aria-labelledby="cmp-h">
    <div class="container narrow">
      <h2 id="cmp-h" class="section-title">SignMeUpDaddy vs. SignUpGenius</h2>
      <p class="section-lede">We like them fine. We just think sign-up sheets should be free, ad-free and pleasant to use.</p>
      <div class="table-wrap">
        <table class="compare">
          <caption class="sr-only">Feature comparison</caption>
          <thead><tr><th scope="col">Feature</th><th scope="col" class="us">SignMeUpDaddy</th><th scope="col">SignUpGenius (free)</th></tr></thead>
          <tbody>
            <tr><th scope="row">Ads on your sheet</th><td class="us">${icon('check')} Never</td><td>Yes, on free sheets</td></tr>
            <tr><th scope="row">Slot caps &amp; waitlists</th><td class="us">${icon('check')} Free</td><td>Paid tiers</td></tr>
            <tr><th scope="row">Signing up</th><td class="us">${icon('check')} One tap: name + email or phone</td><td>Several screens and clicks</td></tr>
            <tr><th scope="row">Account needed to sign up</th><td class="us">No</td><td>No (fair's fair)</td></tr>
            <tr><th scope="row">Add to calendar on confirmation</th><td class="us">${icon('check')} Google + .ics</td><td>Varies; app reviewers want it</td></tr>
            <tr><th scope="row">QR code + group-text message</th><td class="us">${icon('check')} Built in</td><td>Share link</td></tr>
            <tr><th scope="row">Price</th><td class="us">Free</td><td>Free with ads; $11.99–$59.99/mo to upgrade</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">Based on public reviews and pricing pages, October 2026. Their plans change often.</p>
    </div>
  </section>

  ${pricingSection()}

  <section class="cta-band">
    <div class="container cta-inner">
      <h2>Ready to stop chasing people in the group chat?</h2>
      <a class="btn btn-mustard btn-lg" href="#/new">Fire up a sheet ${icon('arrowR')}</a>
      <p class="joke">${randomJoke()}</p>
    </div>
  </section>`.s;

  if (params.scrollTo) {
    const el = root.querySelector(`#${params.scrollTo}`);
    if (el) {
      el.scrollIntoView();
      const h = el.querySelector('h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      return { skipFocus: true };
    }
  }
}
