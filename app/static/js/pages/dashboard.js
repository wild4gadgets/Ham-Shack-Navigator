import { apiGet, apiPost } from '../api.js';
import { getToken, state } from '../state.js';

let ws = null;
let pingInterval = null;
let destroyed = false;

export async function renderDashboard(container) {
  destroyed = false;
  container.innerHTML = `
    <div class="row g-3">
      <!-- Monitoring Control -->
      <div class="col-12">
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-shield-check me-2"></i>Monitoring</span>
            <div class="d-flex gap-2">
              <button id="btn-enable" class="btn btn-sm btn-success">Enable</button>
              <button id="btn-disable" class="btn btn-sm btn-warning">Disable</button>
              <button id="btn-trigger" class="btn btn-sm btn-danger">Manual Trigger</button>
              <button id="btn-refresh" class="btn btn-sm btn-outline-light">
                <i class="bi bi-arrow-clockwise"></i> Refresh
              </button>
            </div>
          </div>
          <div class="card-body" id="monitoring-status-area">
            <div class="text-muted">Loading...</div>
          </div>
        </div>
      </div>

      <!-- Weather Cards -->
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-wind me-2"></i>Wind</div>
          <div class="card-body text-center" id="wind-card">
            <div class="weather-value" id="wind-speed">--</div>
            <div class="weather-unit">mph</div>
            <div class="mt-2 text-muted" id="wind-gust"></div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-thermometer-half me-2"></i>Temperature</div>
          <div class="card-body text-center" id="temp-card">
            <div class="weather-value" id="temp-value">--</div>
            <div class="weather-unit">°F</div>
            <div class="mt-2 text-muted" id="temp-desc"></div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-lightning-charge me-2"></i>Lightning</div>
          <div class="card-body text-center" id="lightning-card">
            <div class="weather-value" id="lightning-value">--</div>
            <div class="weather-unit">miles</div>
            <div class="mt-2 text-muted" id="lightning-desc"></div>
          </div>
        </div>
      </div>

      <!-- Alerts -->
      <div class="col-12" id="alerts-area"></div>

      <!-- Recent Events -->
      <div class="col-12">
        <div class="card">
          <div class="card-header d-flex justify-content-between">
            <span><i class="bi bi-clock-history me-2"></i>Recent Events</span>
            <a href="#/events" class="btn btn-sm btn-outline-light">View All</a>
          </div>
          <div class="card-body p-0">
            <div id="recent-events-table">
              <div class="text-center text-muted p-3">Loading...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadAll();
  connectWS();

  document.getElementById('btn-enable').addEventListener('click', async () => {
    await apiPost('/monitoring/enable');
    await loadMonitoringStatus();
  });
  document.getElementById('btn-disable').addEventListener('click', async () => {
    await apiPost('/monitoring/disable');
    await loadMonitoringStatus();
  });
  document.getElementById('btn-trigger').addEventListener('click', async () => {
    if (!confirm('Trigger shutdown sequence now?')) return;
    await apiPost('/shutdown/trigger');
    setTimeout(loadRecentEvents, 2000);
  });
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await apiPost('/weather/refresh');
    await loadWeather();
  });

  return cleanup;
}

function cleanup() {
  destroyed = true;
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (ws) { ws.close(); ws = null; }
}

async function loadAll() {
  await Promise.all([loadMonitoringStatus(), loadWeather(), loadRecentEvents()]);
}

async function loadMonitoringStatus() {
  try {
    const s = await apiGet('/monitoring/status');
    const area = document.getElementById('monitoring-status-area');
    if (!area) return;
    const badge = document.getElementById('monitoring-badge');
    if (badge) {
      badge.textContent = s.enabled ? 'Monitoring ON' : 'Monitoring OFF';
      badge.className = `badge ${s.enabled ? 'bg-success' : 'bg-secondary'}`;
    }
    let html = `<span class="badge ${s.enabled ? 'bg-success' : 'bg-secondary'} me-2">${s.enabled ? 'Armed' : 'Disarmed'}</span>`;
    if (s.in_cooldown) {
      html += `<span class="badge bg-info text-dark me-2">Cooldown: ${s.cooldown_remaining_min.toFixed(0)} min remaining</span>`;
    }
    if (s.last_shutdown_at) {
      html += `<small class="text-muted">Last shutdown: ${new Date(s.last_shutdown_at).toLocaleString()}</small>`;
    }
    area.innerHTML = html;
  } catch (e) {
    console.error('Status load failed:', e);
  }
}

async function loadWeather() {
  try {
    const [current, realtime] = await Promise.all([
      apiGet('/weather/current'),
      apiGet('/weather/realtime'),
    ]);

    if (current.data) {
      const d = current.data;
      const windEl = document.getElementById('wind-speed');
      const gustEl = document.getElementById('wind-gust');
      const tempEl = document.getElementById('temp-value');
      const descEl = document.getElementById('temp-desc');
      if (windEl) windEl.textContent = d.wind?.speed?.toFixed(1) ?? '--';
      if (gustEl && d.wind?.gust) gustEl.textContent = `Gust: ${d.wind.gust.toFixed(1)} mph`;
      if (tempEl) tempEl.textContent = d.main?.temp?.toFixed(0) ?? '--';
      if (descEl) descEl.textContent = d.weather?.[0]?.description ?? '';

      // Check wind alert threshold
      const alerts = document.getElementById('alerts-area');
      if (alerts) alerts.innerHTML = '';
    }

    if (realtime.data) {
      const values = realtime.data?.data?.values || {};
      const lightEl = document.getElementById('lightning-value');
      const lightDesc = document.getElementById('lightning-desc');
      if (lightEl && values.lightningDistance != null) {
        const miles = (values.lightningDistance * 0.621371).toFixed(1);
        lightEl.textContent = miles;
        if (lightDesc) lightDesc.textContent = `Updated: ${new Date(realtime.fetched_at).toLocaleTimeString()}`;
      } else if (lightEl) {
        lightEl.textContent = 'None';
        if (lightDesc) lightDesc.textContent = 'No lightning detected';
      }
    }
  } catch (e) {
    console.error('Weather load failed:', e);
  }
}

async function loadRecentEvents() {
  try {
    const result = await apiGet('/events?page=1&page_size=10');
    const container = document.getElementById('recent-events-table');
    if (!container) return;
    if (!result.items?.length) {
      container.innerHTML = '<div class="text-center text-muted p-3">No events yet</div>';
      return;
    }
    container.innerHTML = `
      <table class="table table-dark table-sm table-hover mb-0">
        <thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
        <tbody>
          ${result.items.map(ev => `
            <tr>
              <td><small>${new Date(ev.created_at).toLocaleString()}</small></td>
              <td><small>${ev.event_type}</small></td>
              <td><span class="badge badge-${ev.severity}">${ev.severity}</span></td>
              <td><small>${ev.message}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('Events load failed:', e);
  }
}

function connectWS() {
  const token = getToken();
  if (!token) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/dashboard?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(url);

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'weather_update') loadWeather();
      if (msg.type === 'monitoring_status') loadMonitoringStatus();
      if (msg.type === 'new_event') loadRecentEvents();
      if (msg.type === 'shutdown_alert') {
        const alertDiv = document.getElementById('alerts-area');
        if (alertDiv) {
          alertDiv.innerHTML = `<div class="alert alert-danger"><strong>SHUTDOWN TRIGGERED:</strong> ${msg.reason}</div>`;
        }
        loadRecentEvents();
      }
    } catch {}
  };

  ws.onclose = () => {
    // Attempt reconnect after 5s only if page still active
    if (!destroyed) setTimeout(() => { if (!destroyed) connectWS(); }, 5000);
  };

  // Ping every 30s to keep connection alive
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
}
