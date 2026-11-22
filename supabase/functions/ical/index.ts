// Subscribable club calendar: GET /functions/v1/ical?club=518analog
// Calendar apps poll this URL; members follow the club once instead of adding events one by one.
// Public data only (titles, times, places, spots left). Deploy with --no-verify-jwt (see config.toml).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { vcalendar } from '../_shared/ics.ts';

const SITE = Deno.env.get('SITE_URL') ?? 'https://signmeupdaddy.com';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const club = (url.searchParams.get('club') ?? '').toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(club)) return new Response('Unknown club', { status: 400 });

  const { data: c } = await db.from('clubs').select('id, name').eq('id', club).maybeSingle();
  if (!c) return new Response('Unknown club', { status: 404 });

  const from = new Date(Date.now() - 30 * 864e5).toISOString();
  const to = new Date(Date.now() + 365 * 864e5).toISOString();
  const { data: events, error } = await db.rpc('list_events', { p_club: club, p_from: from, p_to: to });
  if (error) return new Response('Error', { status: 500 });

  const body = vcalendar((events ?? []).map((e: Record<string, any>) => {
    const left = e.capacity == null ? null : Math.max(e.capacity - e.seats_taken, 0);
    const spots = left == null ? 'Open seating.' : left === 0 ? 'Full — waitlist open on the event page.' : `${left} of ${e.capacity} spots left.`;
    const book = e.book_title ? `Reading: ${e.book_title}${e.book_author ? ` by ${e.book_author}` : ''}\n` : '';
    return {
      id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location,
      description: `${book}${e.description ?? ''}\n\n${spots} Sign up: `,
      url: `${SITE}/?club=${club}#/e/${e.id}`,
    };
  }), c.name);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${club}.ics"`,
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
