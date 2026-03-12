import { navigate } from './router.js';
import { clearToken, getToken } from './state.js';

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  window.location.hash = '#/login';
});

// Hash routing
window.addEventListener('hashchange', () => navigate());
window.addEventListener('load', () => navigate());

// Initial navigation
navigate();
