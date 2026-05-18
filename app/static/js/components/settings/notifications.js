import { apiGet, apiPut } from '../../api.js';

export async function renderNotificationsTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/notifications');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-toggles me-2"></i>Notification Toggles</div>
      <div class="card-body">
        <div id="notif-msg" class="alert" style="display:none"></div>
        <form id="notif-form">

          <h6 class="text-muted mb-3">Email</h6>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-shutdown" ${data.shutdown_email !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-shutdown">
                <strong>Shutdown Email</strong><br>
                <small class="text-muted">Send email when automatic shutdown is triggered.</small>
              </label>
            </div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-digest" ${data.digest_email !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-digest">
                <strong>Daily Digest Email</strong><br>
                <small class="text-muted">Send daily forecast summary email.</small>
              </label>
            </div>
          </div>

          <hr />
          <h6 class="text-muted mb-3">IFTTT</h6>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-ifttt-shutdown" ${data.shutdown_ifttt !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-ifttt-shutdown">
                <strong>Shutdown IFTTT Event</strong><br>
                <small class="text-muted">Fire IFTTT webhook when shutdown is triggered.</small>
              </label>
            </div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-ifttt-threshold" ${data.threshold_ifttt !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-ifttt-threshold">
                <strong>Threshold Alert IFTTT Event</strong><br>
                <small class="text-muted">Fire IFTTT webhook on threshold alerts.</small>
              </label>
            </div>
          </div>

          <hr />
          <h6 class="text-muted mb-3">Telegram</h6>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-tg-shutdown" ${data.shutdown_telegram !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-tg-shutdown">
                <strong>Shutdown Telegram Message</strong><br>
                <small class="text-muted">Send Telegram message when shutdown is triggered.</small>
              </label>
            </div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-tg-threshold" ${data.threshold_telegram !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-tg-threshold">
                <strong>Threshold Alert Telegram Message</strong><br>
                <small class="text-muted">Send Telegram message on threshold alerts.</small>
              </label>
            </div>
          </div>

          <hr />
          <h6 class="text-muted mb-3">ntfy</h6>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-ntfy-shutdown" ${data.shutdown_ntfy !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-ntfy-shutdown">
                <strong>Shutdown ntfy Notification</strong><br>
                <small class="text-muted">Send ntfy push notification when shutdown is triggered.</small>
              </label>
            </div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="notif-ntfy-threshold" ${data.threshold_ntfy !== false ? 'checked' : ''} />
              <label class="form-check-label" for="notif-ntfy-threshold">
                <strong>Threshold Alert ntfy Notification</strong><br>
                <small class="text-muted">Send ntfy push notification on threshold alerts.</small>
              </label>
            </div>
          </div>

          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('notif-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('notif-msg');
    try {
      await apiPut('/settings/notifications', {
        shutdown_email: document.getElementById('notif-shutdown').checked,
        digest_email: document.getElementById('notif-digest').checked,
        shutdown_ifttt: document.getElementById('notif-ifttt-shutdown').checked,
        threshold_ifttt: document.getElementById('notif-ifttt-threshold').checked,
        shutdown_telegram: document.getElementById('notif-tg-shutdown').checked,
        threshold_telegram: document.getElementById('notif-tg-threshold').checked,
        shutdown_ntfy: document.getElementById('notif-ntfy-shutdown').checked,
        threshold_ntfy: document.getElementById('notif-ntfy-threshold').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Notification settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
