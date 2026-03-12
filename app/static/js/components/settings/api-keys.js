import { apiGet, apiPut } from '../../api.js';

export async function renderApiKeysTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/api-keys');

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
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('api-keys-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('keys-msg');
    try {
      await apiPut('/settings/api-keys', {
        owm_key: document.getElementById('owm-key').value,
        tomorrow_key: document.getElementById('tomorrow-key').value,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'API keys saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
