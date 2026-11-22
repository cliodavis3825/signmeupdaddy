#!/usr/bin/env node
// signmeupdaddy smoke test. Read-only: sends no email and creates no data.
//   node scripts/smoke-test.mjs                 # uses assets/config.js from this repo
//   CRON_SECRET=... node scripts/smoke-test.mjs # also checks send-outbox accepts the real secret
//   SITE=https://signmeupdaddy.com CLUB=518analog node scripts/smoke-test.mjs
// Needs Node 18+. No dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfgSrc = readFileSync(join(root, 'assets/config.js'), 'utf8');
const cfg = (k) => (cfgSrc.match(new RegExp(`${k}:\\s*'([^']*)'`)) || [])[1] || '';
const SITE = (process.env.SITE || cfg('SITE_URL') || 'https://signmeupdaddy.com').replace(/\/$/, '');
const URL_ = cfg('SUPABASE_URL').replace(/\/$/, '');
const KEY = cfg('SUPABASE_ANON_KEY');
const CLUB = process.env.CLUB || cfg('DEFAULT_CLUB') || '518analog';
const CRON = process.env.CRON_SECRET || '';

const rows = [];
let failed = 0;
async function check(name, fn) {
  try {
    const r = await fn();
    const ok = r === true || r === undefined;
    rows.push([ok ? 'PASS' : 'FAIL', name, ok ? '' : String(r)]);
    if (!ok) failed++;
  } catch (e) {
    rows.push(['FAIL', name, e.message]); failed++;
  }
}
const skip = (name, why) => rows.push(['SKIP', name, why]);
const expect = (cond, detail) => (cond ? true : detail);

const rest = (path, init = {}) => fetch(`${URL_}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});
const fn = (name, init = {}) => fetch(`${URL_}/functions/v1/${name}`, init);
const fnAnon = (name, body, origin = SITE) => fn(name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify(body),
});

// ── 1. Site ──────────────────────────────────────────────────────────────
await check('site: home page loads', async () => {
  const r = await fetch(SITE + '/'); return expect(r.ok, `HTTP ${r.status}`);
});
await check('site: live config (not demo mode)', async () => expect(URL_ && KEY, 'SUPABASE_URL / anon key blank in assets/config.js'));
await check('site: Turnstile site key set', async () => expect(cfg('TURNSTILE_SITE_KEY').startsWith('0x'), 'TURNSTILE_SITE_KEY missing'));
await check('site: /518analog/ homepage loads', async () => {
  const r = await fetch(SITE + '/518analog/'); return expect(r.ok, `HTTP ${r.status}`);
});
await check('site: logo + favicon load', async () => {
  for (const p of ['/assets/img/logo-sm.png', '/assets/img/favicon.png', '/assets/img/og-image.png']) {
    const r = await fetch(SITE + p); if (!r.ok) return `${p} HTTP ${r.status}`;
  }
  return true;
});
await check('site: served config matches repo', async () => {
  const t = await (await fetch(SITE + '/assets/config.js')).text();
  return expect(t.includes(URL_), 'live config.js has a different SUPABASE_URL than the repo');
});

if (!URL_) { console.log('No SUPABASE_URL; stopping after site checks.'); }
else {
  // ── 2. Public data the site needs ─────────────────────────────────────
  await check('db: anon can list events (RPC)', async () => {
    const r = await rest('rpc/list_events', { method: 'POST', body: JSON.stringify({ p_club: CLUB, p_from: '2000-01-01', p_to: '2100-01-01' }) });
    const j = await r.json(); return expect(r.ok && Array.isArray(j), `HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  });
  await check('db: anon can read public club fields', async () => {
    const r = await rest(`clubs?select=id,name,tagline,accent,timezone&id=eq.${CLUB}`);
    const j = await r.json(); return expect(r.ok && j.length === 1, `HTTP ${r.status} rows=${Array.isArray(j) ? j.length : '?'} (club "${CLUB}" exists?)`);
  });

  // ── 3. Things anon must NOT be able to do ─────────────────────────────
  const denied = (r, j) => r.status === 401 || r.status === 403 || (r.ok && Array.isArray(j) && j.length === 0);
  await check('security: anon cannot read clubs.contact_email', async () => {
    const r = await rest('clubs?select=contact_email'); const j = await r.json();
    return expect(!r.ok, `HTTP ${r.status}: contact_email is readable by the public`);
  });
  for (const t of ['signups', 'club_admins', 'audit_log', 'outbox', 'rate_limits']) {
    await check(`security: anon cannot read ${t}`, async () => {
      const r = await rest(`${t}?select=*&limit=1`); const j = await r.json().catch(() => []);
      return expect(denied(r, j), `HTTP ${r.status}, returned data`);
    });
  }
  await check('security: anon cannot write events', async () => {
    const r = await rest('events', { method: 'POST', body: JSON.stringify({ club_id: CLUB, title: 'smoke-test-should-fail' }) });
    return expect(!r.ok, `HTTP ${r.status}: anon insert into events succeeded!`);
  });
  const uuid0 = '00000000-0000-4000-8000-000000000000';
  for (const [name, body] of [
    ['sign_up', { p_event: uuid0, p_name: 'x', p_email: 'x@example.com', p_guests: 0, p_note: '', p_skill: null, p_brings_gear: false }],
    ['claim_mail', { p_limit: 1 }],
    ['enqueue_reminders', {}],
    ['hit_rate_limit', { p_key: 'smoke', p_limit: 1, p_window_secs: 60 }],
    ['admin_cancel', { p_signup: uuid0 }],
  ]) {
    await check(`security: anon cannot call ${name}()`, async () => {
      const r = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
      return expect(!r.ok, `HTTP ${r.status}: function is callable by the public`);
    });
  }

  // ── 4. Auth settings (no email is sent) ───────────────────────────────
  await check('auth: public signups are disabled', async () => {
    const s = await (await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } })).json();
    return expect(s.disable_signup === true, `disable_signup=${s.disable_signup}`);
  });
  await check('auth: email login enabled', async () => {
    const s = await (await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } })).json();
    return expect(s.external?.email === true, 'email provider off');
  });
  await check('auth: sign-in requires CAPTCHA', async () => {
    const r = await fetch(`${URL_}/auth/v1/otp`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-smoke-test@example.invalid', create_user: false }),
    });
    const t = await r.text(); return expect(r.status === 400 && /captcha/i.test(t), `HTTP ${r.status} ${t.slice(0, 120)}`);
  });

  // ── 5. signup function guards ─────────────────────────────────────────
  const good = { event_id: uuid0.replace(/^0000/, 'abcd'), name: 'Smoke Test', email: 'smoke@example.invalid', guests: 0, captcha: 'x', elapsed_ms: 6000, website: '' };
  await check('signup fn: wrong origin rejected', async () => {
    const r = await fnAnon('signup', good, 'https://evil.example'); return expect(r.status === 403, `HTTP ${r.status}`);
  });
  await check('signup fn: honeypot rejected', async () => {
    const r = await fnAnon('signup', { ...good, website: 'spam' }); const j = await r.json();
    return expect(r.status === 400 && j.error === 'BOT_SUSPECTED', `HTTP ${r.status} ${JSON.stringify(j)}`);
  });
  await check('signup fn: too-fast form rejected', async () => {
    const r = await fnAnon('signup', { ...good, elapsed_ms: 100 }); const j = await r.json();
    return expect(r.status === 400 && j.error === 'BOT_SUSPECTED', `HTTP ${r.status} ${JSON.stringify(j)}`);
  });
  await check('signup fn: bad input rejected', async () => {
    const r = await fnAnon('signup', { ...good, email: 'not-an-email' }); const j = await r.json();
    return expect(r.status === 400 && j.error === 'BAD_REQUEST', `HTTP ${r.status} ${JSON.stringify(j)}`);
  });
  await check('signup fn: fake CAPTCHA token rejected (Turnstile secret works)', async () => {
    const r = await fnAnon('signup', good); const j = await r.json();
    return expect(r.status === 400 && j.error === 'CAPTCHA_FAILED', `HTTP ${r.status} ${JSON.stringify(j)} (CAPTCHA_NOT_CONFIGURED = TURNSTILE_SECRET missing)`);
  });

  // ── 6. send-outbox auth ───────────────────────────────────────────────
  await check('send-outbox: rejects missing secret', async () => {
    const r = await fn('send-outbox', { method: 'POST' }); return expect(r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  });
  await check('send-outbox: rejects wrong secret', async () => {
    const r = await fn('send-outbox', { method: 'POST', headers: { 'x-cron-secret': 'wrong-secret-smoke-test' } });
    return expect(r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  });
  if (CRON) {
    await check('send-outbox: accepts real CRON_SECRET', async () => {
      const r = await fn('send-outbox', { method: 'POST', headers: { 'x-cron-secret': CRON } });
      return expect(r.ok, `HTTP ${r.status}`);
    });
  } else skip('send-outbox: accepts real CRON_SECRET', 'set CRON_SECRET env var to run (may send queued mail)');

  // ── 7. iCal feed ──────────────────────────────────────────────────────
  await check('ical: club feed is valid', async () => {
    const r = await fn('ical?club=' + CLUB); const t = await r.text();
    return expect(r.ok && t.startsWith('BEGIN:VCALENDAR') && t.includes('END:VCALENDAR'), `HTTP ${r.status} ${t.slice(0, 80)}`);
  });
  await check('ical: unknown club is a 404', async () => {
    const r = await fn('ical?club=no-such-club-smoke'); return expect(r.status === 404, `HTTP ${r.status}`);
  });

  // ── 8. Cancel links ───────────────────────────────────────────────────
  await check('cancel link: random token gives no data and no crash', async () => {
    const r = await rest('rpc/lookup_signup', { method: 'POST', body: JSON.stringify({ p_token: uuid0 }) });
    const j = await r.json().catch(() => null);
    return expect(r.ok && (j === null || (Array.isArray(j) && j.length === 0)), `HTTP ${r.status} ${JSON.stringify(j).slice(0, 100)}`);
  });
}

// ── Report ──────────────────────────────────────────────────────────────
const w = Math.max(...rows.map((r) => r[1].length));
for (const [s, n, d] of rows) console.log(`${s.padEnd(4)}  ${n.padEnd(w)}${d ? '  ← ' + d : ''}`);
const pass = rows.filter((r) => r[0] === 'PASS').length, sk = rows.filter((r) => r[0] === 'SKIP').length;
console.log(`\n${pass} passed, ${failed} failed, ${sk} skipped`);
process.exit(failed ? 1 : 0);
