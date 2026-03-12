import { apiPut } from '../../api.js';

export function renderAccountTab(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-person me-2"></i>Account Settings</div>
      <div class="card-body">
        <h6>Change Password</h6>
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
