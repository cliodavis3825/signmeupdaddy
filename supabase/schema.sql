-- signmeupdaddy — Supabase schema
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run (idempotent where practical).
--
-- Model:  clubs ─┬─ events ── signups
--               └─ club_admins (auth.users)
-- Public visitors never read the signups table directly. Everything they can do
-- goes through SECURITY DEFINER functions that enforce capacity, waitlist and
-- duplicate rules inside one row-locked transaction.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.clubs (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),   -- slug, e.g. '518analog'
  name        text not null,
  tagline     text,
  accent      text default '#2f6b4f',
  timezone    text not null default 'America/New_York',
  created_at  timestamptz not null default now()
);

create table if not exists public.club_admins (
  club_id  text references public.clubs(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete cascade,
  primary key (club_id, user_id)
);

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  club_id      text not null references public.clubs(id) on delete cascade,
  title        text not null check (length(title) between 1 and 120),
  kind         text not null default 'other',          -- book | mahjong | trivia | craft | other
  description  text default '',
  location     text default '',
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int check (capacity is null or capacity > 0),   -- null = unlimited
  max_guests   int not null default 1 check (max_guests between 0 and 10),
  waitlist     boolean not null default true,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists events_club_start on public.events (club_id, starts_at);
-- Hobby-night features (added as ALTERs so re-running this file upgrades an existing database)
alter table public.events add column if not exists table_size   int  check (table_size is null or table_size between 2 and 12);  -- 4 = mahjong
alter table public.events add column if not exists gear_label   text check (gear_label is null or length(gear_label) <= 40);      -- 'mahjong set'
alter table public.events add column if not exists ask_skill    boolean not null default false;
alter table public.events add column if not exists book_title   text check (book_title is null or length(book_title) <= 160);
alter table public.events add column if not exists book_author  text check (book_author is null or length(book_author) <= 120);
alter table public.events add column if not exists book_isbn    text check (book_isbn is null or book_isbn ~ '^[0-9Xx-]{10,17}$');
alter table public.clubs  add column if not exists contact_email text;

create table if not exists public.signups (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  guests        int  not null default 0 check (guests between 0 and 10),
  note          text default '' check (length(note) <= 500),
  status        text not null default 'confirmed' check (status in ('confirmed','waitlist','cancelled')),
  cancel_token  uuid not null default gen_random_uuid() unique,
  created_at    timestamptz not null default now()
);
alter table public.signups add column if not exists skill         text check (skill is null or skill in ('new','learning','experienced'));
alter table public.signups add column if not exists brings_gear   boolean not null default false;
alter table public.signups add column if not exists table_no      int check (table_no is null or table_no between 1 and 200);
alter table public.signups add column if not exists checked_in_at timestamptz;
create unique index if not exists signups_one_per_email
  on public.signups (event_id, lower(email)) where status <> 'cancelled';
create index if not exists signups_event on public.signups (event_id, status, created_at);

-- ───────────────────────── helpers ─────────────────────────
-- MFA is mandatory for organizers: admin rights only exist on an aal2 session
-- (email code/link + authenticator app). An aal1 session sees only public data.
create or replace function public.has_mfa()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.is_club_admin(p_club text)
returns boolean language sql stable security definer set search_path = public as $$
  select has_mfa() and exists (select 1 from club_admins where club_id = p_club and user_id = auth.uid());
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.clubs       enable row level security;
alter table public.club_admins enable row level security;
alter table public.events      enable row level security;
alter table public.signups     enable row level security;

drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select using (true);
drop policy if exists clubs_admin_update on public.clubs;
create policy clubs_admin_update on public.clubs for update using (is_club_admin(id));

drop policy if exists admins_self on public.club_admins;
create policy admins_self on public.club_admins for select using (user_id = auth.uid() and has_mfa());

drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events for select using (published or is_club_admin(club_id));
drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events for all
  using (is_club_admin(club_id)) with check (is_club_admin(club_id));

drop policy if exists signups_admin_read on public.signups;
create policy signups_admin_read on public.signups for select
  using (exists (select 1 from events e where e.id = event_id and is_club_admin(e.club_id)));
drop policy if exists signups_admin_update on public.signups;
create policy signups_admin_update on public.signups for update
  using (exists (select 1 from events e where e.id = event_id and is_club_admin(e.club_id)));
-- No insert/delete policy for anon: public signups only go through sign_up().

-- ───────────────────────── public RPCs ─────────────────────────
-- Events in a window, with seat counts (no attendee data leaves the DB).
drop function if exists public.list_events(text, timestamptz, timestamptz);
create function public.list_events(p_club text, p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, club_id text, title text, kind text, description text, location text,
  starts_at timestamptz, ends_at timestamptz, capacity int, max_guests int, waitlist boolean,
  table_size int, gear_label text, ask_skill boolean, book_title text, book_author text, book_isbn text,
  seats_taken int, waitlist_count int, gear_count int
) language sql stable security definer set search_path = public as $$
  select e.id, e.club_id, e.title, e.kind, e.description, e.location,
         e.starts_at, e.ends_at, e.capacity, e.max_guests, e.waitlist,
         e.table_size, e.gear_label, e.ask_skill, e.book_title, e.book_author, e.book_isbn,
         coalesce(sum(1 + s.guests) filter (where s.status = 'confirmed'), 0)::int,
         count(s.id) filter (where s.status = 'waitlist')::int,
         count(s.id) filter (where s.status = 'confirmed' and s.brings_gear)::int
  from events e
  left join signups s on s.event_id = e.id
  where e.club_id = p_club and e.published
    and e.starts_at >= p_from and e.starts_at < p_to
  group by e.id
  order by e.starts_at;
$$;

drop function if exists public.sign_up(uuid, text, text, int, text);
create or replace function public.sign_up(
  p_event uuid, p_name text, p_email text, p_guests int default 0, p_note text default '',
  p_skill text default null, p_brings_gear boolean default false
) returns table (status text, cancel_token uuid, waitlist_position int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  ev      events%rowtype;
  taken   int;
  party   int := 1 + greatest(coalesce(p_guests, 0), 0);
  st      text;
  tok     uuid;
  pos     int := null;
begin
  select * into ev from events where id = p_event and published for update;   -- serialize per event
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if ev.starts_at < now() then raise exception 'EVENT_PAST'; end if;
  if coalesce(p_guests, 0) > ev.max_guests then raise exception 'TOO_MANY_GUESTS'; end if;
  if exists (select 1 from signups where event_id = p_event and lower(email) = lower(trim(p_email)) and signups.status <> 'cancelled') then
    raise exception 'ALREADY_SIGNED_UP';
  end if;

  select coalesce(sum(1 + guests), 0) into taken from signups where event_id = p_event and signups.status = 'confirmed';

  if ev.capacity is null or taken + party <= ev.capacity then
    st := 'confirmed';
  elsif ev.waitlist then
    st := 'waitlist';
  else
    raise exception 'EVENT_FULL';
  end if;

  insert into signups (event_id, name, email, guests, note, status, skill, brings_gear)
  values (p_event, trim(p_name), lower(trim(p_email)), coalesce(p_guests, 0), coalesce(p_note, ''), st,
          case when ev.ask_skill and p_skill in ('new','learning','experienced') then p_skill end,
          coalesce(p_brings_gear, false) and ev.gear_label is not null)
  returning signups.cancel_token into tok;

  if st = 'waitlist' then
    select count(*) into pos from signups where event_id = p_event and signups.status = 'waitlist';
  end if;
  return query select st, tok, pos;
end $$;

-- Promote waitlisted people (FIFO) while their whole party fits.
create or replace function public._promote_waitlist(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev events%rowtype; taken int; w record;
begin
  select * into ev from events where id = p_event for update;
  if ev.capacity is null then
    update signups set status = 'confirmed' where event_id = p_event and status = 'waitlist';
    return;
  end if;
  select coalesce(sum(1 + guests), 0) into taken from signups where event_id = p_event and status = 'confirmed';
  for w in select id, guests from signups where event_id = p_event and status = 'waitlist' order by created_at loop
    exit when taken + 1 + w.guests > ev.capacity;
    update signups set status = 'confirmed' where id = w.id;
    taken := taken + 1 + w.guests;
  end loop;
end $$;

create or replace function public.cancel_signup(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s signups%rowtype;
begin
  select * into s from signups where cancel_token = p_token for update;
  if not found then raise exception 'SIGNUP_NOT_FOUND'; end if;
  if s.status = 'cancelled' then return 'cancelled'; end if;
  update signups set status = 'cancelled' where id = s.id;
  perform _promote_waitlist(s.event_id);
  return 'cancelled';
end $$;

-- Admin cancel from roster also promotes the waitlist.
create or replace function public.admin_cancel(p_signup uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s signups%rowtype; club text;
begin
  select * into s from signups where id = p_signup;
  select e.club_id into club from events e where e.id = s.event_id;
  if not is_club_admin(club) then raise exception 'NOT_ADMIN'; end if;
  update signups set status = 'cancelled' where id = p_signup;
  perform _promote_waitlist(s.event_id);
end $$;

-- Lock down. Postgres lets PUBLIC execute new functions by default (and Supabase also
-- grants anon/authenticated), so revoke everything, then grant back exactly what's needed.
revoke all on function public._promote_waitlist(uuid)                       from public, anon, authenticated;
revoke all on function public.sign_up(uuid, text, text, int, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_cancel(uuid)                            from public, anon;
grant execute on function public.list_events(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.cancel_signup(uuid)                        to anon, authenticated;
grant execute on function public.admin_cancel(uuid)                         to authenticated;
-- Public signups now go through the `signup` Edge Function (CAPTCHA + rate limit),
-- which calls sign_up() with the service role. Browsers can't call it directly.
grant execute on function public.sign_up(uuid, text, text, int, text, text, boolean) to service_role;

-- ───────────────────────── abuse controls ─────────────────────────
-- Fixed-window rate limiter used by the Edge Function (keyed on a salted hash of the IP).
create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;   -- no policies: service role only

create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_secs int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs); n int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  delete from rate_limits where window_start < now() - interval '1 day';
  return n <= p_limit;   -- true = allowed
end $$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- ───────────────────────── audit log ─────────────────────────
-- Who changed which event or signup, and when. Read it in the Table Editor.
create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor    uuid,                       -- auth user; null = public/system (signup, cancel link)
  aal      text,
  action   text not null,              -- INSERT | UPDATE | DELETE
  tbl      text not null,
  row_id   uuid,
  club_id  text,
  changes  jsonb
);
alter table public.audit_log enable row level security;
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (is_club_admin(club_id));

create or replace function public._audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); club text;
begin
  club := coalesce(r ->> 'club_id', (select e.club_id from events e where e.id = (r ->> 'event_id')::uuid));
  insert into audit_log (actor, aal, action, tbl, row_id, club_id, changes)
  values (auth.uid(), auth.jwt() ->> 'aal', tg_op, tg_table_name, (r ->> 'id')::uuid, club,
          case tg_op when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
                     else r end);
  return coalesce(new, old);
end $$;
revoke all on function public._audit() from public, anon, authenticated;
drop trigger if exists audit_events on public.events;
create trigger audit_events after insert or update or delete on public.events for each row execute function _audit();
drop trigger if exists audit_signups_change on public.signups;
create trigger audit_signups_change after update or delete on public.signups for each row execute function _audit();

-- ───────────────────────── email outbox ─────────────────────────
-- Every email is a row here first, then the send-outbox Edge Function delivers it.
-- If the mail provider is down, rows wait and are retried; nothing is lost or sent twice.
create table if not exists public.outbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('confirmed','waitlisted','promoted','reminder')),
  signup_id   uuid not null references public.signups(id) on delete cascade,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text,
  unique (signup_id, kind)
);
create index if not exists outbox_unsent on public.outbox (created_at) where sent_at is null;
alter table public.outbox enable row level security;   -- no policies: service role only

create or replace function public._enqueue_signup_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Restoring a backup must not re-email everyone: the restore session sets smud.restoring = on.
  if coalesce(current_setting('smud.restoring', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' and new.status in ('confirmed','waitlist') then
    insert into outbox (kind, signup_id)
    values (case new.status when 'confirmed' then 'confirmed' else 'waitlisted' end, new.id)
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'waitlist' and new.status = 'confirmed' then
    insert into outbox (kind, signup_id) values ('promoted', new.id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists signup_mail on public.signups;
create trigger signup_mail after insert or update of status on public.signups
  for each row execute function _enqueue_signup_mail();

-- Day-before reminders (12–36 h out) for people who signed up well in advance.
create or replace function public.enqueue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into outbox (kind, signup_id)
  select 'reminder', s.id from signups s join events e on e.id = s.event_id
  where s.status = 'confirmed' and e.published
    and e.starts_at between now() + interval '12 hours' and now() + interval '36 hours'
    and s.created_at < e.starts_at - interval '36 hours'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Claims up to p_limit unsent emails with everything needed to render them.
create or replace function public.claim_mail(p_limit int default 25)
returns table (
  outbox_id bigint, kind text, name text, email text, guests int, status text, cancel_token uuid, table_no int,
  event_id uuid, title text, starts_at timestamptz, ends_at timestamptz, location text, description text,
  book_title text, book_author text, club_id text, club_name text, club_email text, club_tz text
) language plpgsql security definer set search_path = public as $$
begin
  -- Drop mail that no longer makes sense (cancelled since it was queued, or the event already started).
  update outbox o set sent_at = now(), last_error = 'skipped'
  from signups s join events e on e.id = s.event_id
  where o.signup_id = s.id and o.sent_at is null
    and (s.status = 'cancelled' or e.starts_at < now()
         or (o.kind in ('confirmed','promoted','reminder') and s.status <> 'confirmed')
         or (o.kind = 'waitlisted' and s.status <> 'waitlist'));
  return query
  with c as (
    update outbox o set attempts = o.attempts + 1
    where o.id in (select id from outbox where sent_at is null and attempts < 6
                   order by created_at limit p_limit for update skip locked)
    returning o.id, o.kind, o.signup_id
  )
  select c.id, c.kind, s.name, s.email, s.guests, s.status, s.cancel_token, s.table_no,
         e.id, e.title, e.starts_at, e.ends_at, e.location, e.description, e.book_title, e.book_author,
         cl.id, cl.name, cl.contact_email, cl.timezone
  from c join signups s on s.id = c.signup_id join events e on e.id = s.event_id join clubs cl on cl.id = e.club_id;
end $$;

create or replace function public.mark_mail(p_id bigint, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update outbox set sent_at = case when p_error is null then now() end, last_error = p_error where id = p_id;
$$;

revoke all on function public._enqueue_signup_mail()  from public, anon, authenticated;
revoke all on function public.enqueue_reminders()     from public, anon, authenticated;
revoke all on function public.claim_mail(int)         from public, anon, authenticated;
revoke all on function public.mark_mail(bigint, text) from public, anon, authenticated;
grant execute on function public.enqueue_reminders()     to service_role;
grant execute on function public.claim_mail(int)         to service_role;
grant execute on function public.mark_mail(bigint, text) to service_role;

-- The ical Edge Function looks up the club name with the service role.
grant select (id, name) on public.clubs to service_role;

-- Table privileges for browser roles. RLS policies decide rows, but the roles also need
-- table/column grants (Supabase no longer grants these automatically).
-- Public visitors never read clubs.contact_email; the app selects explicit columns.
grant select (id, name, tagline, accent, timezone, created_at) on public.clubs to anon;
grant select, update on public.clubs to authenticated;
grant select on public.events to anon;
grant select, insert, update, delete on public.events to authenticated;
grant select on public.signups to authenticated;
grant update (table_no, checked_in_at) on public.signups to authenticated;
grant select on public.club_admins to authenticated;
grant select on public.audit_log to authenticated;

-- Attendees can see their table number on their manage page.
drop function if exists public.lookup_signup(uuid);
create function public.lookup_signup(p_token uuid)
returns table (name text, status text, guests int, table_no int, event_id uuid, title text, starts_at timestamptz, location text, club_id text)
language sql stable security definer set search_path = public as $$
  select s.name, s.status, s.guests, s.table_no, e.id, e.title, e.starts_at, e.location, e.club_id
  from signups s join events e on e.id = s.event_id where s.cancel_token = p_token;
$$;
grant execute on function public.lookup_signup(uuid) to anon, authenticated;

-- Tiny function the GitHub Action pings so the free project doesn't auto-pause.
create or replace function public.ping() returns text language sql stable as $$ select 'pong'::text $$;
grant execute on function public.ping() to anon;

-- ───────────────────────── seed ─────────────────────────
insert into public.clubs (id, name, tagline, accent)
values ('518analog', '518 Analog Club', 'Books, tiles, trivia & crafts — offline in the Capital Region', '#2f6b4f')
on conflict (id) do nothing;

-- Organizers are created by you, never by self-signup:
--   1. Dashboard → Authentication → Users → Add user → "Send invitation" (or "Create new user").
--   2. Then link them to a club:
--   insert into public.club_admins (club_id, user_id)
--   select '518analog', id from auth.users where email = 'ORGANIZER-EMAIL';
--   3. On first sign-in they're required to set up an authenticator app.
