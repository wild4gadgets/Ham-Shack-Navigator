import { apiGet, apiPost } from '../api.js';
import { getToken, isAdmin } from '../state.js';

async function apiFetchXml(path) {
  const token = getToken();
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const resp = await fetch('/api/v1' + path, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

let ws = null;
let pingInterval = null;
let destroyed = false;
let radarMap = null;
let radarLayer = null;
let lightningLayer = null;
let radarFrames = [];
let radarFrameIndex = 0;
let radarAnimInterval = null;
let radarPlaying = false;
let radarHomeLat = null;
let radarHomeLon = null;
let radarHomeZoom = 7;
let pinData = { kasa: [], shelly: [] };
let pinStates = {};
let pinPollTimer = null;
let solarRefreshTimer = null;
let dxcRefreshTimer = null;
let pskRefreshTimer = null;
let pskCountdownTimer = null;
let pskNextRefreshAt = null;
let pskPaused = false;
let pskMap = null;
let pskSpotLayer = null;
let pskTerminator = null;
let pskTerminatorTimer = null;
let systemState = { last: null, startup_id: null, shutdown_id: null };

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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
              <button id="btn-system-toggle" class="btn btn-sm btn-secondary" disabled>...</button>
              <button id="btn-refresh" class="btn btn-sm btn-outline-light">
                <i class="bi bi-arrow-clockwise"></i> Refresh
              </button>
            </div>
          </div>
          <div class="card-body d-flex align-items-center flex-wrap gap-2">
            <div id="monitoring-status-area"><span class="text-muted">Loading...</span></div>
            <div id="dashboard-pins" class="d-flex flex-wrap gap-1 align-items-center"></div>
            <div class="ms-auto"><small id="weather-update-time" class="text-white-50"></small></div>
          </div>
        </div>
      </div>

      <!-- Weather Cards - square tiles -->
      <div class="col-12 col-md-4 col-lg-2">
        <div class="card">
          <div class="card-header"><i class="bi bi-wind me-2"></i>Wind</div>
          <div class="card-body p-1 weather-tile-body" id="wind-card" style="overflow:hidden">
            <div class="text-muted text-center pt-3">Loading...</div>
          </div>
        </div>
      </div>

      <div class="col-12 col-md-4 col-lg-2">
        <div class="card">
          <div class="card-header"><i class="bi bi-thermometer-half me-2"></i>Temperature</div>
          <div class="card-body p-1 weather-tile-body" id="temp-card" style="overflow:hidden">
            <div class="text-muted text-center pt-3">Loading...</div>
          </div>
        </div>
      </div>

      <div class="col-12 col-md-4 col-lg-2">
        <div class="card">
          <div class="card-header"><i class="bi bi-lightning-charge me-2"></i>Lightning</div>
          <div class="card-body d-flex flex-column justify-content-center align-items-center weather-tile-body" id="lightning-card">
            <div class="weather-value" id="lightning-value">--</div>
            <div class="weather-unit" id="lightning-unit">miles away</div>
            <div class="mt-2 text-muted" id="lightning-desc"></div>
          </div>
        </div>
      </div>

      <!-- 24-Hour Forecast -->
      <div class="col-12 col-lg-6">
        <div class="card">
          <div class="card-header"><i class="bi bi-calendar-range me-2"></i>24-Hr Forecast</div>
          <div class="card-body p-2" id="forecast-strip">
            <div class="text-muted text-center">Loading...</div>
          </div>
          <div id="alerts-strip" style="display:none"></div>
        </div>
      </div>

      <!-- Radar -->
      <div class="col-12 col-lg-6">
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-broadcast me-2"></i>Local Radar</span>
            <div class="d-flex align-items-center gap-2">
              <span id="radar-timestamp" class="text-muted" style="font-size:0.8rem"></span>
              <button id="btn-radar-prev" class="btn btn-sm btn-outline-light" title="Previous frame">&#8249;</button>
              <button id="btn-radar-play" class="btn btn-sm btn-outline-light" title="Play/Pause">&#9654;</button>
              <button id="btn-radar-next" class="btn btn-sm btn-outline-light" title="Next frame">&#8250;</button>
            </div>
          </div>
          <div id="radar-map" style="aspect-ratio:1/1;width:100%;max-height:600px;background:#1a1a2e"></div>
        </div>
      </div>

      <!-- Right column: Solar Propagation + DX Band Activity stacked -->
      <div class="col-12 col-lg-6">
        <div class="row g-3">
          <!-- Solar Propagation -->
          <div class="col-12">
            <div class="card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span><i class="bi bi-sun me-2"></i>Solar / Propagation</span>
                <small id="solar-updated" class="text-white-50"></small>
              </div>
              <div class="card-body p-2" id="solar-card">
                <div class="text-muted text-center">Loading...</div>
              </div>
            </div>
          </div>

          <!-- DX Band Activity -->
          <div class="col-12">
            <div class="card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span><i class="bi bi-reception-4 me-2"></i>Band Activity</span>
                <small id="dxc-updated" class="text-white-50"></small>
              </div>
              <div class="card-body p-2" id="dxc-card">
                <div class="text-muted text-center">Loading...</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts -->
      <div class="col-12" id="alerts-area"></div>

      <!-- PSK Reporter Spots -->
      <div class="col-12">
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-broadcast-pin me-2"></i>PSK Reporter Spots</span>
            <div class="d-flex align-items-center gap-2">
              <small id="psk-updated" class="text-white-50"></small>
              <button id="btn-psk-pause" class="btn btn-sm btn-outline-warning" title="Pause auto-refresh">
                <i class="bi bi-pause-fill"></i>
              </button>
              <button id="btn-psk-refresh" class="btn btn-sm btn-outline-light" title="Refresh now">
                <i class="bi bi-arrow-clockwise"></i>
              </button>
              <button id="btn-psk-collapse" class="btn btn-sm btn-outline-secondary" title="Collapse controls">
                <i class="bi bi-chevron-up"></i>
              </button>
            </div>
          </div>
          <div class="card-body p-2">
            <!-- Controls -->
            <div class="d-flex flex-wrap gap-2 align-items-end mb-2" id="psk-controls">
              <div>
                <label class="form-label mb-1" style="font-size:0.75rem;color:#94a3b8">Callsign</label>
                <input type="text" id="psk-tile-callsign" class="form-control form-control-sm"
                  placeholder="W1AW" style="width:90px;text-transform:uppercase" maxlength="10" />
              </div>
              <div>
                <label class="form-label mb-1" style="font-size:0.75rem;color:#94a3b8">Direction</label>
                <select id="psk-tile-direction" class="form-select form-select-sm" style="width:160px">
                  <option value="senderCallsign">Heard by others</option>
                  <option value="receiverCallsign">Heard by callsign</option>
                </select>
              </div>
              <div>
                <label class="form-label mb-1" style="font-size:0.75rem;color:#94a3b8">Mode(s) <span style="color:#94a3b8">(none=all)</span></label>
                <select id="psk-tile-modes" class="form-select form-select-sm" multiple size="10" style="min-width:90px">
                  <option value="FT8">FT8</option>
                  <option value="FT4">FT4</option>
                  <option value="CW">CW</option>
                  <option value="SSB">SSB</option>
                  <option value="PSK31">PSK31</option>
                  <option value="RTTY">RTTY</option>
                  <option value="JS8">JS8</option>
                  <option value="WSPR">WSPR</option>
                  <option value="JT65">JT65</option>
                  <option value="JT9">JT9</option>
                </select>
              </div>
              <div>
                <label class="form-label mb-1" style="font-size:0.75rem;color:#94a3b8">Band(s) <span style="color:#94a3b8">(none=all)</span></label>
                <select id="psk-tile-bands" class="form-select form-select-sm" multiple size="12" style="min-width:75px">
                  <option value="160m">160m</option>
                  <option value="80m">80m</option>
                  <option value="60m">60m</option>
                  <option value="40m">40m</option>
                  <option value="30m">30m</option>
                  <option value="20m">20m</option>
                  <option value="17m">17m</option>
                  <option value="15m">15m</option>
                  <option value="12m">12m</option>
                  <option value="10m">10m</option>
                  <option value="6m">6m</option>
                  <option value="2m">2m</option>
                </select>
              </div>
              <div>
                <label class="form-label mb-1" style="font-size:0.75rem;color:#94a3b8">Timespan</label>
                <select id="psk-tile-timespan" class="form-select form-select-sm" style="width:120px">
                  <option value="-900">15 minutes</option>
                  <option value="-1800">30 minutes</option>
                  <option value="-3600" selected>1 hour</option>
                  <option value="-5400">90 minutes</option>
                  <option value="-7200">2 hours</option>
                  <option value="-14400">4 hours</option>
                  <option value="-21600">6 hours</option>
                </select>
              </div>
              <div class="align-self-end">
                <button id="btn-psk-fetch" class="btn btn-sm btn-primary">Fetch Spots</button>
              </div>
              <div class="align-self-end pb-1">
                <div class="form-check mb-0">
                  <input class="form-check-input" type="checkbox" id="psk-greyline-toggle">
                  <label class="form-check-label" for="psk-greyline-toggle" style="font-size:0.8rem;color:#94a3b8">Greyline</label>
                </div>
              </div>
            </div>
            <!-- Map -->
            <div id="psk-map" style="height:500px;background:#1a1a2e;border-radius:4px;position:relative">
              <div id="psk-map-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:1000;pointer-events:none">
                <span class="text-muted" style="font-size:0.85rem">Enter a callsign and click Fetch Spots.</span>
              </div>
            </div>
            <!-- Legend -->
            <div id="psk-legend" style="display:none;padding:6px 4px 0;font-size:0.75rem"></div>
          </div>
        </div>
      </div>

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

    <!-- QRZ Lookup Modal -->
    <div class="modal fade" id="qrz-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content" style="background:#12122a;border:1px solid #2a2a4a;color:#e0e0e0">
          <div class="modal-header" style="border-color:#2a2a4a">
            <h5 class="modal-title" id="qrz-modal-title">QRZ Lookup</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body" id="qrz-modal-body">
            <div class="text-center text-muted py-4">Loading…</div>
          </div>
          <div class="modal-footer" style="border-color:#2a2a4a">
            <a id="qrz-modal-link" href="#" target="_blank" class="btn btn-sm btn-outline-info" style="display:none">
              <i class="bi bi-box-arrow-up-right me-1"></i>Open on QRZ.com
            </a>
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadAll();
  connectWS();

  if (!isAdmin()) {
    document.getElementById('btn-system-toggle').disabled = true;
    document.getElementById('btn-system-toggle').title = 'Admin access required';
  }

  document.getElementById('btn-system-toggle').addEventListener('click', async () => {
    if (!isAdmin()) return;
    const isUp = systemState.last === 'Startup';
    const targetName = isUp ? 'Shutdown' : 'Startup';
    const targetId = isUp ? systemState.shutdown_id : systemState.startup_id;
    if (!targetId) return;
    if (!confirm(`Run ${targetName} workflow now?`)) return;
    const btn = document.getElementById('btn-system-toggle');
    btn.disabled = true;
    btn.textContent = 'Running\u2026';
    try {
      await apiPost(`/workflows/${targetId}/run`, {});
      // Workflow is running in the background; button updates on workflow_complete WS event
    } catch (e) {
      // 504 means the proxy dropped the response but the workflow was already queued;
      // the workflow_complete WS event will still arrive, so treat it like a success.
      if (e.message.includes('504')) return;
      alert(`Could not start workflow: ${e.message}`);
      await loadSystemState();
    }
  });
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.disabled = true;
    await apiPost('/weather/refresh');
    await loadWeather();
    btn.disabled = false;
    btn.textContent = 'Refreshed';
    setTimeout(() => { btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh'; }, 2500);
  });

  return cleanup;
}

function cleanup() {
  destroyed = true;
  if (pinPollTimer) { clearInterval(pinPollTimer); pinPollTimer = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (solarRefreshTimer) { clearInterval(solarRefreshTimer); solarRefreshTimer = null; }
  if (dxcRefreshTimer) { clearInterval(dxcRefreshTimer); dxcRefreshTimer = null; }
  if (pskRefreshTimer) { clearInterval(pskRefreshTimer); pskRefreshTimer = null; }
  if (pskCountdownTimer) { clearInterval(pskCountdownTimer); pskCountdownTimer = null; }
  pskNextRefreshAt = null;
  if (pskTerminatorTimer) { clearInterval(pskTerminatorTimer); pskTerminatorTimer = null; }
  if (pskTerminator)  { pskTerminator.remove(); pskTerminator = null; }
  if (pskSpotLayer)   { pskSpotLayer.clearLayers(); pskSpotLayer = null; }
  if (pskMap)         { pskMap.remove(); pskMap = null; }
  if (ws) { ws.close(); ws = null; }
  if (radarAnimInterval) { clearInterval(radarAnimInterval); radarAnimInterval = null; }
  if (radarMap) { radarMap.remove(); radarMap = null; }
  radarLayer = null;
  lightningLayer = null;
  radarFrames = [];
  radarPlaying = false;
}

async function loadSystemState() {
  try {
    systemState = await apiGet('/workflows/system-state');
  } catch { return; }
  const btn = document.getElementById('btn-system-toggle');
  if (!btn) return;
  const isUp = systemState.last === 'Startup';
  btn.textContent = isUp ? 'System Up' : 'System Down';
  btn.className = `btn btn-sm ${isUp ? 'btn-success' : 'btn-danger'}`;
  btn.disabled = !isAdmin();
}

async function loadAll() {
  await Promise.all([loadMonitoringStatus(), loadWeather(), loadRecentEvents(), loadRadar(), loadPins(), loadSolarData(), loadSystemState(), loadDxCluster(), initPskTile()]);
  if (solarRefreshTimer) clearInterval(solarRefreshTimer);
  solarRefreshTimer = setInterval(() => { if (!destroyed) loadSolarData(); }, 30 * 60 * 1000);
  if (dxcRefreshTimer) clearInterval(dxcRefreshTimer);
  try {
    const dxcSettings = await apiGet('/settings/dxcluster');
    const dxcIntervalMs = ((dxcSettings.refresh_interval_sec ?? 300)) * 1000;
    dxcRefreshTimer = setInterval(() => { if (!destroyed) loadDxCluster(); }, dxcIntervalMs);
  } catch {
    dxcRefreshTimer = setInterval(() => { if (!destroyed) loadDxCluster(); }, 5 * 60 * 1000);
  }
}

async function loadMonitoringStatus() {
  try {
    const s = await apiGet('/monitoring/status');
    const area = document.getElementById('monitoring-status-area');
    if (!area) return;
    const canToggle = isAdmin();
    let html = `<span id="btn-armed-toggle" class="badge ${s.enabled ? 'bg-success' : 'bg-danger'} me-2"
      style="${canToggle ? 'cursor:pointer' : ''}" title="${canToggle ? `Click to ${s.enabled ? 'stop' : 'start'} monitoring` : 'Admin access required'}">Monitoring ${s.enabled ? 'On' : 'Off'}</span>`;
    if (s.in_cooldown) {
      html += `<span class="badge bg-info me-2">Cooldown: ${s.cooldown_remaining_min.toFixed(0)} min remaining</span>`;
    }
    if (s.last_shutdown_at) {
      html += `<small class="text-muted ms-3">Last shutdown: ${new Date(s.last_shutdown_at).toLocaleString()}</small>`;
    }
    area.innerHTML = html;

    if (canToggle) {
      document.getElementById('btn-armed-toggle').addEventListener('click', async () => {
        const toggle = document.getElementById('btn-armed-toggle');
        toggle.style.opacity = '0.5';
        toggle.style.pointerEvents = 'none';
        await (s.enabled ? apiPost('/monitoring/disable') : apiPost('/monitoring/enable'));
        await loadMonitoringStatus();
      });
    }
  } catch (e) {
    console.error('Status load failed:', e);
  }
}

// ── Gauge rendering ──────────────────────────────────────────────────────────

/**
 * Draw an SVG analog gauge.
 * @param {object} opts
 *   min, max        – value range
 *   value           – primary value (white needle)
 *   markers         – [{value, color, label}] colored tick marks on the rim
 *   unit            – string shown below the center value
 *   tickValues      – array of numbers for major tick labels
 *   legend          – [{color, label}] shown at the bottom
 */
function drawGauge({ min, max, value, markers = [], unit, tickValues = [], legend = [] }) {
  const cx = 100, cy = 105, r = 78;
  // Arc: 135° → 45° going clockwise (270° sweep). In SVG, 0°=east, +ve=clockwise.
  const START = 135, SWEEP = 270;

  const toRad = d => d * Math.PI / 180;
  const toXY = (deg, radius) => [
    cx + radius * Math.cos(toRad(deg)),
    cy + radius * Math.sin(toRad(deg)),
  ];
  const valToDeg = v => START + (Math.max(min, Math.min(max, v)) - min) / (max - min) * SWEEP;
  const f = n => n.toFixed(2);

  // Background track arc
  const [bx1, by1] = toXY(START, r);
  const [bx2, by2] = toXY(START + SWEEP, r);
  const bgArc = `M ${f(bx1)} ${f(by1)} A ${r} ${r} 0 1 1 ${f(bx2)} ${f(by2)}`;

  // Major ticks + labels
  let ticksSVG = '';
  for (const tv of tickValues) {
    const deg = valToDeg(tv);
    const [ox, oy] = toXY(deg, r);
    const [ix, iy] = toXY(deg, r - 14);
    const [lx, ly] = toXY(deg, r - 27);
    ticksSVG += `<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}" stroke="#4a5568" stroke-width="2.5"/>`;
    ticksSVG += `<text x="${f(lx)}" y="${f(ly)}" text-anchor="middle" dominant-baseline="middle" fill="#8899bb" font-size="9">${tv}</text>`;
  }

  // Minor ticks (between major ticks)
  const minorCount = 40;
  for (let i = 0; i <= minorCount; i++) {
    const deg = START + (i / minorCount) * SWEEP;
    // Skip positions that are very close to a major tick
    const close = tickValues.some(tv => Math.abs(valToDeg(tv) - deg) < (SWEEP / minorCount) * 0.4);
    if (close) continue;
    const [ox, oy] = toXY(deg, r);
    const [ix, iy] = toXY(deg, r - 7);
    ticksSVG += `<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}" stroke="#2d3748" stroke-width="1.2"/>`;
  }

  // Colored markers (forecast min/max, gust, etc.)
  let markersSVG = '';
  for (const m of markers) {
    if (m.value == null || isNaN(m.value)) continue;
    const deg = valToDeg(m.value);
    const [ox, oy] = toXY(deg, r + 5);
    const [ix, iy] = toXY(deg, r - 18);
    markersSVG += `<line x1="${f(ix)}" y1="${f(iy)}" x2="${f(ox)}" y2="${f(oy)}" stroke="${m.color}" stroke-width="4" stroke-linecap="round"/>`;
  }

  // Needle (triangle pointing east at 0°, rotated to value angle)
  let needleSVG = '';
  if (value != null && !isNaN(value)) {
    const deg = valToDeg(value);
    const nLen = r - 8, nTail = 16, nW = 4;
    const pts = `${cx + nLen},${cy} ${cx - nTail},${cy - nW} ${cx - nTail},${cy + nW}`;
    needleSVG = `
      <g transform="rotate(${f(deg)}, ${cx}, ${cy})">
        <polygon points="${pts}" fill="white"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="7" fill="#16213e" stroke="white" stroke-width="2"/>`;
  }

  // Legend: each item rendered inline as [dot][text], group centered at cx
  let legendSVG = '';
  if (legend.length) {
    const charW = 5.2, dotR = 4, dotTextGap = 5, itemGap = 12;
    const widths = legend.map(item => dotR * 2 + dotTextGap + item.label.length * charW);
    const totalW = widths.reduce((a, b) => a + b, 0) + itemGap * (legend.length - 1);
    let lx = cx - totalW / 2;
    legend.forEach((item, i) => {
      legendSVG += `
        <circle cx="${(lx + dotR).toFixed(1)}" cy="196" r="${dotR}" fill="${item.color}"/>
        <text x="${(lx + dotR * 2 + dotTextGap).toFixed(1)}" y="196" fill="#aabbcc" font-size="11" dominant-baseline="middle">${item.label}</text>`;
      lx += widths[i] + (i < legend.length - 1 ? itemGap : 0);
    });
  }

  // Unit label centered in the bottom gap of the arc
  const unitSVG = unit
    ? `<text x="${cx}" y="168" text-anchor="middle" fill="#8899bb" font-size="11">${unit}</text>`
    : '';

  return `<svg viewBox="0 0 200 205" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    <path d="${bgArc}" fill="none" stroke="#1e2a3a" stroke-width="10"/>
    ${ticksSVG}
    ${markersSVG}
    ${needleSVG}
    ${unitSVG}
    ${legendSVG}
  </svg>`;
}

// ── 24-Hour Forecast strip ───────────────────────────────────────────────────

function owmIcon(weather) {
  const id = weather?.[0]?.id;
  if (!id) return 'bi-cloud';
  if (id >= 200 && id < 300) return 'bi-cloud-lightning-rain';
  if (id >= 300 && id < 400) return 'bi-cloud-drizzle';
  if (id >= 500 && id < 600) return 'bi-cloud-rain';
  if (id >= 600 && id < 700) return 'bi-snow';
  if (id >= 700 && id < 800) return 'bi-cloud-fog2';
  if (id === 800) return 'bi-sun';
  if (id === 801 || id === 802) return 'bi-cloud-sun';
  return 'bi-clouds';
}

function owmIconColor(weather) {
  const id = weather?.[0]?.id;
  if (!id) return '#94a3b8';
  if (id === 800) return '#fbbf24';
  if (id >= 200 && id < 300) return '#a78bfa';
  if (id >= 500 && id < 600) return '#60a5fa';
  if (id >= 600 && id < 700) return '#e2e8f0';
  return '#94a3b8';
}

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-strip');
  if (!el) return;
  if (!alerts.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const severityStyle = {
    'Extreme':  { bg: '#450a0a', border: '#ef4444', text: '#fca5a5', icon: 'bi-exclamation-octagon-fill' },
    'Severe':   { bg: '#431407', border: '#f97316', text: '#fdba74', icon: 'bi-exclamation-triangle-fill' },
    'Moderate': { bg: '#422006', border: '#eab308', text: '#fde047', icon: 'bi-exclamation-triangle'      },
    'Minor':    { bg: '#1e3a5f', border: '#60a5fa', text: '#bfdbfe', icon: 'bi-info-circle'               },
  };

  const rows = alerts.map(a => {
    const s = severityStyle[a.severity] || { bg: '#1e293b', border: '#475569', text: '#94a3b8', icon: 'bi-info-circle' };
    const expires = a.expires ? new Date(a.expires).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
    return `<div style="background:${s.bg};border-left:4px solid ${s.border};padding:8px 10px;margin:0">
      <div style="display:flex;align-items:center;gap:6px;color:${s.text};font-weight:700;font-size:0.9rem">
        <i class="bi ${s.icon}"></i>${a.event}
      </div>
      ${a.headline ? `<div style="color:#cbd5e1;font-size:0.8rem;margin-top:2px">${a.headline}</div>` : ''}
      ${expires ? `<div style="color:#64748b;font-size:0.75rem;margin-top:2px">Expires: ${expires}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = rows;
  el.style.display = 'block';
}

function renderForecast(fList, metric) {
  const el = document.getElementById('forecast-strip');
  if (!el) return;
  if (!fList.length) {
    el.innerHTML = '<div class="text-muted text-center p-2">No forecast data</div>';
    return;
  }

  const tempUnit = metric ? '°C' : '°F';
  const windUnit = metric ? 'km/h' : 'mph';

  const makeRow = (entry, indent) => {
    const dt = new Date(entry.dt * 1000);
    const timeLabel = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const temp = entry.main?.temp != null ? Math.round(entry.main.temp) : '--';
    const pop = entry.pop != null ? Math.round(entry.pop * 100) : 0;
    const rawSpeed = entry.wind?.speed ?? null;
    const windSpeed = rawSpeed != null ? Math.round(metric ? rawSpeed * 3.6 : rawSpeed) : null;
    const desc = entry.weather?.[0]?.description ?? '';
    const icon = owmIcon(entry.weather);
    const iconColor = owmIconColor(entry.weather);
    const popColor = pop >= 60 ? '#60a5fa' : pop >= 30 ? '#93c5fd' : '#64748b';
    const leftPad = indent ? 'padding-left:10px;' : '';
    return `
      <div class="d-flex align-items-center gap-2 py-1" style="${leftPad}border-bottom:1px solid #1e2a3a;font-size:1rem" title="${desc}">
        <span style="width:70px;flex-shrink:0;white-space:nowrap;color:#94a3b8">${timeLabel}</span>
        <i class="bi ${icon}" style="font-size:1.1rem;color:${iconColor};flex-shrink:0"></i>
        <span style="font-weight:600;color:#f1f5f9;width:52px;flex-shrink:0;white-space:nowrap">${temp}${tempUnit}</span>
        <span style="color:#64748b;flex-shrink:0;white-space:nowrap">${windSpeed != null ? windSpeed + ' ' + windUnit : ''}</span>
        <span style="color:${popColor};flex-shrink:0;margin-left:auto;white-space:nowrap">${pop > 0 ? '💧' + pop + '%' : ''}</span>
      </div>`;
  };

  const leftRows  = fList.slice(0, 4).map(e => makeRow(e, false));
  const rightRows = fList.slice(4, 8).map(e => makeRow(e, true));
  el.innerHTML = `<div class="d-flex forecast-cols">\
<div style="flex:1;min-width:0">${leftRows.join('')}</div>\
<div class="forecast-divider" style="width:1px;background:#2e3f52;flex-shrink:0;margin:0 4px"></div>\
<div style="flex:1;min-width:0">${rightRows.join('')}</div>\
</div>`;
}

// ── PSK Reporter ─────────────────────────────────────────────────────────────

const BAND_COLORS = {
  '160m': '#a855f7',
  '80m':  '#ec4899',
  '60m':  '#f97316',
  '40m':  '#eab308',
  '30m':  '#84cc16',
  '20m':  '#22c55e',
  '17m':  '#06b6d4',
  '15m':  '#3b82f6',
  '12m':  '#6366f1',
  '10m':  '#ef4444',
  '6m':   '#f43f5e',
  '2m':   '#14b8a6',
};

function snrColor(snr) {
  if (snr == null) return '#94a3b8';
  if (snr >= 10)  return '#4ade80';
  if (snr >=  0)  return '#86efac';
  if (snr >= -10) return '#fde047';
  if (snr >= -20) return '#fb923c';
  return '#f87171';
}

/** Convert a Maidenhead grid locator (4 or 6 chars) to [lat, lon] center. */
function maidenToLatLon(locator) {
  if (!locator || locator.length < 4) return null;
  const g = locator.trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90;
  lon += parseInt(g[2]) * 2;
  lat += parseInt(g[3]);
  if (g.length >= 6 && /[A-X]{2}$/.test(g.slice(4, 6))) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24);
    lat += (g.charCodeAt(5) - 65) * (1 / 24);
    lon += 1 / 24;   // center of subsquare
    lat += 1 / 48;
  } else {
    lon += 1;        // center of 2° square
    lat += 0.5;
  }
  return [lat, lon];
}

async function initPskTile() {
  // Initialize Leaflet map
  if (!pskMap) {
    const pskMapEl = document.getElementById('psk-map');
    const minZoom = Math.ceil(Math.log2((pskMapEl.clientHeight || 500) / 256));
    pskMap = L.map('psk-map', { zoomControl: true, attributionControl: true, worldCopyJump: true, minZoom }).setView([20, 0], 2);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      maxZoom: 19,
    }).addTo(pskMap);
    pskSpotLayer = L.layerGroup().addTo(pskMap);

    // Wire QRZ lookup button inside popups
    pskMap.on('popupopen', (e) => {
      const btn = e.popup.getElement()?.querySelector('.psk-qrz-btn');
      if (btn) btn.addEventListener('click', () => openQrzModal(btn.dataset.call));
    });

    // Greyline helpers
    const enableGreyline = () => {
      pskTerminator = L.terminator({
        fillColor:   '#0a0f2e',
        fillOpacity: 0.45,
        color:       '#f97316',
        weight:      1.5,
        opacity:     0.8,
      }).addTo(pskMap);
      pskTerminator.bringToBack();
      if (pskTerminatorTimer) clearInterval(pskTerminatorTimer);
      pskTerminatorTimer = setInterval(() => {
        if (pskTerminator) pskTerminator.setTime(new Date());
      }, 60 * 1000);
    };
    const disableGreyline = () => {
      if (pskTerminatorTimer) { clearInterval(pskTerminatorTimer); pskTerminatorTimer = null; }
      if (pskTerminator) { pskTerminator.remove(); pskTerminator = null; }
    };

    // Restore persisted state
    const greylineEl = document.getElementById('psk-greyline-toggle');
    if (greylineEl) {
      const saved = localStorage.getItem('psk_greyline') === 'true';
      greylineEl.checked = saved;
      if (saved) enableGreyline();

      greylineEl.addEventListener('change', (e) => {
        localStorage.setItem('psk_greyline', e.target.checked);
        if (e.target.checked) enableGreyline(); else disableGreyline();
      });
    }
  }

  // Pre-fill controls: localStorage first, fall back to saved API settings
  const LSK = 'psk_tile_prefs';
  try {
    const cs      = document.getElementById('psk-tile-callsign');
    const dir     = document.getElementById('psk-tile-direction');
    const modesEl = document.getElementById('psk-tile-modes');
    const bandsEl = document.getElementById('psk-tile-bands');
    const ts      = document.getElementById('psk-tile-timespan');

    // Try localStorage first
    let prefs = null;
    try { prefs = JSON.parse(localStorage.getItem(LSK)); } catch { /* ignore */ }

    if (prefs) {
      if (cs  && prefs.callsign)   cs.value  = prefs.callsign;
      if (dir && prefs.direction)  dir.value = prefs.direction;
      if (ts  && prefs.timespan)   ts.value  = String(prefs.timespan);
      if (modesEl && prefs.modes?.length)
        Array.from(modesEl.options).forEach(o => { o.selected = prefs.modes.includes(o.value); });
      if (bandsEl && prefs.bands?.length)
        Array.from(bandsEl.options).forEach(o => { o.selected = prefs.bands.includes(o.value); });
    } else {
      // Fall back to API settings defaults
      const cfg = await apiGet('/pskreporter/settings');
      if (cs  && cfg.callsign)           cs.value  = cfg.callsign;
      if (dir && cfg.default_direction)  dir.value = cfg.default_direction;
      if (ts  && cfg.default_timespan)   ts.value  = String(cfg.default_timespan);
      if (modesEl && cfg.default_modes?.length)
        Array.from(modesEl.options).forEach(o => { o.selected = cfg.default_modes.includes(o.value); });
      if (bandsEl && cfg.default_bands?.length)
        Array.from(bandsEl.options).forEach(o => { o.selected = cfg.default_bands.includes(o.value); });
    }

    if (document.getElementById('psk-tile-callsign')?.value) await loadPskSpots();
  } catch { /* no saved settings yet */ }

  // Collapse / expand controls panel
  const collapseBtn = document.getElementById('btn-psk-collapse');
  const controlsEl  = document.getElementById('psk-controls');
  if (collapseBtn && controlsEl) {
    const collapsed = localStorage.getItem('psk_controls_collapsed') === 'true';
    if (collapsed) {
      controlsEl.classList.add('d-none');
      collapseBtn.title = 'Expand controls';
      collapseBtn.querySelector('i').className = 'bi bi-chevron-down';
    }
    collapseBtn.addEventListener('click', () => {
      const isCollapsed = controlsEl.classList.contains('d-none');
      controlsEl.classList.toggle('d-none', !isCollapsed);
      collapseBtn.title = isCollapsed ? 'Collapse controls' : 'Expand controls';
      collapseBtn.querySelector('i').className = isCollapsed ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
      localStorage.setItem('psk_controls_collapsed', isCollapsed ? 'false' : 'true');
    });
  }

  document.getElementById('btn-psk-fetch')?.addEventListener('click', () => loadPskSpots());
  document.getElementById('btn-psk-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-psk-refresh');
    if (btn) btn.disabled = true;
    await loadPskSpots();
    if (btn) btn.disabled = false;
  });

  const PSK_INTERVAL_MS = 5 * 60 * 1000;

  if (pskRefreshTimer) clearInterval(pskRefreshTimer);
  pskRefreshTimer = setInterval(() => {
    if (!destroyed && !pskPaused) {
      pskNextRefreshAt = Date.now() + PSK_INTERVAL_MS;
      loadPskSpots();
    }
  }, PSK_INTERVAL_MS);
  pskNextRefreshAt = Date.now() + PSK_INTERVAL_MS;

  // Countdown display — updates every second
  if (pskCountdownTimer) clearInterval(pskCountdownTimer);
  pskCountdownTimer = setInterval(() => {
    if (destroyed) return;
    const updEl = document.getElementById('psk-updated');
    if (!updEl) return;
    const base = updEl.dataset.base || '';
    if (pskPaused) {
      updEl.textContent = base + (base ? ' · ' : '') + 'paused';
    } else if (pskNextRefreshAt) {
      const remaining = Math.max(0, Math.ceil((pskNextRefreshAt - Date.now()) / 1000));
      const min = Math.floor(remaining / 60);
      const sec = String(remaining % 60).padStart(2, '0');
      updEl.textContent = base + (base ? ' · ' : '') + `next: ${min}:${sec}`;
    }
  }, 1000);

  // Pause / resume button
  const pauseBtn = document.getElementById('btn-psk-pause');
  if (pauseBtn) {
    // Restore persisted pause state
    pskPaused = localStorage.getItem('psk_paused') === 'true';
    pauseBtn.innerHTML = pskPaused
      ? '<i class="bi bi-play-fill"></i>'
      : '<i class="bi bi-pause-fill"></i>';
    pauseBtn.title = pskPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';
    pauseBtn.className = pskPaused
      ? 'btn btn-sm btn-warning'
      : 'btn btn-sm btn-outline-warning';

    pauseBtn.addEventListener('click', () => {
      pskPaused = !pskPaused;
      localStorage.setItem('psk_paused', pskPaused);
      pauseBtn.innerHTML = pskPaused
        ? '<i class="bi bi-play-fill"></i>'
        : '<i class="bi bi-pause-fill"></i>';
      pauseBtn.title = pskPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';
      pauseBtn.className = pskPaused
        ? 'btn btn-sm btn-warning'
        : 'btn btn-sm btn-outline-warning';
      if (!pskPaused) {
        // Resume: reset countdown and fetch immediately
        pskNextRefreshAt = Date.now() + PSK_INTERVAL_MS;
        loadPskSpots();
      }
    });
  }
}

async function openQrzModal(callsign) {
  const modalEl = document.getElementById('qrz-modal');
  const title   = document.getElementById('qrz-modal-title');
  const body    = document.getElementById('qrz-modal-body');
  const link    = document.getElementById('qrz-modal-link');

  title.textContent = `QRZ: ${callsign}`;
  body.innerHTML = '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Loading…</div>';
  link.style.display = 'none';

  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  try {
    const d = await apiGet(`/qrz/lookup?callsign=${encodeURIComponent(callsign)}`);

    // Build human-readable location from QRZ fields
    const locationParts = [d.addr2, d.state, d.country].filter(Boolean);
    const location = locationParts.join(', ');

    body.innerHTML = `
      <div class="row g-3 align-items-start">
        <div class="col-md-8">
          <div class="mb-1" style="font-size:1.15rem;font-weight:700">${escHtml((d.fname || '') + ' ' + (d.name || '')).trim() || escHtml(d.call)}</div>
          <div class="mb-2" style="color:#94a3b8">${escHtml(d.call)}${d.class ? ` &nbsp;·&nbsp; Class ${escHtml(d.class)}` : ''}</div>
          ${location      ? `<div class="mb-1"><i class="bi bi-geo-alt-fill me-1" style="color:#38bdf8"></i>${escHtml(location)}</div>` : ''}
          ${d.grid        ? `<div class="mb-1"><i class="bi bi-grid-3x3 me-1" style="color:#94a3b8"></i>Grid: <span style="font-family:monospace">${escHtml(d.grid)}</span></div>` : ''}
          ${d.addr1       ? `<div class="mb-1 text-muted" style="font-size:0.85rem">${escHtml(d.addr1)}</div>` : ''}
          ${d.email       ? `<div class="mb-1" style="font-size:0.85rem"><i class="bi bi-envelope me-1"></i>${escHtml(d.email)}</div>` : ''}
          ${d.qslmgr      ? `<div class="mb-1" style="font-size:0.85rem">QSL via: ${escHtml(d.qslmgr)}</div>` : ''}
          <div class="mt-2 d-flex gap-2 flex-wrap">
            ${d.lotw === 'Y' ? '<span class="badge bg-success">LoTW</span>' : ''}
            ${d.eqsl === 'Y' ? '<span class="badge bg-info text-dark">eQSL</span>' : ''}
            ${d.cqzone      ? `<span class="badge bg-secondary">CQ ${escHtml(d.cqzone)}</span>` : ''}
            ${d.ituzone     ? `<span class="badge bg-secondary">ITU ${escHtml(d.ituzone)}</span>` : ''}
            ${d.dxcc        ? `<span class="badge bg-secondary">DXCC ${escHtml(d.dxcc)}</span>` : ''}
          </div>
        </div>
        <div class="col-md-4 text-center">
          ${d.image ? `<img src="${escHtml(d.image)}" class="img-fluid rounded" style="max-height:160px;object-fit:cover" onerror="this.style.display='none'" />` : ''}
        </div>
      </div>`;

    link.href = `https://www.qrz.com/db/${encodeURIComponent(d.call)}`;
    link.style.display = '';
  } catch (err) {
    body.innerHTML = `<div class="alert alert-warning mb-0">${escHtml(err.message)}</div>`;
  }
}

async function loadPskSpots() {
  if (!pskMap) return;
  const callsign  = document.getElementById('psk-tile-callsign')?.value.trim().toUpperCase() || '';
  const direction = document.getElementById('psk-tile-direction')?.value || 'senderCallsign';
  const modesEl   = document.getElementById('psk-tile-modes');
  const bandsEl   = document.getElementById('psk-tile-bands');
  const timespan  = parseInt(document.getElementById('psk-tile-timespan')?.value || '-3600');

  // Persist current selections to localStorage
  if (callsign) {
    try {
      localStorage.setItem('psk_tile_prefs', JSON.stringify({
        callsign, direction, timespan,
        modes: modesEl ? Array.from(modesEl.selectedOptions).map(o => o.value) : [],
        bands: bandsEl ? Array.from(bandsEl.selectedOptions).map(o => o.value) : [],
      }));
    } catch { /* ignore */ }
  }
  const placeholder = document.getElementById('psk-map-placeholder');
  const legend    = document.getElementById('psk-legend');

  const setPlaceholder = (msg) => {
    if (placeholder) { placeholder.style.display = 'flex'; placeholder.querySelector('span').textContent = msg; }
  };

  if (!callsign) { setPlaceholder('Enter a callsign and click Fetch Spots.'); return; }

  setPlaceholder('Fetching spots…');
  const modes = modesEl ? Array.from(modesEl.selectedOptions).map(o => o.value).join(',') : '';
  const bands = bandsEl ? Array.from(bandsEl.selectedOptions).map(o => o.value).join(',') : '';

  try {
    const params = new URLSearchParams({ callsign, direction, modes, bands, timespan });
    const data = await apiGet(`/pskreporter/spots?${params}`);

    // Update header status
    const updEl = document.getElementById('psk-updated');
    if (updEl && data.fetched_at) {
      const d = new Date(data.fetched_at.slice(0, 19) + 'Z');
      const base = `${data.cached ? '(cached) ' : ''}${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${data.count ?? 0} spots`;
      updEl.dataset.base = base;
      updEl.textContent = base;  // countdown interval will append "next: X:XX" within 1s
    }
    // Reset auto-refresh countdown from now
    pskNextRefreshAt = Date.now() + 5 * 60 * 1000;

    if (!data.spots?.length) {
      pskSpotLayer.clearLayers();
      if (legend) legend.style.display = 'none';
      setPlaceholder('No spots found for the selected filters.');
      return;
    }

    if (placeholder) placeholder.style.display = 'none';

    // Try to get home station location for the home marker
    let homeLat = null, homeLon = null;
    try {
      const loc = await apiGet('/settings/location');
      homeLat = loc.lat; homeLon = loc.lon;
    } catch { /* ignore */ }

    pskSpotLayer.clearLayers();
    // Keep terminator below spots after clearing
    if (pskTerminator) pskTerminator.bringToBack();
    const bandCounts = {};

    // Add home station marker
    if (homeLat != null && homeLon != null) {
      L.marker([homeLat, homeLon], {
        icon: L.divIcon({
          html: `<i class="bi bi-house-fill" style="color:#fbbf24;font-size:1.1rem;filter:drop-shadow(0 0 3px #000)"></i>`,
          iconSize: [18, 18], iconAnchor: [9, 9], className: '',
        }),
        zIndexOffset: 1000,
      }).addTo(pskSpotLayer).bindTooltip(`${callsign} (your station)`, { direction: 'right' });
    }

    // Jitter tracker to spread markers that share the same grid square
    const jitterMap = {};

    for (const spot of data.spots) {
      const otherCall = direction === 'senderCallsign' ? spot.receiverCallsign : spot.senderCallsign;
      const otherLoc  = direction === 'senderCallsign' ? spot.receiverLocator  : spot.senderLocator;
      const ll = maidenToLatLon(otherLoc);
      if (!ll) continue;

      const color   = BAND_COLORS[spot.band] ?? '#94a3b8';
      bandCounts[spot.band] = (bandCounts[spot.band] ?? 0) + 1;

      // Jitter: offset overlapping spots by a tiny amount
      const jKey = `${Math.round(ll[0]*100)},${Math.round(ll[1]*100)}`;
      const n    = jitterMap[jKey] ?? 0;
      jitterMap[jKey] = n + 1;
      const jLat = ll[0] + (n % 5) * 0.08 * Math.cos((n * 137.5) * Math.PI / 180);
      const jLon = ll[1] + (n % 5) * 0.08 * Math.sin((n * 137.5) * Math.PI / 180);

      const snrStr = spot.snr != null ? `${spot.snr > 0 ? '+' : ''}${spot.snr}` : '?';
      const sColor = snrColor(spot.snr);
      const t      = spot.timestamp ? new Date(spot.timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '--';

      const marker = L.circleMarker([jLat, jLon], {
        radius: 7, color: '#0f172a', weight: 1,
        fillColor: color, fillOpacity: 0.85,
      });

      // Popup with full details on click
      marker.bindPopup(
        `<b>${escHtml(otherCall)}</b><br>` +
        `Locator: ${escHtml(otherLoc || '--')}<br>` +
        `Band: ${escHtml(spot.band)} &nbsp; Mode: ${escHtml(spot.mode)}<br>` +
        `SNR: <span style="color:${sColor};font-weight:600">${escHtml(snrStr)} dB</span><br>` +
        `Time: ${escHtml(t)}<br>` +
        `<button class="psk-qrz-btn" data-call="${escHtml(otherCall)}" style="margin-top:5px;padding:2px 8px;font-size:0.78rem;background:transparent;border:1px solid #38bdf8;color:#38bdf8;border-radius:4px;cursor:pointer">QRZ Lookup</button>`,
        { className: 'psk-popup' }
      );

      marker.addTo(pskSpotLayer);

      // Plain floating text label — no balloon, no box
      L.marker([jLat, jLon], {
        icon: L.divIcon({
          html: `<div class="psk-spot-label"><span style="font-weight:700;color:#ffffff">${escHtml(otherCall)}</span><br><span style="color:${sColor}">${escHtml(snrStr)} dB</span></div>`,
          iconSize: null,
          iconAnchor: [-10, 8],
          className: '',
        }),
        interactive: false,
        keyboard: false,
      }).addTo(pskSpotLayer);
    }

    // Build legend (only bands present in results)
    if (legend) {
      const BAND_ORDER = ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','2m'];
      const items = BAND_ORDER
        .filter(b => bandCounts[b])
        .map(b => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${BAND_COLORS[b]};flex-shrink:0"></span>
            <span style="color:#e2e8f0">${b}</span>
            <span style="color:#64748b">(${bandCounts[b]})</span>
          </span>`)
        .join('');
      legend.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:2px;color:#94a3b8">
        <span style="margin-right:6px;font-weight:600">Band:</span>${items}
        <span style="margin-left:auto;color:#64748b">SNR: </span>
        ${['≥+10','0 to +10','-10 to 0','-20 to -10','< -20'].map((l,i) => {
          const c = ['#4ade80','#86efac','#fde047','#fb923c','#f87171'][i];
          return `<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c}"></span>
            <span style="color:#94a3b8">${l}</span></span>`;
        }).join('')}
      </div>`;
      legend.style.display = 'block';
    }

  } catch (e) {
    setPlaceholder(`Error: ${e.message}`);
  }
}

// ── Weather loading ──────────────────────────────────────────────────────────

async function loadWeather() {
  try {
    const [current, forecast, realtime, loc, lightning, alertsData] = await Promise.all([
      apiGet('/weather/current'),
      apiGet('/weather/forecast'),
      apiGet('/weather/realtime'),
      apiGet('/settings/location'),
      apiGet('/weather/lightning'),
      apiGet('/weather/alerts').catch(() => ({ alerts: [] })),
    ]);

    const metric = (loc.units || 'imperial') === 'metric';

    if (current.fetched_at) {
      const el = document.getElementById('weather-update-time');
      if (el) {
        // Slice to seconds and append Z so JS treats the stored UTC value as UTC,
        // then toLocaleString converts it to the browser's local timezone.
        const d = new Date(current.fetched_at.slice(0, 19) + 'Z');
        el.textContent = `Weather updated: ${d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`;
      }
    }

    // ── Temperature gauge ──
    const tempCard = document.getElementById('temp-card');
    if (tempCard && current.data) {
      const d = current.data;
      let currentTemp = d.main?.temp;

      // Forecast min/max from the 24h forecast list
      const fList = forecast.data?.list || [];
      renderForecast(fList, metric);
      renderAlerts(alertsData?.alerts || []);
      const fTemps = fList.flatMap(e => [e.main?.temp_min, e.main?.temp_max]).filter(t => t != null);
      const forecastMin = fTemps.length ? Math.min(...fTemps) : null;
      const forecastMax = fTemps.length ? Math.max(...fTemps) : null;

      const tempUnit = metric ? '°C' : '°F';
      const tMin = metric ? -30 : -20;
      const tMax = metric ? 50 : 120;
      const tTicks = metric ? [-30, -20, -10, 0, 10, 20, 30, 40, 50]
                            : [-20, 0, 20, 40, 60, 80, 100, 120];

      tempCard.innerHTML = drawGauge({
        min: tMin, max: tMax,
        value: currentTemp,
        unit: tempUnit,
        tickValues: tTicks,
        markers: [
          { value: forecastMin, color: '#60a5fa', label: `Low ${forecastMin != null ? Math.round(forecastMin) + tempUnit : '--'}` },
          { value: forecastMax, color: '#f87171', label: `High ${forecastMax != null ? Math.round(forecastMax) + tempUnit : '--'}` },
        ],
        legend: [
          { color: '#60a5fa', label: `Low ${forecastMin != null ? Math.round(forecastMin) + tempUnit : '--'}` },
          { color: 'white',   label: `Now ${currentTemp != null ? Math.round(currentTemp) + tempUnit : '--'}` },
          { color: '#f87171', label: `High ${forecastMax != null ? Math.round(forecastMax) + tempUnit : '--'}` },
        ],
      });
    }

    // ── Wind gauge ──
    const windCard = document.getElementById('wind-card');
    if (windCard && current.data) {
      const d = current.data;
      // OWM metric returns m/s; convert to km/h
      const windSpeed = metric ? (d.wind?.speed != null ? d.wind.speed * 3.6 : null) : d.wind?.speed ?? null;
      const gustSpeed = metric ? (d.wind?.gust != null ? d.wind.gust * 3.6 : null) : d.wind?.gust ?? null;
      const windUnit = metric ? 'km/h' : 'mph';
      const wMax = metric ? 120 : 80;
      const wTicks = metric ? [0, 20, 40, 60, 80, 100, 120] : [0, 10, 20, 30, 40, 50, 60, 70, 80];

      windCard.innerHTML = drawGauge({
        min: 0, max: wMax,
        value: windSpeed,
        unit: windUnit,
        tickValues: wTicks,
        markers: [
          { value: gustSpeed, color: '#fb923c', label: `Gust ${gustSpeed != null ? gustSpeed.toFixed(1) + windUnit : '--'}` },
        ],
        legend: [
          { color: 'white',   label: `Wind ${windSpeed != null ? Math.round(windSpeed) + ' ' + windUnit : '--'}` },
          ...(gustSpeed != null ? [{ color: '#fb923c', label: `Gust ${Math.round(gustSpeed) + ' ' + windUnit}` }] : []),
        ],
      });
    }

    // ── Lightning ──
    {
      const lightEl   = document.getElementById('lightning-value');
      const lightUnit = document.getElementById('lightning-unit');
      const lightDesc = document.getElementById('lightning-desc');
      if (lightEl) {
        const km    = lightning?.lightningDistance;
        const miles = lightning?.lightningMiles;
        if (km != null) {
          lightEl.textContent = metric ? km.toFixed(1) : miles.toFixed(1);
          lightEl.style.fontSize = '';
          if (lightUnit) lightUnit.textContent = metric ? 'km away' : 'miles away';
          if (lightDesc) lightDesc.textContent = lightning.source || '';
        } else {
          lightEl.textContent = metric ? 'None detected within 400 kilometers' : 'None detected within 250 miles';
          lightEl.style.fontSize = '1.5rem';
          if (lightUnit) lightUnit.textContent = '';
          if (lightDesc) lightDesc.textContent = '';
        }
      }
    }

    const alerts = document.getElementById('alerts-area');
    if (alerts) alerts.innerHTML = '';

  } catch (e) {
    console.error('Weather load failed:', e);
  }
}

async function loadRadar() {
  try {
    const loc = await apiGet('/settings/location');
    const lat = loc.lat ?? 39.5;
    const lon = loc.lon ?? -98.35;
    radarHomeLat = lat;
    radarHomeLon = lon;

    // Init map only once
    if (!radarMap) {
      radarMap = L.map('radar-map', { zoomControl: true, attributionControl: true }).setView([lat, lon], radarHomeZoom);

      // Home button control
      const HomeControl = L.Control.extend({
        onAdd() {
          const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control');
          btn.innerHTML = '<i class="bi bi-house-fill"></i>';
          btn.style.cssText = 'width:30px;height:30px;background:#fff;border:none;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;';
          btn.title = 'Recenter map';
          L.DomEvent.on(btn, 'click', (e) => {
            L.DomEvent.stopPropagation(e);
            radarMap.setView([radarHomeLat, radarHomeLon], radarHomeZoom);
          });
          return btn;
        },
      });
      new HomeControl({ position: 'topleft' }).addTo(radarMap);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(radarMap);
    } else {
      radarMap.setView([lat, lon], radarHomeZoom);
    }

    // Fetch RainViewer timestamps
    const rv = await fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json());
    const host = rv.host;
    const past = rv.radar?.past ?? [];
    const nowcast = rv.radar?.nowcast ?? [];
    radarFrames = [...past, ...nowcast];
    if (!radarFrames.length) return;

    // Lightning overlay — use the most recent strike frame
    const lightningFrames = rv.lightning ?? [];
    if (lightningFrames.length) {
      const lf = lightningFrames[lightningFrames.length - 1];
      const lUrl = `${host}${lf.path}/256/{z}/{x}/{y}/1/1_1.png`;
      if (!lightningLayer) {
        lightningLayer = L.tileLayer(lUrl, {
          opacity: 0.9,
          maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
          maxZoom: 19,
          attribution: 'RainViewer',
        }).addTo(radarMap);
      } else {
        lightningLayer.setUrl(lUrl);
      }
    }

    radarFrameIndex = radarFrames.length - 1;
    showRadarFrame(host, radarFrameIndex);

    // Wire up controls
    document.getElementById('btn-radar-prev').onclick = () => {
      stopRadarAnim();
      radarFrameIndex = (radarFrameIndex - 1 + radarFrames.length) % radarFrames.length;
      showRadarFrame(host, radarFrameIndex);
    };
    document.getElementById('btn-radar-next').onclick = () => {
      stopRadarAnim();
      radarFrameIndex = (radarFrameIndex + 1) % radarFrames.length;
      showRadarFrame(host, radarFrameIndex);
    };
    document.getElementById('btn-radar-play').onclick = () => {
      if (radarPlaying) {
        stopRadarAnim();
      } else {
        radarPlaying = true;
        document.getElementById('btn-radar-play').innerHTML = '&#9646;&#9646;';
        radarAnimInterval = setInterval(() => {
          radarFrameIndex = (radarFrameIndex + 1) % radarFrames.length;
          showRadarFrame(host, radarFrameIndex);
        }, 600);
      }
    };
  } catch (e) {
    console.error('Radar load failed:', e);
  }
}

const RADAR_MAX_NATIVE_ZOOM = 6;

function showRadarFrame(host, index) {
  const frame = radarFrames[index];
  if (!frame || !radarMap) return;

  const url = `${host}${frame.path}/256/{z}/{x}/{y}/6/1_1.png`;

  if (!radarLayer) {
    radarLayer = L.tileLayer(url, {
      opacity: 0.85,
      maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
      maxZoom: 19,
      attribution: 'RainViewer',
    }).addTo(radarMap);
  } else {
    radarLayer.setUrl(url);
  }

  if (lightningLayer) lightningLayer.bringToFront();

  const ts = document.getElementById('radar-timestamp');
  if (ts) ts.textContent = new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stopRadarAnim() {
  radarPlaying = false;
  if (radarAnimInterval) { clearInterval(radarAnimInterval); radarAnimInterval = null; }
  const btn = document.getElementById('btn-radar-play');
  if (btn) btn.innerHTML = '&#9654;';
}

async function loadRecentEvents() {
  try {
    const result = await apiGet('/events?page=1&page_size=25');
    const container = document.getElementById('recent-events-table');
    if (!container) return;
    const items = (result.items ?? []).filter(ev => ev.severity !== 'info');
    if (!items.length) {
      container.innerHTML = '<div class="text-center text-muted p-3">No events yet</div>';
      return;
    }
    container.innerHTML = `
      <table class="table table-dark table-sm table-hover mb-0">
        <thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
        <tbody>
          ${items.slice(0, 10).map(ev => `
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

async function loadPins() {
  try {
    const data = await apiGet('/dashboard/pins');
    pinData = data;
    pinStates = {};
    data.kasa.forEach(p => { pinStates[`kasa-${p.id}`] = null; });
    data.shelly.forEach(c => { pinStates[`shelly-${c.id}`] = null; });
    renderPins();
    await pollPinStates();
    if (pinPollTimer) clearInterval(pinPollTimer);
    if (data.kasa.length || data.shelly.length) {
      pinPollTimer = setInterval(pollPinStates, 10000);
    }
  } catch {}
}

function renderPins() {
  const el = document.getElementById('dashboard-pins');
  if (!el) return;
  const allPins = [
    ...pinData.kasa.map(p => ({ type: 'kasa', ...p })),
    ...pinData.shelly.map(c => ({ type: 'shelly', ...c })),
  ];
  if (!allPins.length) { el.innerHTML = ''; return; }

  el.innerHTML = allPins.map(pin => {
    const key = `${pin.type}-${pin.id}`;
    const isOn = pinStates[key];
    const label = escHtml(pin.label || (pin.type === 'kasa' ? `Port ${pin.port_index + 1}` : `Ch ${pin.channel_index}`));
    const icon = pin.type === 'kasa' ? 'bi-plug' : 'bi-toggles';
    const bg = isOn === null ? '#6c757d' : (isOn ? '#198754' : '#dc3545');
    const stateText = isOn === null ? '?' : (isOn ? 'ON' : 'OFF');
    const cursor = isAdmin() ? 'pointer' : 'default';
    return `<button class="pin-badge border-0 rounded" style="background:${bg};color:#fff;cursor:${cursor};font-size:0.72rem;padding:3px 9px;line-height:1.4"
      data-pin-type="${pin.type}" data-pin-id="${pin.id}" title="${escHtml(pin.device_name)}" ${isAdmin() ? '' : 'disabled'}>
      <i class="bi ${icon} me-1"></i>${label} <span style="opacity:0.8">${stateText}</span>
    </button>`;
  }).join('');

  if (isAdmin()) {
    el.querySelectorAll('.pin-badge').forEach(btn => {
      btn.addEventListener('click', () => togglePin(btn.dataset.pinType, parseInt(btn.dataset.pinId)));
    });
  }
}

async function pollPinStates() {
  const kasaByDevice = {};
  for (const pin of pinData.kasa) {
    if (!kasaByDevice[pin.device_id]) kasaByDevice[pin.device_id] = { pins: [] };
    kasaByDevice[pin.device_id].pins.push(pin);
  }
  const shellyByDevice = {};
  for (const pin of pinData.shelly) {
    if (!shellyByDevice[pin.device_id]) shellyByDevice[pin.device_id] = { pins: [] };
    shellyByDevice[pin.device_id].pins.push(pin);
  }

  const promises = [];
  for (const [deviceId, info] of Object.entries(kasaByDevice)) {
    promises.push(
      apiGet(`/kasa/devices/${deviceId}/states`)
        .then(result => {
          if (result.success) {
            result.port_states.forEach(s => {
              const pin = info.pins.find(p => p.port_index === s.port_index);
              if (pin) pinStates[`kasa-${pin.id}`] = s.is_on;
            });
          }
        }).catch(() => {})
    );
  }
  for (const [deviceId, info] of Object.entries(shellyByDevice)) {
    promises.push(
      apiGet(`/shelly/devices/${deviceId}/states`)
        .then(states => {
          states.forEach(s => {
            const pin = info.pins.find(c => c.channel_index === s.channel_index);
            if (pin) pinStates[`shelly-${pin.id}`] = s.is_on;
          });
        }).catch(() => {})
    );
  }

  await Promise.all(promises);
  renderPins();
}

async function togglePin(type, id) {
  const key = `${type}-${id}`;
  const current = pinStates[key];
  if (current === null) return;
  const action = current ? 'off' : 'on';
  pinStates[key] = null;
  renderPins();
  try {
    if (type === 'kasa') {
      await apiPost(`/kasa/ports/${id}/control`, { action });
    } else {
      await apiPost(`/shelly/channels/${id}/control`, { action });
    }
    pinStates[key] = action === 'on';
  } catch {
    pinStates[key] = current;
  }
  renderPins();
}

// ── Solar Propagation ────────────────────────────────────────────────────────

async function loadSolarData() {
  try {
    const text = await apiFetchXml('/solar/data');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const get = tag => doc.querySelector(tag)?.textContent?.trim() ?? '--';

    const bands = {};
    doc.querySelectorAll('calculatedconditions band').forEach(el => {
      const name = el.getAttribute('name');
      const time = el.getAttribute('time');
      if (!bands[name]) bands[name] = {};
      bands[name][time] = el.textContent.trim();
    });

    renderSolarData({
      sfi: get('solarflux'),
      sunspots: get('sunspots'),
      kIndex: get('kindex'),
      aIndex: get('aindex'),
      xray: get('xray'),
      geoField: get('geomagfield'),
      solarWind: get('solarwind'),
      signalNoise: get('signalnoise'),
      updated: get('updated'),
      bands,
    });
  } catch (e) {
    console.error('Solar data load failed:', e);
    const card = document.getElementById('solar-card');
    if (card) card.innerHTML = '<div class="text-muted text-center p-2">Solar data unavailable</div>';
  }
}

function solarKColor(k) {
  const n = parseInt(k);
  if (isNaN(n)) return '#94a3b8';
  if (n <= 1) return '#198754';
  if (n <= 3) return '#fbbf24';
  if (n <= 5) return '#fd7e14';
  return '#dc3545';
}

function solarAColor(a) {
  const n = parseInt(a);
  if (isNaN(n)) return '#94a3b8';
  if (n <= 7)  return '#198754';
  if (n <= 15) return '#fbbf24';
  if (n <= 29) return '#fd7e14';
  return '#dc3545';
}

function solarXrayColor(x) {
  if (!x || x === '--') return '#94a3b8';
  const c = x[0].toUpperCase();
  if (c === 'A' || c === 'B') return '#198754';
  if (c === 'C') return '#fbbf24';
  if (c === 'M') return '#fd7e14';
  if (c === 'X') return '#dc3545';
  return '#94a3b8';
}

function conditionColor(cond) {
  if (!cond || cond === '--') return '#475569';
  switch (cond.toLowerCase()) {
    case 'good': return '#198754';
    case 'fair': return '#fd7e14';
    case 'poor': return '#dc3545';
    default:     return '#475569';
  }
}

function renderSolarData({ sfi, sunspots, kIndex, aIndex, xray, geoField, solarWind, signalNoise, updated, bands }) {
  const card = document.getElementById('solar-card');
  if (!card) return;

  const updEl = document.getElementById('solar-updated');
  if (updEl && updated !== '--') updEl.textContent = `Updated: ${updated}`;

  const indices = [
    { label: 'SFI',        value: sfi,       color: '#60a5fa' },
    { label: 'Sunspots',   value: sunspots,  color: '#a78bfa' },
    { label: 'K-index',    value: kIndex,    color: solarKColor(kIndex) },
    { label: 'A-index',    value: aIndex,    color: solarAColor(aIndex) },
    { label: 'X-ray',      value: xray,      color: solarXrayColor(xray) },
    { label: 'Geomag',     value: geoField,  color: '#94a3b8' },
    { label: 'Solar Wind', value: solarWind !== '--' ? solarWind + ' km/s' : '--', color: '#94a3b8' },
    { label: 'Sig/Noise',  value: signalNoise, color: '#94a3b8' },
  ];

  // 4-column grid of index badges (2 rows of 4, more compact)
  const indexHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
      ${indices.map(idx => `
        <div style="background:#0f3460;border-radius:5px;padding:3px 5px;text-align:center">
          <div style="font-size:0.58rem;color:#b0c0d8;text-transform:uppercase;letter-spacing:0.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${idx.label}</div>
          <div style="font-size:0.9rem;font-weight:700;color:${idx.color};line-height:1.2">${escHtml(idx.value)}</div>
        </div>`).join('')}
    </div>`;

  const bandOrder = ['80m-40m', '30m-20m', '17m-15m', '12m-10m'];
  const bandLabel = { '80m-40m': '80-40m', '30m-20m': '30-20m', '17m-15m': '17-15m', '12m-10m': '12-10m' };

  const bandRows = bandOrder.map(b => {
    const day   = bands[b]?.day   ?? '--';
    const night = bands[b]?.night ?? '--';
    return `<tr>
      <td style="color:#c8d8ee;font-size:0.78rem;padding:2px 6px 2px 0;white-space:nowrap">${bandLabel[b] ?? b}</td>
      <td style="padding:2px 3px"><span style="background:${conditionColor(day)};color:#fff;font-size:0.7rem;padding:1px 6px;border-radius:4px;display:inline-block;font-weight:600">${escHtml(day)}</span></td>
      <td style="padding:2px 3px"><span style="background:${conditionColor(night)};color:#fff;font-size:0.7rem;padding:1px 6px;border-radius:4px;display:inline-block;font-weight:600">${escHtml(night)}</span></td>
    </tr>`;
  }).join('');

  const bandHTML = `
    <div class="solar-bands" style="flex-shrink:0">
      <div style="font-size:0.63rem;color:#b0c0d8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">HF Bands</div>
      <table style="border-collapse:collapse;width:100%">
        <thead>
          <tr>
            <th style="font-size:0.63rem;color:#b0c0d8;padding:1px 6px 3px 0;text-align:left">Band</th>
            <th style="font-size:0.63rem;color:#b0c0d8;padding:1px 3px 3px;text-align:left">☀ Day</th>
            <th style="font-size:0.63rem;color:#b0c0d8;padding:1px 3px 3px;text-align:left">☽ Night</th>
          </tr>
        </thead>
        <tbody>${bandRows}</tbody>
      </table>
    </div>`;

  // Side-by-side: index grid left, band conditions right
  card.innerHTML = `
    <div class="solar-layout" style="display:flex;gap:12px;align-items:start">
      <div class="solar-indices" style="flex:1;min-width:0">${indexHTML}</div>
      ${bandHTML}
    </div>`;
}

// ── DX Cluster Band Activity ─────────────────────────────────────────────────

const DXC_REGION_LABELS = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe',
  NA: 'North America', OC: 'Oceania', SA: 'South America',
};

function dxcHeatColor(count) {
  if (count === 0) return { bg: '#0d1b2a', fg: '#1e3a5f' };
  if (count < 4)  return { bg: '#1a4731', fg: '#86efac' };
  if (count < 10) return { bg: '#166534', fg: '#4ade80' };
  if (count < 20) return { bg: '#92400e', fg: '#fbbf24' };
  if (count < 30) return { bg: '#9a3412', fg: '#fb923c' };
  return                  { bg: '#7f1d1d', fg: '#f87171' };
}

function renderDxHeatmap({ region, bands, continents, counts }) {
  const card = document.getElementById('dxc-card');
  if (!card) return;

  const updEl = document.getElementById('dxc-updated');
  if (updEl) updEl.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const regionLabel = DXC_REGION_LABELS[region] || region;

  const thBase = 'font-size:0.63rem;color:#b0c0d8;text-transform:uppercase;letter-spacing:0.03em;padding:2px 4px;text-align:center;font-weight:600;white-space:nowrap';
  const headers = continents.map(c => `<th style="${thBase}">${c}</th>`).join('');

  const rows = bands.map((band, i) => {
    const rowBg = i % 2 === 0 ? '#0d1626' : '#111e30';
    const cells = continents.map(cont => {
      const count = counts[band]?.[cont] ?? 0;
      const { bg, fg } = dxcHeatColor(count);
      const cellBg = count === 0 ? rowBg : bg;
      const display = count === 0 ? '' : String(count);
      return `<td style="background:${cellBg};color:${fg};text-align:center;padding:3px 4px;border:1px solid #060e18;font-size:0.72rem;font-weight:${count > 0 ? '700' : '400'};min-width:28px">${display}</td>`;
    }).join('');
    return `<tr style="background:${rowBg}">
      <td style="background:${rowBg};color:#c8d8ee;font-size:0.72rem;padding:3px 8px 3px 2px;white-space:nowrap;font-weight:600">${escHtml(band)}</td>
      ${cells}
    </tr>`;
  }).join('');

  const legendItems = [
    { bg: '#1a4731', label: '1–3' },
    { bg: '#166534', label: '4–9' },
    { bg: '#92400e', label: '10–19' },
    { bg: '#9a3412', label: '20–29' },
    { bg: '#7f1d1d', label: '30+' },
  ];
  const legendHTML = legendItems.map(i =>
    `<span style="display:inline-flex;align-items:center;gap:2px">
      <span style="width:10px;height:10px;background:${i.bg};display:inline-block;border-radius:1px;flex-shrink:0"></span>
      <span style="font-size:0.6rem;color:#94a3b8">${i.label}</span>
    </span>`
  ).join('');

  card.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="font-size:0.63rem;color:#b0c0d8;padding:2px 8px 3px 2px;text-align:left;font-weight:600">Band</th>
            ${headers}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
        <span style="font-size:0.6rem;color:#64748b">Spots from ${escHtml(regionLabel)} · last 60 min · <a href="https://www.dxsummit.fi" target="_blank" rel="noopener" style="color:#60a5fa">DXSummit</a></span>
        <span style="margin-left:auto;display:inline-flex;gap:5px;align-items:center">${legendHTML}</span>
      </div>
    </div>`;
}

async function loadDxCluster() {
  const card = document.getElementById('dxc-card');
  if (!card) return;
  try {
    const settings = await apiGet('/settings/dxcluster');
    const region = (settings.region || 'NA').toUpperCase();
    const data = await apiGet(`/dxcluster/spots?region=${region}`);
    renderDxHeatmap(data);
  } catch (e) {
    console.error('DX cluster load failed:', e);
    if (card) card.innerHTML = '<div class="text-muted text-center p-2">Band activity unavailable</div>';
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
      if (msg.type === 'workflow_complete') {
        if (!msg.success && msg.error) alert(`Workflow failed: ${msg.error}`);
        loadSystemState();
      }
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
    if (!destroyed) setTimeout(() => { if (!destroyed) { connectWS(); loadSystemState(); } }, 5000);
  };

  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
}
