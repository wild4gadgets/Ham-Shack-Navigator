import { navigate } from './router.js';
import { clearToken, getToken, state } from './state.js';
import { apiGet, apiPost } from './api.js';

// ── Profile Modal ─────────────────────────────────────────────────────────────

const profileModalEl = document.getElementById('profileModal');
if (profileModalEl) {
  profileModalEl.addEventListener('show.bs.modal', async () => {
    const body = document.getElementById('profile-modal-body');
    body.innerHTML = '<div class="text-muted text-center py-2" style="font-size:0.85rem">Loading…</div>';
    try {
      const data = await apiGet('/settings/profiles');
      _renderProfileModalBody(body, data);
    } catch (e) {
      body.innerHTML = `<div class="text-danger p-2" style="font-size:0.82rem">${e.message}</div>`;
    }
  });
}

function _renderProfileModalBody(body, data) {
  const { active_profile_id, profiles } = data;
  if (!profiles.length) {
    body.innerHTML = `
      <div class="text-muted text-center py-3" style="font-size:0.85rem">No profiles yet.</div>`;
    return;
  }
  body.innerHTML = profiles.map(p => {
    const isActive = p.id === active_profile_id;
    return `
      <button class="btn btn-sm w-100 text-start mb-1 profile-switch-btn
                     ${isActive ? 'btn-primary' : 'btn-outline-secondary'}"
              data-id="${p.id}" data-order='${JSON.stringify(p.order)}'
              style="font-size:0.85rem;${isActive ? 'font-weight:700' : ''}">
        ${isActive ? '<i class="bi bi-check2 me-1"></i>' : '<i class="bi bi-layout-three-columns me-1"></i>'}
        ${_escHtml(p.name)}
      </button>`;
  }).join('');

  body.querySelectorAll('.profile-switch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const profileId = btn.dataset.id;
      const order = JSON.parse(btn.dataset.order);
      try {
        await apiPost(`/settings/profiles/${profileId}/activate`, {});
        bootstrap.Modal.getInstance(profileModalEl)?.hide();
        _applyTileOrder(order);
        // Re-highlight active in modal body (modal is closing, but update state)
      } catch (e) {
        btn.textContent = 'Error — try again';
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
  // Monitoring is always first
  const mon = parent.querySelector('[data-section="monitoring"]');
  if (mon) parent.insertBefore(mon, parent.firstChild);
}

function _escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  state.user = null;
  window.location.hash = '#/login';
});

// Hash routing
window.addEventListener('hashchange', () => navigate());

// Initial navigation (module scripts are deferred, so DOM is ready)
navigate();

// ── 7-segment LED clocks ─────────────────────────────────────────────────────

const SEG_MAP = {
  '0':[1,1,1,1,1,1,0], '1':[0,1,1,0,0,0,0], '2':[1,1,0,1,1,0,1],
  '3':[1,1,1,1,0,0,1], '4':[0,1,1,0,0,1,1], '5':[1,0,1,1,0,1,1],
  '6':[1,0,1,1,1,1,1], '7':[1,1,1,0,0,0,0], '8':[1,1,1,1,1,1,1],
  '9':[1,1,1,1,0,1,1],
};

function segDigit(ch) {
  const s = SEG_MAP[ch] || [0,0,0,0,0,0,0];
  // segments: a, b, c, d, e, f, g
  return `<div class="seg-digit">
    <span class="seg seg-a${s[0]?' on':''}"></span>
    <span class="seg seg-b${s[1]?' on':''}"></span>
    <span class="seg seg-c${s[2]?' on':''}"></span>
    <span class="seg seg-d${s[3]?' on':''}"></span>
    <span class="seg seg-e${s[4]?' on':''}"></span>
    <span class="seg seg-f${s[5]?' on':''}"></span>
    <span class="seg seg-g${s[6]?' on':''}"></span>
  </div>`;
}

function renderSegTime(h, m) {
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const colon = `<div class="seg-colon"><span class="seg-dot"></span><span class="seg-dot"></span></div>`;
  return segDigit(hh[0]) + segDigit(hh[1]) + colon + segDigit(mm[0]) + segDigit(mm[1]);
}

function updateClocks() {
  const now = new Date();
  const local = document.getElementById('clock-local-display');
  const utc   = document.getElementById('clock-utc-display');
  if (local) local.innerHTML = renderSegTime(now.getHours(), now.getMinutes());
  if (utc)   utc.innerHTML   = renderSegTime(now.getUTCHours(), now.getUTCMinutes());
}

updateClocks();
setInterval(updateClocks, 1000);
