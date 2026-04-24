import { apiGet, apiPut, apiPost } from '../../api.js';

export async function renderSmtpTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/smtp');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-envelope me-2"></i>SMTP / Email Settings</div>
      <div class="card-body">
        <div id="smtp-msg" class="alert" style="display:none"></div>
        <form id="smtp-form">
          <div class="row">
            <div class="col-md-8 mb-3">
              <label class="form-label">SMTP Host</label>
              <input type="text" class="form-control" id="smtp-host" value="${data.host || ''}" placeholder="smtp.gmail.com" />
            </div>
            <div class="col-md-4 mb-3">
              <label class="form-label">Port</label>
              <input type="number" class="form-control" id="smtp-port" value="${data.port || 587}" />
            </div>
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Username</label>
              <input type="text" class="form-control" id="smtp-user" value="${data.user || ''}" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Password</label>
              <input type="password" class="form-control" id="smtp-password" value="${data.password || ''}" placeholder="Leave as-is to keep current" />
            </div>
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">From Address</label>
              <input type="email" class="form-control" id="smtp-from" value="${data.from_addr || ''}" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">To Address</label>
              <input type="email" class="form-control" id="smtp-to" value="${data.to_addr || ''}" />
            </div>
          </div>
          <hr />
          <div class="row">
            <div class="col-md-4 mb-3">
              <label class="form-label">Daily Digest Time (local time)</label>
              <input type="time" class="form-control" id="digest-time" value="${data.digest_time || '06:00'}" />
            </div>
            <div class="col-md-4 mb-3 d-flex align-items-end">
              <div class="form-check">
                <input type="checkbox" class="form-check-input" id="digest-enabled" ${data.digest_enabled !== false ? 'checked' : ''} />
                <label class="form-check-label" for="digest-enabled">Enable Daily Digest</label>
              </div>
            </div>
          </div>
          <div class="d-flex gap-2">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline-info" id="btn-test-email">Send Test Email</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('smtp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('smtp-msg');
    try {
      await apiPut('/settings/smtp', {
        host: document.getElementById('smtp-host').value,
        port: parseInt(document.getElementById('smtp-port').value),
        user: document.getElementById('smtp-user').value,
        password: document.getElementById('smtp-password').value,
        from_addr: document.getElementById('smtp-from').value,
        to_addr: document.getElementById('smtp-to').value,
        digest_time: document.getElementById('digest-time').value,
        digest_enabled: document.getElementById('digest-enabled').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'SMTP settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-test-email').addEventListener('click', async () => {
    const msg = document.getElementById('smtp-msg');
    msg.className = 'alert alert-info';
    msg.textContent = 'Sending test email...';
    msg.style.display = '';
    try {
      await apiPost('/settings/smtp/test', {});
      msg.className = 'alert alert-success';
      msg.textContent = 'Test email sent successfully!';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = `Test failed: ${err.message}`;
    }
  });
}
