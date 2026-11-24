# signmeupdaddy

A shared event-signup engine for clubs. Static site on GitHub Pages; Supabase (Postgres) holds the data.
518 Analog Club is the first club. Any club can be added later with one SQL row.

**Built for game and book nights** (what Luma, Partiful and SignUpGenius don't do):
- **Tables, not just headcount.** Set players per table (4 for mahjong) and guests see "3 more players complete Table 3". One click seats everyone: experienced players spread across tables, brand-new players next to them, parties kept together. Attendees see their table number.
- **Gear tracking.** "I can bring a mahjong set" on the form; organizers see sets vs. tables needed and get warned when a table has none.
- **Experience levels** collected at signup and used for seating.
- **No-show defence.** Confirmation, waitlist-promotion and day-before reminder emails (each with a one-click "release my spot"), door check-in, and per-person attendance badges ("2 no-shows", "3× regular") built from past check-ins.
- **Analog at the door.** Printable roster with tick boxes, and printable table cards (one big number per page).
- **Follow the club.** A subscribable calendar feed so members get new nights in Apple/Google/Outlook automatically.
- **Book club details**: this month's title, author and cover on the event and in emails.

**Also:** month calendar and upcoming list, filter by type, capacity with automatic FIFO waitlist,
guests per signup, duplicate-email protection, add to calendar (.ics or Google), cancel links (also saved
under "My signups" on the device), organizer dashboard with magic-link login, roster with CSV export
and copy-emails, "+1 week" duplicate for recurring nights, and an iframe embed that auto-sizes on any site.

With `assets/config.js` left blank it runs in **demo mode** (data saved in the browser only), so you can click around before any setup.

## Files
```
index.html            landing page; app/index.html is the app shell (calendar, event, cancel, my signups, admin)
assets/config.js      ← the only file you edit (Supabase URL, anon key, Turnstile site key)
assets/api.js         data layer: Supabase or demo
assets/app.js         UI + routing (#/, #/e/<id>, #/cancel/<token>, #/me, #/admin, #/subscribe, #/report)
assets/util.js        dates, .ics, CSV
assets/app.css
supabase/schema.sql   tables, row-level security, signup/cancel/waitlist functions, rate limit, audit log
supabase/functions/signup/       CAPTCHA + rate limit in front of every public signup; sends the confirmation
supabase/functions/send-outbox/  delivers queued emails + queues day-before reminders (called by notify.yml)
supabase/functions/ical/         subscribable club calendar feed
supabase/functions/_shared/      iCalendar + email rendering shared by the functions
supabase/config.toml             which functions skip JWT checks (feed + cron endpoint)
.github/workflows/notify.yml     drains the email outbox every 15 minutes
.github/workflows/keepalive.yml   stops the free Supabase project from auto-pausing
CNAME                 signmeupdaddy.com
```

## Setup (about 30 minutes)

### 1. Supabase
1. Create a free project at supabase.com.
2. SQL Editor → paste all of `supabase/schema.sql` → Run. It creates the `518analog` club.
3. Authentication → URL Configuration: set Site URL to `https://signmeupdaddy.com` and add `https://signmeupdaddy.com/**` to Redirect URLs.
4. Project Settings → API: copy the Project URL and the `anon` public key into `assets/config.js`.
   (The anon key is meant to be public. Row-level security keeps attendee emails private; the public can only list events and use cancel links. Signups go through the Edge Function in step 4.)

### 2. GitHub Pages
1. Create a repo (e.g. `signmeupdaddy`) and push these files.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Custom domain: `signmeupdaddy.com` (the CNAME file is already here). Turn on **Enforce HTTPS** once it's offered.

### 3. DNS at your registrar
| Type | Host | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<your-github-username>.github.io` |

### 4. Security: CAPTCHA, sign-in hardening, signup endpoint

**a. Cloudflare Turnstile** (free): Cloudflare dashboard → Turnstile → Add widget.
Hostnames: `signmeupdaddy.com` (add `localhost` while testing). Mode: Managed.
Put the **site key** in `assets/config.js` → `TURNSTILE_SITE_KEY`. Keep the **secret key** for b and d.

**b. Supabase Auth settings** (dashboard menu names shift occasionally; search the setting name if one has moved)
| Where | Setting |
|---|---|
| Authentication → Bot and Abuse Protection | Enable CAPTCHA → Turnstile → paste the secret key |
| Authentication → Sign In / Providers → Email | **Turn off "Allow new users to sign up"**. Organizers are invited, never self-registered. Set Email OTP expiration to `900` (15 min). |
| Authentication → Emails → Templates → Magic Link | Add the code to the body, e.g. `<h2>{{ .Token }}</h2><p>Or <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>` |
| Authentication → Emails → SMTP Settings | Connect a sender (Resend, Postmark, Brevo…) on your own domain. The built-in sender is for testing and capped at 2 emails/hour. Turn **off** link tracking at the provider so it doesn't rewrite sign-in links. |
| Authentication → URL Configuration | Site URL `https://signmeupdaddy.com`; Redirect URLs exactly `https://signmeupdaddy.com/**` (no wildcards on other hosts) |
| Authentication → Multi-Factor | App Authenticator (TOTP) **enabled** (it is by default) |

**c. Invite yourself as an organizer**: Authentication → Users → Add user → Send invitation. Then in the SQL Editor:
```sql
insert into public.club_admins (club_id, user_id)
select '518analog', id from auth.users where email = 'YOUR-EMAIL';
```
Sign in at `signmeupdaddy.com/#/admin`: email → 6-digit code → set up your authenticator app (first time) → dashboard.

**d. Deploy the signup Edge Function** (needs the Supabase CLI once, from your computer):
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set TURNSTILE_SECRET=... RATE_SALT="$(openssl rand -hex 32)" \
  ALLOWED_ORIGINS=https://signmeupdaddy.com,https://www.signmeupdaddy.com
supabase functions deploy signup
```

**e. Email (confirmations, waitlist promotions, reminders)**
1. Create a free [Resend](https://resend.com) account, verify your sending domain, create an API key.
2. Set the function secrets and deploy the other two functions:
```bash
supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="518 Analog Club <hello@YOUR-DOMAIN>" \
  SITE_URL=https://signmeupdaddy.com CRON_SECRET="$(openssl rand -hex 32)"
supabase functions deploy send-outbox
supabase functions deploy ical
```
3. GitHub repo secrets for the notify workflow: `SUPABASE_URL` (already set) and `CRON_SECRET` (same value).
4. Optional reply-to per club: `update clubs set contact_email = 'you@example.com' where id = '518analog';`

How it works: every email is a row in the `outbox` table first (written by a database trigger), then delivered. If Resend is down, rows wait and are retried up to 6 times, and each send carries an idempotency key so a retry can't double-send. Confirmations go out immediately from the signup function; promotions and reminders go out on the next notify run. Restoring a backup with `set smud.restoring = on` does not re-email anyone.

**Scheduled jobs caveat:** GitHub runs schedules best-effort (runs can be delayed), and in a **public** repo it switches schedules off after 60 days with no repository activity. The keepalive workflow re-enables all scheduled workflows each time it runs, which should reset that timer; if a schedule ever stops, push any commit or click Enable on the Actions tab.

#### What the auth flow now does
- **Organizers**
  - **CAPTCHA** on the sign-in form (Supabase Auth verifies the token server-side).
  - **No self-signup.** Unknown emails get the same "if this is an organizer account…" message, so the form can't be used to discover who's an organizer.
  - **6-digit code** as well as the link. This covers corporate mail scanners that "click" links before you do, and opening the email on a different device.
  - **Required authenticator-app MFA.** It's enforced in the database, not just the UI: `is_club_admin()` only returns true on an `aal2` session. A stolen inbox alone gets you nothing but the public calendar.
  - **Idle sign-out** after 30 minutes (`ORGANIZER_IDLE_MINUTES`), plus **Sign out everywhere**.
  - **Audit log** (`audit_log` table): every event create/edit/delete and every signup change, with who did it and their auth level.
- **Public signups**
  - **Turnstile**, checked by the Edge Function for the right action and hostname. Tokens are single-use.
  - **Honeypot field and a minimum fill time.**
  - **10 signups per IP per hour.** The IP is stored only as a salted hash.
  - **Locked-down database function.** `sign_up()` is no longer callable from the browser, so the CAPTCHA can't be skipped by hitting the API directly.
- **Site**
  - **Content-Security-Policy** in `index.html`: scripts only from this site, esm.sh and Cloudflare; network calls only to Supabase.

### 5. Keep the free database awake
Free Supabase projects pause after a week with no activity. In the GitHub repo:
Settings → Secrets and variables → Actions → add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
The included workflow pings the database every 3 days.

### 6. Nightly backups (the free plan has none)
Add two more repo secrets:
- `SUPABASE_DB_URL`: Supabase → **Connect** → **Session pooler** URI (port 5432), with your DB password filled in.
  Use the session pooler, not "Direct": GitHub's runners are IPv4-only and the direct connection is IPv6.
- `BACKUP_PASSPHRASE`: a long random string. Save it in your password manager; backups can't be opened without it.

`.github/workflows/backup.yml` runs nightly (about 2:40 AM Eastern). It dumps clubs, events and signups,
**restore-tests the dump** against `schema.sql` in a throwaway Postgres (the run summary shows the row counts),
then saves it AES-256-encrypted as a workflow artifact for 30 days. Encrypted because it holds attendee
names and emails. Run it once by hand (Actions → db-backup → Run workflow) to confirm it's green.
Restore steps are at the bottom of the workflow file.

## Adding another club (book club, etc.)
```sql
insert into public.clubs (id, name, tagline, accent) values ('bookclub', 'signmeupdaddy Book Club', 'One book a month', '#c8452c');
```
Its calendar lives at `signmeupdaddy.com/?club=bookclub`. Add organizers with the step 4c query using `'bookclub'`.

## Embedding on another site
```html
<iframe id="signup-frame" src="https://signmeupdaddy.com/?club=518analog&embed=1"
        style="width:100%;border:0;min-height:640px" title="Events"></iframe>
<script>
addEventListener('message', e => {
  if (e.origin === 'https://signmeupdaddy.com' && e.data?.type === 'smud:height')
    document.getElementById('signup-frame').style.height = e.data.height + 8 + 'px';
});
</script>
```

## Known limits / next steps
- **No confirmation emails yet.** People get their cancel link on screen and it's saved on their device. Next step: a Supabase Edge Function + Resend to email confirmations, waitlist promotions and day-before reminders.
- Organizers enter event times in their own browser's time zone; display is America/New_York (change `TIMEZONE` in config).
- Lost authenticator: another organizer can't reset it from the app yet. You remove the factor in Supabase (Authentication → Users → user → MFA) and they re-enroll on next sign-in.
- Organizer sessions use Supabase's default token lifetime plus the in-app idle sign-out. Supabase also has server-side session time-boxes and inactivity timeouts under Authentication → Sessions. I believe those are paid-plan features but haven't confirmed it, so check your plan.
