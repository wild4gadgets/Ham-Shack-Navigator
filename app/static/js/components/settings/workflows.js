import { apiGet, apiPost, apiDelete, apiPut, apiPatch } from '../../api.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let workflows = [];
let scheduledWorkflows = [];
let ports = [];
let shellyChannels = [];
let activeWorkflowId = null;
let steps = [];
let originalSteps = [];
let editIndex = null;
let editSchedId = null;

export async function renderWorkflowsTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  activeWorkflowId = null;
  steps = [];
  originalSteps = [];
  editIndex = null;
  editSchedId = null;
  [ports, shellyChannels, workflows, scheduledWorkflows] = await Promise.all([
    apiGet('/kasa/ports'),
    apiGet('/shelly/channels').catch(() => []),
    apiGet('/workflows'),
    apiGet('/workflows/scheduled').catch(() => []),
  ]);
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

  const shellyOptions = shellyChannels.map(ch =>
    `<option value="${ch.id}">${ch.label || `Channel ${ch.channel_index}`} (device ${ch.device_id})</option>`
  ).join('');

  const workflowOptions = workflows.map(wf =>
    `<option value="${wf.id}">${wf.name}${wf.is_system ? ' (System)' : ''}</option>`
  ).join('');

  const dayCbs = DAY_NAMES.map((name, i) => `
    <div class="form-check form-check-inline">
      <input class="form-check-input sched-day-cb" type="checkbox" id="sched-day-${i}" value="${i}">
      <label class="form-check-label" for="sched-day-${i}">${name}</label>
    </div>
  `).join('');

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

    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-clock me-2"></i>Scheduled Workflows</span>
        <button class="btn btn-sm btn-success" id="btn-add-sched"><i class="bi bi-plus"></i> Add Schedule</button>
      </div>
      <div class="card-body p-0">
        <div id="sched-list"></div>
      </div>
    </div>

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
                <option value="shelly">Shelly Action</option>
                <option value="ifttt">IFTTT Trigger</option>
                <option value="pause">Pause</option>
              </select>
            </div>
            <div id="step-kasa-fields">
              <div class="mb-3">
                <label class="form-label">Kasa Port</label>
                <select class="form-select" id="step-port">${portOptions || '<option disabled>No Kasa ports configured</option>'}</select>
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
            <div id="step-shelly-fields" style="display:none">
              <div class="mb-3">
                <label class="form-label">Shelly Channel</label>
                <select class="form-select" id="step-shelly-channel">${shellyOptions || '<option disabled>No Shelly channels configured</option>'}</select>
              </div>
              <div class="mb-3">
                <label class="form-label">Action</label>
                <select class="form-select" id="step-shelly-action">
                  <option value="off">Turn OFF</option>
                  <option value="on">Turn ON</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Delay After (seconds)</label>
                <input type="number" min="0" class="form-control" id="step-shelly-delay" value="0" />
              </div>
            </div>
            <div id="step-ifttt-fields" style="display:none">
              <div class="mb-3">
                <label class="form-label">Event Name <small class="text-muted">(the IFTTT webhook event name)</small></label>
                <input type="text" class="form-control" id="step-ifttt-event" placeholder="e.g. turn_on_plug" />
              </div>
              <div class="mb-3">
                <label class="form-label">Value 1 <small class="text-muted">(optional)</small></label>
                <input type="text" class="form-control" id="step-ifttt-value1" placeholder="" />
              </div>
              <div class="mb-3">
                <label class="form-label">Value 2 <small class="text-muted">(optional)</small></label>
                <input type="text" class="form-control" id="step-ifttt-value2" placeholder="" />
              </div>
              <div class="mb-3">
                <label class="form-label">Value 3 <small class="text-muted">(optional)</small></label>
                <input type="text" class="form-control" id="step-ifttt-value3" placeholder="" />
              </div>
              <div class="mb-3">
                <label class="form-label">Delay After (seconds)</label>
                <input type="number" min="0" class="form-control" id="step-ifttt-delay" value="0" />
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

    <div class="modal fade" id="sched-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title" id="sched-modal-title">Add Scheduled Workflow</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Workflow</label>
              <select class="form-select" id="sched-workflow-id">${workflowOptions || '<option disabled>No workflows configured</option>'}</select>
            </div>
            <div class="mb-3">
              <label class="form-label">Run Time <small class="text-muted">(local time)</small></label>
              <input type="time" class="form-control" id="sched-run-time" value="06:00" />
            </div>
            <div class="mb-3">
              <label class="form-label">Days of Week</label>
              <div class="d-flex gap-1 flex-wrap mt-1">${dayCbs}</div>
            </div>
            <div class="mb-3">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="sched-enabled" checked />
                <label class="form-check-label" for="sched-enabled">Enabled</label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" id="sched-modal-save">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  renderWfList();
  renderScheduledWfList();

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
    const val = e.target.value;
    document.getElementById('step-kasa-fields').style.display = val === 'kasa' ? '' : 'none';
    document.getElementById('step-shelly-fields').style.display = val === 'shelly' ? '' : 'none';
    document.getElementById('step-ifttt-fields').style.display = val === 'ifttt' ? '' : 'none';
    document.getElementById('step-pause-fields').style.display = val === 'pause' ? '' : 'none';
  });

  document.getElementById('step-modal-save').addEventListener('click', () => {
    const type = document.getElementById('step-type').value;
    const description = document.getElementById('step-description').value.trim() || null;
    let newStep;
    if (type === 'pause') {
      const dur = parseInt(document.getElementById('step-pause-sec').value) || 5;
      newStep = { action: 'pause', kasa_port_id: null, shelly_channel_id: null, delay_after_sec: dur, description };
    } else if (type === 'ifttt') {
      const eventName = document.getElementById('step-ifttt-event').value.trim();
      if (!eventName) { alert('Event name is required for IFTTT steps.'); return; }
      const delay = parseInt(document.getElementById('step-ifttt-delay').value) || 0;
      newStep = {
        action: 'ifttt', kasa_port_id: null, shelly_channel_id: null, delay_after_sec: delay, description,
        ifttt_event_name: eventName,
        ifttt_value1: document.getElementById('step-ifttt-value1').value.trim() || null,
        ifttt_value2: document.getElementById('step-ifttt-value2').value.trim() || null,
        ifttt_value3: document.getElementById('step-ifttt-value3').value.trim() || null,
      };
    } else if (type === 'shelly') {
      const channelId = parseInt(document.getElementById('step-shelly-channel').value);
      const action = document.getElementById('step-shelly-action').value;
      const delay = parseInt(document.getElementById('step-shelly-delay').value) || 0;
      newStep = { shelly_channel_id: channelId, kasa_port_id: null, action, delay_after_sec: delay, description };
    } else {
      const portId = parseInt(document.getElementById('step-port').value);
      const action = document.getElementById('step-action').value;
      const delay = parseInt(document.getElementById('step-delay').value) || 0;
      newStep = { kasa_port_id: portId, shelly_channel_id: null, action, delay_after_sec: delay, description };
    }
    if (editIndex !== null) {
      steps[editIndex] = newStep;
    } else {
      steps.push(newStep);
    }
    bootstrap.Modal.getInstance(document.getElementById('step-modal')).hide();
    renderStepList();
  });

  // Scheduled workflow modal save
  document.getElementById('btn-add-sched').addEventListener('click', () => openSchedModal(null));

  document.getElementById('sched-modal-save').addEventListener('click', saveSchedModal);
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
        scheduledWorkflows = scheduledWorkflows.filter(s => s.workflow_id !== id);
        if (activeWorkflowId === id) {
          activeWorkflowId = null;
          steps = [];
          originalSteps = [];
          const editor = document.getElementById('step-editor');
          if (editor) editor.style.display = 'none';
        }
        renderWfList();
        renderScheduledWfList();
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
    <div class="card mb-3">
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
    document.getElementById('step-shelly-fields').style.display = 'none';
    document.getElementById('step-ifttt-fields').style.display = 'none';
    document.getElementById('step-pause-fields').style.display = 'none';
    document.getElementById('step-action').value = 'off';
    document.getElementById('step-delay').value = '0';
    document.getElementById('step-shelly-action').value = 'off';
    document.getElementById('step-shelly-delay').value = '0';
    document.getElementById('step-ifttt-event').value = '';
    document.getElementById('step-ifttt-value1').value = '';
    document.getElementById('step-ifttt-value2').value = '';
    document.getElementById('step-ifttt-value3').value = '';
    document.getElementById('step-ifttt-delay').value = '0';
    document.getElementById('step-pause-sec').value = '5';
    if (ports.length) document.getElementById('step-port').value = ports[0].id;
    if (shellyChannels.length) document.getElementById('step-shelly-channel').value = shellyChannels[0].id;
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
    document.getElementById('step-shelly-fields').style.display = 'none';
    document.getElementById('step-ifttt-fields').style.display = 'none';
    document.getElementById('step-pause-fields').style.display = '';
    document.getElementById('step-pause-sec').value = step.delay_after_sec;
  } else if (step.action === 'ifttt') {
    document.getElementById('step-type').value = 'ifttt';
    document.getElementById('step-kasa-fields').style.display = 'none';
    document.getElementById('step-shelly-fields').style.display = 'none';
    document.getElementById('step-ifttt-fields').style.display = '';
    document.getElementById('step-pause-fields').style.display = 'none';
    document.getElementById('step-ifttt-event').value = step.ifttt_event_name || '';
    document.getElementById('step-ifttt-value1').value = step.ifttt_value1 || '';
    document.getElementById('step-ifttt-value2').value = step.ifttt_value2 || '';
    document.getElementById('step-ifttt-value3').value = step.ifttt_value3 || '';
    document.getElementById('step-ifttt-delay').value = step.delay_after_sec;
  } else if (step.shelly_channel_id) {
    document.getElementById('step-type').value = 'shelly';
    document.getElementById('step-kasa-fields').style.display = 'none';
    document.getElementById('step-shelly-fields').style.display = '';
    document.getElementById('step-ifttt-fields').style.display = 'none';
    document.getElementById('step-pause-fields').style.display = 'none';
    document.getElementById('step-shelly-channel').value = step.shelly_channel_id;
    document.getElementById('step-shelly-action').value = step.action;
    document.getElementById('step-shelly-delay').value = step.delay_after_sec;
  } else {
    document.getElementById('step-type').value = 'kasa';
    document.getElementById('step-kasa-fields').style.display = '';
    document.getElementById('step-shelly-fields').style.display = 'none';
    document.getElementById('step-ifttt-fields').style.display = 'none';
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
    } else if (step.action === 'ifttt') {
      mainContent = `
        <span class="badge bg-warning text-dark me-2">IFTTT</span>
        <i class="bi bi-lightning-charge me-1 text-warning" style="font-size:0.85rem"></i>
        <span style="color:#e0e0e0">${step.ifttt_event_name}</span>
      `;
      const delayPart = step.delay_after_sec > 0 ? `<span style="color:#a0b0c8">delay ${step.delay_after_sec}s</span>` : '';
      const descPart = step.description ? `<span style="color:#a0b0c8">${step.description}</span>` : '';
      const sep = delayPart && descPart ? '<span style="color:#555"> &mdash; </span>' : '';
      subContent = descPart + sep + delayPart;
    } else if (step.shelly_channel_id) {
      const ch = shellyChannels.find(c => c.id === step.shelly_channel_id);
      const chLabel = ch ? (ch.label || `Channel ${ch.channel_index}`) : `Channel ID ${step.shelly_channel_id}`;
      mainContent = `
        <span class="badge ${step.action === 'on' ? 'bg-success' : 'bg-danger'} me-2">${step.action.toUpperCase()}</span>
        <i class="bi bi-toggles me-1 text-info" style="font-size:0.85rem"></i>
        <span style="color:#e0e0e0">${chLabel}</span>
      `;
      const delayPart = step.delay_after_sec > 0 ? `<span style="color:#a0b0c8">delay ${step.delay_after_sec}s</span>` : '';
      const descPart = step.description ? `<span style="color:#a0b0c8">${step.description}</span>` : '';
      const sep = delayPart && descPart ? '<span style="color:#555"> &mdash; </span>' : '';
      subContent = descPart + sep + delayPart;
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

// ── Scheduled Workflows ───────────────────────────────────────────────────────

function renderScheduledWfList() {
  const list = document.getElementById('sched-list');
  if (!list) return;

  if (!scheduledWorkflows.length) {
    list.innerHTML = '<div class="text-muted p-3">No scheduled workflows configured.</div>';
    return;
  }

  list.innerHTML = scheduledWorkflows.map(sw => {
    const dayBadges = sw.days_of_week
      .map(d => `<span class="badge bg-secondary">${DAY_NAMES[d]}</span>`)
      .join(' ');
    return `
      <div class="d-flex align-items-center px-3 py-2" style="border-bottom:1px solid #2a2a4a">
        <span class="flex-grow-1" style="color:#e0e0e0">
          <strong>${sw.workflow_name}</strong>
          <span class="ms-2 text-muted small">${sw.run_time} local</span>
          <span class="ms-2">${dayBadges}</span>
        </span>
        <div class="form-check form-switch me-3 mb-0">
          <input class="form-check-input sched-toggle" type="checkbox" role="switch"
            id="sched-toggle-${sw.id}" ${sw.enabled ? 'checked' : ''} data-id="${sw.id}">
          <label class="form-check-label" for="sched-toggle-${sw.id}"
            style="color:${sw.enabled ? '#4caf50' : '#888'}">${sw.enabled ? 'On' : 'Off'}</label>
        </div>
        <button class="btn btn-sm btn-outline-secondary btn-edit-sched me-1" data-id="${sw.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger btn-del-sched" data-id="${sw.id}" data-name="${sw.workflow_name.replace(/"/g, '&quot;')}">Delete</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.sched-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const id = parseInt(toggle.dataset.id);
      try {
        const updated = await apiPatch(`/workflows/scheduled/${id}`, { enabled: toggle.checked });
        const sw = scheduledWorkflows.find(s => s.id === id);
        if (sw) sw.enabled = updated.enabled;
        renderScheduledWfList();
      } catch (err) {
        toggle.checked = !toggle.checked;
        showMsg(err.message, 'danger');
      }
    });
  });

  list.querySelectorAll('.btn-edit-sched').forEach(btn => {
    btn.addEventListener('click', () => {
      const sw = scheduledWorkflows.find(s => s.id === parseInt(btn.dataset.id));
      if (sw) openSchedModal(sw);
    });
  });

  list.querySelectorAll('.btn-del-sched').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete schedule for "${btn.dataset.name}"?`)) return;
      const id = parseInt(btn.dataset.id);
      try {
        await apiDelete(`/workflows/scheduled/${id}`);
        scheduledWorkflows = scheduledWorkflows.filter(s => s.id !== id);
        renderScheduledWfList();
      } catch (err) {
        showMsg(err.message, 'danger');
      }
    });
  });
}

function openSchedModal(sw) {
  editSchedId = sw ? sw.id : null;
  document.getElementById('sched-modal-title').textContent = sw ? 'Edit Scheduled Workflow' : 'Add Scheduled Workflow';

  // Reset day checkboxes
  document.querySelectorAll('.sched-day-cb').forEach(cb => { cb.checked = false; });

  if (sw) {
    document.getElementById('sched-workflow-id').value = sw.workflow_id;
    document.getElementById('sched-run-time').value = sw.run_time;
    document.getElementById('sched-enabled').checked = sw.enabled;
    sw.days_of_week.forEach(d => {
      const cb = document.getElementById(`sched-day-${d}`);
      if (cb) cb.checked = true;
    });
  } else {
    if (workflows.length) document.getElementById('sched-workflow-id').value = workflows[0].id;
    document.getElementById('sched-run-time').value = '06:00';
    document.getElementById('sched-enabled').checked = true;
  }

  new bootstrap.Modal(document.getElementById('sched-modal')).show();
}

async function saveSchedModal() {
  const workflowId = parseInt(document.getElementById('sched-workflow-id').value);
  const runTime = document.getElementById('sched-run-time').value;
  const enabled = document.getElementById('sched-enabled').checked;
  const days = Array.from(document.querySelectorAll('.sched-day-cb:checked')).map(cb => parseInt(cb.value));

  if (!days.length) {
    alert('Please select at least one day.');
    return;
  }
  if (!runTime) {
    alert('Please specify a run time.');
    return;
  }

  try {
    if (editSchedId !== null) {
      const updated = await apiPatch(`/workflows/scheduled/${editSchedId}`, {
        workflow_id: workflowId,
        run_time: runTime,
        days_of_week: days,
        enabled,
      });
      const idx = scheduledWorkflows.findIndex(s => s.id === editSchedId);
      if (idx >= 0) scheduledWorkflows[idx] = updated;
    } else {
      const created = await apiPost('/workflows/scheduled', {
        workflow_id: workflowId,
        run_time: runTime,
        days_of_week: days,
        enabled,
      });
      scheduledWorkflows.push(created);
    }
    bootstrap.Modal.getInstance(document.getElementById('sched-modal')).hide();
    renderScheduledWfList();
    showMsg(editSchedId !== null ? 'Schedule updated.' : 'Schedule created.', 'success');
  } catch (err) {
    showMsg(err.message, 'danger');
  }
}
