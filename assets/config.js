// signmeupdaddy configuration.
// Leave SUPABASE_URL empty to run in DEMO MODE (data lives in this browser only).
// The anon key is designed to be public; Row Level Security in schema.sql protects the data.
export const CONFIG = {
  SUPABASE_URL: 'https://hlglqwhjxkbusysyeofm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZ2xxd2hqeGtidXN5c3llb2ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNzAxMTMsImV4cCI6MjExMDk0NjExM30.ThdwyRD1Zjd7xF84V55sPKIRURmrXNlkQpSb3MGi8MA', // public anon key (RLS protects the data)
  // Cloudflare Turnstile site key (public). Leave blank in demo mode.
  // Same widget/key is used for organizer sign-in (Supabase Auth CAPTCHA) and public signups.
  TURNSTILE_SITE_KEY: '',
  ORGANIZER_IDLE_MINUTES: 30,
  SITE_URL: 'https://signmeupdaddy.com',
  DEFAULT_CLUB: '518analog',
  TIMEZONE: 'America/New_York',
};
