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

  const chk = (id, val) => val ? 'checked' : '';

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
          <!-- Detection -->
          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="bz-enabled"
              ${chk('bz-enabled', data.enabled)}>
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

          <div class="mb-4">
            <label class="form-label">Home geohash (read-only)</label>
            <input type="text" class="form-control" id="bz-geohash" readonly
              value="${hashDisplay}" style="${INP};opacity:0.7">
            <div class="form-text">
              Precision-4 cell (~39 km × 20 km) derived from your location.
              The service also subscribes to all 8 adjacent cells.
            </div>
          </div>

          <hr style="border-color:#2a2a4a">

          <!-- Notifications -->
          <h6 class="text-white-50 mb-3">Strike Notifications</h6>

          <div class="mb-3 form-check form-switch">
            <input class="form-check-input" type="checkbox" id="bz-notify-enabled"
              ${chk('', data.notify_enabled)}>
            <label class="form-check-label" for="bz-notify-enabled" style="color:#fff">
              Send notifications when a strike is detected within the radius
            </label>
          </div>

          <div id="bz-notify-options">
            <div class="mb-3">
              <label class="form-label">Notification channels</label>
              <div class="d-flex flex-wrap gap-3">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="bz-notify-ntfy"
                    ${chk('', data.notify_ntfy)}>
                  <label class="form-check-label" for="bz-notify-ntfy">ntfy</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="bz-notify-telegram"
                    ${chk('', data.notify_telegram)}>
                  <label class="form-check-label" for="bz-notify-telegram">Telegram</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="bz-notify-ifttt"
                    ${chk('', data.notify_ifttt)}>
                  <label class="form-check-label" for="bz-notify-ifttt">IFTTT</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="bz-notify-email"
                    ${chk('', data.notify_email)}>
                  <label class="form-check-label" for="bz-notify-email">Email</label>
                </div>
              </div>
              <div class="form-text">Each channel must also be configured and enabled in its own settings tab.</div>
            </div>

            <div class="mb-3">
              <label class="form-label" for="bz-notify-interval">Minimum notification interval (minutes)</label>
              <input type="number" class="form-control" id="bz-notify-interval" min="1" max="1440"
                value="${data.notify_interval_min ?? 15}" style="${INP};max-width:120px">
              <div class="form-text">
                Notifications will not be sent more often than this interval, even during continuous activity.
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  // Toggle notify options visibility
  const notifyEnabled = document.getElementById('bz-notify-enabled');
  const notifyOptions = document.getElementById('bz-notify-options');
  function syncNotifyOptions() {
    notifyOptions.style.display = notifyEnabled.checked ? '' : 'none';
  }
  syncNotifyOptions();
  notifyEnabled.addEventListener('change', syncNotifyOptions);

  document.getElementById('bz-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('bz-msg');
    try {
      await apiPut('/settings/blitzortung', {
        enabled:              document.getElementById('bz-enabled').checked,
        range_km:             parseInt(document.getElementById('bz-range').value, 10),
        notify_enabled:       document.getElementById('bz-notify-enabled').checked,
        notify_ntfy:          document.getElementById('bz-notify-ntfy').checked,
        notify_telegram:      document.getElementById('bz-notify-telegram').checked,
        notify_ifttt:         document.getElementById('bz-notify-ifttt').checked,
        notify_email:         document.getElementById('bz-notify-email').checked,
        notify_interval_min:  parseInt(document.getElementById('bz-notify-interval').value, 10),
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
