const TOKEN_KEY = 'sw_token';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

export const state = {
  user: null,         // { id, email, role }
  monitoringStatus: null,
  weatherCurrent: null,
  weatherForecast: null,
  weatherRealtime: null,
};

export function isAdmin() { return state.user?.role === 'admin'; }
