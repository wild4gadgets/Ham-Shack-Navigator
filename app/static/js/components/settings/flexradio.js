import { apiGet, apiPut } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

export async function renderFlexRadioTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/flexradio');

  const daxEnabled      = data.dax_enabled        ?? true;
  const daxChannel      = data.dax_channel        ?? 1;
  const cwToneFreq      = data.cw_tone_freq       ?? 700;
  const cwThreshold     = data.cw_threshold       ?? 0.15;
  const stepSmallKhz    = data.freq_step_small_khz ?? 50.0;
  const stepLargeKhz    = data.freq_step_large_khz ?? 100.0;

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
          <h6 class="text-white-50 mb-3">DAX Audio &amp; CW Decoder</h6>

          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="flex-dax-enabled"
              ${daxEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-dax-enabled">Enable DAX RX audio stream</label>
          </div>

          <div class="mb-3" id="dax-options" style="${daxEnabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <label class="form-label">DAX Channel</label>
            <select class="form-select" id="flex-dax-channel" style="${INP}">
              ${[1,2,3,4,5,6,7,8].map(n =>
                `<option value="${n}"${daxChannel === n ? ' selected' : ''}>${n}</option>`
              ).join('')}
            </select>
            <div class="form-text">DAX RX channel assigned to the primary slice in SmartSDR.</div>
          </div>

          <div class="mb-3" id="cw-options" style="${daxEnabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <label class="form-label">CW Tone Frequency (Hz)</label>
            <input type="number" class="form-control" id="flex-cw-tone-freq"
              min="300" max="1200" step="10" value="${cwToneFreq}" style="${INP}">
            <div class="form-text">Sidetone frequency to detect. Typical values: 500–800 Hz. Default: 700 Hz.</div>
          </div>

          <div class="mb-4" id="cw-threshold-wrap" style="${daxEnabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <label class="form-label d-flex justify-content-between">
              <span>CW Detection Threshold</span>
              <span id="flex-cw-threshold-val" class="text-white-50">${cwThreshold.toFixed(2)}</span>
            </label>
            <input type="range" class="form-range" id="flex-cw-threshold"
              min="0.05" max="0.60" step="0.01" value="${cwThreshold}">
            <div class="form-text">
              Relative power level (0.05–0.60) at which a tone is considered "on".
              Lower = more sensitive; higher = less false triggers. Default: 0.15.
            </div>
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

  // Toggle DAX-dependent fields when the DAX switch changes
  document.getElementById('flex-dax-enabled').addEventListener('change', (e) => {
    const on = e.target.checked;
    for (const id of ['dax-options', 'cw-options', 'cw-threshold-wrap']) {
      document.getElementById(id).style.cssText =
        on ? '' : 'opacity:0.5;pointer-events:none';
    }
  });

  // Live threshold label
  document.getElementById('flex-cw-threshold').addEventListener('input', (e) => {
    document.getElementById('flex-cw-threshold-val').textContent =
      parseFloat(e.target.value).toFixed(2);
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
        cw_tone_freq:         parseFloat(document.getElementById('flex-cw-tone-freq').value),
        cw_threshold:         parseFloat(document.getElementById('flex-cw-threshold').value),
        freq_step_small_khz:  parseFloat(document.getElementById('flex-step-small').value),
        freq_step_large_khz:  parseFloat(document.getElementById('flex-step-large').value),
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
