import { apiGet, apiPut } from '../../api.js';

let steps = [];
let ports = [];

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

    <!-- Add Step Modal -->
    <div class="modal fade" id="step-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title">Add Step</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
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
    new bootstrap.Modal(document.getElementById('step-modal')).show();
  });

  document.getElementById('step-modal-save').addEventListener('click', () => {
    const portId = parseInt(document.getElementById('step-port').value);
    const action = document.getElementById('step-action').value;
    const delay = parseInt(document.getElementById('step-delay').value) || 0;
    steps.push({ kasa_port_id: portId, action, delay_after_sec: delay });
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

function renderStepList() {
  const list = document.getElementById('shutdown-steps-list');
  if (!list) return;

  if (!steps.length) {
    list.innerHTML = '<div class="text-muted">No steps configured. Add steps above.</div>';
    return;
  }

  list.innerHTML = steps.map((step, i) => {
    const port = ports.find(p => p.id === step.kasa_port_id);
    const portLabel = port ? (port.label || `Port ${port.port_index}`) : `Port ID ${step.kasa_port_id}`;
    return `
      <div class="card mb-2 step-item" draggable="true" data-index="${i}">
        <div class="card-body d-flex align-items-center gap-3 py-2">
          <span class="text-muted" style="cursor:grab"><i class="bi bi-grip-vertical"></i></span>
          <span class="badge bg-secondary">${i + 1}</span>
          <span class="flex-grow-1">
            <span class="badge ${step.action === 'on' ? 'bg-success' : 'bg-danger'}">${step.action.toUpperCase()}</span>
            ${portLabel}
          </span>
          <small class="text-muted">${step.delay_after_sec}s delay</small>
          <button class="btn btn-sm btn-outline-danger btn-remove-step" data-index="${i}">
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

  // Remove buttons
  list.querySelectorAll('.btn-remove-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      steps.splice(parseInt(btn.dataset.index), 1);
      renderStepList();
    });
  });
}
