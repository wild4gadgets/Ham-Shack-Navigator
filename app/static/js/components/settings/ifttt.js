import { apiGet, apiPut, apiPost } from '../../api.js';

export async function renderIftttTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';
  let data;
  try {
    data = await apiGet('/settings/ifttt');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load IFTTT settings: ${err.message}</div>`;
    return;
  }

  const webhookUrl = `${window.location.origin}/api/v1/monitoring/webhook/trigger`;

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-arrow-left-right me-2"></i>IFTTT Webhooks</div>
      <div class="card-body">
        <div id="ifttt-msg" class="alert" style="display:none"></div>

        <h6 class="mb-3" style="color:#a0a8b8">Outgoing — Ham Shack Navigator → IFTTT</h6>
        <form id="ifttt-form">
          <div class="mb-3">
            <label class="form-label">Webhook Key</label>
            <input type="password" class="form-control" id="ifttt-key" value="${data.webhook_key || ''}" placeholder="Your IFTTT Maker webhook key" />
            <div class="form-text">Found at <strong>ifttt.com/maker_webhooks</strong> → Documentation.</div>
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Shutdown Event Name</label>
              <input type="text" class="form-control" id="ifttt-evt-shutdown" value="${data.event_name_shutdown || 'ham_shack_shutdown'}" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Threshold Alert Event Name</label>
              <input type="text" class="form-control" id="ifttt-evt-threshold" value="${data.event_name_threshold || 'ham_shack_alert'}" />
            </div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="ifttt-enabled" ${data.enabled ? 'checked' : ''} />
              <label class="form-check-label" for="ifttt-enabled">Enable outgoing IFTTT events</label>
            </div>
          </div>

          <hr />
          <h6 class="mb-3" style="color:#a0a8b8">Incoming — IFTTT → Ham Shack Navigator</h6>
          <div class="mb-3">
            <label class="form-label">Incoming Webhook Secret</label>
            <input type="password" class="form-control" id="ifttt-secret" value="${data.incoming_secret || ''}" placeholder="Set a strong random secret to enable incoming webhooks" />
            <div class="form-text">Required — the endpoint rejects all requests unless a secret is configured.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Incoming Webhook URL</label>
            <div class="input-group">
              <input type="text" class="form-control font-monospace" id="ifttt-webhook-url" value="${webhookUrl}" readonly />
              <button type="button" class="btn btn-outline-secondary" id="btn-copy-url">Copy</button>
            </div>
            <div class="form-text">
              POST to this URL with header <code>X-Webhook-Secret: your-secret</code> and body
              <code>{"action": "arm"}</code>, <code>{"action": "disarm"}</code>, or <code>{"action": "trigger_shutdown"}</code>.
            </div>
          </div>

          <div class="d-flex gap-2">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline-info" id="btn-test-ifttt">Send Test Event</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('btn-copy-url').addEventListener('click', () => {
    navigator.clipboard.writeText(webhookUrl);
    document.getElementById('btn-copy-url').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('btn-copy-url').textContent = 'Copy'; }, 2000);
  });

  document.getElementById('ifttt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ifttt-msg');
    try {
      await apiPut('/settings/ifttt', {
        webhook_key: document.getElementById('ifttt-key').value,
        event_name_shutdown: document.getElementById('ifttt-evt-shutdown').value,
        event_name_threshold: document.getElementById('ifttt-evt-threshold').value,
        enabled: document.getElementById('ifttt-enabled').checked,
        incoming_secret: document.getElementById('ifttt-secret').value || null,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'IFTTT settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-test-ifttt').addEventListener('click', async () => {
    const msg = document.getElementById('ifttt-msg');
    msg.className = 'alert alert-info';
    msg.textContent = 'Sending test event...';
    msg.style.display = '';
    try {
      await apiPost('/settings/ifttt/test', {});
      msg.className = 'alert alert-success';
      msg.textContent = 'Test event sent to IFTTT!';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = `Test failed: ${err.message}`;
    }
  });
}
