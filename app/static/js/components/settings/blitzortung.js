import { apiGet, apiPut } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

// Precision-4 geohash (base32), mirrors pygeohash encode() output
function geohash4(lat, lon) {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let result = '', bits = 0, hashValue = 0;
  let isEven = true;
  while (result.length < 4) {
    if (isEven) {
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) { hashValue = (hashValue << 1) | 1; minLon = mid; }
      else            { hashValue = (hashValue << 1);     maxLon = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { hashValue = (hashValue << 1) | 1; minLat = mid; }
      else            { hashValue = (hashValue << 1);     maxLat = mid; }
    }
    isEven = !isEven;
    bits++;
    if (bits === 5) {
      result += BASE32[hashValue];
      bits = 0;
      hashValue = 0;
    }
  }
  return result;
}

export async function renderBlitzortungTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading…</div>';

  let data, loc;
  try {
    [data, loc] = await Promise.all([
      apiGet('/settings/blitzortung'),
      apiGet('/settings/location'),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    return;
  }

  const lat = loc?.lat ?? 0;
  const lon = loc?.lon ?? 0;
  const hashDisplay = (lat !== 0 || lon !== 0)
    ? geohash4(lat, lon)
    : '(set location first)';

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-lightning-fill me-2"></i>Blitzortung Live Lightning</div>
      <div class="card-body">
        <div id="bz-msg" class="alert" style="display:none"></div>

        <p class="text-white-50 small mb-3">
          Connects to the public Blitzortung MQTT relay and shows real-time lightning
          strikes within your configured radius — no API key required.
        </p>

        <form id="bz-form">
          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="bz-enabled"
              ${data.enabled ? 'checked' : ''}>
            <label class="form-check-label" for="bz-enabled" style="color:#fff">
              Enable Blitzortung lightning detection
            </label>
          </div>

          <div class="mb-3">
            <label class="form-label">Detection radius (km)</label>
            <input type="number" class="form-control" id="bz-range" min="10" max="500"
              value="${data.range_km ?? 40}" style="${INP}">
            <div class="form-text">
              Strikes within this radius trigger a live dashboard alert.
              The service subscribes to a 3×3 grid of ~39×20 km geohash cells
              centred on your location.
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label">Home geohash (read-only)</label>
            <input type="text" class="form-control" id="bz-geohash" readonly
              value="${hashDisplay}" style="${INP};opacity:0.7">
            <div class="form-text">
              Precision-4 cell (~39 km × 20 km) derived from your location.
              The service also subscribes to all 8 adjacent cells.
            </div>
          </div>

          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('bz-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('bz-msg');
    try {
      await apiPut('/settings/blitzortung', {
        enabled: document.getElementById('bz-enabled').checked,
        range_km: parseInt(document.getElementById('bz-range').value, 10),
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Saved. Service restarted with new settings.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
