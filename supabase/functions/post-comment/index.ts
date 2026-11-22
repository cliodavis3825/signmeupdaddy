// Public comment on an event page. Origin allowlist, honeypot, Turnstile, rate limit. Organizers can hide any comment.
import { cors, check, db, UUID } from '../_shared/guard.ts';

Deno.serve(async (req) => {
  const { ok, reply } = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req).headers });
  if (req.method !== 'POST') return reply(405, { error: 'BAD_REQUEST' });
  if (!ok) return reply(403, { error: 'BAD_ORIGIN' });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: 'BAD_REQUEST' }); }
  const event_id = String(b.event_id ?? '');
  const name = String(b.name ?? '').trim();
  const body = String(b.body ?? '').trim();
  if (!UUID.test(event_id) || !name || name.length > 60 || !body || body.length > 1000) return reply(400, { error: 'BAD_REQUEST' });

  const bad = await check(req, b, 'comment', 3000, 10, 3600);
  if (bad) return reply(bad.status, { error: bad.code });

  const { data: e } = await db.from('events').select('id, published, starts_at').eq('id', event_id).maybeSingle();
  if (!e || !e.published) return reply(404, { error: 'EVENT_NOT_FOUND' });
  if (new Date(e.starts_at).getTime() < Date.now() - 30 * 864e5) return reply(409, { error: 'EVENT_PAST' });

  // Public pages show "First L." only, so that is all we keep for the public author name.
  const w = name.split(/\s+/).filter(Boolean);
  const shown = w.length > 1 ? `${w[0].slice(0, 30)} ${w[w.length - 1][0].toUpperCase()}.` : (w[0] ?? 'Guest').slice(0, 30);
  const { error } = await db.from('event_posts').insert({ event_id, kind: 'comment', author_name: shown, body });
  if (error) return reply(500, { error: 'SERVER' });
  return reply(200, { ok: true });
});
