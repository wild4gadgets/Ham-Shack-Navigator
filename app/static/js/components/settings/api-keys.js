import { apiGet, apiPut, apiPost } from '../../api.js';

export async function renderApiKeysTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const [data, qrzData] = await Promise.all([
    apiGet('/settings/api-keys'),
    apiGet('/qrz/settings').catch(() => ({ username: '', password: '' })),
  ]);

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-key me-2"></i>API Keys</div>
      <div class="card-body">
        <div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>Keys are stored securely. Existing keys are shown masked. Leave masked to keep current value.</div>
        <div id="keys-msg" class="alert" style="display:none"></div>
        <form id="api-keys-form">
          <div class="mb-3">
            <label class="form-label">OpenWeatherMap API Key</label>
            <input type="text" class="form-control font-monospace" id="owm-key" value="${data.owm_key || ''}" placeholder="Enter new key or leave masked" />
            <div class="form-text">Get free key at <a href="https://openweathermap.org/api" target="_blank" class="text-info">openweathermap.org</a>. Uses One Call 2.5 (free).</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Tomorrow.io API Key</label>
            <input type="text" class="form-control font-monospace" id="tomorrow-key" value="${data.tomorrow_key || ''}" placeholder="Enter new key or leave masked" />
            <div class="form-text">Get free key at <a href="https://tomorrow.io" target="_blank" class="text-info">tomorrow.io</a>. Free tier: 500 req/day.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">AccuWeather API Key</label>
            <input type="text" class="form-control font-monospace" id="accuweather-key" value="${data.accuweather_key || ''}" placeholder="Enter new key or leave masked" />
            <div class="form-text">Get key at <a href="https://developer.accuweather.com" target="_blank" class="text-info">developer.accuweather.com</a>. Provides thunderstorm probability via hourly forecast. Location key lookup uses 1 additional call on first run or location change.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">CARTO API Key</label>
            <input type="text" class="form-control font-monospace" id="carto-key" value="${data.carto_key || ''}" placeholder="Enter new key or leave masked" />
            <div class="form-text">Get free key at <a href="https://carto.com/basemaps/apikey" target="_blank" class="text-info">carto.com/basemaps/apikey</a>. Used for the dark radar basemap tiles.</div>
          </div>

          <hr style="border-color:#2a2a4a" />
          <h6 class="mb-3" style="color:#94a3b8"><i class="bi bi-person-badge me-2"></i>QRZ.com (XML Data subscription required)</h6>
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label">QRZ Username</label>
              <input type="text" class="form-control font-monospace" id="qrz-username"
                value="${qrzData.username || ''}" placeholder="Your QRZ callsign/username" autocomplete="off" />
            </div>
            <div class="col-md-6">
              <label class="form-label">QRZ Password</label>
              <input type="password" class="form-control font-monospace" id="qrz-password"
                value="${qrzData.password || ''}" placeholder="Leave masked to keep current" autocomplete="new-password" />
            </div>
          </div>
          <div class="mb-3">
            <button type="button" id="btn-qrz-test" class="btn btn-sm btn-outline-info">
              <i class="bi bi-plug me-1"></i>Test QRZ Connection
            </button>
            <span id="qrz-test-result" class="ms-2" style="font-size:0.85rem"></span>
          </div>

          <button type="submit" class="btn btn-primary">Save All</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('api-keys-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('keys-msg');
    try {
      await Promise.all([
        apiPut('/settings/api-keys', {
          owm_key: document.getElementById('owm-key').value,
          tomorrow_key: document.getElementById('tomorrow-key').value,
          accuweather_key: document.getElementById('accuweather-key').value,
          carto_key: document.getElementById('carto-key').value,
        }),
        apiPut('/qrz/settings', {
          username: document.getElementById('qrz-username').value,
          password: document.getElementById('qrz-password').value,
        }),
      ]);
      msg.className = 'alert alert-success';
      msg.textContent = 'Settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-qrz-test').addEventListener('click', async () => {
    const resultEl = document.getElementById('qrz-test-result');
    const btn = document.getElementById('btn-qrz-test');
    btn.disabled = true;
    resultEl.style.color = '#94a3b8';
    resultEl.textContent = 'Testing…';
    try {
      // Save current credentials first, then test with a well-known callsign
      await apiPut('/qrz/settings', {
        username: document.getElementById('qrz-username').value,
        password: document.getElementById('qrz-password').value,
      });
      const result = await apiGet('/qrz/lookup?callsign=W1AW');
      resultEl.style.color = '#4ade80';
      resultEl.textContent = `Connected — ${result.fname || ''} ${result.name || ''} (${result.call})`;
    } catch (err) {
      resultEl.style.color = '#f87171';
      resultEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
