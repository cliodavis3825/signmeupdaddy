// signmeupdaddy configuration.
// Leave SUPABASE_URL empty to run in DEMO MODE (data lives in this browser only).
// The anon key is designed to be public; Row Level Security in schema.sql protects the data.
export const CONFIG = {
  SUPABASE_URL: '',            // e.g. 'https://abcd1234.supabase.co'
  SUPABASE_ANON_KEY: '',       // Project Settings → API → anon public key
  // Cloudflare Turnstile site key (public). Leave blank in demo mode.
  // Same widget/key is used for organizer sign-in (Supabase Auth CAPTCHA) and public signups.
  TURNSTILE_SITE_KEY: '',
  ORGANIZER_IDLE_MINUTES: 30,
  SITE_URL: 'https://signmeupdaddy.com',
  DEFAULT_CLUB: '518analog',
  TIMEZONE: 'America/New_York',
};
