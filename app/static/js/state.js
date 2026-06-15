const TOKEN_KEY = 'sw_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export const state = {
  user: null,         // { id, email, role }
  monitoringStatus: null,
  weatherCurrent: null,
  weatherForecast: null,
  weatherRealtime: null,
};

export function isAdmin() { return state.user?.role === 'admin'; }
