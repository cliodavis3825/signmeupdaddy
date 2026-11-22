// Old links (emails, calendar feeds, embeds) point at "/?club=…#/e/…" or "/#/admin".
// The calendar app now lives at /app/, so forward anything that carries a route or club parameter.
if (location.hash.length > 2 || /[?&](club|embed)=/.test(location.search)) {
  location.replace('/app/' + location.search + location.hash);
}
