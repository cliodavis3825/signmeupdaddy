// Delivers queued emails and queues day-before reminders. Called every 15 minutes by
// .github/workflows/notify.yml with the CRON_SECRET header (not a user JWT; see config.toml).
// Secrets: RESEND_API_KEY, MAIL_FROM ("518 Analog Club <hello@yourdomain>"), CRON_SECRET, SITE_URL.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { drainOutbox } from '../_shared/mailer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SECRET = Deno.env.get('CRON_SECRET') ?? '';

function same(a: string, b: string) {          // constant-time compare
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !same(req.headers.get('x-cron-secret') ?? '', SECRET)) return new Response('Forbidden', { status: 403 });
  const { data: queued, error } = await db.rpc('enqueue_reminders');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const result = await drainOutbox(db, 50);
  return Response.json({ reminders_queued: queued, ...result });
});
