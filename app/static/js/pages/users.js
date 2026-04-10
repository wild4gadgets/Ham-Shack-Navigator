import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { state } from '../state.js';

export async function renderUsers(container) {
  container.innerHTML = '<div class="text-center mt-4"><div class="spinner-border text-secondary"></div></div>';

  let users = [];
  try {
    users = await apiGet('/users');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load users: ${err.message}</div>`;
    return;
  }

  render(container, users);
}

function render(container, users) {
  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="mb-0"><i class="bi bi-people me-2"></i>User Management</h5>
      <button class="btn btn-sm btn-primary" id="btn-add-user">
        <i class="bi bi-person-plus me-1"></i>Add User
      </button>
    </div>

    <div id="users-msg" class="alert" style="display:none"></div>

    <!-- Add user form (hidden by default) -->
    <div class="card mb-3" id="add-user-card" style="display:none">
      <div class="card-header">New User</div>
      <div class="card-body">
        <div id="add-user-msg" class="alert" style="display:none"></div>
        <form id="add-user-form">
          <div class="row g-2">
            <div class="col-md-4">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" id="new-user-email" required />
            </div>
            <div class="col-md-4">
              <label class="form-label">Password</label>
              <input type="password" class="form-control" id="new-user-password" required />
              <div class="form-text text-muted">Min 10 chars, upper, lower, digit, special</div>
            </div>
            <div class="col-md-2">
              <label class="form-label">Role</label>
              <select class="form-select" id="new-user-role">
                <option value="readonly">Read-only</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="col-md-2 d-flex align-items-end gap-2">
              <button type="submit" class="btn btn-primary btn-sm">Create</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-add">Cancel</button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- Users table -->
    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0" id="users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => renderUserRow(u)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Toggle add-user form
  document.getElementById('btn-add-user').addEventListener('click', () => {
    document.getElementById('add-user-card').style.display = '';
    document.getElementById('btn-add-user').style.display = 'none';
  });
  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    document.getElementById('add-user-card').style.display = 'none';
    document.getElementById('btn-add-user').style.display = '';
    document.getElementById('add-user-form').reset();
  });

  // Create user
  document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('add-user-msg');
    msg.style.display = 'none';
    try {
      await apiPost('/users', {
        email: document.getElementById('new-user-email').value,
        password: document.getElementById('new-user-password').value,
        role: document.getElementById('new-user-role').value,
      });
      const users = await apiGet('/users');
      render(container, users);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  // Role change & delete via event delegation
  document.getElementById('users-table').addEventListener('change', async (e) => {
    if (!e.target.matches('.role-select')) return;
    const userId = parseInt(e.target.dataset.userId);
    const newRole = e.target.value;
    const msg = document.getElementById('users-msg');
    msg.style.display = 'none';
    try {
      await apiPut(`/users/${userId}/role`, { role: newRole });
      msg.className = 'alert alert-success';
      msg.textContent = 'Role updated.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
      // Reload to reset the select
      const users = await apiGet('/users');
      render(container, users);
    }
  });

  document.getElementById('users-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-delete-user');
    if (!btn) return;
    const userId = parseInt(btn.dataset.userId);
    const email = btn.dataset.email;
    if (!confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    const msg = document.getElementById('users-msg');
    msg.style.display = 'none';
    try {
      await apiDelete(`/users/${userId}`);
      const users = await apiGet('/users');
      render(container, users);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}

function renderUserRow(u) {
  const isCurrentUser = state.user && u.id === state.user.id;
  const created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';

  const roleSelect = isCurrentUser
    ? `<span class="badge ${u.role === 'admin' ? 'bg-danger' : 'bg-secondary'}">${u.role === 'admin' ? 'Admin' : 'Read-only'}</span> <small class="text-muted">(you)</small>`
    : `<select class="form-select form-select-sm role-select" style="width:auto" data-user-id="${u.id}">
        <option value="readonly" ${u.role === 'readonly' ? 'selected' : ''}>Read-only</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>`;

  const deleteBtn = isCurrentUser
    ? ''
    : `<button class="btn btn-sm btn-outline-danger btn-delete-user" data-user-id="${u.id}" data-email="${u.email}">
        <i class="bi bi-trash"></i>
      </button>`;

  return `
    <tr>
      <td class="align-middle">${u.email}</td>
      <td class="align-middle">${roleSelect}</td>
      <td class="align-middle text-muted"><small>${created}</small></td>
      <td class="align-middle text-end">${deleteBtn}</td>
    </tr>`;
}
