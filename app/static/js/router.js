import { renderLogin } from './pages/login.js';
import { renderSetup } from './pages/setup.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderSettings } from './pages/settings.js';
import { renderEvents } from './pages/events.js';
import { renderWorkflows } from './pages/workflows.js';
import { renderUsers } from './pages/users.js';
import { renderHelp } from './pages/help.js';
import { getToken, state, isAdmin } from './state.js';
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

  // Fetch current user info if authenticated and not cached
  if (getToken() && !state.user) {
    try {
      state.user = await apiGet('/auth/me');
    } catch {}
  }

  navbar.style.display = getToken() ? '' : 'none';

  // Show station callsign in navbar
  const callsignEl = document.getElementById('nav-callsign');
  if (callsignEl) {
    if (getToken()) {
      try {
        const loc = await apiGet('/settings/location');
        callsignEl.textContent = loc.callsign ? loc.callsign.replace(/0/g, 'Ø') + ' — ' : '';
      } catch { /* ignore */ }
    } else {
      callsignEl.textContent = '';
    }
  }

  // Show/hide admin-only nav items
  const usersNavLink = document.getElementById('nav-users');
  if (usersNavLink) usersNavLink.style.display = isAdmin() ? '' : 'none';
  const workflowsNavLink = document.getElementById('nav-workflows');
  if (workflowsNavLink) workflowsNavLink.style.display = isAdmin() ? '' : 'none';
  const roleIndicator = document.getElementById('nav-role-indicator');
  if (roleIndicator && state.user) {
    roleIndicator.textContent = isAdmin() ? 'Admin' : 'Read Only';
    roleIndicator.className = `badge rounded-pill ${isAdmin() ? 'bg-success' : 'bg-danger'}`;
    roleIndicator.style.display = '';
  }

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
  } else if (hash === '#/workflows') {
    if (!isAdmin()) {
      window.location.hash = '#/dashboard';
      return;
    }
    await renderWorkflows(app);
  } else if (hash === '#/users') {
    if (!isAdmin()) {
      window.location.hash = '#/dashboard';
      return;
    }
    await renderUsers(app);
  } else if (hash === '#/help') {
    renderHelp(app);
  } else {
    app.innerHTML = '<div class="text-center mt-5"><h3>Page not found</h3><a href="#/dashboard">Go home</a></div>';
  }
}
