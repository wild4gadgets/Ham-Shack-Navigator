import { apiGet, apiPut, apiPost } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

const DEFAULTS = {
  name: 'My ntfy Profile',
  server_url: 'https://ntfy.sh',
  topic: '',
  token: '',
  enabled: false,
  notify_shutdown: true,
  notify_threshold: true,
  notify_flexradio_down: true,
};

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function profileCardHtml(profile, index) {
  const p = { ...DEFAULTS, ...profile };
  const headerId   = `ntfy-heading-${index}`;
  const collapseId = `ntfy-collapse-${index}`;
  const badgeCls   = p.enabled ? 'badge bg-success ms-2' : 'badge bg-secondary ms-2';
  const badgeTxt   = p.enabled ? 'Enabled' : 'Disabled';
  const topicHint  = p.topic ? _esc(p.topic) : 'no topic set';

  const chk = (field, val, label, hint) => `
    <div class="form-check form-switch mb-2">
      <input class="form-check-input ntfy-field" type="checkbox" data-field="${field}"
        id="ntfy-${field}-${index}" ${val ? 'checked' : ''}>
      <label class="form-check-label" for="ntfy-${field}-${index}">
        <strong>${label}</strong>
        <div class="form-text">${hint}</div>
      </label>
    </div>`;

  return `
    <div class="accordion-item bg-transparent border border-secondary mb-2 rounded" data-profile-index="${index}">
      <div class="d-flex align-items-center" id="${headerId}">
        <button class="accordion-button collapsed flex-grow-1 d-flex align-items-center gap-2"
          type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}"
          style="background:#1a1f2e;color:#e0e0e0;border:none;border-radius:6px 0 0 6px;min-width:0">
          <i class="bi bi-bell-fill text-info flex-shrink-0"></i>
          <span class="ntfy-profile-title fw-semibold text-truncate">${_esc(p.name || 'Unnamed Profile')}</span>
          <span class="text-muted small text-truncate">${topicHint}</span>
          <span class="${badgeCls} flex-shrink-0">${badgeTxt}</span>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger ntfy-delete-btn flex-shrink-0 me-2"
          data-index="${index}" title="Delete profile" style="border-radius:0 6px 6px 0">
          <i class="bi bi-trash"></i>
        </button>
      </div>
      <div id="${collapseId}" class="accordion-collapse collapse">
        <div class="accordion-body" style="background:#12172a">

          <div class="mb-3">
            <label class="form-label">Profile Name</label>
            <input type="text" class="form-control ntfy-field" data-field="name"
              placeholder="My ntfy Profile" value="${_esc(p.name)}" style="${INP}">
            <div class="form-text">A friendly name to identify this ntfy profile.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Server URL</label>
            <input type="text" class="form-control ntfy-field" data-field="server_url"
              placeholder="https://ntfy.sh" value="${_esc(p.server_url)}" style="${INP}">
            <div class="form-text">Leave as <code>https://ntfy.sh</code> unless you self-host ntfy.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Topic</label>
            <input type="text" class="form-control ntfy-field" data-field="topic"
              placeholder="my-ham-shack-4729" value="${_esc(p.topic ?? '')}" style="${INP}">
            <div class="form-text">Anyone who knows the topic can subscribe — make it hard to guess.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Token <span style="color:#adb5bd">(optional — bearer token for protected topics)</span></label>
            <input type="password" class="form-control ntfy-field" data-field="token"
              placeholder="" value="${_esc(p.token ?? '')}" style="${INP}">
          </div>

          <div class="mb-4 form-check form-switch">
            <input class="form-check-input ntfy-field" type="checkbox" data-field="enabled"
              id="ntfy-enabled-${index}" ${p.enabled ? 'checked' : ''}>
            <label class="form-check-label" for="ntfy-enabled-${index}">Enable this profile</label>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-2">Notification Events</h6>
          <p class="form-text mb-3">Choose which events are sent via this profile.</p>
          ${chk('notify_shutdown',       p.notify_shutdown,       'Equipment shutdown',       'Push notification when weather protection shuts down equipment.')}
          ${chk('notify_threshold',      p.notify_threshold,      'Weather threshold alert',  'Push notification when lightning or wind exceeds configured thresholds.')}
          ${chk('notify_flexradio_down', p.notify_flexradio_down, 'FlexRadio down',           'Push notification when a FlexRadio fails ping checks (also requires per-radio notification to be enabled).')}

          <div class="d-flex gap-2 mt-3">
            <button type="button" class="btn btn-sm btn-outline-info ntfy-test-btn" data-index="${index}">
              <i class="bi bi-send me-1"></i>Send Test
            </button>
          </div>

        </div>
      </div>
    </div>
  `;
}

function collectProfiles(accordion) {
  const cards = accordion.querySelectorAll('[data-profile-index]');
  return Array.from(cards).map(card => {
    const get = (field) => {
      const el = card.querySelector(`[data-field="${field}"]`);
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      return el.value.trim();
    };
    return {
      name:                 get('name') || 'My ntfy Profile',
      server_url:           get('server_url') || 'https://ntfy.sh',
      topic:                get('topic') || null,
      token:                get('token') || null,
      enabled:              get('enabled') ?? false,
      notify_shutdown:      get('notify_shutdown') ?? true,
      notify_threshold:     get('notify_threshold') ?? true,
      notify_flexradio_down: get('notify_flexradio_down') ?? true,
    };
  });
}

export async function renderNtfyTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';

  let data;
  try {
    data = await apiGet('/settings/ntfy');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load ntfy settings: ${_esc(err.message)}</div>`;
    return;
  }

  let profiles = Array.isArray(data?.profiles) ? data.profiles : [];

  function render() {
    container.innerHTML = `
      <div class="card">
        <div class="card-header d-flex align-items-center justify-content-between">
          <span><i class="bi bi-bell-fill me-2"></i>ntfy Push Notifications</span>
          <button type="button" class="btn btn-sm btn-outline-info" id="ntfy-add-btn">
            <i class="bi bi-plus-lg me-1"></i>Add Profile
          </button>
        </div>
        <div class="card-body">

          <div class="mb-4 p-3 rounded" style="font-size:0.875rem;background:#0f3460;border:1px solid #1a4a80;color:#e0e0e0">
            <strong>Setup:</strong>
            <ol class="mb-0 mt-1">
              <li>Install the <strong>ntfy</strong> app on your phone (<a href="https://ntfy.sh" target="_blank" class="text-info">ntfy.sh</a> — free).</li>
              <li>Choose a unique topic name (e.g. <code>my-ham-shack-4729</code>). Anyone who knows the topic can subscribe, so make it hard to guess.</li>
              <li>Subscribe to your topic in the app.</li>
              <li>Add a profile below, enter the topic, and click <strong>Send Test</strong> to verify.</li>
            </ol>
          </div>

          <div id="ntfy-msg" class="alert" style="display:none"></div>

          ${profiles.length === 0
            ? '<p class="text-muted">No profiles configured. Click <strong>Add Profile</strong> to get started.</p>'
            : ''
          }

          <div class="accordion" id="ntfy-accordion">
            ${profiles.map((p, i) => profileCardHtml(p, i)).join('')}
          </div>

          ${profiles.length > 0
            ? '<button type="button" class="btn btn-primary mt-3" id="ntfy-save-btn">Save</button>'
            : ''
          }
        </div>
      </div>
    `;

    document.getElementById('ntfy-add-btn').addEventListener('click', () => {
      profiles.push({ ...DEFAULTS });
      render();
      const lastCollapse = document.getElementById(`ntfy-collapse-${profiles.length - 1}`);
      if (lastCollapse) lastCollapse.classList.add('show');
    });

    const acc = document.getElementById('ntfy-accordion');

    acc.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.ntfy-delete-btn');
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.index, 10);
        profiles.splice(idx, 1);
        render();
        return;
      }

      const testBtn = e.target.closest('.ntfy-test-btn');
      if (testBtn) {
        const idx = parseInt(testBtn.dataset.index, 10);
        const msg = document.getElementById('ntfy-msg');
        msg.className = 'alert alert-info';
        msg.textContent = `Sending test to profile ${idx + 1}…`;
        msg.style.display = '';
        try {
          await apiPost(`/settings/ntfy/test/${idx}`, {});
          msg.className = 'alert alert-success';
          msg.textContent = 'Test notification sent!';
        } catch (err) {
          msg.className = 'alert alert-danger';
          msg.textContent = `Test failed: ${err.message}`;
        }
      }
    });

    const saveBtn = document.getElementById('ntfy-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const collected = collectProfiles(acc);
        try {
          await apiPut('/settings/ntfy', { profiles: collected });
          profiles = collected;
          render();
          const msg = document.getElementById('ntfy-msg');
          msg.className = 'alert alert-success';
          msg.textContent = 'ntfy settings saved.';
          msg.style.display = '';
        } catch (err) {
          const msg = document.getElementById('ntfy-msg');
          msg.className = 'alert alert-danger';
          msg.textContent = err.message;
          msg.style.display = '';
        }
      });
    }
  }

  render();
}
