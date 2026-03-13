import { apiGet, apiPost, apiPut, apiDelete } from '../../api.js';

let pollTimer = null;
let currentDevices = [];

export async function renderKasaTab(container) {
  clearPoll();
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  await loadKasaContent(container);
}

function clearPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function loadKasaContent(container) {
  clearPoll();
  const [devices, kasaSettings] = await Promise.all([
    apiGet('/kasa/devices'),
    apiGet('/settings/kasa'),
  ]);
  currentDevices = devices;
  const pollIntervalSec = kasaSettings.poll_interval_sec || 30;

  container.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-plug me-2"></i>Kasa Devices</span>
        <button class="btn btn-sm btn-success" id="btn-add-device">
          <i class="bi bi-plus"></i> Add Device
        </button>
      </div>
      <div class="card-body">
        <div id="kasa-msg" class="alert" style="display:none"></div>
        <div id="devices-list">
          ${devices.length === 0 ? '<div class="text-muted">No devices configured.</div>' :
            devices.map(d => renderDevice(d)).join('')}
        </div>
        <hr class="border-secondary mt-3" />
        <div class="d-flex align-items-center gap-3">
          <label class="form-label mb-0">Port State Poll Interval</label>
          <input type="number" min="5" max="3600" class="form-control form-control-sm" style="width:90px"
                 id="kasa-poll-interval" value="${pollIntervalSec}" />
          <span class="text-muted">seconds</span>
          <button class="btn btn-sm btn-primary" id="btn-save-poll-interval">Save</button>
          <span id="poll-interval-msg" class="text-success" style="display:none">Saved</span>
        </div>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <div class="modal fade" id="device-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title" id="modal-title">Add Device</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="modal-msg" class="alert" style="display:none"></div>
            <input type="hidden" id="modal-device-id" />
            <div class="mb-3">
              <label class="form-label">Name</label>
              <input type="text" class="form-control" id="modal-name" placeholder="e.g. Radio Strip" />
            </div>
            <div class="mb-3">
              <label class="form-label">IP Address</label>
              <input type="text" class="form-control" id="modal-ip" placeholder="192.168.1.100" />
            </div>
            <div class="mb-3" id="modal-type-row">
              <label class="form-label">Device Type</label>
              <select class="form-select" id="modal-type">
                <option value="strip">Power Strip</option>
                <option value="plug">Single Plug</option>
              </select>
            </div>
            <div class="mb-3" id="modal-ports-row">
              <label class="form-label">Number of Ports (for strip)</label>
              <input type="number" min="1" max="8" class="form-control" id="modal-ports" value="6" />
            </div>
            <div id="modal-port-names-section">
              <label class="form-label">Port Names <small class="text-muted">(max 15 characters each)</small></label>
              <div id="modal-port-names"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupModalListeners(container);
  setupDeviceListeners(container, devices);

  const typeSelect = document.getElementById('modal-type');
  const portsInput = document.getElementById('modal-ports');

  function refreshPortNameInputs() {
    const isStrip = typeSelect.value === 'strip';
    document.getElementById('modal-ports-row').style.display = isStrip ? '' : 'none';
    const count = isStrip ? (parseInt(portsInput.value) || 1) : 1;
    renderPortNameInputs(count);
  }

  typeSelect.addEventListener('change', refreshPortNameInputs);
  portsInput.addEventListener('input', refreshPortNameInputs);

  // Fetch initial states then poll at configured interval
  if (devices.length > 0) {
    await pollAllStates();
    pollTimer = setInterval(pollAllStates, pollIntervalSec * 1000);
  }

  document.getElementById('btn-save-poll-interval').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('kasa-poll-interval').value);
    const msg = document.getElementById('poll-interval-msg');
    if (!val || val < 5) return;
    try {
      await apiPut('/settings/kasa', { poll_interval_sec: val });
      clearPoll();
      if (currentDevices.length > 0) {
        pollTimer = setInterval(pollAllStates, val * 1000);
      }
      msg.style.display = '';
      setTimeout(() => { msg.style.display = 'none'; }, 2000);
    } catch {}
  });
}

async function pollAllStates() {
  for (const device of currentDevices) {
    try {
      const result = await apiGet(`/kasa/devices/${device.id}/states`);
      if (result.success) {
        applyStates(device.id, result.port_states);
      }
    } catch {}
  }
}

function applyStates(deviceId, portStates) {
  for (const state of portStates) {
    const sw = document.querySelector(
      `.port-switch[data-device-id="${deviceId}"][data-port-index="${state.port_index}"]`
    );
    if (sw && !sw.dataset.pending) {
      sw.checked = state.is_on;
      sw.disabled = false;
    }
  }
}

function renderPortNameInputs(count) {
  const container = document.getElementById('modal-port-names');
  const existing = [...container.querySelectorAll('.modal-port-label')].map(i => i.value);
  container.innerHTML = Array.from({ length: count }, (_, i) => `
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="text-muted" style="min-width:60px">Port ${i + 1}</span>
      <input type="text" maxlength="15" class="form-control form-control-sm modal-port-label"
             data-port-index="${i}" placeholder="Port ${i + 1}" value="${existing[i] || ''}" />
    </div>
  `).join('');
}

function renderDevice(device) {
  const ports = [...device.ports].sort((a, b) => a.port_index - b.port_index).map(p => `
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="badge bg-secondary" style="min-width:54px">Port ${p.port_index + 1}</span>
      <input type="text" maxlength="15" class="form-control form-control-sm port-label"
             style="max-width:160px" data-port-id="${p.id}" value="${p.label || ''}" placeholder="Label" />
      <button class="btn btn-sm btn-outline-primary port-label-save" data-port-id="${p.id}" title="Save label">
        <i class="bi bi-floppy"></i>
      </button>
      <div class="form-check form-switch mb-0 ms-2">
        <input class="form-check-input port-switch" type="checkbox" role="switch"
               data-port-id="${p.id}" data-port-index="${p.port_index}" data-device-id="${device.id}" />
      </div>
    </div>
  `).join('');

  return `
    <div class="card mb-3" data-device-id="${device.id}">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><strong>${device.name}</strong> <small class="ms-1" style="opacity:0.7">(${device.device_type}, ${device.ip_address})</small></span>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-info btn-test" data-device-id="${device.id}">Test</button>
          <button class="btn btn-sm btn-outline-light btn-edit"
                  data-device-id="${device.id}"
                  data-name="${device.name}"
                  data-ip="${device.ip_address}">Edit</button>
          <button class="btn btn-sm btn-outline-danger btn-delete" data-device-id="${device.id}">Delete</button>
        </div>
      </div>
      <div class="card-body">
        <div id="test-result-${device.id}" class="mb-2" style="display:none"></div>
        ${ports}
      </div>
    </div>
  `;
}

function setupModalListeners(container) {
  const modal = new bootstrap.Modal(document.getElementById('device-modal'));

  document.getElementById('btn-add-device').addEventListener('click', () => {
    document.getElementById('modal-title').textContent = 'Add Device';
    document.getElementById('modal-device-id').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-ip').value = '';
    document.getElementById('modal-type').value = 'strip';
    document.getElementById('modal-ports').value = '6';
    document.getElementById('modal-ports-row').style.display = '';
    document.getElementById('modal-type-row').style.display = '';
    document.getElementById('modal-port-names-section').style.display = '';
    document.getElementById('modal-msg').style.display = 'none';
    renderPortNameInputs(6);
    modal.show();
  });

  document.getElementById('modal-save').addEventListener('click', async () => {
    const id = document.getElementById('modal-device-id').value;
    const msg = document.getElementById('modal-msg');
    msg.style.display = 'none';
    try {
      if (id) {
        await apiPut(`/kasa/devices/${id}`, {
          name: document.getElementById('modal-name').value,
          ip_address: document.getElementById('modal-ip').value,
        });
      } else {
        const type = document.getElementById('modal-type').value;
        const device = await apiPost('/kasa/devices', {
          name: document.getElementById('modal-name').value,
          ip_address: document.getElementById('modal-ip').value,
          device_type: type,
          port_count: type === 'strip' ? parseInt(document.getElementById('modal-ports').value) : 1,
        });

        const labelInputs = document.querySelectorAll('.modal-port-label');
        for (const input of labelInputs) {
          const label = input.value.trim();
          if (!label) continue;
          const idx = parseInt(input.dataset.portIndex);
          const port = device.ports.find(p => p.port_index === idx);
          if (port) await apiPut(`/kasa/ports/${port.id}`, { label });
        }
      }
      modal.hide();
      await loadKasaContent(container);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}

function setupDeviceListeners(container, devices) {
  // Edit buttons
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('modal-title').textContent = 'Edit Device';
      document.getElementById('modal-device-id').value = btn.dataset.deviceId;
      document.getElementById('modal-name').value = btn.dataset.name;
      document.getElementById('modal-ip').value = btn.dataset.ip;
      document.getElementById('modal-type-row').style.display = 'none';
      document.getElementById('modal-ports-row').style.display = 'none';
      document.getElementById('modal-port-names-section').style.display = 'none';
      document.getElementById('modal-msg').style.display = 'none';
      new bootstrap.Modal(document.getElementById('device-modal')).show();
    });
  });

  // Delete buttons
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this device and all its ports?')) return;
      await apiDelete(`/kasa/devices/${btn.dataset.deviceId}`);
      await loadKasaContent(container);
    });
  });

  // Test buttons
  container.querySelectorAll('.btn-test').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deviceId;
      const resultDiv = document.getElementById(`test-result-${id}`);
      resultDiv.style.display = '';
      resultDiv.innerHTML = '<div class="text-muted">Testing...</div>';
      try {
        const result = await apiPost(`/kasa/devices/${id}/test`, {});
        if (result.success) {
          resultDiv.innerHTML = `<div class="alert alert-success py-1">Connected! Ports: ${result.port_states.map(p => `Port${p.port_index + 1}=${p.is_on ? 'ON' : 'OFF'}`).join(', ')}</div>`;
          applyStates(parseInt(id), result.port_states);
        } else {
          resultDiv.innerHTML = `<div class="alert alert-danger py-1">Failed: ${result.error}</div>`;
        }
      } catch (e) {
        resultDiv.innerHTML = `<div class="alert alert-danger py-1">Error: ${e.message}</div>`;
      }
    });
  });

  // Port label save buttons
  container.querySelectorAll('.port-label-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const portId = btn.dataset.portId;
      const input = container.querySelector(`.port-label[data-port-id="${portId}"]`);
      try {
        await apiPut(`/kasa/ports/${portId}`, { label: input.value });
        btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        btn.classList.replace('btn-outline-primary', 'btn-success');
        setTimeout(() => {
          btn.innerHTML = '<i class="bi bi-floppy"></i>';
          btn.classList.replace('btn-success', 'btn-outline-primary');
        }, 1500);
      } catch (e) {
        btn.innerHTML = '<i class="bi bi-x-lg"></i>';
        btn.classList.replace('btn-outline-primary', 'btn-danger');
        btn.title = e.message;
        setTimeout(() => {
          btn.innerHTML = '<i class="bi bi-floppy"></i>';
          btn.classList.replace('btn-danger', 'btn-outline-primary');
          btn.title = '';
        }, 3000);
      }
    });
  });

  // Port toggle switches
  container.querySelectorAll('.port-switch').forEach(sw => {
    sw.addEventListener('change', async () => {
      const action = sw.checked ? 'on' : 'off';
      sw.dataset.pending = '1';
      sw.disabled = true;
      try {
        await apiPost(`/kasa/ports/${sw.dataset.portId}/control`, { action });
      } catch (e) {
        sw.checked = !sw.checked; // revert
      } finally {
        delete sw.dataset.pending;
        sw.disabled = false;
      }
    });
  });
}
