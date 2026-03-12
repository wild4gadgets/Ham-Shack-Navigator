import { apiGet, apiPut } from '../../api.js';

export async function renderLocationTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/location');

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
              <input type="number" step="0.0001" class="form-control" id="loc-lat" value="${data.lat || 0}" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Longitude</label>
              <input type="number" step="0.0001" class="form-control" id="loc-lon" value="${data.lon || 0}" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('location-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loc-msg');
    try {
      await apiPut('/settings/location', {
        city: document.getElementById('loc-city').value,
        lat: parseFloat(document.getElementById('loc-lat').value),
        lon: parseFloat(document.getElementById('loc-lon').value),
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
