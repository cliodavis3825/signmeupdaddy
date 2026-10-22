// App shell: hash router, theme toggle, focus management.
import * as store from './store.js';
import { icon, logoMark } from './components.js';
import { html, readLocal, writeLocal, randomJoke } from './util.js';
import { landingView } from './views/landing.js';
import { builderView } from './views/builder.js';
import { sheetView } from './views/sheet.js';
import { manageView } from './views/manage.js';
import { doneView, editView } from './views/participant.js';
import { groupsHomeView, groupBuilderView } from './views/groups.js';
import { groupView, eventView } from './views/group.js';
import { groupManageView } from './views/groupManage.js';
import { notFound } from './views/notfound.js';

const ROUTES = [
  [/^\/?$/, () => landingView, () => ({}), 'home'],
  [/^\/mine$/, () => landingView, () => ({ scrollTo: 'mine' }), 'mine'],
  [/^\/new$/, () => builderView, () => ({}), 'new'],
  [/^\/new\/([\w-]+)$/, () => builderView, (m) => ({ template: m[1] }), 'new'],
  [/^\/s\/([\w-]+)$/, () => sheetView, (m) => ({ id: m[1] })],
  [/^\/s\/([\w-]+)\/manage$/, () => manageView, (m) => ({ id: m[1] }), 'mine'],
  [/^\/done\/([\w-]+)$/, () => doneView, (m) => ({ token: m[1] })],
  [/^\/edit\/([\w-]+)$/, () => editView, (m) => ({ token: m[1] })],
  [/^\/groups$/, () => groupsHomeView, () => ({}), 'groups'],
  [/^\/groups\/new$/, () => groupBuilderView, () => ({}), 'groups'],
  [/^\/groups\/new\/from\/([\w-]+)$/, () => groupBuilderView, (m) => ({ fromSheet: m[1] }), 'groups'],
  [/^\/g\/([\w-]+)$/, () => groupView, (m) => ({ id: m[1] }), 'groups'],
  [/^\/g\/([\w-]+)\/manage$/, () => groupManageView, (m) => ({ id: m[1] }), 'groups'],
  [/^\/g\/([\w-]+)\/e\/([\w-]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/, () => eventView, (m) => ({ id: m[1], eventId: m[2], date: m[3] || '' }), 'groups'],
];

const app = document.getElementById('app');
let cleanup = null;
let navToken = 0;

function currentPath() {
  const h = location.hash || '#/';
  if (!h.startsWith('#/')) return null;
  let p = h.slice(1).split('?')[0];
  try { p = decodeURI(p); } catch { /* keep raw */ }
  return p.replace(/\/+$/, '') || '/';
}

async function route() {
  const path = currentPath();
  if (path === null) return; // in-page anchors (none expected)
  const token = ++navToken;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());

  const root = document.createElement('div');
  root.className = 'view';
  app.replaceChildren(root);

  let navKey = '';
  let result;
  try {
    const hit = ROUTES.find(([re]) => re.test(path));
    if (!hit) {
      notFound(root);
    } else {
      const [re, view, params, key] = hit;
      navKey = key || '';
      result = await view()(root, params(path.match(re)));
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = html`<div class="container narrow center-page"><h1 tabindex="-1">Well, that's embarrassing.</h1>
      <p class="lede">Something broke. Try refreshing. (${e.message || 'Unknown error'})</p><a class="btn btn-primary" href="#/">Home</a></div>`.s;
  }
  if (token !== navToken) { result?.cleanup?.(); return; }
  cleanup = result?.cleanup || null;

  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  if (!result?.skipFocus) {
    window.scrollTo(0, 0);
    const h = root.querySelector('h1');
    if (h) {
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }
}

/* ---------- Theme ---------- */
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  btn.innerHTML = (dark ? icon('sun') : icon('moon')).s;
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17110d' : '#fff8ef');
}

function initChrome() {
  document.getElementById('logo-slot').innerHTML = logoMark().s;
  document.getElementById('nav-new-icon').innerHTML = icon('plus').s;
  document.getElementById('footer-joke').textContent = randomJoke();
  const saved = readLocal('smud:theme', null);
  applyTheme(saved);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    writeLocal('smud:theme', next);
    applyTheme(next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(readLocal('smud:theme', null)));
  document.querySelector('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    const main = document.getElementById('app');
    main.focus();
  });
  if (!store.isPersistent()) {
    const b = document.getElementById('storage-banner');
    if (b) b.hidden = false;
  }
}

store.init();
initChrome();
window.addEventListener('hashchange', route);
route();
