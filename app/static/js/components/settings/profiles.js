import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../../api.js';

export async function renderProfilesTab(container) {
  await _render(container);
}

async function _render(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  let data;
  try {
    data = await apiGet('/settings/profiles');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger m-3">${esc(e.message)}</div>`;
    return;
  }

  const { active_profile_id, profiles } = data;

  const listHtml = profiles.length === 0
    ? '<div class="text-muted p-3">No profiles</div>'
    : profiles.map(p => {
        const isActive = p.id === active_profile_id;
        return `
          <li class="list-group-item d-flex align-items-center justify-content-between gap-2"
              style="background:#1a1a3a;border-color:#2a2a4a;color:#e0e0e0">
            <span class="d-flex align-items-center gap-2">
              <button class="btn btn-link p-0 text-start btn-activate ${isActive ? 'fw-bold text-light' : 'text-secondary'}"
                      data-id="${esc(p.id)}" data-order='${escAttr(JSON.stringify(p.order))}'
                      title="${isActive ? 'Already active' : 'Switch to this profile'}"
                      style="text-decoration:none;font-size:inherit">
                ${esc(p.name)}
              </button>
              ${isActive ? '<span class="badge bg-primary" style="font-size:0.65rem">Active</span>' : ''}
            </span>
            <div class="d-flex gap-1 flex-shrink-0">
              <button class="btn btn-sm btn-outline-secondary btn-rename"
                      data-id="${esc(p.id)}" data-name="${escAttr(p.name)}"
                      title="Rename profile">Rename</button>
              <button class="btn btn-sm btn-outline-info btn-update"
                      data-id="${esc(p.id)}"
                      title="Overwrite this profile with the current dashboard layout">Update</button>
              <button class="btn btn-sm btn-outline-danger btn-delete"
                      data-id="${esc(p.id)}"
                      title="Delete profile">Delete</button>
            </div>
          </li>`;
      }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-layout-three-columns me-2"></i>Dashboard Profiles</span>
        <button class="btn btn-sm btn-primary" id="btn-add-profile">
          <i class="bi bi-plus-lg me-1"></i>Add Profile
        </button>
      </div>
      <div class="card-body p-0">
        <div id="profiles-msg" class="alert mx-3 mt-3 mb-0" style="display:none"></div>
        <p class="text-muted px-3 pt-3 mb-2" style="font-size:0.82rem">
          Profiles save and restore your dashboard tile layout.
          <strong>Click a profile name</strong> to switch to it.
          The active profile updates automatically when you drag tiles.
          Use <strong>Update</strong> to overwrite any profile with the current layout.
        </p>
        <ul class="list-group list-group-flush" id="profiles-list">
          ${listHtml}
        </ul>
      </div>
    </div>
  `;

  const msgEl = container.querySelector('#profiles-msg');

  function showMsg(text, type = 'success') {
    msgEl.className = `alert alert-${type} mx-3 mt-3 mb-0`;
    msgEl.textContent = text;
    msgEl.style.display = '';
    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
  }

  container.querySelector('#btn-add-profile').addEventListener('click', async () => {
    const name = prompt('Profile name:')?.trim();
    if (!name) return;
    try {
      await apiPost('/settings/profiles', { name });
      await _render(container);
    } catch (e) {
      showMsg(e.message, 'danger');
    }
  });

  container.querySelectorAll('.btn-rename').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = prompt('New name:', btn.dataset.name)?.trim();
      if (!name) return;
      try {
        await apiPatch(`/settings/profiles/${btn.dataset.id}`, { name });
        await _render(container);
      } catch (e) {
        showMsg(e.message, 'danger');
      }
    });
  });

  container.querySelectorAll('.btn-update').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await apiPut(`/settings/profiles/${btn.dataset.id}`, {});
        showMsg('Profile updated with current layout.');
      } catch (e) {
        showMsg(e.message, 'danger');
      }
    });
  });

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this profile?')) return;
      try {
        await apiDelete(`/settings/profiles/${btn.dataset.id}`);
        await _render(container);
      } catch (e) {
        showMsg(e.message, 'danger');
      }
    });
  });

  container.querySelectorAll('.btn-activate').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.id === active_profile_id) return;
      try {
        const result = await apiPost(`/settings/profiles/${btn.dataset.id}/activate`, {});
        _applyTileOrder(result.order);
        await _render(container);
      } catch (e) {
        showMsg(e.message, 'danger');
      }
    });
  });
}

function _applyTileOrder(order) {
  const parent = document.getElementById('dashboard-rows');
  if (!parent) return;
  order.forEach(id => {
    const el = parent.querySelector(`[data-section="${id}"]`);
    if (el) parent.appendChild(el);
  });
  const mon = parent.querySelector('[data-section="monitoring"]');
  if (mon) parent.insertBefore(mon, parent.firstChild);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}
