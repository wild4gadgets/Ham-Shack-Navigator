import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
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
let pskZoomHandler = null;
let radarMap = null;
let radarLayer = null;
let lightningLayer = null;
let radarLabelsLayer = null;
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
let blitzortungFlashTimer = null;
let blitzortungMarkers = []; // {marker: L.CircleMarker, time: Date}
let blitzortungCleanupTimer = null;
let useMetric = false;
let _nearestLightningKm = null;
let _nearestLightningAt = 0; // epoch ms of last WS-sourced update
const BLITZ_FADE_MS = 15 * 60 * 1000;
let flexRadioRefreshTimer = null;
let flrigRefreshTimer = null;
let solarRefreshTimer = null;
let dxcRefreshTimer = null;
let radarRefreshTimer = null;
let pskRefreshTimer = null;
let pskCountdownTimer = null;
let pskNextRefreshAt = null;
let pskPaused = false;
let pskRadioOffline = false;
let pskMap = null;
let pskSpotLayer = null;
let pskTerminator = null;
let pskTerminatorTimer = null;
let systemState = { last: null, startup_id: null, shutdown_id: null };
let _workflowDelayTimer = null;
let _runningWorkflowName = null;
let flexFreqSteps = { small: 50.0, large: 100.0 };
let _txButtonLabel = 'MOX';
let _flexRadios = [];
let _selectedRadioIndex = -1; // -1 = not yet initialised
let _nonPrimaryPingCache = { idx: -1, success: null, rtt_ms: null, ts: 0 };
let _optimisticFreqMhz = null;
let _optimisticFlrigFreqHz = null;
let _currentRfpower = null;  // latest rfpower from WS broadcast; bypasses stale server-fetch
let _activeRig = 'flexradio'; // 'flexradio' | 'flrig'
let _lastFlrigStatus = null;
const _bandFreqMemory = {};
const _HF_BANDS = ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m'];
const _BAND_DEFAULTS = {
  '160m': 1.900, '80m': 3.750, '60m': 5.358,
  '40m': 7.150, '30m': 10.125, '20m': 14.175,
  '17m': 18.118, '15m': 21.225, '12m': 24.940, '10m': 28.850,
};

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function renderDashboard(container) {
  destroyed = false;
  container.innerHTML = `
    <div id="dashboard-rows" class="d-flex flex-column gap-3">

      <!-- Monitoring Control — fixed, never draggable -->
      <div class="db-section" data-section="monitoring">
        <div class="card">
          <div class="card-header monitoring-header d-flex align-items-center gap-2 flex-wrap">
            <span class="me-1"><i class="bi bi-shield-check me-2"></i>System Monitor</span>
            <div id="monitoring-status-area"><span class="text-muted">Loading...</span></div>
            <div id="dashboard-pins" class="d-flex flex-wrap gap-1 align-items-center"></div>
            <div class="ms-auto d-flex align-items-center gap-2">
              <span id="workflow-step-badge" class="badge bg-info" style="display:none"></span>
              <span id="workflow-delay-badge" class="badge bg-secondary" style="display:none"></span>
              <div class="dropdown" id="system-workflow-dropdown">
                <button class="btn btn-sm btn-secondary dropdown-toggle" id="btn-system-toggle"
                        type="button" data-bs-toggle="dropdown" aria-expanded="false" disabled>...</button>
                <ul class="dropdown-menu dropdown-menu-end" id="workflow-dropdown-menu"></ul>
              </div>
              <button id="btn-reset-layout" class="btn btn-sm btn-outline-secondary" title="Reset tile layout to default">
                <i class="bi bi-layout-three-columns"></i>
              </button>
              <button id="btn-events-log" class="btn btn-sm btn-outline-light" title="Event Log">
                <i class="bi bi-clock-history"></i>
              </button>
              <button id="btn-refresh" class="btn btn-sm btn-outline-light">
                <i class="bi bi-arrow-clockwise"></i> Refresh
              </button>
            </div>
          </div>
          <div class="card-body d-flex align-items-center flex-wrap gap-2 py-2">
            <div id="flexradio-status" class="d-flex flex-wrap align-items-center gap-1"></div>
            <div id="flrig-status" class="d-flex flex-wrap align-items-center gap-1"></div>
            <div class="ms-auto"><small id="weather-update-time" class="text-white-50"></small></div>
          </div>
        </div>
      </div>

      <!-- Weather Group: Wind + Temperature + Lightning -->
      <div class="db-section db-draggable" data-section="weather">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
        <div class="row g-3">
          <div class="col-12 col-md-4">
            <div class="card">
              <div class="card-header"><i class="bi bi-wind me-2"></i>Wind</div>
              <div class="card-body p-1 weather-tile-body" id="wind-card" style="overflow:hidden">
                <div class="text-muted text-center pt-3">Loading...</div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="card">
              <div class="card-header"><i class="bi bi-thermometer-half me-2"></i>Temperature</div>
              <div class="card-body p-1 weather-tile-body" id="temp-card" style="overflow:hidden">
                <div class="text-muted text-center pt-3">Loading...</div>
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="card">
              <div class="card-header"><i class="bi bi-lightning-charge me-2"></i>Lightning</div>
              <div class="card-body d-flex flex-column justify-content-center align-items-center weather-tile-body" id="lightning-card">
                <div class="weather-value" id="lightning-value">--</div>
                <div class="weather-unit" id="lightning-unit">miles away</div>
                <div class="mt-2 text-muted" id="lightning-desc"></div>
                <div id="blitzortung-badge" style="display:none" class="mt-2">
                  <span class="badge bg-warning text-dark">
                    <i class="bi bi-lightning-fill me-1"></i>
                    <span id="blitzortung-strike-text">Live: -- km</span>
                  </span>
                </div>
                <div id="blitzortung-history" class="mt-1 w-100" style="display:none;font-size:0.72rem;color:#94a3b8;max-height:60px;overflow-y:auto"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 24-Hour Forecast — group draggable -->
      <div class="db-section db-draggable" data-section="forecast">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
        <div class="card">
          <div class="card-header"><i class="bi bi-calendar-range me-2"></i>24-Hr Forecast</div>
          <div class="card-body p-2" id="forecast-strip">
            <div class="text-muted text-center">Loading...</div>
          </div>
        </div>
      </div>

      <!-- Local Radar — independent draggable -->
      <div class="db-section db-draggable" data-section="radar">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
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
          <div id="radar-map" style="aspect-ratio:1/1;width:67%;max-height:600px;background:#1a1a2e;margin:0 auto"></div>
        </div>
      </div>

      <!-- Solar Propagation + DX Band Activity — group draggable -->
      <div class="db-section db-draggable" data-section="solar">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
        <div class="row g-3">
          <div class="col-12 col-lg-6">
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
          <div class="col-12 col-lg-6">
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

      <!-- Warnings & Alerts — group draggable -->
      <div class="db-section db-draggable" data-section="alerts" style="display:none">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
        <div id="alerts-area"></div>
      </div>

      <!-- PSK Reporter Spots — independent draggable -->
      <div class="db-section db-draggable" data-section="psk">
        <div class="drag-handle"><i class="bi bi-grip-horizontal"></i></div>
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-broadcast-pin me-2"></i>PSK Reporter Spots</span>
            <div class="d-flex align-items-center gap-2">
              <div class="d-flex align-items-center gap-1">
                <input type="text" id="psk-qrz-input" class="form-control form-control-sm"
                  placeholder="Callsign" style="width:100px;text-transform:uppercase" maxlength="12" />
                <button id="btn-psk-qrz" class="btn btn-sm btn-outline-info" title="QRZ Lookup">QRZ</button>
              </div>
              <small id="psk-updated" class="text-white-50"></small>
              <button id="btn-psk-pause" class="btn btn-sm btn-outline-warning" title="Pause auto-refresh">
                <i class="bi bi-pause-fill"></i>
              </button>
              <button id="btn-psk-center" class="btn btn-sm btn-outline-info" title="Center map on your station">
                Center
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

    </div>

    <!-- Tune Frequency Modal -->
    <div class="modal fade" id="tune-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog" style="max-width:340px">
        <div class="modal-content" style="background:#12122a;border:1px solid #2a2a4a;color:#e0e0e0">
          <div class="modal-header" style="border-color:#2a2a4a">
            <h5 class="modal-title">Tune Frequency</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="tune-modal-bands" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:12px">
              ${_HF_BANDS.map(b => `<button class="btn btn-sm btn-outline-secondary" data-band="${b}" style="font-size:0.75rem;padding:3px 0">${b}</button>`).join('')}
            </div>
            <label class="form-label small text-muted mb-1">or enter frequency (MHz)</label>
            <input type="text" id="tune-modal-input" class="form-control" placeholder="14.174000" />
          </div>
          <div class="modal-footer" style="border-color:#2a2a4a">
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" id="btn-tune-modal-submit" class="btn btn-sm btn-success">Tune</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode Picker Modal -->
    <div class="modal fade" id="mode-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-sm">
        <div class="modal-content" style="background:#12122a;border:1px solid #2a2a4a;color:#e0e0e0">
          <div class="modal-header" style="border-color:#2a2a4a">
            <h5 class="modal-title">Select Mode</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body d-grid gap-2" id="mode-modal-buttons"></div>
        </div>
      </div>
    </div>

    <!-- Power Control Modal -->
    <div class="modal fade" id="power-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog" style="max-width:320px">
        <div class="modal-content" style="background:#12122a;border:1px solid #2a2a4a;color:#e0e0e0">
          <div class="modal-header" style="border-color:#2a2a4a">
            <h5 class="modal-title">TX Power</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="text-center mb-2">
              <span id="power-modal-val" style="font-size:2rem;font-weight:700;color:#00e676">100</span>
              <span style="font-size:1.1rem;color:#aaa">W</span>
            </div>
            <input type="range" id="power-modal-slider" class="form-range" min="1" max="100" step="1" value="100" />
            <div class="d-flex justify-content-between mt-3" style="gap:4px;flex-wrap:wrap">
              ${[10,25,50,75,100].map(p => `<button class="btn btn-sm btn-outline-secondary power-preset" data-watts="${p}" style="flex:1;min-width:0">${p}W</button>`).join('')}
            </div>
          </div>
          <div class="modal-footer" style="border-color:#2a2a4a">
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" id="btn-power-modal-submit" class="btn btn-sm btn-success">Set</button>
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

    <!-- Event Log Modal -->
    <div class="modal fade" id="events-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content" style="background:#12122a;border:1px solid #2a2a4a;color:#e0e0e0">
          <div class="modal-header" style="border-color:#2a2a4a">
            <h5 class="modal-title"><i class="bi bi-clock-history me-2"></i>Event Log</h5>
            <div class="d-flex gap-2 ms-3">
              <select id="em-filter-type" class="form-select form-select-sm" style="width:auto">
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
                <option>login</option>
                <option>error</option>
                <option>info</option>
              </select>
              <select id="em-filter-severity" class="form-select form-select-sm" style="width:auto">
                <option value="">All Severities</option>
                <option>info</option>
                <option>warning</option>
                <option>critical</option>
              </select>
              <button id="btn-em-refresh" class="btn btn-sm btn-outline-secondary" title="Refresh"><i class="bi bi-arrow-clockwise"></i></button>
            </div>
            <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-0" id="em-body">
            <div class="text-center text-muted p-4">Loading…</div>
          </div>
          <div class="modal-footer justify-content-center" style="border-color:#2a2a4a" id="em-pagination"></div>
        </div>
      </div>
    </div>
  `;

  await loadAll();
  connectWS();
  await restoreTileOrder();
  initDashboardDnD();

  if (pskZoomHandler) document.removeEventListener('keydown', pskZoomHandler);
  pskZoomHandler = (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
      pskMap?.zoomIn();
      radarMap?.zoomIn();
    } else if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
      pskMap?.zoomOut();
      radarMap?.zoomOut();
    } else if (e.key === ',' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      stepFreq(-flexFreqSteps.small);
    } else if (e.key === '.' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      stepFreq(flexFreqSteps.small);
    } else if (e.key === '<' && !e.ctrlKey && !e.metaKey) {
      stepFreq(-flexFreqSteps.large);
    } else if (e.key === '>' && !e.ctrlKey && !e.metaKey) {
      stepFreq(flexFreqSteps.large);
    }
  };
  document.addEventListener('keydown', pskZoomHandler);

  if (!isAdmin()) {
    document.getElementById('btn-system-toggle').disabled = true;
    document.getElementById('btn-system-toggle').title = 'Admin access required';
  }

  document.getElementById('system-workflow-dropdown').addEventListener('show.bs.dropdown', () => {
    _populateWorkflowDropdown();
  });

  document.getElementById('workflow-dropdown-menu').addEventListener('click', async e => {
    e.preventDefault();
    bootstrap.Dropdown.getInstance(document.getElementById('btn-system-toggle'))?.hide();
    const endBtn = e.target.closest('#workflow-end-btn');
    if (endBtn) {
      if (!confirm(`Stop workflow '${_runningWorkflowName}'?`)) return;
      try {
        await apiDelete('/workflows/running');
      } catch (err) {
        alert(`Could not end workflow: ${err.message}`);
      }
      return;
    }
    const item = e.target.closest('[data-workflow-id]');
    if (!item) return;
    const id = parseInt(item.dataset.workflowId, 10);
    const name = item.dataset.workflowName;
    if (!confirm(`Run workflow '${name}' now?`)) return;
    _setWorkflowRunning(name);
    try {
      await apiPost(`/workflows/${id}/run`, {});
    } catch (err) {
      if (err.message.includes('504')) return;
      alert(`Could not start workflow: ${err.message}`);
      _clearWorkflowRunning();
      await loadSystemState();
    }
  });
  document.getElementById('flexradio-status')?.addEventListener('change', e => {
    const sel = e.target.closest('#flex-radio-picker');
    if (sel) {
      _selectedRadioIndex = parseInt(sel.value, 10);
      _nonPrimaryPingCache = { idx: -1, success: null, rtt_ms: null, ts: 0 }; // force immediate ping
      loadFlexRadioStatus();
    }
  });
  document.getElementById('flexradio-status')?.addEventListener('click', e => {
    const stepBtn = e.target.closest('.freq-step-btn');
    if (stepBtn) {
      const dir = stepBtn.dataset.step;
      if (dir === '-large') stepFreq(-flexFreqSteps.large);
      else if (dir === '-small') stepFreq(-flexFreqSteps.small);
      else if (dir === '+small') stepFreq(flexFreqSteps.small);
      else if (dir === '+large') stepFreq(flexFreqSteps.large);
      return;
    }
    const freqBadge = e.target.closest('#flex-freq-badge');
    if (freqBadge) { openTuneModal(freqBadge.dataset.freq); return; }
    const modeBadge = e.target.closest('#flex-mode-badge');
    if (modeBadge) { openModeModal(modeBadge.dataset.mode); return; }
    const powerBadge = e.target.closest('#flex-power-badge');
    if (powerBadge) { openPowerModal(parseInt(powerBadge.dataset.power, 10)); return; }
    const moxBtn = e.target.closest('#flex-mox-btn');
    if (moxBtn) { toggleMox(moxBtn); return; }
    const tuneBtn = e.target.closest('#flex-tune-btn');
    if (tuneBtn) toggleTuneCarrier(tuneBtn);
  });

  document.getElementById('flrig-status')?.addEventListener('click', e => {
    const stepBtn = e.target.closest('.flrig-step-btn');
    if (stepBtn) {
      const dir = stepBtn.dataset.step;
      if (dir === '-large') stepFlrigFreq(-flexFreqSteps.large);
      else if (dir === '-small') stepFlrigFreq(-flexFreqSteps.small);
      else if (dir === '+small') stepFlrigFreq(flexFreqSteps.small);
      else if (dir === '+large') stepFlrigFreq(flexFreqSteps.large);
      return;
    }
    const freqBadge = e.target.closest('#flrig-freq-badge');
    if (freqBadge) { openTuneModal((parseFloat(freqBadge.dataset.freqHz) / 1e6).toFixed(6)); return; }
    const modeBadge = e.target.closest('#flrig-mode-badge');
    if (modeBadge) { openModeModal(modeBadge.dataset.mode); return; }
    const pttBtn = e.target.closest('#flrig-ptt-btn');
    if (pttBtn) { togglePtt(pttBtn); return; }
  });

  function openTuneModal(currentFreq) {
    const input = document.getElementById('tune-modal-input');
    if (input) input.value = currentFreq;
    const currentBand = amateurBand(parseFloat(currentFreq).toFixed(3));
    document.querySelectorAll('#tune-modal-bands [data-band]').forEach(btn => {
      const active = btn.dataset.band === currentBand;
      btn.className = `btn btn-sm ${active ? 'btn-success' : 'btn-outline-secondary'}`;
    });
    const modalEl = document.getElementById('tune-modal');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    modalEl.addEventListener('shown.bs.modal', () => { input?.select(); }, { once: true });
  }

  document.getElementById('btn-tune-modal-submit')?.addEventListener('click', async () => {
    const input = document.getElementById('tune-modal-input');
    const btn = document.getElementById('btn-tune-modal-submit');
    const freq = parseFloat(input?.value);
    if (!freq || isNaN(freq)) return;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      if (_activeRig === 'flrig') {
        await apiPost('/flrig/tune', { frequency_hz: Math.round(freq * 1e6) });
        _optimisticFlrigFreqHz = Math.round(freq * 1e6);
        loadFlrigStatus();
      } else {
        await apiPost('/flexradio/tune', { freq_mhz: freq });
        _optimisticFreqMhz = freq;
        loadFlexRadioStatus();
      }
      bootstrap.Modal.getInstance(document.getElementById('tune-modal'))?.hide();
    } catch (e) {
      alert(`Tune failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tune';
    }
  });

  document.getElementById('tune-modal-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-tune-modal-submit')?.click();
  });

  document.getElementById('tune-modal-bands')?.addEventListener('click', async e => {
    const bandBtn = e.target.closest('[data-band]');
    if (!bandBtn) return;
    const band = bandBtn.dataset.band;
    const freq = _bandFreqMemory[band] ?? _BAND_DEFAULTS[band];
    bandBtn.disabled = true;
    try {
      if (_activeRig === 'flrig') {
        await apiPost('/flrig/tune', { frequency_hz: Math.round(freq * 1e6) });
        _optimisticFlrigFreqHz = Math.round(freq * 1e6);
        loadFlrigStatus();
      } else {
        await apiPost('/flexradio/tune', { freq_mhz: freq });
        _optimisticFreqMhz = freq;
        loadFlexRadioStatus();
      }
      bootstrap.Modal.getInstance(document.getElementById('tune-modal'))?.hide();
    } catch (err) {
      alert(`Tune failed: ${err.message}`);
    } finally {
      bandBtn.disabled = false;
    }
  });

  const MODES = ['AM', 'CW', 'DIGL', 'DIGU', 'LSB', 'RTTY', 'USB'];

  function openModeModal(currentMode) {
    const container = document.getElementById('mode-modal-buttons');
    if (container) {
      const modes = _activeRig === 'flrig' && _lastFlrigStatus?.available_modes?.length
        ? _lastFlrigStatus.available_modes
        : MODES;
      container.innerHTML = modes.map(m => {
        const active = m.toUpperCase() === (currentMode || '').toUpperCase();
        return `<button class="btn btn-sm ${active ? 'btn-success' : 'btn-outline-secondary'}" data-mode-pick="${m}">${m}</button>`;
      }).join('');
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('mode-modal')).show();
  }

  document.getElementById('mode-modal-buttons')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-mode-pick]');
    if (!btn) return;
    const mode = btn.dataset.modePick;
    btn.disabled = true;
    try {
      if (_activeRig === 'flrig') {
        await apiPost('/flrig/mode', { mode });
      } else {
        await apiPost('/flexradio/mode', { mode });
      }
      bootstrap.Modal.getInstance(document.getElementById('mode-modal'))?.hide();
    } catch (err) {
      alert(`Mode change failed: ${err.message}`);
      btn.disabled = false;
    }
  });

  function openPowerModal(currentPower) {
    const slider = document.getElementById('power-modal-slider');
    const val = document.getElementById('power-modal-val');
    const pwr = isNaN(currentPower) ? 100 : Math.max(1, Math.min(100, currentPower));
    if (slider) slider.value = pwr;
    if (val) val.textContent = pwr;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('power-modal')).show();
  }

  document.getElementById('power-modal-slider')?.addEventListener('input', e => {
    const val = document.getElementById('power-modal-val');
    if (val) val.textContent = e.target.value;
  });

  document.getElementById('power-modal')?.addEventListener('click', e => {
    const preset = e.target.closest('.power-preset');
    if (!preset) return;
    const w = parseInt(preset.dataset.watts, 10);
    const slider = document.getElementById('power-modal-slider');
    const val = document.getElementById('power-modal-val');
    if (slider) slider.value = w;
    if (val) val.textContent = w;
  });

  document.getElementById('btn-power-modal-submit')?.addEventListener('click', async () => {
    const slider = document.getElementById('power-modal-slider');
    const btn = document.getElementById('btn-power-modal-submit');
    const rf_power = parseInt(slider?.value, 10);
    if (!rf_power || isNaN(rf_power)) return;
    btn.disabled = true;
    btn.textContent = '…';
    const badge = document.getElementById('flex-power-badge');
    const prevPower = badge ? parseInt(badge.dataset.power, 10) : null;
    _currentRfpower = rf_power;
    if (badge) { badge.textContent = `${rf_power}W`; badge.dataset.power = rf_power; }
    try {
      await apiPost('/flexradio/power', { rf_power });
      bootstrap.Modal.getInstance(document.getElementById('power-modal'))?.hide();
    } catch (e) {
      if (badge && prevPower !== null) { badge.textContent = `${prevPower}W`; badge.dataset.power = prevPower; }
      alert(`Power change failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Set';
    }
  });

  async function toggleTuneCarrier(btn) {
    const active = btn.dataset.tuneActive === '1';
    btn.disabled = true;
    try {
      await apiPost('/flexradio/tune-carrier', { active: !active });
    } catch (e) {
      alert(`Tune carrier failed: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  async function toggleMox(btn) {
    const isTx = btn.dataset.isTx === '1';
    const newMox = !isTx;
    btn.disabled = true;
    try {
      await apiPost('/flexradio/mox', { mox: newMox });
    } catch (e) {
      alert(`MOX failed: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.disabled = true;
    await apiPost('/weather/refresh');
    await loadWeather();
    btn.disabled = false;
    btn.textContent = 'Refreshed';
    setTimeout(() => { btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh'; }, 2500);
  });

  document.getElementById('btn-reset-layout')?.addEventListener('click', async () => {
    await apiPut('/settings/dashboard-layout', { order: DEFAULT_TILE_ORDER });
    cleanup();
    renderDashboard(container);
  });

  // Events modal
  let emPage = 1;
  async function loadEventsModal(page) {
    emPage = page;
    const type = document.getElementById('em-filter-type')?.value || '';
    const sev  = document.getElementById('em-filter-severity')?.value || '';
    let q = `/events?page=${page}&page_size=50`;
    if (type) q += `&event_type=${encodeURIComponent(type)}`;
    if (sev)  q += `&severity=${encodeURIComponent(sev)}`;
    const body = document.getElementById('em-body');
    if (!body) return;
    try {
      const result = await apiGet(q);
      const sevClass = { info: 'badge-info', warning: 'badge-warning', critical: 'badge-critical' };
      if (!result.items?.length) {
        body.innerHTML = '<div class="text-center text-muted p-4">No events found</div>';
      } else {
        body.innerHTML = `
          <table class="table table-dark table-sm table-hover mb-0">
            <thead class="sticky-top"><tr>
              <th>Time</th><th>Type</th><th>Severity</th><th>Message</th><th>Metadata</th>
            </tr></thead>
            <tbody>${result.items.map(ev => `<tr>
              <td><small>${new Date(ev.created_at.slice(0,19)+'Z').toLocaleString(undefined,{dateStyle:'short',timeStyle:'medium'})}</small></td>
              <td><small class="font-monospace">${ev.event_type}</small></td>
              <td><span class="badge ${sevClass[ev.severity]||'bg-secondary'}">${ev.severity}</span></td>
              <td><small>${ev.message}</small></td>
              <td><small class="text-muted">${ev.meta ? JSON.stringify(JSON.parse(ev.meta)).substring(0,80) : ''}</small></td>
            </tr>`).join('')}</tbody>
          </table>
          <div class="p-2 text-muted text-end"><small>Total: ${result.total} events</small></div>`;
      }
      // Pagination
      const pg = document.getElementById('em-pagination');
      if (pg) {
        if (result.pages <= 1) { pg.innerHTML = ''; }
        else {
          const cur = result.page, pages = result.pages;
          let html = `<ul class="pagination pagination-sm mb-0">
            <li class="page-item ${cur===1?'disabled':''}"><a class="page-link" href="#" data-p="${cur-1}">&laquo;</a></li>`;
          for (let p = Math.max(1,cur-2); p <= Math.min(pages,cur+2); p++)
            html += `<li class="page-item ${p===cur?'active':''}"><a class="page-link" href="#" data-p="${p}">${p}</a></li>`;
          html += `<li class="page-item ${cur===pages?'disabled':''}"><a class="page-link" href="#" data-p="${cur+1}">&raquo;</a></li></ul>`;
          pg.innerHTML = html;
          pg.querySelectorAll('[data-p]').forEach(el => el.addEventListener('click', e => {
            e.preventDefault();
            const p = parseInt(el.dataset.p);
            if (p >= 1 && p <= pages) loadEventsModal(p);
          }));
        }
      }
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger m-3">Failed to load events: ${err.message}</div>`;
    }
  }

  document.getElementById('btn-events-log')?.addEventListener('click', () => {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('events-modal')).show();
    loadEventsModal(1);
  });
  document.getElementById('em-filter-type')?.addEventListener('change', () => loadEventsModal(1));
  document.getElementById('em-filter-severity')?.addEventListener('change', () => loadEventsModal(1));
  document.getElementById('btn-em-refresh')?.addEventListener('click', () => loadEventsModal(emPage));

  return cleanup;
}

const DEFAULT_TILE_ORDER = [
  'monitoring', 'weather', 'forecast', 'radar', 'solar', 'alerts', 'psk',
];

async function restoreTileOrder() {
  try {
    const data = await apiGet('/settings/dashboard-layout');
    const order = (data.order && data.order.length) ? data.order : DEFAULT_TILE_ORDER;
    const parent = document.getElementById('dashboard-rows');
    if (!parent) return;
    order.forEach(id => {
      const el = parent.querySelector(`[data-section="${id}"]`);
      if (el) parent.appendChild(el);
    });
    // Monitoring is always first regardless of saved order
    const mon = parent.querySelector('[data-section="monitoring"]');
    if (mon) parent.insertBefore(mon, parent.firstChild);
  } catch (_) { /* fall through to default order on error */ }
}

async function saveTileOrder() {
  const order = Array.from(
    document.querySelectorAll('#dashboard-rows .db-section')
  ).map(s => s.dataset.section);
  try { await apiPut('/settings/dashboard-layout', { order }); } catch (_) {}
}

function initDashboardDnD() {
  const container = document.getElementById('dashboard-rows');
  if (!container || typeof Sortable === 'undefined') return;

  container.querySelectorAll('.drag-handle').forEach(h => {
    h.title = 'Drag to reorder';
  });

  Sortable.create(container, {
    handle: '.drag-handle',
    animation: 150,
    draggable: '.db-draggable',
    onEnd: () => {
      saveTileOrder();
      radarMap?.invalidateSize();
      pskMap?.invalidateSize();
    },
  });
}

function cleanup() {
  destroyed = true;
  if (pskZoomHandler) { document.removeEventListener('keydown', pskZoomHandler); pskZoomHandler = null; }
  if (pinPollTimer) { clearInterval(pinPollTimer); pinPollTimer = null; }
  if (blitzortungFlashTimer) { clearTimeout(blitzortungFlashTimer); blitzortungFlashTimer = null; }
  if (blitzortungCleanupTimer) { clearInterval(blitzortungCleanupTimer); blitzortungCleanupTimer = null; }
  blitzortungMarkers.forEach(({ marker }) => marker.remove());
  blitzortungMarkers = [];
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (flexRadioRefreshTimer) { clearInterval(flexRadioRefreshTimer); flexRadioRefreshTimer = null; }
  if (flrigRefreshTimer) { clearInterval(flrigRefreshTimer); flrigRefreshTimer = null; }
  if (solarRefreshTimer) { clearInterval(solarRefreshTimer); solarRefreshTimer = null; }
  if (dxcRefreshTimer) { clearInterval(dxcRefreshTimer); dxcRefreshTimer = null; }
  if (radarRefreshTimer) { clearInterval(radarRefreshTimer); radarRefreshTimer = null; }
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
  radarLabelsLayer = null;
  radarFrames = [];
  radarPlaying = false;
}

function computeDeviceStatusFromPins() {
  // null  = unreachable ('?') — counts as down
  // false = off           — counts as down
  // true  = on            — counts as up
  const values = Object.values(pinStates);
  if (!values.length) return null; // no pins configured; caller falls back to backend status
  const onCount = values.filter(v => v === true).length;
  if (onCount === values.length) return 'up';
  if (onCount === 0)             return 'down';
  return 'partial';
}

function updateSystemStatusButton() {
  if (_runningWorkflowName) return;
  const btn = document.getElementById('btn-system-toggle');
  if (!btn) return;
  // Pin states are the ground truth (they reflect actual device reachability, including
  // '?' for unreachable devices).  Fall back to the backend-computed status only when
  // no dashboard pins have been configured.
  const ds = computeDeviceStatusFromPins() ?? systemState.device_status ?? 'unknown';
  const labels  = { up: 'System Up', partial: 'Partially Up', down: 'System Down', unknown: 'Status Unknown' };
  const classes = { up: 'btn-success', partial: 'btn-warning', down: 'btn-danger', unknown: 'btn-secondary' };
  btn.textContent = labels[ds] ?? 'Status Unknown';
  btn.className   = `btn btn-sm ${classes[ds] ?? 'btn-secondary'} dropdown-toggle`;
  btn.disabled    = !isAdmin();
}

function _setWorkflowRunning(workflowName) {
  _runningWorkflowName = workflowName;
  const btn = document.getElementById('btn-system-toggle');
  if (btn) {
    btn.textContent = `${workflowName} running…`;
    btn.className = 'btn btn-sm btn-warning dropdown-toggle';
    btn.disabled = !isAdmin();
  }
}

function _updateWorkflowStepBadge(stepLabel) {
  if (_workflowDelayTimer) { clearInterval(_workflowDelayTimer); _workflowDelayTimer = null; }
  const badge = document.getElementById('workflow-step-badge');
  if (badge) { badge.textContent = stepLabel; badge.style.display = ''; }
  const delay = document.getElementById('workflow-delay-badge');
  if (delay) delay.style.display = 'none';
}

function _updateWorkflowDelayBadge(delaySec) {
  if (_workflowDelayTimer) { clearInterval(_workflowDelayTimer); _workflowDelayTimer = null; }
  const badge = document.getElementById('workflow-delay-badge');
  if (!badge) return;
  let remaining = delaySec;
  badge.textContent = `Delay ${remaining}s`;
  badge.style.display = '';
  _workflowDelayTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(_workflowDelayTimer);
      _workflowDelayTimer = null;
      badge.style.display = 'none';
    } else {
      badge.textContent = `Delay ${remaining}s`;
    }
  }, 1000);
}

function _clearWorkflowRunning() {
  _runningWorkflowName = null;
  if (_workflowDelayTimer) { clearInterval(_workflowDelayTimer); _workflowDelayTimer = null; }
  const step = document.getElementById('workflow-step-badge');
  if (step) step.style.display = 'none';
  const delay = document.getElementById('workflow-delay-badge');
  if (delay) delay.style.display = 'none';
  updateSystemStatusButton();
}

async function _populateWorkflowDropdown() {
  const menu = document.getElementById('workflow-dropdown-menu');
  if (!menu) return;
  menu.innerHTML = '<li><span class="dropdown-item-text text-muted small">Loading…</span></li>';
  let workflows;
  try {
    workflows = await apiGet('/workflows');
  } catch {
    menu.innerHTML = '<li><span class="dropdown-item-text text-danger small">Failed to load workflows</span></li>';
    return;
  }
  menu.innerHTML = '';
  if (_runningWorkflowName) {
    const statusLi = document.createElement('li');
    statusLi.innerHTML = `<span class="dropdown-item-text text-warning fw-semibold">Workflow ‘${_runningWorkflowName}’ running</span>`;
    menu.appendChild(statusLi);
    const endLi = document.createElement('li');
    const endA = document.createElement('a');
    endA.className = 'dropdown-item text-danger';
    endA.href = '#';
    endA.id = 'workflow-end-btn';
    endA.textContent = 'End Workflow';
    endLi.appendChild(endA);
    menu.appendChild(endLi);
    if (workflows.length) {
      const divLi = document.createElement('li');
      divLi.innerHTML = '<hr class="dropdown-divider">';
      menu.appendChild(divLi);
      for (const wf of workflows) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item disabled';
        a.href = '#';
        a.textContent = wf.name;
        li.appendChild(a);
        menu.appendChild(li);
      }
    }
  } else if (!workflows.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dropdown-item-text text-muted">No workflows defined</span>';
    menu.appendChild(li);
  } else {
    for (const wf of workflows) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'dropdown-item';
      a.href = '#';
      a.dataset.workflowId = wf.id;
      a.dataset.workflowName = wf.name;
      a.textContent = wf.name;
      li.appendChild(a);
      menu.appendChild(li);
    }
  }
}

async function loadSystemState() {
  try {
    systemState = await apiGet('/workflows/system-state');
  } catch { return; }
  if (systemState.running_workflow_name) {
    _setWorkflowRunning(systemState.running_workflow_name);
  } else {
    updateSystemStatusButton();
  }
}

async function loadAll() {
  await loadFlexSettings();
  await loadRigControlSettings();
  await Promise.all([loadMonitoringStatus(), loadFlexRadioStatus(), loadFlrigStatus(), loadWeather(), loadRadar(), loadPins(), loadSolarData(), loadSystemState(), loadDxCluster(), initPskTile(), loadLocationProfile()]);
  if (flexRadioRefreshTimer) clearInterval(flexRadioRefreshTimer);
  flexRadioRefreshTimer = setInterval(() => { if (!destroyed) loadFlexRadioStatus(); }, 5000);
  if (flrigRefreshTimer) clearInterval(flrigRefreshTimer);
  flrigRefreshTimer = setInterval(() => { if (!destroyed) loadFlrigStatus(); }, 5000);
  if (solarRefreshTimer) clearInterval(solarRefreshTimer);
  solarRefreshTimer = setInterval(() => { if (!destroyed) loadSolarData(); }, 30 * 60 * 1000);
  if (radarRefreshTimer) clearInterval(radarRefreshTimer);
  radarRefreshTimer = setInterval(() => { if (!destroyed) loadRadar(); }, 5 * 60 * 1000);
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
    let html = `<span id="monitoring-lightning-badge" style="display:none"></span>`;
    if (s.in_cooldown) {
      html += `<span class="badge bg-info ms-1 me-2">Cooldown: ${s.cooldown_remaining_min.toFixed(0)} min remaining</span>`;
    }
    area.innerHTML = html;
    _updateLightningBannerBadge(_nearestLightningKm);
  } catch (e) {
    console.error('Status load failed:', e);
  }
}

async function loadLocationProfile() {
  const el = document.getElementById('location-profile-badge');
  if (!el) return;
  try {
    const [loc, profiles] = await Promise.all([
      apiGet('/settings/location'),
      apiGet('/settings/location/profiles'),
    ]);
    const activeId = loc?.active_profile_id;
    const profile = Array.isArray(profiles) && activeId
      ? profiles.find(p => p.id === activeId)
      : null;
    const name = profile?.name || loc?.name || '';
    el.textContent = name ? `• ${name}` : '';
  } catch {
    el.textContent = '';
  }
}

function formatFlexFreq(mhz) {
  const s = parseFloat(mhz).toFixed(6);
  const [intPart, decPart] = s.split('.');
  return `${intPart}.${decPart.slice(0, 3)}.${decPart.slice(3)}`;
}

function amateurBand(mhz) {
  const f = parseFloat(mhz);
  if (f >= 0.1357  && f <= 0.1378) return '2200m';
  if (f >= 0.472   && f <= 0.479)  return '630m';
  if (f >= 1.8     && f <= 2.0)    return '160m';
  if (f >= 3.5     && f <= 4.0)    return '80m';
  if (f >= 5.06    && f <= 5.45)   return '60m';
  if (f >= 7.0     && f <= 7.3)    return '40m';
  if (f >= 10.1    && f <= 10.15)  return '30m';
  if (f >= 14.0    && f <= 14.35)  return '20m';
  if (f >= 18.068  && f <= 18.168) return '17m';
  if (f >= 21.0    && f <= 21.45)  return '15m';
  if (f >= 24.89   && f <= 24.99)  return '12m';
  if (f >= 28.0    && f <= 29.7)   return '10m';
  if (f >= 50.0    && f <= 54.0)   return '6m';
  if (f >= 144.0   && f <= 148.0)  return '2m';
  if (f >= 222.0   && f <= 225.0)  return '1.25m';
  if (f >= 420.0   && f <= 450.0)  return '70cm';
  if (f >= 902.0   && f <= 928.0)  return '33cm';
  if (f >= 1240.0  && f <= 1300.0) return '23cm';
  return null;
}

async function loadFlexSettings() {
  try {
    const s = await apiGet('/settings/flexradio');
    _flexRadios = Array.isArray(s.radios) ? s.radios : [];
    const primary = _flexRadios.find(r => r.enabled) || _flexRadios[0] || {};
    flexFreqSteps.small = primary.freq_step_small_khz ?? 50.0;
    flexFreqSteps.large = primary.freq_step_large_khz ?? 100.0;
    _txButtonLabel = primary.tx_button_label ?? 'MOX';
    if (_selectedRadioIndex === -1) {
      const primaryIdx = _flexRadios.findIndex(r => r.enabled);
      _selectedRadioIndex = Math.max(0, primaryIdx);
    }
  } catch { /* keep defaults */ }
}

function _flexPickerHtml() {
  if (_flexRadios.length <= 1) return '';
  const opts = _flexRadios.map((r, i) =>
    `<option value="${i}"${i === _selectedRadioIndex ? ' selected' : ''}>${escHtml(r.name || `Radio ${i + 1}`)}</option>`
  ).join('');
  return `<select id="flex-radio-picker" style="background:#1a1f2e;color:#e0e0e0;border:1px solid #2a2a4a;border-radius:3px;font-size:0.75rem;padding:1px 4px;margin-left:6px;cursor:pointer">${opts}</select>`;
}

async function loadRigControlSettings() {
  try {
    const s = await apiGet('/settings/rig-control');
    _activeRig = s.active_rig ?? 'flexradio';
  } catch { /* keep default */ }
}

async function stepFreq(deltaKhz) {
  const badge = document.getElementById('flex-freq-badge');
  if (!badge) return;
  const currentMhz = parseFloat(badge.dataset.freq);
  if (isNaN(currentMhz)) return;
  const newMhz = parseFloat((currentMhz + deltaKhz / 1000).toFixed(6));
  if (newMhz <= 0) return;
  // Optimistic update: reflect new freq immediately so rapid presses stack
  // and the badge text doesn't wait for the radio's WS confirmation.
  const newBand = amateurBand(newMhz.toFixed(3));
  badge.dataset.freq = newMhz.toFixed(6);
  badge.textContent = `${formatFlexFreq(newMhz)} MHz${newBand ? ' · ' + newBand : ''}`;
  _optimisticFreqMhz = newMhz;
  try {
    await apiPost('/flexradio/tune', { freq_mhz: newMhz });
  } catch {
    // Revert display if the command failed
    const oldBand = amateurBand(currentMhz.toFixed(3));
    badge.dataset.freq = currentMhz.toFixed(6);
    badge.textContent = `${formatFlexFreq(currentMhz)} MHz${oldBand ? ' · ' + oldBand : ''}`;
    _optimisticFreqMhz = null;
  }
}

async function stepFlrigFreq(deltaKhz) {
  const badge = document.getElementById('flrig-freq-badge');
  if (!badge) return;
  const currentHz = parseFloat(badge.dataset.freqHz);
  if (isNaN(currentHz)) return;
  const newHz = Math.round(currentHz + deltaKhz * 1000);
  if (newHz <= 0) return;
  const newMhz = (newHz / 1e6).toFixed(3);
  const newBand = amateurBand(newMhz);
  badge.dataset.freqHz = newHz;
  badge.textContent = `${newMhz} MHz${newBand ? ' · ' + newBand : ''}`;
  _optimisticFlrigFreqHz = newHz;
  try {
    await apiPost('/flrig/tune', { frequency_hz: newHz });
  } catch {
    const oldMhz = (currentHz / 1e6).toFixed(3);
    const oldBand = amateurBand(oldMhz);
    badge.dataset.freqHz = currentHz;
    badge.textContent = `${oldMhz} MHz${oldBand ? ' · ' + oldBand : ''}`;
    _optimisticFlrigFreqHz = null;
  }
}

async function togglePtt(btn) {
  const isTx = btn.dataset.isTx === '1';
  btn.disabled = true;
  try {
    await apiPost('/flrig/ptt', { active: !isTx });
  } catch (e) {
    alert(`PTT failed: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function loadFlexRadioStatus() {
  const el = document.getElementById('flexradio-status');
  if (!el) return;
  if (_activeRig !== 'flexradio') { el.innerHTML = ''; return; }

  const picker = _flexPickerHtml();
  const selectedRadio = _flexRadios[_selectedRadioIndex] || {};
  const primaryIdx = _flexRadios.findIndex(r => r.enabled);
  const isPrimary = _flexRadios.length <= 1 || _selectedRadioIndex === primaryIdx || primaryIdx === -1;
  const radioLabel = _flexRadios.length > 1 ? escHtml(selectedRadio.name || `Radio ${_selectedRadioIndex + 1}`) : 'FlexRadio Status';

  // Non-primary radio selected — show ping status only, throttled to ping_interval_sec
  if (!isPrimary) {
    pskRadioOffline = false;
    const ip = selectedRadio.ip || '';
    const pingEnabled = selectedRadio.ping_enabled !== false;
    if (!ip) {
      el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span><span class="text-muted ms-2" style="font-size:0.8rem">No IP configured</span>${picker}`;
      return;
    }
    if (!pingEnabled) {
      el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span><span class="text-muted ms-2" style="font-size:0.8rem">Ping disabled</span>${picker}`;
      return;
    }
    const intervalMs = (selectedRadio.ping_interval_sec ?? 30) * 1000;
    const cache = _nonPrimaryPingCache;
    const cacheValid = cache.idx === _selectedRadioIndex && (Date.now() - cache.ts) < intervalMs;
    const pingResult = cacheValid ? cache : await (async () => {
      try {
        const res = await apiPost('/settings/flexradio/ping', { ip });
        _nonPrimaryPingCache = { idx: _selectedRadioIndex, success: res.success, rtt_ms: res.rtt_ms, ts: Date.now() };
        return _nonPrimaryPingCache;
      } catch {
        return { success: null, rtt_ms: null };
      }
    })();
    const pingBadge = pingResult.success === true
      ? `<span class="badge ms-1" style="background:#198754;color:#fff">Online${pingResult.rtt_ms != null ? ' · ' + pingResult.rtt_ms + ' ms' : ''}</span>`
      : pingResult.success === false
        ? `<span class="badge ms-1" style="background:#dc3545;color:#fff">Offline</span>`
        : '';
    el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span>${pingBadge}${picker}`;
    return;
  }

  try {
    const s = await apiGet('/flexradio/status');
    const pingBadge = s.ping_online === true
      ? `<span class="badge ms-1" style="background:#198754;color:#fff">Online${s.ping_rtt_ms != null ? ' · ' + s.ping_rtt_ms + ' ms' : ''}</span>`
      : s.ping_online === false
        ? '<span class="badge ms-1" style="background:#dc3545;color:#fff">Offline</span>'
        : '';
    if (!s.connected) {
      pskRadioOffline = true;
      el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span>${pingBadge}<span class="fw-bold text-danger ms-2">SmartSDR Offline</span>${picker}`;
      return;
    }
    pskRadioOffline = false;
    if (!s.freq_mhz) {
      el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span>${pingBadge}<span class="text-warning ms-2" style="font-size:0.8rem">Connecting…</span>${picker}`;
      return;
    }
    // If we have an optimistic freq from a recent step, use it until the server
    // confirms the new value — prevents the badge from briefly reverting to the
    // pre-step frequency when an unrelated WS event fires before the radio
    // has sent its updated RF_frequency over TCP.
    const serverFreq = parseFloat(s.freq_mhz);
    let displayFreq = serverFreq;
    if (_optimisticFreqMhz !== null) {
      if (Math.abs(serverFreq - _optimisticFreqMhz) < 0.0005) {
        _optimisticFreqMhz = null; // server confirmed our step
      } else {
        displayFreq = _optimisticFreqMhz; // server hasn't caught up yet
      }
    }
    const mhz = displayFreq.toFixed(3); // kept for band lookup
    const freqDisplay = formatFlexFreq(displayFreq);
    const mode = s.mode ? `<span id="flex-mode-badge" class="badge ms-2" style="background:#00e676;color:#000;cursor:pointer" data-mode="${escHtml(s.mode)}">${escHtml(s.mode)}</span>` : '';
    const rfPower = _currentRfpower != null ? _currentRfpower : s.rf_power;
    const power = rfPower != null ? `<span id="flex-power-badge" class="badge ms-1" style="background:#00e676;color:#000;cursor:pointer" data-power="${rfPower}">${rfPower}W</span>` : '';
    const isTx = s.tx_state === 'TRANSMITTING' || s.tx_state === 'PTT_REQUESTED';
    const rxtx = s.tx_state != null
      ? `<span class="badge ms-1" style="background:${isTx ? '#dc3545' : '#198754'};color:#fff">${isTx ? 'TX' : 'RX'}</span>`
      : '';
    const band = amateurBand(mhz);
    if (band && _HF_BANDS.includes(band)) _bandFreqMemory[band] = serverFreq;
    const btnStyle = 'background:#1a1f2e;color:#00e676;border:1px solid #00e676;padding:1px 5px;font-size:0.7rem;line-height:1.4;border-radius:3px;cursor:pointer';
    const freqStepBtns = `<button class="freq-step-btn ms-1" data-step="-large" style="${btnStyle}" title="Decrease ${flexFreqSteps.large} kHz">&lt;&lt;</button><button class="freq-step-btn ms-1" data-step="-small" style="${btnStyle}" title="Decrease ${flexFreqSteps.small} kHz">&lt;</button>`;
    const freqBadge = `<span id="flex-freq-badge" class="badge ms-1" style="background:#00e676;color:#000;cursor:pointer" data-freq="${displayFreq.toFixed(6)}">${escHtml(freqDisplay)} MHz${band ? ' · ' + band : ''}</span>`;
    const freqStepBtnsR = `<button class="freq-step-btn ms-1" data-step="+small" style="${btnStyle}" title="Increase ${flexFreqSteps.small} kHz">&gt;</button><button class="freq-step-btn ms-1" data-step="+large" style="${btnStyle}" title="Increase ${flexFreqSteps.large} kHz">&gt;&gt;</button>`;
    const freq = freqStepBtns + freqBadge + freqStepBtnsR;
    const moxStyle = isTx
      ? 'background:#dc3545;color:#fff;border:1px solid #dc3545;'
      : 'background:#1a1f2e;color:#dc3545;border:1px solid #dc3545;';
    const moxBtn = s.tx_state != null
      ? `<button id="flex-mox-btn" class="ms-1" data-is-tx="${isTx ? '1' : '0'}" style="${moxStyle}padding:1px 7px;font-size:0.7rem;line-height:1.4;border-radius:3px;cursor:pointer;font-weight:700">${escHtml(_txButtonLabel)}</button>`
      : '';
    const tuneActive = !!s.tune_active;
    const tuneStyle = tuneActive
      ? 'background:#fd7e14;color:#000;border:1px solid #fd7e14;'
      : 'background:#1a1f2e;color:#fd7e14;border:1px solid #fd7e14;';
    const tunePowerLabel = s.tune_power != null ? ` ${s.tune_power}W` : '';
    const tuneBtn = s.connected
      ? `<button id="flex-tune-btn" class="ms-1" data-tune-active="${tuneActive ? '1' : '0'}" style="${tuneStyle}padding:1px 7px;font-size:0.7rem;line-height:1.4;border-radius:3px;cursor:pointer;font-weight:700" title="Tune carrier${tunePowerLabel}">TUNE</button>`
      : '';
    const swrColor = s.swr == null ? '' : s.swr <= 2.0 ? '#198754' : s.swr <= 3.0 ? '#fd7e14' : '#dc3545';
    const swr = s.swr != null ? `<span class="badge ms-1" style="background:${swrColor};color:#fff">SWR ${s.swr}:1</span>` : '';
    el.innerHTML = `<span class="freq-retro me-1">${radioLabel}</span>${pingBadge}${freq}${mode}${power}${rxtx}${tuneBtn}${moxBtn}${swr}${picker}`;
  } catch {
    pskRadioOffline = false;
    el.innerHTML = picker;
  }
}

async function loadFlrigStatus() {
  const el = document.getElementById('flrig-status');
  if (!el) return;
  if (_activeRig !== 'flrig') { el.innerHTML = ''; return; }
  try {
    const s = await apiGet('/flrig/status');
    _lastFlrigStatus = s;
    if (!s.connected) {
      el.innerHTML = '<span class="fw-bold text-danger" style="font-size:0.8rem">flrig Offline</span>';
      return;
    }
    const freqHz = s.freq_hz ?? 0;
    let displayHz = freqHz;
    if (_optimisticFlrigFreqHz !== null) {
      if (Math.abs(freqHz - _optimisticFlrigFreqHz) < 500) {
        _optimisticFlrigFreqHz = null;
      } else {
        displayHz = _optimisticFlrigFreqHz;
      }
    }
    const displayMhz = (displayHz / 1e6).toFixed(3);
    const band = amateurBand(displayMhz);
    if (band && _HF_BANDS.includes(band)) _bandFreqMemory[band] = displayHz / 1e6;
    const isTx = !!s.ptt;
    const swrColor = s.swr == null ? '' : s.swr <= 2.0 ? '#198754' : s.swr <= 3.0 ? '#fd7e14' : '#dc3545';
    const swr = s.swr != null ? `<span class="badge ms-1" style="background:${swrColor};color:#fff">SWR ${s.swr}:1</span>` : '';
    const btnStyle = 'background:#1a1f2e;color:#4fc3f7;border:1px solid #4fc3f7;padding:1px 5px;font-size:0.7rem;line-height:1.4;border-radius:3px;cursor:pointer';
    const freqStepBtns = `<button class="flrig-step-btn ms-1" data-step="-large" style="${btnStyle}" title="Decrease ${flexFreqSteps.large} kHz">&lt;&lt;</button><button class="flrig-step-btn ms-1" data-step="-small" style="${btnStyle}" title="Decrease ${flexFreqSteps.small} kHz">&lt;</button>`;
    const freqBadge = `<span id="flrig-freq-badge" class="badge ms-1" style="background:#4fc3f7;color:#000;cursor:pointer" data-freq-hz="${displayHz}">${escHtml(displayMhz)} MHz${band ? ' · ' + band : ''}</span>`;
    const freqStepBtnsR = `<button class="flrig-step-btn ms-1" data-step="+small" style="${btnStyle}" title="Increase ${flexFreqSteps.small} kHz">&gt;</button><button class="flrig-step-btn ms-1" data-step="+large" style="${btnStyle}" title="Increase ${flexFreqSteps.large} kHz">&gt;&gt;</button>`;
    const mode = s.mode ? `<span id="flrig-mode-badge" class="badge ms-2" style="background:#4fc3f7;color:#000;cursor:pointer" data-mode="${escHtml(s.mode)}">${escHtml(s.mode)}</span>` : '';
    const rxtx = `<span class="badge ms-1" style="background:${isTx ? '#dc3545' : '#198754'};color:#fff">${isTx ? 'TX' : 'RX'}</span>`;
    const pttStyle = isTx
      ? 'background:#dc3545;color:#fff;border:1px solid #dc3545;'
      : 'background:#1a1f2e;color:#dc3545;border:1px solid #dc3545;';
    const pttBtn = `<button id="flrig-ptt-btn" class="ms-1" data-is-tx="${isTx ? '1' : '0'}" style="${pttStyle}padding:1px 7px;font-size:0.7rem;line-height:1.4;border-radius:3px;cursor:pointer;font-weight:700">PTT</button>`;
    el.innerHTML = `<span style="font-size:0.8rem;color:#4fc3f7;font-weight:600" class="me-1">flrig</span>` +
      freqStepBtns + freqBadge + freqStepBtnsR + mode + rxtx + pttBtn + swr;
  } catch {
    el.innerHTML = '';
  }
}

function _updateLightningBannerBadge(nearestKm) {
  const badge = document.getElementById('monitoring-lightning-badge');
  if (!badge) return;
  if (nearestKm == null) {
    badge.style.display = 'none';
    badge.innerHTML = '';
    return;
  }
  badge.innerHTML = `<span class="badge bg-warning text-dark fw-bold"><i class="bi bi-lightning-fill me-1"></i>Lightning</span>`;
  badge.style.display = '';
}

function _resetLightningTile() {
  // Clear map markers
  blitzortungMarkers.forEach(({ marker }) => marker.remove());
  blitzortungMarkers = [];

  // Reset tile text
  const lightEl   = document.getElementById('lightning-value');
  const lightUnit = document.getElementById('lightning-unit');
  const lightDesc = document.getElementById('lightning-desc');
  if (lightEl) {
    lightEl.textContent = 'No lightning detected';
    lightEl.style.fontSize = '1.5rem';
    lightEl.style.color = '';
    if (lightUnit) lightUnit.textContent = '';
    if (lightDesc) lightDesc.textContent = '';
  }

  // Hide badge and history
  const badge = document.getElementById('blitzortung-badge');
  const hist  = document.getElementById('blitzortung-history');
  if (badge) badge.style.display = 'none';
  if (hist)  { hist.style.display = 'none'; hist.innerHTML = ''; }

  _nearestLightningKm = null;
  _nearestLightningAt = 0;
  _updateLightningBannerBadge(null);
}

function _handleBlitzortungStrike(data) {
  if (!document.getElementById('blitzortung-style')) {
    const s = document.createElement('style');
    s.id = 'blitzortung-style';
    s.textContent = '@keyframes bz-flash{0%,100%{opacity:1}50%{opacity:0.3}}.blitzortung-flash{animation:bz-flash 0.5s ease 2}';
    document.head.appendChild(s);
  }
  const badge = document.getElementById('blitzortung-badge');
  const text  = document.getElementById('blitzortung-strike-text');
  const hist  = document.getElementById('blitzortung-history');
  if (!badge || !text) return;

  const distVal  = data.distance_km != null
    ? (useMetric ? data.distance_km.toFixed(1) : (data.distance_km * 0.621371).toFixed(1))
    : '?';
  const distUnit = useMetric ? 'km' : 'mi';
  const brng = data.bearing_deg != null ? ` ${Math.round(data.bearing_deg)}°` : '';
  const ts  = data.timestamp
    ? new Date(data.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  text.textContent = `Live: ${distVal} ${distUnit}${brng}  ${ts}`;
  badge.style.display = '';

  if (hist) {
    hist.style.display = '';
    const row = document.createElement('div');
    row.textContent = `${ts}  ${distVal} ${distUnit}${brng}`;
    hist.insertBefore(row, hist.firstChild);
    while (hist.children.length > 5) hist.removeChild(hist.lastChild);
  }

  badge.classList.remove('blitzortung-flash');
  void badge.offsetWidth; // force reflow to restart animation
  badge.classList.add('blitzortung-flash');
  clearTimeout(blitzortungFlashTimer);
  blitzortungFlashTimer = setTimeout(() => badge.classList.remove('blitzortung-flash'), 2000);

  if (data.distance_km != null) {
    if (_nearestLightningKm == null || data.distance_km < _nearestLightningKm) {
      _nearestLightningKm = data.distance_km;
    }
    _nearestLightningAt = Date.now();
    _updateLightningBannerBadge(_nearestLightningKm);

    const lightEl   = document.getElementById('lightning-value');
    const lightUnit = document.getElementById('lightning-unit');
    const lightDesc = document.getElementById('lightning-desc');
    if (lightEl) {
      lightEl.textContent = useMetric ? data.distance_km.toFixed(1) : (data.distance_km * 0.621371).toFixed(1);
      lightEl.style.fontSize = '';
      lightEl.style.color = '#ef4444';
      if (lightUnit) lightUnit.textContent = useMetric ? 'km away' : 'miles away';
      if (lightDesc) lightDesc.textContent = 'Blitzortung';
    }
  }

  if (data.lat != null && data.lon != null) {
    _addBlitzortungMarker(data.lat, data.lon, data.timestamp);
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
  const section = document.querySelector('[data-section="alerts"]');
  const el = document.getElementById('alerts-area');
  if (!el || !section) return;
  if (!alerts.length) {
    section.style.display = 'none';
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
    return `<div style="background:${s.bg};border-left:4px solid ${s.border};padding:8px 10px;margin:0;border-radius:4px">
      <div style="display:flex;align-items:center;gap:6px;color:${s.text};font-weight:700;font-size:0.9rem">
        <i class="bi ${s.icon}"></i>${a.event}
      </div>
      ${a.headline ? `<div style="color:#cbd5e1;font-size:0.8rem;margin-top:2px">${a.headline}</div>` : ''}
      ${expires ? `<div style="color:#64748b;font-size:0.75rem;margin-top:2px">Expires: ${expires}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = rows;
  section.style.display = '';
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

  const makeRow = (entry) => {
    const dt = new Date(entry.dt * 1000);
    const timeLabel = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const temp = entry.main?.temp != null ? Math.round(entry.main.temp) : '--';
    const pop = entry.pop != null ? Math.round(entry.pop * 100) : 0;
    const rawSpeed = entry.wind?.speed ?? null;
    const windSpeed = rawSpeed != null ? Math.round(metric ? rawSpeed * 3.6 : rawSpeed) : null;
    const desc = entry.weather?.[0]?.description ?? '';
    const icon = owmIcon(entry.weather);
    const iconColor = owmIconColor(entry.weather);
    const popColor = pop >= 60 ? '#60a5fa' : pop >= 30 ? '#93c5fd' : '#bfdbfe';
    return `
      <div class="d-flex align-items-center gap-2 py-1" style="border-bottom:1px solid #1e2a3a;font-size:1rem" title="${desc}">
        <span style="width:70px;flex-shrink:0;white-space:nowrap;color:#94a3b8">${timeLabel}</span>
        <i class="bi ${icon}" style="font-size:1.1rem;color:${iconColor};flex-shrink:0"></i>
        <span style="font-weight:600;color:#f1f5f9;width:52px;flex-shrink:0;white-space:nowrap">${temp}${tempUnit}</span>
        <span style="color:#64748b;flex-shrink:0;white-space:nowrap;width:52px">${windSpeed != null ? windSpeed + ' ' + windUnit : ''}</span>
        <span style="color:${popColor};flex-shrink:0;white-space:nowrap;width:44px">💧${pop}%</span>
      </div>`;
  };

  const leftRows  = fList.slice(0, 4).map(e => makeRow(e));
  const rightRows = fList.slice(4, 8).map(e => makeRow(e));
  el.innerHTML = `<div class="d-flex forecast-cols">\
<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center">${leftRows.join('')}</div>\
<div class="forecast-divider" style="width:1px;background:#2e3f52;flex-shrink:0;margin:0 4px"></div>\
<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center">${rightRows.join('')}</div>\
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
    pskMap = L.map('psk-map', { zoomControl: true, attributionControl: true, worldCopyJump: true, minZoom, scrollWheelZoom: false }).setView([20, 0], 2);
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
  const qrzInput = document.getElementById('psk-qrz-input');
  document.getElementById('btn-psk-qrz')?.addEventListener('click', () => {
    const call = qrzInput?.value.trim().toUpperCase();
    if (call) openQrzModal(call);
  });
  qrzInput?.addEventListener('input', () => {
    qrzInput.value = qrzInput.value.toUpperCase();
  });
  qrzInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const call = qrzInput.value.trim();
      if (call) openQrzModal(call);
    }
  });

  document.getElementById('btn-psk-center')?.addEventListener('click', async () => {
    if (!pskMap) return;
    try {
      const loc = await apiGet('/settings/location');
      if (loc?.lat && loc?.lon) {
        pskMap.setView([loc.lat, loc.lon], 4);
      }
    } catch { /* ignore */ }
  });

  document.getElementById('btn-psk-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-psk-refresh');
    if (btn) btn.disabled = true;
    await loadPskSpots();
    if (btn) btn.disabled = false;
  });

  const PSK_INTERVAL_MS = 5 * 60 * 1000;

  if (pskRefreshTimer) clearInterval(pskRefreshTimer);
  pskRefreshTimer = setInterval(() => {
    if (!destroyed && !pskPaused && !pskRadioOffline) {
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
    if (pskRadioOffline) {
      updEl.textContent = base + (base ? ' · ' : '') + 'paused (radio offline)';
    } else if (pskPaused) {
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
  const _weatherFetchStart = Date.now();
  try {
    const [current, forecast, realtime, loc, lightning, alertsData, blitzortung, blitzStrikes] = await Promise.all([
      apiGet('/weather/current'),
      apiGet('/weather/forecast'),
      apiGet('/weather/realtime'),
      apiGet('/settings/location'),
      apiGet('/weather/lightning'),
      apiGet('/weather/alerts').catch(() => ({ alerts: [] })),
      apiGet('/settings/blitzortung').catch(() => ({})),
      apiGet('/weather/blitzortung').catch(() => null),
    ]);

    const metric = (loc.units || 'imperial') === 'metric';
    useMetric = metric;

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
      // Banner badge always reflects Blitzortung nearest strike regardless of which
      // source the lightning tile displays.
      const bzStrikes = blitzStrikes?.strikes ?? [];
      if (bzStrikes.length > 0) {
        const nearest = bzStrikes.reduce((a, b) => a.distance_km < b.distance_km ? a : b);
        _nearestLightningKm = nearest.distance_km;
        // Use the actual timestamp of the most recent strike so the 70-min clearing
        // window is measured from the real last strike, not from when loadWeather ran.
        const mostRecentStrikeMs = bzStrikes.reduce((max, s) => {
          const t = s.timestamp ? new Date(s.timestamp).getTime() : 0;
          return t > max ? t : max;
        }, 0);
        if (mostRecentStrikeMs > _nearestLightningAt) {
          _nearestLightningAt = mostRecentStrikeMs;
        }
      } else if (!_nearestLightningAt || _nearestLightningAt < _weatherFetchStart - 5000) {
        // Clear only when the last WS-sourced strike predates this REST call by >5 s,
        // ruling out the race where a strike's WS message arrives while the fetch is in-flight.
        _nearestLightningKm = null;
        const bzBadge = document.getElementById('blitzortung-badge');
        const bzHist  = document.getElementById('blitzortung-history');
        if (bzBadge) bzBadge.style.display = 'none';
        if (bzHist)  { bzHist.style.display = 'none'; bzHist.innerHTML = ''; }
      }
      _updateLightningBannerBadge(_nearestLightningKm);

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
          if (bzStrikes.length > 0) {
            const bKm = _nearestLightningKm;
            lightEl.textContent = metric ? bKm.toFixed(1) : (bKm * 0.621371).toFixed(1);
            lightEl.style.fontSize = '';
            lightEl.style.color = '#ef4444';
            if (lightUnit) lightUnit.textContent = metric ? 'km away' : 'miles away';
            if (lightDesc) lightDesc.textContent = 'Blitzortung';
          } else {
            lightEl.style.color = '';
            let noLightningText;
            if (blitzortung?.enabled && blitzortung?.range_km) {
              const rangeVal  = metric ? blitzortung.range_km : Math.round(blitzortung.range_km * 0.621371);
              const rangeUnit = metric ? 'km' : 'miles';
              noLightningText = `No lightning detected within ${rangeVal} ${rangeUnit}`;
            } else {
              noLightningText = metric ? 'None detected within 400 kilometers' : 'None detected within 250 miles';
            }
            lightEl.textContent = noLightningText;
            lightEl.style.fontSize = '1.5rem';
            if (lightUnit) lightUnit.textContent = '';
            if (lightDesc) lightDesc.textContent = '';
          }
        }
      }
    }

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
      radarMap = L.map('radar-map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([lat, lon], radarHomeZoom);

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
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(radarMap);
      radarLabelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        pane: 'overlayPane',
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

    // Plot buffered Blitzortung strikes and start the age-fade timer
    const blitzData = await apiGet('/weather/blitzortung').catch(() => null);
    if (blitzData?.strikes?.length) {
      for (const s of blitzData.strikes) {
        if (s.lat != null && s.lon != null) _addBlitzortungMarker(s.lat, s.lon, s.timestamp);
      }
    }
    if (!blitzortungCleanupTimer) {
      blitzortungCleanupTimer = setInterval(_tickBlitzortungMarkers, 30_000);
    }

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

const RADAR_MAX_NATIVE_ZOOM = 7;

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
  if (radarLabelsLayer) radarLabelsLayer.bringToFront();

  const ts = document.getElementById('radar-timestamp');
  if (ts) ts.textContent = new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stopRadarAnim() {
  radarPlaying = false;
  if (radarAnimInterval) { clearInterval(radarAnimInterval); radarAnimInterval = null; }
  const btn = document.getElementById('btn-radar-play');
  if (btn) btn.innerHTML = '&#9654;';
}

function _blitzortungMarkerStyle(ageMs) {
  const ratio = Math.min(ageMs / BLITZ_FADE_MS, 1);
  if (ratio < 0.2) return { color: '#ffffff', opacity: 1.0 };
  if (ratio < 0.4) return { color: '#ffee44', opacity: 0.85 };
  if (ratio < 0.6) return { color: '#ffaa00', opacity: 0.65 };
  if (ratio < 0.8) return { color: '#ff6600', opacity: 0.45 };
  return { color: '#ff3300', opacity: 0.25 };
}

function _addBlitzortungMarker(lat, lon, timestamp) {
  if (!radarMap) return;
  const time = timestamp ? new Date(timestamp) : new Date();
  const ageMs = Date.now() - time.getTime();
  if (ageMs >= BLITZ_FADE_MS) return;
  const { color, opacity } = _blitzortungMarkerStyle(ageMs);
  const marker = L.circleMarker([lat, lon], {
    radius: 3,
    color,
    weight: 1.5,
    fillColor: color,
    fillOpacity: opacity * 0.5,
    opacity,
    interactive: false,
  }).addTo(radarMap);
  if (radarLabelsLayer) radarLabelsLayer.bringToFront();
  blitzortungMarkers.push({ marker, time });
}

function _tickBlitzortungMarkers() {
  const now = Date.now();
  blitzortungMarkers = blitzortungMarkers.filter(({ marker, time }) => {
    const ageMs = now - time.getTime();
    if (ageMs >= BLITZ_FADE_MS) {
      marker.remove();
      return false;
    }
    const { color, opacity } = _blitzortungMarkerStyle(ageMs);
    marker.setStyle({ color, fillColor: color, fillOpacity: opacity * 0.5, opacity });
    return true;
  });
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
    const stateText = isOn === null ? '' : (isOn ? 'ON' : 'OFF');
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
  updateSystemStatusButton();
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
    const [text, mufData] = await Promise.all([
      apiFetchXml('/solar/data'),
      apiGet('/solar/muf').catch(() => null),
    ]);
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
      muf: mufData?.muf_3000 ?? null,
    });
  } catch (e) {
    console.error('Solar data load failed:', e);
    const card = document.getElementById('solar-card');
    if (card) card.innerHTML = '<div class="text-muted text-center p-2">Solar data unavailable</div>';
  }
}

function solarUpdatedToLocal(utcStr) {
  if (!utcStr || utcStr === '--') return utcStr;
  // HamQSL format: " 26 Apr 2026 2209 GMT" (leading space, GMT suffix)
  const m = utcStr.trim().match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2})(\d{2})\s+(?:UTC|GMT)$/);
  if (!m) return utcStr;
  const d = new Date(`${m[2]} ${m[1]}, ${m[3]} ${m[4]}:${m[5]}:00 UTC`);
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

function mufColor(mhz) {
  if (mhz === null || mhz === undefined) return '#94a3b8';
  if (mhz >= 20) return '#198754';
  if (mhz >= 14) return '#fbbf24';
  if (mhz >= 7)  return '#fd7e14';
  return '#dc3545';
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

function renderSolarData({ sfi, sunspots, kIndex, aIndex, xray, geoField, solarWind, signalNoise, updated, bands, muf }) {
  const card = document.getElementById('solar-card');
  if (!card) return;

  const updEl = document.getElementById('solar-updated');
  if (updEl && updated !== '--') updEl.textContent = `Updated: ${solarUpdatedToLocal(updated)}`;

  const mufLabel = muf !== null ? `${muf} MHz` : '--';
  const indices = [
    { label: 'SFI',        value: sfi,        color: '#60a5fa' },
    { label: 'Sunspots',   value: sunspots,   color: '#a78bfa' },
    { label: 'K-index',    value: kIndex,     color: solarKColor(kIndex) },
    { label: 'A-index',    value: aIndex,     color: solarAColor(aIndex) },
    { label: 'X-ray',      value: xray,       color: solarXrayColor(xray) },
    { label: 'Geomag',     value: geoField,   color: '#94a3b8' },
    { label: 'Solar Wind', value: solarWind !== '--' ? solarWind + ' km/s' : '--', color: '#94a3b8' },
    { label: 'Sig/Noise',  value: signalNoise, color: '#94a3b8' },
    { label: 'MUF',        value: mufLabel,   color: mufColor(muf) },
  ];

  // 4-column grid of index badges (2 rows of 4, more compact)
  const indexHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
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

async function connectWS() {
  const token = getToken();
  if (!token) return;

  // Fetch a short-lived one-time ticket so the long-lived JWT never appears in
  // server access logs (WebSocket URLs are logged in full by nginx).
  let ticket;
  try {
    const resp = await fetch('/api/v1/auth/ws-ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) return;
    ({ ticket } = await resp.json());
  } catch {
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/dashboard?ticket=${encodeURIComponent(ticket)}`;
  ws = new WebSocket(url);

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'weather_update') loadWeather();
      if (msg.type === 'location_changed') { _resetLightningTile(); loadLocationProfile(); }
      if (msg.type === 'lightning_strike') _handleBlitzortungStrike(msg.data);
      if (msg.type === 'monitoring_status') loadMonitoringStatus();
      if (msg.type === 'flexradio_update') {
        if (msg.rfpower != null) {
          _currentRfpower = parseInt(msg.rfpower, 10);
          const badge = document.getElementById('flex-power-badge');
          if (badge) { badge.textContent = `${_currentRfpower}W`; badge.dataset.power = _currentRfpower; }
        }
        // Full re-render only when fields other than rfpower changed
        if (msg.freq || msg.mode || msg.tune_active != null ||
            msg.interlock_state || msg.atu_enabled != null || msg.swr != null ||
            msg.rfpower == null) {
          loadFlexRadioStatus();
        }
      }
      if (msg.type === 'flrig_update') loadFlrigStatus();
      if (msg.type === 'workflow_started') {
        _setWorkflowRunning(msg.workflow_name);
      }
      if (msg.type === 'workflow_step_started') {
        _updateWorkflowStepBadge(msg.step_label);
      }
      if (msg.type === 'workflow_delay') {
        _updateWorkflowDelayBadge(msg.delay_sec);
      }
      if (msg.type === 'workflow_complete') {
        _clearWorkflowRunning();
        if (!msg.success && msg.error) alert(`Workflow failed: ${msg.error}`);
        loadSystemState();
      }
      if (msg.type === 'shutdown_alert') {
        const alertDiv = document.getElementById('alerts-area');
        const alertSection = document.querySelector('[data-section="alerts"]');
        if (alertDiv) {
          alertDiv.innerHTML = `<div class="alert alert-danger mb-0"><strong>SHUTDOWN TRIGGERED:</strong> ${msg.reason}</div>`;
        }
        if (alertSection) alertSection.style.display = '';
      }
    } catch {}
  };

  ws.onclose = () => {
    if (!destroyed) setTimeout(() => { if (!destroyed) { connectWS(); loadSystemState(); } }, 5000);
  };

  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
}
