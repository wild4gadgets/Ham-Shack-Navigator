import { apiGet, apiPut } from '../../api.js';

let steps = [];
let ports = [];
let editIndex = null; // null = add mode, number = edit mode

export async function renderShutdownTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  [ports] = await Promise.all([apiGet('/kasa/ports')]);
  const seq = await apiGet('/shutdown/sequence');
  steps = seq.map(s => ({ ...s }));
  render(container);
}

function render(container) {
  const portOptions = ports.map(p =>
    `<option value="${p.id}">${p.label || `Port ${p.port_index} (device ${p.device_id})`}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-power me-2"></i>Shutdown Sequence</span>
        <button class="btn btn-sm btn-success" id="btn-add-step">
          <i class="bi bi-plus"></i> Add Step
        </button>
      </div>
      <div class="card-body">
        <div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>Drag steps to reorder. Steps execute top-to-bottom with configured delays.</div>
        <div id="shutdown-msg" class="alert" style="display:none"></div>
        <div id="shutdown-steps-list"></div>
        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-primary" id="btn-save-sequence">Save Sequence</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Step Modal -->
    <div class="modal fade" id="step-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title" id="step-modal-title">Add Step</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Description <small class="text-muted">(optional)</small></label>
              <input type="text" class="form-control" id="step-description" placeholder="e.g. Power off amplifier" />
            </div>
            <div class="mb-3">
              <label class="form-label">Step Type</label>
              <select class="form-select" id="step-type">
                <option value="kasa">Kasa Action</option>
                <option value="pause">Pause</option>
              </select>
            </div>
            <div id="step-kasa-fields">
              <div class="mb-3">
                <label class="form-label">Kasa Port</label>
                <select class="form-select" id="step-port">${portOptions}</select>
              </div>
              <div class="mb-3">
                <label class="form-label">Action</label>
                <select class="form-select" id="step-action">
                  <option value="off">Turn OFF</option>
                  <option value="on">Turn ON</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Delay After (seconds)</label>
                <input type="number" min="0" class="form-control" id="step-delay" value="0" />
              </div>
            </div>
            <div id="step-pause-fields" style="display:none">
              <div class="mb-3">
                <label class="form-label">Pause Duration (seconds)</label>
                <input type="number" min="1" class="form-control" id="step-pause-sec" value="5" />
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" id="step-modal-save">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;

  renderStepList();

  document.getElementById('btn-add-step').addEventListener('click', () => {
    editIndex = null;
    document.getElementById('step-modal-title').textContent = 'Add Step';
    document.getElementById('step-modal-save').textContent = 'Add';
    document.getElementById('step-description').value = '';
    document.getElementById('step-type').value = 'kasa';
    document.getElementById('step-kasa-fields').style.display = '';
    document.getElementById('step-pause-fields').style.display = 'none';
    document.getElementById('step-action').value = 'off';
    document.getElementById('step-delay').value = '0';
    document.getElementById('step-pause-sec').value = '5';
    if (ports.length) document.getElementById('step-port').value = ports[0].id;
    new bootstrap.Modal(document.getElementById('step-modal')).show();
  });

  document.getElementById('step-type').addEventListener('change', (e) => {
    const isPause = e.target.value === 'pause';
    document.getElementById('step-kasa-fields').style.display = isPause ? 'none' : '';
    document.getElementById('step-pause-fields').style.display = isPause ? '' : 'none';
  });

  document.getElementById('step-modal-save').addEventListener('click', () => {
    const type = document.getElementById('step-type').value;
    const description = document.getElementById('step-description').value.trim() || null;
    let newStep;
    if (type === 'pause') {
      const dur = parseInt(document.getElementById('step-pause-sec').value) || 5;
      newStep = { action: 'pause', kasa_port_id: null, delay_after_sec: dur, description };
    } else {
      const portId = parseInt(document.getElementById('step-port').value);
      const action = document.getElementById('step-action').value;
      const delay = parseInt(document.getElementById('step-delay').value) || 0;
      newStep = { kasa_port_id: portId, action, delay_after_sec: delay, description };
    }
    if (editIndex !== null) {
      steps[editIndex] = newStep;
    } else {
      steps.push(newStep);
    }
    bootstrap.Modal.getInstance(document.getElementById('step-modal')).hide();
    renderStepList();
  });

  document.getElementById('btn-save-sequence').addEventListener('click', async () => {
    const msg = document.getElementById('shutdown-msg');
    try {
      await apiPut('/shutdown/sequence', { steps });
      msg.className = 'alert alert-success';
      msg.textContent = 'Sequence saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}

function openEditModal(index) {
  const step = steps[index];
  editIndex = index;
  document.getElementById('step-modal-title').textContent = 'Edit Step';
  document.getElementById('step-modal-save').textContent = 'Save';
  document.getElementById('step-description').value = step.description || '';

  if (step.action === 'pause') {
    document.getElementById('step-type').value = 'pause';
    document.getElementById('step-kasa-fields').style.display = 'none';
    document.getElementById('step-pause-fields').style.display = '';
    document.getElementById('step-pause-sec').value = step.delay_after_sec;
  } else {
    document.getElementById('step-type').value = 'kasa';
    document.getElementById('step-kasa-fields').style.display = '';
    document.getElementById('step-pause-fields').style.display = 'none';
    document.getElementById('step-port').value = step.kasa_port_id;
    document.getElementById('step-action').value = step.action;
    document.getElementById('step-delay').value = step.delay_after_sec;
  }

  new bootstrap.Modal(document.getElementById('step-modal')).show();
}

function renderStepList() {
  const list = document.getElementById('shutdown-steps-list');
  if (!list) return;

  if (!steps.length) {
    list.innerHTML = '<div class="text-muted">No steps configured. Add steps above.</div>';
    return;
  }

  list.innerHTML = steps.map((step, i) => {
    let mainContent;
    let subContent;
    if (step.action === 'pause') {
      mainContent = `<span class="badge bg-secondary me-2">PAUSE</span><span style="color:#e0e0e0">${step.delay_after_sec}s</span>`;
      subContent = step.description ? `<span style="color:#a0b0c8">${step.description}</span>` : '';
    } else {
      const port = ports.find(p => p.id === step.kasa_port_id);
      const portLabel = port ? (port.label || `Port ${port.port_index + 1}`) : `Port ID ${step.kasa_port_id}`;
      mainContent = `
        <span class="badge ${step.action === 'on' ? 'bg-success' : 'bg-danger'} me-2">${step.action.toUpperCase()}</span>
        <span style="color:#e0e0e0">${portLabel}</span>
      `;
      const delayPart = step.delay_after_sec > 0 ? `<span style="color:#a0b0c8">delay ${step.delay_after_sec}s</span>` : '';
      const descPart = step.description ? `<span style="color:#a0b0c8">${step.description}</span>` : '';
      const sep = delayPart && descPart ? '<span style="color:#555"> &mdash; </span>' : '';
      subContent = descPart + sep + delayPart;
    }

    return `
      <div class="card mb-2 step-item" draggable="true" data-index="${i}">
        <div class="card-body d-flex align-items-center py-2 px-3">
          <span style="color:#888;cursor:grab" class="me-2"><i class="bi bi-grip-vertical"></i></span>
          <span class="badge bg-secondary me-3" style="min-width:28px">${i + 1}</span>
          <span class="flex-grow-1">
            <div class="d-flex align-items-center">${mainContent}</div>
            ${subContent ? `<div class="small mt-1">${subContent}</div>` : ''}
          </span>
          <button class="btn btn-sm btn-outline-secondary btn-edit-step me-1" data-index="${i}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger btn-remove-step" data-index="${i}" title="Remove">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Drag-to-reorder
  let dragSrc = null;
  list.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragSrc = parseInt(item.dataset.index);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const dropIdx = parseInt(item.dataset.index);
      if (dragSrc !== null && dragSrc !== dropIdx) {
        const moved = steps.splice(dragSrc, 1)[0];
        steps.splice(dropIdx, 0, moved);
        renderStepList();
      }
    });
  });

  // Edit buttons
  list.querySelectorAll('.btn-edit-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(parseInt(btn.dataset.index));
    });
  });

  // Remove buttons
  list.querySelectorAll('.btn-remove-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      steps.splice(parseInt(btn.dataset.index), 1);
      renderStepList();
    });
  });
}
