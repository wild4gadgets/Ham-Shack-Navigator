import { apiGet, apiPut } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

export async function renderFlrigTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/flrig');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-router me-2"></i>flrig Rig Control</div>
      <div class="card-body">
        <p class="text-muted small mb-3">
          Connect to a running <strong>flrig</strong> instance via its XML-RPC interface.
          flrig must be installed and running on this machine before enabling.
        </p>
        <div id="flrig-msg" class="alert" style="display:none"></div>
        <form id="flrig-form">
          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="flrig-enabled" ${data.enabled ? 'checked' : ''}>
            <label class="form-check-label" for="flrig-enabled">Enable flrig XML-RPC connection</label>
          </div>
          <div class="mb-3">
            <label class="form-label">Host</label>
            <input type="text" class="form-control" id="flrig-host"
              value="${data.host ?? 'localhost'}" style="${INP}">
            <div class="form-text">Hostname or IP where flrig is running. Usually <code>localhost</code>.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Port</label>
            <input type="number" class="form-control" id="flrig-port"
              min="1" max="65535" value="${data.port ?? 12345}" style="${INP}">
            <div class="form-text">flrig XML-RPC port. Default: <code>12345</code>.</div>
          </div>
          <div class="mb-4">
            <label class="form-label">Poll Interval (ms)</label>
            <input type="number" class="form-control" id="flrig-poll-ms"
              min="250" max="10000" step="250" value="${data.poll_interval_ms ?? 1000}" style="${INP}">
            <div class="form-text">How often to query flrig for state changes. 1000 ms recommended.</div>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>`;

  document.getElementById('flrig-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('flrig-msg');
    try {
      await apiPut('/settings/flrig', {
        enabled:          document.getElementById('flrig-enabled').checked,
        host:             document.getElementById('flrig-host').value.trim(),
        port:             parseInt(document.getElementById('flrig-port').value, 10),
        poll_interval_ms: parseInt(document.getElementById('flrig-poll-ms').value, 10),
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'flrig settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message ?? 'Save failed.';
      msg.style.display = '';
    }
  });
}
