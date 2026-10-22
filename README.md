# SignMeUpDaddy

Free sign-up sheets and groups with dad energy. **No ads, ever.**
This is a front-end prototype for signmeupdaddy.com: plain HTML, CSS and vanilla JS (ES modules), with no build step and no dependencies to install.

## Run it

```sh
cd signmeupdaddy
python -m http.server 8000
```

Then open <http://localhost:8000/>. It needs a static server because ES modules don't load from `file://`.

On first load the app adds three demo sheets and one demo group, and treats this browser as their organizer:

- `#/s/room12-potluck`: potluck with item/quantity slots, one full slot and one waitlisted person
- `#/s/fall-fest`: volunteer shifts with time slots
- `#/g/trail-dads`: **Saturday Trail Dads**, a weekly hike with a capped RSVP list and an attached snack sheet ("3/4 claimed")

To reset everything, clear the site's localStorage (DevTools → Application → Local Storage).

## Features

### Phase 1: sign-up sheets
- **Landing page**: tagline, positioning, "No ads, ever" promise, feature grid, templates, comparison with SignUpGenius, pricing, CTA.
- **3-step sheet builder** (Basics → Slots → Review & publish) with a live preview. Templates: Potluck, Volunteer Shifts, Snack Rotation, Meal Train, Carpool, Blank. Slots can be time slots (date + start/end) or items with a quantity ("Desserts ×3"), and you can mix both. Each slot has a capacity limit, and the waitlist is free. You can reorder, duplicate ("duplicate to next day") and delete slots. Validation shows an error summary and marks the bad fields. The draft is kept in sessionStorage.
- **Public sheet** (`#/s/<id>`): mobile-first layout, large tap targets, live "3 of 5 filled" progress bars (overall and per slot), and a "No ads, ever" badge. Signup is one tap in an inline dialog: name plus email or phone, no account. Name and contact are remembered, so the next signup is truly one tap. When a slot is full, people join its waitlist. Changes made in other tabs show up live and are announced through `aria-live`.
- **Confirmation** (`#/done/<token>`): Google Calendar link, downloadable `.ics`, and a private edit link with a copy button (this stands in for the emailed link).
- **Edit/cancel** (`#/edit/<token>`): change name, contact, note or slot, or cancel. When a confirmed spot opens up, the first person on that slot's waitlist moves in.
- **Share panel**: copy link, QR code, an editable pre-written group-text message (copy, `sms:` link, Web Share when available).
- **Organizer dashboard** (`#/s/<id>/manage`): stats, who signed up for what, open spots, waitlists, remove a signup (with waitlist promotion), CSV export (guarded against formula injection), delete sheet, and an "only open slots" filter.
- **My sheets** on the home page (`#/mine`).
- **Nudge**: organizers of a standalone sheet see "Doing this regularly? Turn it into a Group." It opens the group builder pre-filled from that sheet, with the sheet already attached.

### Phase 2: Groups
- **Groups home** (`#/groups`): pitch, my groups, how it works ("Event = RSVP + sheet"), pricing.
- **3-step group builder** (`#/groups/new`): name, emoji, cover colour, description, location, public/private, then an optional first event (one-off, weekly, biweekly or monthly; capacity; attach a sheet), then review. The last step can include a pinned welcome post.
- **Group page** (`#/g/<id>`): cover, members with roles, upcoming events (next date plus the following few), announcements (one pinned), share link and QR. Private groups show only the cover until you join.
- **Join** with name + email only, no account.
- **RSVP** Going / Maybe / Can't with capacity limits and a free waitlist. Changing from Going promotes the next person in line. RSVPing as a non-member joins you to the group in the same step.
- **Attached sign-up sheets**: create a sheet inline from a template, or attach an existing one. Template slots are generated for each of the event's next occurrences. Event cards show progress per date ("3/4 claimed"). **After you RSVP Going, a prompt asks "Want to bring something?" and you can claim a slot with one tap**, with calendar and edit links right there.
- **Event page** (`#/g/<id>/e/<eventId>/<date>`): date picker chips, RSVP, who's going (visible to everyone), per-date slots to claim. Add to calendar for one date (Google or `.ics`) or for the whole series (`.ics` with `RRULE`, or Google with recurrence).
- **Co-organizers**: organizers can promote members. A co-organizer's browser can then post, create events, attach sheets and open the organizer view.
- **Organizer view** (`#/g/<id>/manage`): member list (role changes, remove), RSVP counts per event and date with sheet progress, members CSV and RSVPs CSV, and a member counter against the free plan's 50-member cap.

### Quality
- Light and dark themes via CSS custom properties and `prefers-color-scheme`, plus a manual toggle that is remembered.
- Responsive down to 360px with no horizontal scroll (verified on every route).
- Accessibility: semantic HTML, labelled fields, visible focus rings, native `<dialog>` modals (focus trap, Esc to close, focus returns to the trigger), `aria-pressed` RSVP buttons, `aria-live` progress announcements, a skip link, and focus moved to the page heading on each route change.
- All user text is escaped: the `html` tagged template escapes every interpolated value by default.
- SEO and link previews: meta description, canonical URL, Open Graph and Twitter card tags (`og:url` https://signmeupdaddy.com/, 1200×630 `img/og-image.png`), SVG favicon and Apple touch icon. Share links in the app are built from `location.origin`, so they work locally and on the real domain.

## File structure

```
index.html            App shell: header/nav, <main id="app">, footer, toast/live regions, meta tags
css/styles.css        All styles: design tokens (light/dark), components, layouts
img/                  favicon.svg, apple-touch-icon.png, og-image.png
js/app.js             Hash router, theme toggle, focus management
js/store.js           Data layer (localStorage). The only module that persists anything.
js/model.js           Pure helpers: slot stats, grouping, recurrence, RSVP tallies, per-date sheet progress
js/templates.js       Sheet templates + slot factories
js/seed.js            Demo data
js/util.js            Safe html`` templating, ids, dates, clipboard, downloads, toasts
js/calendar.js        Google Calendar URLs, .ics builder (incl. RRULE)
js/qr.js              QR SVG via qrcode-generator 1.4.4 (cdnjs, pinned)
js/components.js      Icons, sheet renderer, progress bars, dialogs, share panel
js/views/*.js         landing, builder, sheet, signup dialog, participant (done/edit), manage,
                      groups (home + builder), group (group + event pages), groupManage,
                      groupsShared (event cards, RSVP + claim flow, pricing), notfound
docs/                 Market research briefs
```

### Data layer
`store.js` keeps data in generic collections keyed by type (`db.collections.sheets`, `db.collections.groups`), plus per-type "mine" refs that hold admin tokens. Every function is `async` and returns copies. Public getters (`getSheet`, `getGroup`) strip contacts and tokens; admin calls need a token. To move to a real backend, rewrite this module as a fetch client. Views only use its exported functions. Sheets have optional `groupId` / `eventId` fields.

## Known limitations (prototype)
- **No backend.** Everything lives in this browser's localStorage. Shared links only work in the same browser profile, and "live" updates only reach other tabs in the same browser.
- **No email/SMS.** Edit links and organizer access are shown on screen instead of emailed. Organizer and co-organizer rights belong to the browser that holds the token.
- **Link previews are static.** Crawlers don't run JS, so every link (sheets and groups included) previews the homepage card. Per-sheet previews will need server-side rendering.
- Paid plans aren't enforced, except the free 50-member cap on groups.
- A recurring event's attached sheet gets slots for its next ~4 dates when created. It doesn't roll forward automatically (that's P1). Item-only sheets (e.g. Potluck) apply to every date cumulatively.
- Calendar times are "floating" local times with no time zone.
- The QR code needs the CDN script. Offline, the share panel shows a notice instead.
