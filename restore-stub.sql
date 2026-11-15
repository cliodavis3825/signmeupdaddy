-- Used only by the backup restore test: stands in for the parts of Supabase that
-- schema.sql references, so it can run on plain Postgres.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
grant usage on schema auth to anon, authenticated;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
