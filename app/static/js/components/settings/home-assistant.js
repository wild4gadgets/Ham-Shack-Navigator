import { apiGet, apiPut, apiPost } from '../../api.js';

export async function renderHomeAssistantTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';
  let data;
  try {
    data = await apiGet('/settings/home-assistant');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load Home Assistant settings: ${err.message}</div>`;
    return;
  }

  const baseUrl = window.location.origin;
  const stateUrl = `${baseUrl}/api/v1/ha/state`;
  const sensorBaseUrl = `${baseUrl}/api/v1/ha/sensor/`;
  const pollToken = data.ha_poll_token || '(save settings to generate)';

  const yamlExample = `# In your Home Assistant configuration.yaml:
sensor:
  - platform: rest
    name: "Ham Shack Wind Speed"
    resource: "${sensorBaseUrl}wind_mph"
    headers:
      Authorization: "Bearer ${pollToken}"
    value_template: "{{ value_json.state }}"
    unit_of_measurement: "mph"
    scan_interval: 300

  - platform: rest
    name: "Ham Shack Lightning Distance"
    resource: "${sensorBaseUrl}lightning_miles"
    headers:
      Authorization: "Bearer ${pollToken}"
    value_template: "{{ value_json.state }}"
    unit_of_measurement: "mi"
    scan_interval: 300

binary_sensor:
  - platform: rest
    name: "Ham Shack Monitoring Armed"
    resource: "${sensorBaseUrl}monitoring_armed"
    headers:
      Authorization: "Bearer ${pollToken}"
    value_template: "{{ value_json.state == 'on' }}"
    scan_interval: 60`;

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-house-gear me-2"></i>Home Assistant</div>
      <div class="card-body">
        <div id="ha-msg" class="alert" style="display:none"></div>

        <ul class="nav nav-tabs mb-4" id="ha-tabs">
          <li class="nav-item">
            <a class="nav-link active" href="#" data-ha-tab="pull">Pull (HA polls us)</a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="#" data-ha-tab="push">Push (we push to HA)</a>
          </li>
        </ul>

        <!-- Pull tab -->
        <div id="ha-tab-pull">
          <p style="font-size:0.875rem;color:#a0a8b8">
            Home Assistant polls Ham Shack Navigator's read-only state endpoints using a static bearer token.
            No HA credentials needed here — just configure HA REST sensors with the token below.
          </p>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="ha-pull-enabled" ${data.enabled_pull !== false ? 'checked' : ''} />
              <label class="form-check-label" for="ha-pull-enabled">Enable pull endpoint</label>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">HA Poll Token</label>
            <div class="input-group">
              <input type="text" class="form-control font-monospace" id="ha-poll-token-display"
                     value="${pollToken}" readonly style="font-size:0.8rem" />
              <button type="button" class="btn btn-outline-secondary" id="btn-copy-token">Copy</button>
              <button type="button" class="btn btn-outline-warning" id="btn-regen-token">Regenerate</button>
            </div>
            <div class="form-text">Use this token in HA as shown in the YAML example below. Keep it secret.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">State Endpoint</label>
            <input type="text" class="form-control font-monospace" value="${stateUrl}" readonly style="font-size:0.8rem" />
          </div>
          <div class="mb-3">
            <label class="form-label">Example Home Assistant YAML</label>
            <pre class="p-3 rounded" style="background:#1a1a2e;font-size:0.75rem;max-height:240px;overflow-y:auto">${yamlExample}</pre>
          </div>
        </div>

        <!-- Push tab -->
        <div id="ha-tab-push" style="display:none">
          <p style="font-size:0.875rem;color:#a0a8b8">
            Ham Shack Navigator pushes sensor states to your HA instance after every monitoring poll and on shutdown.
            Requires a Home Assistant long-lived access token.
          </p>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="ha-push-enabled" ${data.enabled_push ? 'checked' : ''} />
              <label class="form-check-label" for="ha-push-enabled">Enable push to Home Assistant</label>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">Home Assistant URL</label>
            <input type="text" class="form-control" id="ha-url" value="${data.ha_url || ''}" placeholder="http://homeassistant.local:8123" />
          </div>
          <div class="mb-3">
            <label class="form-label">Long-Lived Access Token</label>
            <input type="password" class="form-control" id="ha-token" value="${data.ha_token || ''}" placeholder="Generate in HA: Profile → Long-Lived Access Tokens" />
          </div>
          <button type="button" class="btn btn-outline-info" id="btn-test-ha">Test Push Connection</button>
        </div>

        <hr />
        <div class="d-flex gap-2 mt-3">
          <button type="button" class="btn btn-primary" id="btn-save-ha">Save</button>
        </div>
      </div>
    </div>
  `;

  // Tab switching
  document.querySelectorAll('[data-ha-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-ha-tab]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.getElementById('ha-tab-pull').style.display = link.dataset.haTab === 'pull' ? '' : 'none';
      document.getElementById('ha-tab-push').style.display = link.dataset.haTab === 'push' ? '' : 'none';
    });
  });

  document.getElementById('btn-copy-token').addEventListener('click', () => {
    navigator.clipboard.writeText(pollToken);
    document.getElementById('btn-copy-token').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('btn-copy-token').textContent = 'Copy'; }, 2000);
  });

  document.getElementById('btn-regen-token').addEventListener('click', async () => {
    const msg = document.getElementById('ha-msg');
    if (!confirm('Regenerate the poll token? HA sensors will stop working until you update them with the new token.')) return;
    try {
      const result = await apiPost('/settings/home-assistant/regenerate-token', {});
      document.getElementById('ha-poll-token-display').value = result.ha_poll_token;
      msg.className = 'alert alert-success';
      msg.textContent = 'Poll token regenerated. Update your HA configuration.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-test-ha').addEventListener('click', async () => {
    const msg = document.getElementById('ha-msg');
    msg.className = 'alert alert-info';
    msg.textContent = 'Testing connection...';
    msg.style.display = '';
    try {
      await apiPost('/settings/home-assistant/test', {});
      msg.className = 'alert alert-success';
      msg.textContent = 'Push test successful! Check sensor.hamshack_test in your HA instance.';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = `Test failed: ${err.message}`;
    }
  });

  document.getElementById('btn-save-ha').addEventListener('click', async () => {
    const msg = document.getElementById('ha-msg');
    try {
      await apiPut('/settings/home-assistant', {
        ha_url: document.getElementById('ha-url').value,
        ha_token: document.getElementById('ha-token').value || null,
        enabled_push: document.getElementById('ha-push-enabled').checked,
        enabled_pull: document.getElementById('ha-pull-enabled').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Home Assistant settings saved.';
      msg.style.display = '';
      // Reload to show generated poll token if this was first save
      if (!data.ha_poll_token) renderHomeAssistantTab(container);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
