import { apiGet, apiPut } from '../../api.js';

export async function renderAccountTab(container) {
  const me = await apiGet('/users/me');

  container.innerHTML = `
    <div class="card mb-3">
      <div class="card-header"><i class="bi bi-envelope me-2"></i>Change Email</div>
      <div class="card-body">
        <p class="text-muted mb-3">Current email: <strong>${me.email}</strong></p>
        <div id="email-msg" class="alert" style="display:none"></div>
        <form id="email-form">
          <div class="mb-3">
            <label class="form-label">New Email Address</label>
            <input type="email" class="form-control" id="new-email" required />
          </div>
          <div class="mb-3">
            <label class="form-label">Current Password</label>
            <input type="password" class="form-control" id="email-cur-password" required />
          </div>
          <button type="submit" class="btn btn-primary">Change Email</button>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><i class="bi bi-key me-2"></i>Change Password</div>
      <div class="card-body">
        <div id="account-msg" class="alert" style="display:none"></div>
        <form id="password-form">
          <div class="mb-3">
            <label class="form-label">Current Password</label>
            <input type="password" class="form-control" id="cur-password" required />
          </div>
          <div class="mb-3">
            <label class="form-label">New Password</label>
            <input type="password" class="form-control" id="new-password" required />
            <div class="form-text text-muted">Min 10 chars, upper, lower, digit, special</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Confirm New Password</label>
            <input type="password" class="form-control" id="new-password2" required />
          </div>
          <button type="submit" class="btn btn-primary">Change Password</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('email-msg');
    msg.style.display = 'none';
    try {
      await apiPut('/users/me/email', {
        new_email: document.getElementById('new-email').value,
        current_password: document.getElementById('email-cur-password').value,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Email updated successfully.';
      msg.style.display = '';
      document.getElementById('email-form').reset();
      // Refresh to show new email
      await renderAccountTab(container);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('account-msg');
    msg.style.display = 'none';

    const newPw = document.getElementById('new-password').value;
    const newPw2 = document.getElementById('new-password2').value;
    if (newPw !== newPw2) {
      msg.className = 'alert alert-danger';
      msg.textContent = 'Passwords do not match';
      msg.style.display = '';
      return;
    }

    try {
      await apiPut('/users/me/password', {
        current_password: document.getElementById('cur-password').value,
        new_password: newPw,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Password changed successfully.';
      msg.style.display = '';
      document.getElementById('password-form').reset();
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
