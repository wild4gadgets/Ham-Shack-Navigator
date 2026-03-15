import { apiGet, apiPost } from '../api.js';
import { getToken } from '../state.js';

let ws = null;
let pingInterval = null;
let destroyed = false;
let radarMap = null;
let radarLayer = null;
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
              <button id="btn-enable" class="btn btn-sm btn-success">Enable</button>
              <button id="btn-disable" class="btn btn-sm btn-warning">Disable</button>
              <button id="btn-trigger" class="btn btn-sm btn-danger">Manual Trigger</button>
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

      <!-- Weather Cards -->
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-wind me-2"></i>Wind</div>
          <div class="card-body p-2" id="wind-card">
            <div class="text-muted text-center pt-3">Loading...</div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-thermometer-half me-2"></i>Temperature</div>
          <div class="card-body p-2" id="temp-card">
            <div class="text-muted text-center pt-3">Loading...</div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-header"><i class="bi bi-lightning-charge me-2"></i>Lightning</div>
          <div class="card-body d-flex flex-column justify-content-center align-items-center" id="lightning-card">
            <div class="weather-value" id="lightning-value">--</div>
            <div class="weather-unit" id="lightning-unit">miles away</div>
            <div class="mt-2 text-muted" id="lightning-desc"></div>
          </div>
        </div>
      </div>

      <!-- 24-Hour Forecast -->
      <div class="col-12">
        <div class="card">
          <div class="card-header"><i class="bi bi-calendar-range me-2"></i>24-Hour Forecast</div>
          <div class="card-body p-2" id="forecast-strip">
            <div class="text-muted text-center">Loading...</div>
          </div>
        </div>
      </div>

      <!-- Radar -->
      <div class="col-12">
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
          <div id="radar-map" style="height:400px;background:#1a1a2e"></div>
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
  if (ws) { ws.close(); ws = null; }
  if (radarAnimInterval) { clearInterval(radarAnimInterval); radarAnimInterval = null; }
  if (radarMap) { radarMap.remove(); radarMap = null; }
  radarLayer = null;
  radarFrames = [];
  radarPlaying = false;
}

async function loadAll() {
  await Promise.all([loadMonitoringStatus(), loadWeather(), loadRecentEvents(), loadRadar(), loadPins()]);
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
    let html = `<span id="btn-armed-toggle" class="badge ${s.enabled ? 'bg-success' : 'bg-secondary'} me-2"
      style="cursor:pointer" title="Click to ${s.enabled ? 'disarm' : 'arm'}">${s.enabled ? 'Armed' : 'Disarmed'}</span>`;
    if (s.in_cooldown) {
      html += `<span class="badge bg-info me-2">Cooldown: ${s.cooldown_remaining_min.toFixed(0)} min remaining</span>`;
    }
    if (s.last_shutdown_at) {
      html += `<small class="text-muted ms-3">Last shutdown: ${new Date(s.last_shutdown_at).toLocaleString()}</small>`;
    }
    area.innerHTML = html;

    document.getElementById('btn-armed-toggle').addEventListener('click', async () => {
      const toggle = document.getElementById('btn-armed-toggle');
      toggle.style.opacity = '0.5';
      toggle.style.pointerEvents = 'none';
      await (s.enabled ? apiPost('/monitoring/disable') : apiPost('/monitoring/enable'));
      await loadMonitoringStatus();
    });
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

  return `<svg viewBox="0 0 200 205" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-height:230px">
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

function renderForecast(fList, metric) {
  const el = document.getElementById('forecast-strip');
  if (!el) return;
  if (!fList.length) {
    el.innerHTML = '<div class="text-muted text-center p-2">No forecast data</div>';
    return;
  }

  const tempUnit = metric ? '°C' : '°F';
  const windUnit = metric ? 'km/h' : 'mph';

  const slots = fList.map(entry => {
    const dt = new Date(entry.dt * 1000);
    const timeLabel = dt.toLocaleTimeString([], { hour: 'numeric', hour12: true });
    const temp = entry.main?.temp != null ? Math.round(entry.main.temp) : '--';
    const pop = entry.pop != null ? Math.round(entry.pop * 100) : 0;
    const rawSpeed = entry.wind?.speed ?? null;
    const windSpeed = rawSpeed != null
      ? Math.round(metric ? rawSpeed * 3.6 : rawSpeed)
      : null;
    const desc = entry.weather?.[0]?.description ?? '';
    const icon = owmIcon(entry.weather);
    const iconColor = owmIconColor(entry.weather);
    const popColor = pop >= 60 ? '#60a5fa' : pop >= 30 ? '#93c5fd' : '#475569';

    return `
      <div class="d-flex flex-column align-items-center gap-1 px-1" style="min-width:68px;flex:1" title="${desc}">
        <div style="font-size:0.7rem;color:#94a3b8;white-space:nowrap">${timeLabel}</div>
        <i class="bi ${icon}" style="font-size:1.35rem;color:${iconColor}"></i>
        <div style="font-size:0.85rem;font-weight:600;color:#f1f5f9">${temp}${tempUnit}</div>
        <div style="font-size:0.72rem;color:${popColor}">${pop > 0 ? '💧 ' + pop + '%' : ''}</div>
        <div style="font-size:0.68rem;color:#64748b">${windSpeed != null ? windSpeed + ' ' + windUnit : ''}</div>
      </div>`;
  });

  el.innerHTML = `<div class="d-flex overflow-auto py-1" style="gap:0.25rem">${slots.join('')}</div>`;
}

// ── Weather loading ──────────────────────────────────────────────────────────

async function loadWeather() {
  try {
    const [current, forecast, realtime, loc] = await Promise.all([
      apiGet('/weather/current'),
      apiGet('/weather/forecast'),
      apiGet('/weather/realtime'),
      apiGet('/settings/location'),
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

    // ── Lightning (keep text display) ──
    if (realtime.data) {
      const values = realtime.data?.data?.values || {};
      const lightEl = document.getElementById('lightning-value');
      const lightUnit = document.getElementById('lightning-unit');
      const lightDesc = document.getElementById('lightning-desc');
      if (lightUnit) lightUnit.textContent = metric ? 'km away' : 'miles away';
      if (lightEl && values.lightningDistance != null) {
        const dist = metric
          ? values.lightningDistance.toFixed(1)
          : (values.lightningDistance * 0.621371).toFixed(1);
        lightEl.textContent = dist;
        if (lightDesc) lightDesc.textContent = `Updated: ${new Date(realtime.fetched_at).toLocaleTimeString()}`;
      } else if (lightEl) {
        lightEl.textContent = '∞';
        if (lightDesc) lightDesc.textContent = 'No lightning detected';
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
    const bg = isOn === null ? '#6c757d' : (isOn ? '#198754' : '#495057');
    const stateText = isOn === null ? '?' : (isOn ? 'ON' : 'OFF');
    return `<button class="pin-badge border-0 rounded" style="background:${bg};color:#fff;cursor:pointer;font-size:0.72rem;padding:3px 9px;line-height:1.4"
      data-pin-type="${pin.type}" data-pin-id="${pin.id}" title="${escHtml(pin.device_name)}">
      <i class="bi ${icon} me-1"></i>${label} <span style="opacity:0.8">${stateText}</span>
    </button>`;
  }).join('');

  el.querySelectorAll('.pin-badge').forEach(btn => {
    btn.addEventListener('click', () => togglePin(btn.dataset.pinType, parseInt(btn.dataset.pinId)));
  });
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
    if (!destroyed) setTimeout(() => { if (!destroyed) connectWS(); }, 5000);
  };

  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
}
