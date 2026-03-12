import { apiGet, apiPost, apiPut, apiDelete } from '../../api.js';

export async function renderKasaTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  await loadKasaContent(container);
}

async function loadKasaContent(container) {
  const devices = await apiGet('/kasa/devices');

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

  document.getElementById('modal-type').addEventListener('change', (e) => {
    document.getElementById('modal-ports-row').style.display = e.target.value === 'strip' ? '' : 'none';
  });
}

function renderDevice(device) {
  const ports = device.ports.map(p => `
    <div class="d-flex align-items-center gap-2 mb-1">
      <span class="badge bg-secondary">Port ${p.port_index}</span>
      <input type="text" class="form-control form-control-sm flex-grow-1 port-label"
             data-port-id="${p.id}" value="${p.label || ''}" placeholder="Port label..." />
      <button class="btn btn-sm btn-outline-success port-on" data-port-id="${p.id}">ON</button>
      <button class="btn btn-sm btn-outline-secondary port-off" data-port-id="${p.id}">OFF</button>
    </div>
  `).join('');

  return `
    <div class="card mb-3" data-device-id="${device.id}">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><strong>${device.name}</strong> <small class="text-muted">(${device.device_type}, ${device.ip_address})</small></span>
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
    document.getElementById('modal-msg').style.display = 'none';
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
        await apiPost('/kasa/devices', {
          name: document.getElementById('modal-name').value,
          ip_address: document.getElementById('modal-ip').value,
          device_type: type,
          port_count: type === 'strip' ? parseInt(document.getElementById('modal-ports').value) : 1,
        });
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
          resultDiv.innerHTML = `<div class="alert alert-success py-1">Connected! Ports: ${result.port_states.map(p => `Port${p.port_index}=${p.is_on ? 'ON' : 'OFF'}`).join(', ')}</div>`;
        } else {
          resultDiv.innerHTML = `<div class="alert alert-danger py-1">Failed: ${result.error}</div>`;
        }
      } catch (e) {
        resultDiv.innerHTML = `<div class="alert alert-danger py-1">Error: ${e.message}</div>`;
      }
    });
  });

  // Port label save (blur)
  container.querySelectorAll('.port-label').forEach(input => {
    input.addEventListener('blur', async () => {
      await apiPut(`/kasa/ports/${input.dataset.portId}`, { label: input.value });
    });
  });

  // Port ON/OFF
  container.querySelectorAll('.port-on').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiPost(`/kasa/ports/${btn.dataset.portId}/control`, { action: 'on' });
    });
  });
  container.querySelectorAll('.port-off').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiPost(`/kasa/ports/${btn.dataset.portId}/control`, { action: 'off' });
    });
  });
}
