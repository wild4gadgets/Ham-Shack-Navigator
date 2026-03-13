import { getToken, clearToken } from './state.js';

const BASE = '/api/v1';

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(BASE + path, { ...options, headers });

  if (resp.status === 401) {
    clearToken();
    window.location.hash = '#/login';
    throw new Error('Unauthorized');
  }

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

export function apiGet(path) { return apiFetch(path); }
export function apiPost(path, data) { return apiFetch(path, { method: 'POST', body: JSON.stringify(data) }); }
export function apiPut(path, data) { return apiFetch(path, { method: 'PUT', body: JSON.stringify(data) }); }
export function apiPatch(path, data) { return apiFetch(path, { method: 'PATCH', body: JSON.stringify(data) }); }
export function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }
