import { apiGet, apiPost, apiDelete, apiPut, apiPatch } from '../../api.js';

let workflows = [];
let ports = [];
let activeWorkflowId = null;
let steps = [];
let originalSteps = [];
let editIndex = null;

export async function renderWorkflowsTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  activeWorkflowId = null;
  steps = [];
  originalSteps = [];
  editIndex = null;
  [ports, workflows] = await Promise.all([apiGet('/kasa/ports'), apiGet('/workflows')]);
  render(container);
}

function showMsg(text, type) {
  const el = document.getElementById('wf-msg');
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = text;
  el.style.display = '';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function render(container) {
  const portOptions = ports.map(p =>
    `<option value="${p.id}">${p.label || `Port ${p.port_index} (device ${p.device_id})`}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-diagram-3 me-2"></i>Workflows</span>
        <button class="btn btn-sm btn-success" id="btn-new-wf"><i class="bi bi-plus"></i> New Workflow</button>
      </div>
      <div class="card-body p-0">
        <div id="wf-msg" class="alert m-3" style="display:none"></div>
        <div id="new-wf-form" class="px-3 pt-3 pb-2" style="display:none">
          <div class="input-group">
            <input type="text" class="form-control" id="new-wf-name" placeholder="Workflow name" />
            <button class="btn btn-primary" id="btn-create-wf">Create</button>
            <button class="btn btn-secondary" id="btn-cancel-wf">Cancel</button>
          </div>
        </div>
        <div id="wf-list"></div>
      </div>
    </div>

    <div id="step-editor" style="display:none"></div>

    <div class="modal fade" id="step-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title" id="step-modal-title">Add Step</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Description <small style="color:#888">(optional)</small></label>
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

  renderWfList();

  if (activeWorkflowId !== null) {
    const wf = workflows.find(w => w.id === activeWorkflowId);
    if (wf) renderStepEditor(wf);
  }

  document.getElementById('btn-new-wf').addEventListener('click', () => {
    document.getElementById('new-wf-form').style.display = '';
    document.getElementById('new-wf-name').focus();
  });
  document.getElementById('btn-cancel-wf').addEventListener('click', () => {
    document.getElementById('new-wf-form').style.display = 'none';
    document.getElementById('new-wf-name').value = '';
  });
  document.getElementById('btn-create-wf').addEventListener('click', createWorkflow);
  document.getElementById('new-wf-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createWorkflow();
  });

  document.getElementById('step-type').addEventListener('change', e => {
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
}

async function createWorkflow() {
  const name = document.getElementById('new-wf-name').value.trim();
  if (!name) return;
  try {
    const wf = await apiPost('/workflows', { name });
    workflows.push(wf);
    document.getElementById('new-wf-form').style.display = 'none';
    document.getElementById('new-wf-name').value = '';
    renderWfList();
    activeWorkflowId = wf.id;
    steps = [];
    renderStepEditor(wf);
  } catch (err) {
    showMsg(err.message, 'danger');
  }
}

function renderWfList() {
  const list = document.getElementById('wf-list');
  if (!list) return;
  if (!workflows.length) {
    list.innerHTML = '<div class="text-muted p-3">No workflows configured.</div>';
    return;
  }
  list.innerHTML = workflows.map(wf => `
    <div class="d-flex align-items-center px-3 py-2" style="border-bottom:1px solid #2a2a4a" id="wf-row-${wf.id}">
      <span class="flex-grow-1" style="color:#e0e0e0">
        ${wf.name}
        ${wf.is_system ? '<span class="badge bg-secondary ms-2">System</span>' : ''}
      </span>
      <button class="btn btn-sm btn-outline-success btn-run-wf me-1" data-id="${wf.id}" data-name="${wf.name.replace(/"/g, '&quot;')}">Run</button>
      <button class="btn btn-sm btn-outline-secondary btn-rename-wf me-1" data-id="${wf.id}" data-name="${wf.name.replace(/"/g, '&quot;')}">Rename</button>
      <button class="btn btn-sm btn-outline-secondary btn-edit-wf me-1" data-id="${wf.id}">Edit</button>
      <button class="btn btn-sm btn-outline-danger btn-del-wf" data-id="${wf.id}" data-name="${wf.name.replace(/"/g, '&quot;')}" ${wf.is_system ? 'disabled title="System workflows cannot be deleted"' : ''}>Delete</button>
    </div>
  `).join('');

  list.querySelectorAll('.btn-run-wf').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        await apiPost(`/workflows/${id}/run`, {});
        showMsg(`Workflow "${btn.dataset.name}" completed.`, 'success');
      } catch (err) {
        showMsg(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run';
      }
    });
  });

  list.querySelectorAll('.btn-rename-wf').forEach(btn => {
    btn.addEventListener('click', () => openRenameRow(parseInt(btn.dataset.id), btn.dataset.name));
  });

  list.querySelectorAll('.btn-edit-wf').forEach(btn => {
    btn.addEventListener('click', () => openWorkflow(parseInt(btn.dataset.id)));
  });

  list.querySelectorAll('.btn-del-wf').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete workflow "${btn.dataset.name}"?`)) return;
      const id = parseInt(btn.dataset.id);
      try {
        await apiDelete(`/workflows/${id}`);
        workflows = workflows.filter(w => w.id !== id);
        if (activeWorkflowId === id) {
          activeWorkflowId = null;
          steps = [];
          originalSteps = [];
          const editor = document.getElementById('step-editor');
          if (editor) editor.style.display = 'none';
        }
        renderWfList();
      } catch (err) {
        showMsg(err.message, 'danger');
      }
    });
  });
}

function openRenameRow(id, currentName) {
  const row = document.getElementById(`wf-row-${id}`);
  if (!row) return;
  row.innerHTML = `
    <div class="input-group input-group-sm flex-grow-1">
      <input type="text" class="form-control" id="rename-input-${id}" value="${currentName.replace(/"/g, '&quot;')}" />
      <button class="btn btn-primary btn-save-rename" data-id="${id}">Save</button>
      <button class="btn btn-secondary btn-cancel-rename" data-id="${id}">Cancel</button>
    </div>
  `;
  const input = document.getElementById(`rename-input-${id}`);
  input.focus();
  input.select();

  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const updated = await apiPatch(`/workflows/${id}`, { name });
      const wf = workflows.find(w => w.id === id);
      if (wf) wf.name = updated.name;
      if (activeWorkflowId === id) {
        const header = document.querySelector('#step-editor .card-header span');
        if (header) header.innerHTML = `<i class="bi bi-list-ol me-2"></i>${updated.name} \u2014 Steps`;
      }
      renderWfList();
    } catch (err) {
      showMsg(err.message, 'danger');
    }
  };

  row.querySelector('.btn-save-rename').addEventListener('click', save);
  row.querySelector('.btn-cancel-rename').addEventListener('click', renderWfList);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') renderWfList();
  });
}

async function openWorkflow(id) {
  activeWorkflowId = id;
  editIndex = null;
  const seq = await apiGet(`/workflows/${id}/steps`);
  steps = seq.map(s => ({ ...s }));
  originalSteps = steps.map(s => ({ ...s }));
  const wf = workflows.find(w => w.id === id);
  renderStepEditor(wf);
}

function renderStepEditor(wf) {
  const editor = document.getElementById('step-editor');
  if (!editor) return;
  editor.style.display = '';
  editor.innerHTML = `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-list-ol me-2"></i>${wf.name} \u2014 Steps</span>
        <button class="btn btn-sm btn-success" id="btn-add-step"><i class="bi bi-plus"></i> Add Step</button>
      </div>
      <div class="card-body">
        <div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>Drag steps to reorder. Steps execute top-to-bottom with configured delays.</div>
        <div id="step-msg" class="alert" style="display:none"></div>
        <div id="step-list"></div>
        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-primary" id="btn-save-steps">Save Steps</button>
          <button class="btn btn-outline-secondary" id="btn-cancel-edit">Cancel</button>
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

  document.getElementById('btn-save-steps').addEventListener('click', async () => {
    const msg = document.getElementById('step-msg');
    try {
      await apiPut(`/workflows/${activeWorkflowId}/steps`, { steps });
      originalSteps = steps.map(s => ({ ...s }));
      msg.className = 'alert alert-success';
      msg.textContent = 'Steps saved.';
      msg.style.display = '';
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    const hasChanges = JSON.stringify(steps) !== JSON.stringify(originalSteps);
    if (hasChanges && !confirm('Discard unsaved changes?')) return;
    activeWorkflowId = null;
    steps = [];
    originalSteps = [];
    document.getElementById('step-editor').style.display = 'none';
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
  const list = document.getElementById('step-list');
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

  let dragSrc = null;
  list.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      dragSrc = parseInt(item.dataset.index);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
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

  list.querySelectorAll('.btn-edit-step').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(parseInt(btn.dataset.index));
    });
  });

  list.querySelectorAll('.btn-remove-step').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      steps.splice(parseInt(btn.dataset.index), 1);
      renderStepList();
    });
  });
}
