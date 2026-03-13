import { apiGet, apiPut } from '../../api.js';

export async function renderLocationTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/location');

  const units = data.units || 'imperial';
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-geo-alt me-2"></i>Station Location</div>
      <div class="card-body">
        <div id="loc-msg" class="alert" style="display:none"></div>
        <form id="location-form">
          <div class="mb-3">
            <label class="form-label">City / Station Name</label>
            <input type="text" class="form-control" id="loc-city" value="${data.city || ''}" />
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Latitude</label>
              <input type="number" step="0.0001" class="form-control" id="loc-lat" value="${data.lat || ''}" placeholder="e.g. 39.1234" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Longitude</label>
              <input type="number" step="0.0001" class="form-control" id="loc-lon" value="${data.lon || ''}" placeholder="e.g. -105.1234" />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">Units</label>
            <div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="loc-units" id="units-imperial" value="imperial" ${units === 'imperial' ? 'checked' : ''} />
                <label class="form-check-label" for="units-imperial">Imperial (°F, mph, miles)</label>
              </div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="loc-units" id="units-metric" value="metric" ${units === 'metric' ? 'checked' : ''} />
                <label class="form-check-label" for="units-metric">Metric (°C, km/h, km)</label>
              </div>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  function truncate4(input) {
    const val = input.value;
    const dot = val.indexOf('.');
    if (dot !== -1 && val.length - dot - 1 > 4) {
      input.value = parseFloat(val).toFixed(4);
    }
  }

  document.getElementById('loc-lat').addEventListener('change', (e) => truncate4(e.target));
  document.getElementById('loc-lon').addEventListener('change', (e) => truncate4(e.target));

  document.getElementById('location-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loc-msg');
    try {
      await apiPut('/settings/location', {
        city: document.getElementById('loc-city').value,
        lat: parseFloat(document.getElementById('loc-lat').value),
        lon: parseFloat(document.getElementById('loc-lon').value),
        units: document.querySelector('input[name="loc-units"]:checked').value,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Location saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
