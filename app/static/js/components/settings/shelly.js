import { apiGet, apiPost, apiPut, apiDelete } from '../../api.js';

let pollTimers = {};

export async function renderShellyTab(container) {
  // Clear any existing poll timers from a previous render
  Object.values(pollTimers).forEach(clearInterval);
  pollTimers = {};

  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  let devices, pollInterval;
  try {
    [devices, pollInterval] = await Promise.all([
      apiGet('/shelly/devices'),
      apiGet('/settings/kasa').then(s => s.poll_interval_sec ?? 30).catch(() => 30),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    return;
  }
  render(container, devices, pollInterval);
}

function render(container, devices, pollInterval) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-toggles me-2"></i>Shelly Devices</span>
        <button class="btn btn-sm btn-success" id="btn-add-shelly">
          <i class="bi bi-plus-lg"></i> Add Device
        </button>
      </div>
      <div class="card-body">
        <div id="shelly-msg" class="alert" style="display:none"></div>
        <div id="shelly-device-list">${renderDeviceList(devices)}</div>
      </div>
    </div>

    <!-- Add/Edit modal -->
    <div class="modal fade" id="shelly-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title" id="shelly-modal-title">Add Shelly Device</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="shelly-edit-id" value="" />
            <div class="mb-3">
              <label class="form-label">Device Name</label>
              <input type="text" class="form-control" id="shelly-name" placeholder="e.g. Antenna Switch" />
            </div>
            <div class="mb-3">
              <label class="form-label">IP Address</label>
              <input type="text" class="form-control" id="shelly-ip" placeholder="192.168.1.x" />
            </div>
            <div class="mb-3" id="shelly-channel-count-row">
              <label class="form-label">Number of Relay Channels</label>
              <select class="form-select" id="shelly-channels">
                <option value="1">1 (Shelly 1, 1PM, Plug)</option>
                <option value="2">2 (Shelly 2, 2.5, EM)</option>
                <option value="4">4 (Shelly 4Pro)</option>
              </select>
              <div class="form-text">Cannot be changed after device is added.</div>
            </div>
            <div class="mb-3" id="shelly-generation-row">
              <label class="form-label">Device Generation</label>
              <select class="form-select" id="shelly-generation">
                <option value="1">Gen 1 (original)</option>
                <option value="2">Gen 2 / Gen 3 (Plus, Pro, Mini)</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" id="shelly-modal-save">Add Device</button>
          </div>
        </div>
      </div>
    </div>
  `;

  attachHandlers(container, devices, pollInterval);
}

function renderDeviceList(devices) {
  if (!devices.length) {
    return '<div class="text-muted">No Shelly devices configured.</div>';
  }
  return devices.map(dev => {
    const channels = [...dev.channels].sort((a, b) => a.channel_index - b.channel_index).map(ch => `
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="badge bg-secondary" style="min-width:54px">Ch ${ch.channel_index}</span>
        <input type="text" maxlength="24" class="form-control form-control-sm shelly-label-input"
          style="max-width:160px" data-channel-id="${ch.id}"
          value="${escHtml(ch.label || '')}" placeholder="Label" />
        <button class="btn btn-sm btn-outline-primary btn-save-label" data-channel-id="${ch.id}" title="Save label">
          <i class="bi bi-floppy"></i>
        </button>
        <div class="form-check form-switch mb-0 ms-2">
          <input class="form-check-input shelly-toggle" type="checkbox" role="switch"
            data-channel-id="${ch.id}" data-channel-index="${ch.channel_index}"
            id="shelly-sw-${ch.id}" />
        </div>
        <label class="d-flex align-items-center gap-1 small text-muted mb-0 ms-1" title="Pin to dashboard" style="cursor:pointer;white-space:nowrap">
          <input class="form-check-input mt-0 shelly-dashboard-pin" type="checkbox"
            data-channel-id="${ch.id}" ${ch.show_on_dashboard ? 'checked' : ''} />
          <i class="bi bi-pin-angle" style="font-size:0.75rem"></i>
        </label>
      </div>
    `).join('');

    return `
      <div class="card mb-3" id="shelly-dev-${dev.id}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span>
            <strong>${escHtml(dev.name)}</strong>
            <small class="ms-1" style="opacity:0.7">(${escHtml(dev.ip_address)}, Gen ${dev.generation ?? 1})</small>
          </span>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-info btn-shelly-test" data-id="${dev.id}">Test</button>
            <button class="btn btn-sm btn-outline-light btn-shelly-edit"
              data-id="${dev.id}" data-name="${escHtml(dev.name)}" data-ip="${escHtml(dev.ip_address)}" data-generation="${dev.generation ?? 1}">Edit</button>
            <button class="btn btn-sm btn-outline-danger btn-shelly-delete"
              data-id="${dev.id}" data-name="${escHtml(dev.name)}">Delete</button>
          </div>
        </div>
        <div class="card-body">
          <div id="shelly-test-${dev.id}" class="mb-2" style="display:none"></div>
          <div class="d-flex align-items-center gap-2 mb-1 px-1" style="font-size:0.72rem;color:#6c757d">
            <span style="width:54px;flex-shrink:0">Ch #</span>
            <span style="flex:1;max-width:160px">Description</span>
            <span style="width:34px;flex-shrink:0;text-align:center">Save</span>
            <span style="flex-shrink:0;text-align:center;margin-left:0.5rem">Off/On</span>
            <span style="flex-shrink:0;margin-left:0.25rem">Pin</span>
          </div>
          ${channels}
        </div>
      </div>
    `;
  }).join('');
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showMsg(text, type = 'danger') {
  const el = document.getElementById('shelly-msg');
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = text;
  el.style.display = '';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function attachHandlers(container, devices, pollInterval) {
  // Poll each device for live relay state
  devices.forEach(dev => {
    const poll = async () => {
      try {
        const states = await apiGet(`/shelly/devices/${dev.id}/states`);
        states.forEach(({ channel_index, is_on }) => {
          const ch = dev.channels.find(c => c.channel_index === channel_index);
          if (!ch) return;
          const sw = document.getElementById(`shelly-sw-${ch.id}`);
          if (sw && !sw.dataset.pending) sw.checked = is_on;
        });
      } catch { /* device offline — leave toggles as-is */ }
    };
    poll();
    pollTimers[dev.id] = setInterval(poll, pollInterval * 1000);
  });

  // Toggle switches
  container.querySelectorAll('.shelly-toggle').forEach(sw => {
    sw.addEventListener('change', async () => {
      const channelId = sw.dataset.channelId;
      const action = sw.checked ? 'on' : 'off';
      sw.dataset.pending = '1';
      sw.disabled = true;
      try {
        await apiPost(`/shelly/channels/${channelId}/control`, { action });
      } catch (e) {
        sw.checked = !sw.checked;
        showMsg(`Control failed: ${e.message}`);
      } finally {
        delete sw.dataset.pending;
        sw.disabled = false;
      }
    });
  });

  // Dashboard pin toggles
  container.querySelectorAll('.shelly-dashboard-pin').forEach(sw => {
    sw.addEventListener('change', async () => {
      try {
        await apiPut(`/shelly/channels/${sw.dataset.channelId}`, { show_on_dashboard: sw.checked });
      } catch { sw.checked = !sw.checked; }
    });
  });

  // Save channel labels
  container.querySelectorAll('.btn-save-label').forEach(btn => {
    btn.addEventListener('click', async () => {
      const channelId = btn.dataset.channelId;
      const input = container.querySelector(`.shelly-label-input[data-channel-id="${channelId}"]`);
      try {
        await apiPut(`/shelly/channels/${channelId}`, { label: input.value.trim() || null });
        btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        btn.classList.replace('btn-outline-primary', 'btn-success');
        setTimeout(() => {
          btn.innerHTML = '<i class="bi bi-floppy"></i>';
          btn.classList.replace('btn-success', 'btn-outline-primary');
        }, 1500);
      } catch (e) {
        btn.innerHTML = '<i class="bi bi-x-lg"></i>';
        btn.classList.replace('btn-outline-primary', 'btn-danger');
        setTimeout(() => {
          btn.innerHTML = '<i class="bi bi-floppy"></i>';
          btn.classList.replace('btn-danger', 'btn-outline-primary');
        }, 3000);
      }
    });
  });

  // Test buttons
  container.querySelectorAll('.btn-shelly-test').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const resultEl = document.getElementById(`shelly-test-${id}`);
      btn.disabled = true;
      btn.textContent = 'Testing…';
      resultEl.style.display = '';
      resultEl.innerHTML = '<span class="text-muted">Connecting…</span>';
      try {
        const result = await apiPost(`/shelly/devices/${id}/test`, {});
        const states = result.states.map(s =>
          `<span class="badge ${s.is_on ? 'bg-success' : 'bg-secondary'} me-1">Ch ${s.channel_index}: ${s.is_on ? 'ON' : 'OFF'}</span>`
        ).join('');
        const fw = result.info?.fw ?? '';
        resultEl.innerHTML = `<span class="text-success">Connected</span> ${fw ? `<small class="text-muted">fw ${fw}</small>` : ''} &nbsp; ${states}`;
      } catch (e) {
        resultEl.innerHTML = `<span class="text-danger">Failed: ${escHtml(e.message)}</span>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test';
      }
    });
  });

  // Edit buttons
  container.querySelectorAll('.btn-shelly-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('shelly-modal-title').textContent = 'Edit Shelly Device';
      document.getElementById('shelly-modal-save').textContent = 'Save';
      document.getElementById('shelly-edit-id').value = btn.dataset.id;
      document.getElementById('shelly-name').value = btn.dataset.name;
      document.getElementById('shelly-ip').value = btn.dataset.ip;
      document.getElementById('shelly-channel-count-row').style.display = 'none';
      document.getElementById('shelly-generation').value = btn.dataset.generation ?? '1';
      document.getElementById('shelly-generation-row').style.display = '';
      new bootstrap.Modal(document.getElementById('shelly-modal')).show();
    });
  });

  // Delete buttons
  container.querySelectorAll('.btn-shelly-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete "${btn.dataset.name}"? This will also remove it from any workflows.`)) return;
      try {
        await apiDelete(`/shelly/devices/${btn.dataset.id}`);
        Object.values(pollTimers).forEach(clearInterval);
        pollTimers = {};
        const [newDevices] = await Promise.all([apiGet('/shelly/devices')]);
        renderShellyTab(container);
      } catch (e) {
        showMsg(e.message);
      }
    });
  });

  // Add button → open modal fresh
  document.getElementById('btn-add-shelly').addEventListener('click', () => {
    document.getElementById('shelly-modal-title').textContent = 'Add Shelly Device';
    document.getElementById('shelly-modal-save').textContent = 'Add Device';
    document.getElementById('shelly-edit-id').value = '';
    document.getElementById('shelly-name').value = '';
    document.getElementById('shelly-ip').value = '';
    document.getElementById('shelly-channels').value = '1';
    document.getElementById('shelly-generation').value = '1';
    document.getElementById('shelly-channel-count-row').style.display = '';
    document.getElementById('shelly-generation-row').style.display = '';
    new bootstrap.Modal(document.getElementById('shelly-modal')).show();
  });

  // Modal save
  document.getElementById('shelly-modal-save').addEventListener('click', async () => {
    const editId = document.getElementById('shelly-edit-id').value;
    const name = document.getElementById('shelly-name').value.trim();
    const ip = document.getElementById('shelly-ip').value.trim();
    if (!name || !ip) { showMsg('Name and IP address are required.'); return; }
    try {
      if (editId) {
        const generation = parseInt(document.getElementById('shelly-generation').value);
        await apiPut(`/shelly/devices/${editId}`, { name, ip_address: ip, generation });
      } else {
        const channelCount = parseInt(document.getElementById('shelly-channels').value);
        const generation = parseInt(document.getElementById('shelly-generation').value);
        await apiPost('/shelly/devices', { name, ip_address: ip, channel_count: channelCount, generation });
      }
      bootstrap.Modal.getInstance(document.getElementById('shelly-modal')).hide();
      Object.values(pollTimers).forEach(clearInterval);
      pollTimers = {};
      renderShellyTab(container);
    } catch (e) {
      showMsg(e.message);
    }
  });
}
