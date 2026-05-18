import { apiGet, apiPut, apiPost } from '../../api.js';

export async function renderNtfyTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';
  let data;
  try {
    data = await apiGet('/settings/ntfy');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load ntfy settings: ${err.message}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-bell-fill me-2"></i>ntfy Push Notifications</div>
      <div class="card-body">
        <div id="ntfy-msg" class="alert" style="display:none"></div>

        <div class="mb-4 p-3 rounded" style="font-size:0.875rem;background:#0f3460;border:1px solid #1a4a80;color:#e0e0e0">
          <strong>Setup:</strong>
          <ol class="mb-0 mt-1">
            <li>Install the <strong>ntfy</strong> app on your phone (<a href="https://ntfy.sh" target="_blank" class="text-info">ntfy.sh</a> — free).</li>
            <li>Choose a unique topic name (e.g. <code>my-ham-shack-4729</code>). Anyone who knows the topic can subscribe, so make it hard to guess.</li>
            <li>Subscribe to your topic in the app.</li>
            <li>Enter the topic below and click Save, then send a test notification to verify.</li>
          </ol>
          <div class="mt-2" style="color:#adb5bd">Leave Server URL as <code>https://ntfy.sh</code> unless you self-host ntfy. Token is only needed for protected topics.</div>
        </div>

        <form id="ntfy-form">
          <div class="mb-3">
            <label class="form-label" style="color:#fff">Server URL</label>
            <input type="text" class="form-control" id="ntfy-server" value="${data.server_url || 'https://ntfy.sh'}" placeholder="https://ntfy.sh" />
          </div>
          <div class="mb-3">
            <label class="form-label" style="color:#fff">Topic</label>
            <input type="text" class="form-control" id="ntfy-topic" value="${data.topic || ''}" placeholder="my-ham-shack-4729" />
          </div>
          <div class="mb-3">
            <label class="form-label" style="color:#fff">Token <span style="color:#adb5bd">(optional: bearer token for protected topics)</span></label>
            <input type="password" class="form-control" id="ntfy-token" value="${data.token || ''}" placeholder="" />
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="ntfy-enabled" ${data.enabled ? 'checked' : ''} />
              <label class="form-check-label" style="color:#fff" for="ntfy-enabled">Enable ntfy notifications</label>
            </div>
          </div>
          <div class="d-flex gap-2">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline-info" id="btn-test-ntfy">Send Test Notification</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('ntfy-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ntfy-msg');
    try {
      await apiPut('/settings/ntfy', {
        server_url: document.getElementById('ntfy-server').value || 'https://ntfy.sh',
        topic: document.getElementById('ntfy-topic').value || null,
        token: document.getElementById('ntfy-token').value || null,
        enabled: document.getElementById('ntfy-enabled').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'ntfy settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-test-ntfy').addEventListener('click', async () => {
    const msg = document.getElementById('ntfy-msg');
    msg.className = 'alert alert-info';
    msg.textContent = 'Sending test notification...';
    msg.style.display = '';
    try {
      await apiPost('/settings/ntfy/test', {});
      msg.className = 'alert alert-success';
      msg.textContent = 'Test notification sent!';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = `Test failed: ${err.message}`;
    }
  });
}
