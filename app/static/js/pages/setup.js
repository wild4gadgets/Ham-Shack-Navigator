import { apiPost } from '../api.js';
import { setToken } from '../state.js';

export function renderSetup(container) {
  container.innerHTML = `
    <div class="row justify-content-center mt-5">
      <div class="col-md-5">
        <div class="card">
          <div class="card-header text-center">
            <h4><i class="bi bi-gear me-2"></i>First-Time Setup</h4>
            <small class="text-muted">Create your administrator account</small>
          </div>
          <div class="card-body">
            <div id="setup-error" class="alert alert-danger" style="display:none"></div>
            <form id="setup-form">
              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" id="setup-email" required />
              </div>
              <div class="mb-3">
                <label class="form-label">Password</label>
                <input type="password" class="form-control" id="setup-password" required />
                <div class="form-text text-muted">Min 10 chars, upper, lower, digit, special</div>
              </div>
              <div class="mb-3">
                <label class="form-label">Confirm Password</label>
                <input type="password" class="form-control" id="setup-password2" required />
              </div>
              <button type="submit" class="btn btn-success w-100">Create Account</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('setup-error');
    errDiv.style.display = 'none';

    const pw = document.getElementById('setup-password').value;
    const pw2 = document.getElementById('setup-password2').value;
    if (pw !== pw2) {
      errDiv.textContent = 'Passwords do not match';
      errDiv.style.display = '';
      return;
    }

    try {
      const result = await apiPost('/setup', {
        email: document.getElementById('setup-email').value,
        password: pw,
      });
      setToken(result.access_token);
      window.location.hash = '#/settings';
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.style.display = '';
    }
  });
}
