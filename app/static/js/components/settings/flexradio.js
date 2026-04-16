import { apiGet, apiPut } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

export async function renderFlexRadioTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/flexradio');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-broadcast-pin me-2"></i>FlexRadio</div>
      <div class="card-body">
        <div id="flex-msg" class="alert" style="display:none"></div>
        <form id="flex-form">
          <div class="mb-3">
            <label class="form-label">Radio IP Address</label>
            <input type="text" class="form-control" id="flex-ip"
              placeholder="192.168.1.x" value="${data.ip ?? ''}" style="${INP}">
            <div class="form-text">Local IP address of your FlexRadio 6400. Leave blank to disable.</div>
          </div>
          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="flex-enabled"
              ${data.enabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-enabled">Enable FlexRadio connection</label>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('flex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('flex-msg');
    try {
      await apiPut('/settings/flexradio', {
        ip: document.getElementById('flex-ip').value.trim(),
        enabled: document.getElementById('flex-enabled').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'FlexRadio settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
