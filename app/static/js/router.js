import { renderLogin } from './pages/login.js';
import { renderSetup } from './pages/setup.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderSettings } from './pages/settings.js';
import { renderEvents } from './pages/events.js';
import { getToken } from './state.js';
import { apiGet } from './api.js';

const app = document.getElementById('app');
const navbar = document.getElementById('navbar');

let currentCleanup = null;

export async function navigate(forceHash) {
  const hash = forceHash || window.location.hash || '#/dashboard';

  // Run cleanup for previous page
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  // Always check setup first (no auth required)
  try {
    const resp = await fetch('/api/v1/setup/status');
    const status = resp.ok ? await resp.json() : { needs_setup: false };
    if (status.needs_setup) {
      navbar.style.display = 'none';
      app.innerHTML = '';
      renderSetup(app);
      return;
    }
  } catch {}

  // Auth check for protected routes
  const publicRoutes = ['#/login', '#/setup'];
  if (!publicRoutes.includes(hash) && !getToken()) {
    window.location.hash = '#/login';
    return;
  }

  navbar.style.display = getToken() ? '' : 'none';

  app.innerHTML = '';

  if (hash === '#/login') {
    navbar.style.display = 'none';
    renderLogin(app);
  } else if (hash === '#/setup') {
    navbar.style.display = 'none';
    renderSetup(app);
  } else if (hash === '#/dashboard' || hash === '#/' || hash === '') {
    currentCleanup = await renderDashboard(app);
  } else if (hash.startsWith('#/settings')) {
    renderSettings(app);
  } else if (hash === '#/events') {
    await renderEvents(app);
  } else {
    app.innerHTML = '<div class="text-center mt-5"><h3>Page not found</h3><a href="#/dashboard">Go home</a></div>';
  }
}
