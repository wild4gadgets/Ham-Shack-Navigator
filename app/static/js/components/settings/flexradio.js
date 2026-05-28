import { apiGet, apiPut } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

export async function renderFlexRadioTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/flexradio');

  const daxEnabled      = data.dax_enabled        ?? true;
  const daxChannel      = data.dax_channel        ?? 1;
  const stepSmallKhz    = data.freq_step_small_khz ?? 50.0;
  const stepLargeKhz    = data.freq_step_large_khz ?? 100.0;
  const txBtnLabel      = data.tx_button_label ?? 'MOX';

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

          <div class="mb-4 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="flex-enabled"
              ${data.enabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-enabled">Enable FlexRadio connection</label>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">DAX Audio</h6>

          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="flex-dax-enabled"
              ${daxEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-dax-enabled">Enable DAX RX audio stream</label>
          </div>

          <div class="mb-4" id="dax-options" style="${daxEnabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <label class="form-label">DAX Channel</label>
            <select class="form-select" id="flex-dax-channel" style="${INP}">
              ${[1,2,3,4,5,6,7,8].map(n =>
                `<option value="${n}"${daxChannel === n ? ' selected' : ''}>${n}</option>`
              ).join('')}
            </select>
            <div class="form-text">DAX RX channel assigned to the primary slice in SmartSDR.</div>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">Transmit Button</h6>

          <div class="mb-4">
            <label class="form-label">Transmit Button Name</label>
            <input type="text" class="form-control" id="flex-tx-btn-label"
              maxlength="4" placeholder="MOX" value="${txBtnLabel}" style="${INP};width:6rem;text-transform:uppercase">
            <div class="form-text">Label shown on the TX toggle button in the status bar (up to 4 characters). Common choices: MOX, PTT, TX.</div>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">Frequency Step Sizes</h6>

          <div class="row mb-3">
            <div class="col">
              <label class="form-label">Small Step (kHz)</label>
              <input type="number" class="form-control" id="flex-step-small"
                min="0.001" step="0.001" value="${stepSmallKhz}" style="${INP}">
              <div class="form-text">Step size for &lt; / &gt; buttons and , / . keys.</div>
            </div>
            <div class="col">
              <label class="form-label">Large Step (kHz)</label>
              <input type="number" class="form-control" id="flex-step-large"
                min="0.001" step="0.001" value="${stepLargeKhz}" style="${INP}">
              <div class="form-text">Step size for &lt;&lt; / &gt;&gt; buttons and &lt; / &gt; keys.</div>
            </div>
          </div>

          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('flex-dax-enabled').addEventListener('change', (e) => {
    document.getElementById('dax-options').style.cssText =
      e.target.checked ? '' : 'opacity:0.5;pointer-events:none';
  });

  document.getElementById('flex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('flex-msg');
    try {
      await apiPut('/settings/flexradio', {
        ip:                   document.getElementById('flex-ip').value.trim(),
        enabled:              document.getElementById('flex-enabled').checked,
        dax_enabled:          document.getElementById('flex-dax-enabled').checked,
        dax_channel:          parseInt(document.getElementById('flex-dax-channel').value, 10),
        freq_step_small_khz:  parseFloat(document.getElementById('flex-step-small').value),
        freq_step_large_khz:  parseFloat(document.getElementById('flex-step-large').value),
        tx_button_label:      (document.getElementById('flex-tx-btn-label').value.trim().toUpperCase() || 'MOX').slice(0, 4),
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
