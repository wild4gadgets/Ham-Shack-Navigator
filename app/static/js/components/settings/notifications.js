import { apiGet, apiPut } from '../../api.js';

export async function renderNotificationsTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/notifications');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-bell me-2"></i>Notification Settings</div>
      <div class="card-body">
        <div id="notif-msg" class="alert" style="display:none"></div>
        <form id="notif-form">
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
