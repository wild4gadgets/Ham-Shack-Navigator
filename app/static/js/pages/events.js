import { apiGet } from '../api.js';

let currentPage = 1;
const PAGE_SIZE = 50;

export async function renderEvents(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-clock-history me-2"></i>Event Log</span>
        <div class="d-flex gap-2">
          <select id="filter-type" class="form-select form-select-sm" style="width:auto">
            <option value="">All Types</option>
            <option>shutdown_triggered</option>
            <option>wind_alert</option>
            <option>lightning_alert</option>
            <option>weather_alert</option>
            <option>weather_data</option>
            <option>email_sent</option>
            <option>kasa_action</option>
            <option>monitoring_armed</option>
            <option>monitoring_disarmed</option>
            <option>error</option>
            <option>info</option>
          </select>
          <select id="filter-severity" class="form-select form-select-sm" style="width:auto">
            <option value="">All Severities</option>
            <option>info</option>
            <option>warning</option>
            <option>critical</option>
          </select>
          <button id="btn-refresh-events" class="btn btn-sm btn-outline-secondary" title="Refresh"><i class="bi bi-arrow-clockwise"></i></button>
        </div>
      </div>
      <div class="card-body p-0">
        <div id="events-table-container">
          <div class="text-center text-muted p-4">Loading...</div>
        </div>
        <div id="events-pagination" class="d-flex justify-content-center p-3"></div>
      </div>
    </div>
  `;

  await loadEvents(1);

  document.getElementById('filter-type').addEventListener('change', () => loadEvents(1));
  document.getElementById('filter-severity').addEventListener('change', () => loadEvents(1));
  document.getElementById('btn-refresh-events').addEventListener('click', () => loadEvents(currentPage));
}

async function loadEvents(page) {
  currentPage = page;
  const type = document.getElementById('filter-type')?.value || '';
  const severity = document.getElementById('filter-severity')?.value || '';

  let query = `/events?page=${page}&page_size=${PAGE_SIZE}`;
  if (type) query += `&event_type=${encodeURIComponent(type)}`;
  if (severity) query += `&severity=${encodeURIComponent(severity)}`;

  try {
    const result = await apiGet(query);
    renderTable(result);
    renderPagination(result);
  } catch (e) {
    const c = document.getElementById('events-table-container');
    if (c) c.innerHTML = `<div class="alert alert-danger m-3">Failed to load events: ${e.message}</div>`;
  }
}

function renderTable(result) {
  const container = document.getElementById('events-table-container');
  if (!container) return;

  if (!result.items?.length) {
    container.innerHTML = '<div class="text-center text-muted p-4">No events found</div>';
    return;
  }

  const severityClass = { info: 'badge-info', warning: 'badge-warning', critical: 'badge-critical' };

  container.innerHTML = `
    <table class="table table-dark table-sm table-hover mb-0">
      <thead class="sticky-top">
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Message</th>
          <th>Metadata</th>
        </tr>
      </thead>
      <tbody>
        ${result.items.map(ev => `
          <tr>
            <td><small>${new Date(ev.created_at.slice(0, 19) + 'Z').toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })}</small></td>
            <td><small class="font-monospace">${ev.event_type}</small></td>
            <td><span class="badge ${severityClass[ev.severity] || 'bg-secondary'}">${ev.severity}</span></td>
            <td><small>${ev.message}</small></td>
            <td><small class="text-muted">${ev.meta ? JSON.stringify(JSON.parse(ev.meta)).substring(0, 80) : ''}</small></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="p-2 text-muted text-end"><small>Total: ${result.total} events</small></div>
  `;
}

function renderPagination(result) {
  const container = document.getElementById('events-pagination');
  if (!container || result.pages <= 1) { if (container) container.innerHTML = ''; return; }

  const pages = result.pages;
  const cur = result.page;

  let items = '';
  items += `<li class="page-item ${cur === 1 ? 'disabled' : ''}">
    <a class="page-link" href="#" data-page="${cur - 1}">&laquo;</a></li>`;

  for (let p = Math.max(1, cur - 2); p <= Math.min(pages, cur + 2); p++) {
    items += `<li class="page-item ${p === cur ? 'active' : ''}">
      <a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
  }

  items += `<li class="page-item ${cur === pages ? 'disabled' : ''}">
    <a class="page-link" href="#" data-page="${cur + 1}">&raquo;</a></li>`;

  container.innerHTML = `<ul class="pagination pagination-sm mb-0">${items}</ul>`;
  container.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const p = parseInt(el.dataset.page);
      if (p >= 1 && p <= pages) loadEvents(p);
    });
  });
}
