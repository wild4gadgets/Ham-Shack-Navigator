import { apiPost } from '../api.js';
import { setToken } from '../state.js';

export function renderLogin(container) {
  container.innerHTML = `
    <div class="row justify-content-center mt-5">
      <div class="col-md-4">
        <div class="card">
          <div class="card-header text-center">
            <h4><i class="bi bi-broadcast-pin me-2"></i>Ham Shack Navigator</h4>
          </div>
          <div class="card-body">
            <div id="login-error" class="alert alert-danger" style="display:none"></div>
            <form id="login-form">
              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" id="login-email" required />
              </div>
              <div class="mb-3">
                <label class="form-label">Password</label>
                <input type="password" class="form-control" id="login-password" required />
              </div>
              <button type="submit" class="btn btn-primary w-100">Login</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('login-error');
    errDiv.style.display = 'none';
    try {
      const result = await apiPost('/auth/login', {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      });
      setToken(result.access_token);
      window.location.hash = '#/dashboard';
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.style.display = '';
    }
  });
}
