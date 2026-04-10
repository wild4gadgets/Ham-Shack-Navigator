import { apiGet, apiPut } from '../../api.js';

const REGIONS = [
  { value: 'AF', label: 'Africa' },
  { value: 'AS', label: 'Asia' },
  { value: 'EU', label: 'Europe' },
  { value: 'NA', label: 'North America' },
  { value: 'OC', label: 'Oceania' },
  { value: 'SA', label: 'South America' },
];

const INTERVALS = [
  { value: 60,   label: '1 minute' },
  { value: 120,  label: '2 minutes' },
  { value: 300,  label: '5 minutes' },
  { value: 600,  label: '10 minutes' },
  { value: 900,  label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
];

export async function renderDxclusterTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/dxcluster');

  const regionOptions = REGIONS.map(r =>
    `<option value="${r.value}"${data.region === r.value ? ' selected' : ''}>${r.label}</option>`
  ).join('');

  const currentInterval = data.refresh_interval_sec ?? 300;
  const intervalOptions = INTERVALS.map(i =>
    `<option value="${i.value}"${currentInterval === i.value ? ' selected' : ''}>${i.label}</option>`
  ).join('');

  const sel = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-reception-4 me-2"></i>DX Cluster</div>
      <div class="card-body">
        <div id="dxc-msg" class="alert" style="display:none"></div>
        <form id="dxc-form">
          <div class="mb-3">
            <label class="form-label">Band Activity Region</label>
            <select class="form-select" id="dxc-region" style="${sel}">
              ${regionOptions}
            </select>
            <div class="form-text">Filter the Band Activity heatmap to show spots received from stations in this region.</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Refresh Interval</label>
            <select class="form-select" id="dxc-interval" style="${sel}">
              ${intervalOptions}
            </select>
            <div class="form-text">How often the Band Activity heatmap on the dashboard automatically refreshes.</div>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('dxc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('dxc-msg');
    try {
      await apiPut('/settings/dxcluster', {
        region: document.getElementById('dxc-region').value,
        refresh_interval_sec: parseInt(document.getElementById('dxc-interval').value, 10),
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'DX Cluster settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
