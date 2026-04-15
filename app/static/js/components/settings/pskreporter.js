import { apiGet, apiPut } from '../../api.js';

const BANDS = ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','2m'];
const MODES = ['FT8','FT4','CW','SSB','PSK31','RTTY','JS8','WSPR','JT65','JT9'];

function multiOptions(items, selected) {
  return items.map(v =>
    `<option value="${v}" ${selected.includes(v) ? 'selected' : ''}>${v}</option>`
  ).join('');
}

export async function renderPskReporterTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  let data;
  try {
    data = await apiGet('/pskreporter/settings');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger m-3">${e.message}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-broadcast-pin me-2"></i>PSK Reporter Defaults</div>
      <div class="card-body">
        <div id="psk-msg" class="alert" style="display:none"></div>
        <p class="text-muted small">These values pre-fill the PSK Reporter tile on the dashboard. You can override them per-session directly in the tile.</p>
        <form id="psk-settings-form">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Default Callsign</label>
              <input type="text" id="psk-callsign" class="form-control"
                value="${data.callsign ?? ''}" placeholder="e.g. W1AW"
                style="text-transform:uppercase" maxlength="10" />
            </div>
            <div class="col-md-4">
              <label class="form-label">Default Direction</label>
              <select id="psk-direction" class="form-select">
                <option value="senderCallsign"  ${data.default_direction === 'senderCallsign'  ? 'selected' : ''}>Heard by others (TX)</option>
                <option value="receiverCallsign" ${data.default_direction === 'receiverCallsign' ? 'selected' : ''}>Heard from others (RX)</option>
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Default Timespan</label>
              <select id="psk-timespan" class="form-select">
                <option value="-900"   ${data.default_timespan === -900   ? 'selected' : ''}>15 minutes</option>
                <option value="-1800"  ${data.default_timespan === -1800  ? 'selected' : ''}>30 minutes</option>
                <option value="-3600"  ${data.default_timespan === -3600  ? 'selected' : ''}>1 hour</option>
                <option value="-5400"  ${data.default_timespan === -5400  ? 'selected' : ''}>90 minutes</option>
                <option value="-7200"  ${data.default_timespan === -7200  ? 'selected' : ''}>2 hours</option>
                <option value="-14400" ${data.default_timespan === -14400 ? 'selected' : ''}>4 hours</option>
                <option value="-21600" ${data.default_timespan === -21600 ? 'selected' : ''}>6 hours</option>
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label">Default Modes <small class="text-muted">(Ctrl/Cmd+click for multiple; none = all)</small></label>
              <select id="psk-modes" class="form-select" multiple size="5">
                ${multiOptions(MODES, data.default_modes ?? [])}
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label">Default Bands <small class="text-muted">(Ctrl/Cmd+click for multiple; none = all)</small></label>
              <select id="psk-bands" class="form-select" multiple size="5">
                ${multiOptions(BANDS, data.default_bands ?? [])}
              </select>
            </div>
          </div>
          <div class="mt-3">
            <button type="submit" class="btn btn-primary">Save Defaults</button>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('psk-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('psk-msg');
    const modesEl = document.getElementById('psk-modes');
    const bandsEl = document.getElementById('psk-bands');
    const selectedModes = Array.from(modesEl.selectedOptions).map(o => o.value);
    const selectedBands = Array.from(bandsEl.selectedOptions).map(o => o.value);
    try {
      await apiPut('/pskreporter/settings', {
        callsign:          document.getElementById('psk-callsign').value.trim().toUpperCase(),
        default_direction: document.getElementById('psk-direction').value,
        default_modes:     selectedModes,
        default_bands:     selectedBands,
        default_timespan:  parseInt(document.getElementById('psk-timespan').value),
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'PSK Reporter defaults saved.';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
    }
    msg.style.display = '';
  });
}
