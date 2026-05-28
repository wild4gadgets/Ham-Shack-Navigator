import { apiGet, apiPut, apiPost, apiPatch, apiDelete } from '../../api.js';

// Compute 6-character Maidenhead grid locator from lat/lon
function maidenhead(lat, lon) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWX';
  const la = lat + 90, lo = lon + 180;
  return (
    L[Math.floor(lo / 20)] +
    L[Math.floor(la / 10)] +
    Math.floor((lo % 20) / 2) +
    Math.floor(la % 10) +
    String.fromCharCode(97 + Math.floor((lo % 2) * 12)) +
    String.fromCharCode(97 + Math.floor((la % 1) * 24))
  );
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showMsg(type, text) {
  const el = document.getElementById('loc-msg');
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = text;
  el.style.display = '';
}

function activeProfile(profiles, id) {
  return profiles.find(p => p.id === id) || null;
}

export async function renderLocationTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  let active, profiles;
  try {
    active = await apiGet('/settings/location');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">${escHtml(e.message)}</div>`;
    return;
  }
  try {
    profiles = await apiGet('/settings/location/profiles');
  } catch {
    profiles = [];  // profiles endpoint not yet available (container needs rebuild)
  }
  buildUI(container, active, profiles || []);
}

function buildUI(container, active, profiles) {
  const activeId = active.active_profile_id || '';
  const units = active.units || 'imperial';
  const prof = activeProfile(profiles, activeId);

  const profileOptions = profiles.map(p =>
    `<option value="${escHtml(p.id)}" ${p.id === activeId ? 'selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-geo-alt me-2"></i>Station Information</div>
      <div class="card-body">
        <div id="loc-msg" class="alert" style="display:none"></div>

        <div class="row align-items-end mb-3">
          <div class="col">
            <label class="form-label fw-semibold">Location Profile</label>
            <select class="form-select" id="loc-profile-select">
              ${profiles.length
                ? profileOptions
                : '<option value="">— No profiles yet —</option>'}
            </select>
          </div>
          <div class="col-auto d-flex gap-2">
            <button type="button" class="btn btn-outline-success" id="loc-new-btn" title="New profile">
              <i class="bi bi-plus-lg"></i> New
            </button>
            <button type="button" class="btn btn-outline-secondary" id="loc-rename-btn"
              title="Rename this profile" ${!activeId ? 'disabled' : ''}>
              <i class="bi bi-pencil"></i>
            </button>
            <button type="button" class="btn btn-outline-danger" id="loc-delete-btn"
              title="Delete this profile" ${!activeId ? 'disabled' : ''}>
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>

        <div class="row mb-4">
          <div class="col">
            <label class="form-label fw-semibold">Location Lookup</label>
            <div class="input-group">
              <input type="text" class="form-control" id="loc-lookup"
                placeholder="City/ZIP, lat/lon, or grid square (e.g. DM79mr)" />
              <button class="btn btn-outline-secondary" type="button" id="loc-lookup-btn">
                <i class="bi bi-search me-1"></i>Search
              </button>
            </div>
            <div class="form-text">
              Accepts: city/ZIP (e.g. <em>Denver, CO</em>), GPS coords (e.g. <em>39.7392, -104.9847</em>),
              or Maidenhead grid (e.g. <em>DM79mr</em>). Populates coordinates, city, and grid square.
            </div>
          </div>
        </div>

        <form id="location-form">
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Profile Name</label>
              <input type="text" class="form-control" id="loc-profile-name"
                value="${escHtml(prof?.name ?? '')}"
                placeholder="e.g. Home QTH" ${!activeId ? 'disabled' : ''} />
            </div>
            <div class="col-md-3 mb-3">
              <label class="form-label">Station Callsign</label>
              <input type="text" class="form-control font-monospace" id="loc-callsign"
                value="${escHtml(active.callsign || '')}" placeholder="e.g. W1AW"
                style="text-transform:uppercase" maxlength="10" />
            </div>
            <div class="col-md-3 mb-3">
              <label class="form-label">City / Station Name</label>
              <input type="text" class="form-control" id="loc-city"
                value="${escHtml(active.city || '')}" placeholder="e.g. Denver, CO" />
            </div>
          </div>

          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Latitude</label>
              <input type="number" step="0.0001" class="form-control" id="loc-lat"
                value="${active.lat || ''}" placeholder="e.g. 39.7392" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Longitude</label>
              <input type="number" step="0.0001" class="form-control" id="loc-lon"
                value="${active.lon || ''}" placeholder="e.g. -104.9847" />
            </div>
          </div>

          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Maidenhead Grid Square</label>
              <input type="text" class="form-control font-monospace" id="loc-gridsquare"
                value="${escHtml(active.gridsquare || '')}"
                placeholder="e.g. DM79mr" maxlength="6" style="text-transform:uppercase" />
              <div class="form-text">Auto-computed from coordinates. Override if needed.</div>
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label">Units</label>
            <div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="loc-units"
                  id="units-imperial" value="imperial" ${units === 'imperial' ? 'checked' : ''} />
                <label class="form-check-label" for="units-imperial">Imperial (°F, mph, miles)</label>
              </div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="loc-units"
                  id="units-metric" value="metric" ${units === 'metric' ? 'checked' : ''} />
                <label class="form-check-label" for="units-metric">Metric (°C, km/h, km)</label>
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-primary">
            ${activeId ? 'Save Profile' : 'Save Location'}
          </button>
        </form>
      </div>
    </div>
  `;

  attachHandlers(container, active, profiles);
}

function attachHandlers(container, active, profiles) {
  const activeId = active.active_profile_id || '';

  // ── Profile dropdown: switching profile activates it immediately ──
  document.getElementById('loc-profile-select')?.addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return;
    try {
      await apiPost(`/settings/location/profiles/${id}/activate`);
      const [newActive, newProfiles] = await Promise.all([
        apiGet('/settings/location'),
        apiGet('/settings/location/profiles'),
      ]);
      buildUI(container, newActive, newProfiles);
    } catch (err) {
      showMsg('danger', err.message);
    }
  });

  // ── New profile ──
  document.getElementById('loc-new-btn')?.addEventListener('click', async () => {
    const name = prompt('Enter a name for the new location profile:');
    if (!name?.trim()) return;
    const lat = parseFloat(document.getElementById('loc-lat').value) || 0;
    const lon = parseFloat(document.getElementById('loc-lon').value) || 0;
    try {
      const created = await apiPost('/settings/location/profiles', {
        name: name.trim(),
        lat, lon,
        city: document.getElementById('loc-city').value,
        units: document.querySelector('input[name="loc-units"]:checked')?.value || 'imperial',
        gridsquare: document.getElementById('loc-gridsquare').value,
      });
      await apiPost(`/settings/location/profiles/${created.id}/activate`);
      const [newActive, newProfiles] = await Promise.all([
        apiGet('/settings/location'),
        apiGet('/settings/location/profiles'),
      ]);
      buildUI(container, newActive, newProfiles);
    } catch (err) {
      showMsg('danger', err.message);
    }
  });

  // ── Rename profile ──
  document.getElementById('loc-rename-btn')?.addEventListener('click', async () => {
    if (!activeId) return;
    const prof = activeProfile(profiles, activeId);
    const newName = prompt('New profile name:', prof?.name || '')?.trim();
    if (!newName || newName === prof?.name) return;
    try {
      await apiPatch(`/settings/location/profiles/${activeId}`, { name: newName });
      const [newActive, newProfiles] = await Promise.all([
        apiGet('/settings/location'),
        apiGet('/settings/location/profiles'),
      ]);
      buildUI(container, newActive, newProfiles);
    } catch (err) {
      showMsg('danger', err.message);
    }
  });

  // ── Delete profile ──
  document.getElementById('loc-delete-btn')?.addEventListener('click', async () => {
    if (!activeId) return;
    const prof = activeProfile(profiles, activeId);
    if (!confirm(`Delete profile "${prof?.name || activeId}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/settings/location/profiles/${activeId}`);
      const remaining = profiles.filter(p => p.id !== activeId);
      if (remaining.length) {
        await apiPost(`/settings/location/profiles/${remaining[0].id}/activate`);
      }
      const [newActive, newProfiles] = await Promise.all([
        apiGet('/settings/location'),
        apiGet('/settings/location/profiles'),
      ]);
      buildUI(container, newActive, newProfiles);
    } catch (err) {
      showMsg('danger', err.message);
    }
  });

  // ── Lat/lon → auto-compute Maidenhead ──
  function autoGridsquare() {
    const lat = parseFloat(document.getElementById('loc-lat').value);
    const lon = parseFloat(document.getElementById('loc-lon').value);
    if (!isNaN(lat) && !isNaN(lon)) {
      document.getElementById('loc-gridsquare').value = maidenhead(lat, lon);
    }
  }

  function truncate4(input) {
    const dot = input.value.indexOf('.');
    if (dot !== -1 && input.value.length - dot - 1 > 4) {
      input.value = parseFloat(input.value).toFixed(4);
    }
  }

  document.getElementById('loc-lat').addEventListener('change', autoGridsquare);
  document.getElementById('loc-lon').addEventListener('change', autoGridsquare);
  document.getElementById('loc-lat').addEventListener('blur', (e) => { truncate4(e.target); autoGridsquare(); });
  document.getElementById('loc-lon').addEventListener('blur', (e) => { truncate4(e.target); autoGridsquare(); });

  // ── Location lookup ──
  async function doLookup() {
    const q = document.getElementById('loc-lookup').value.trim();
    if (!q) return;
    const btn = document.getElementById('loc-lookup-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Searching…';
    try {
      const result = await apiGet(`/settings/location/lookup?q=${encodeURIComponent(q)}`);
      document.getElementById('loc-lat').value = result.lat.toFixed(4);
      document.getElementById('loc-lon').value = result.lon.toFixed(4);
      if (result.city) document.getElementById('loc-city').value = result.city;
      if (result.gridsquare) document.getElementById('loc-gridsquare').value = result.gridsquare;
      showMsg('success', `Found: ${result.city || result.lat + ', ' + result.lon}`);
    } catch (err) {
      showMsg('danger', `Lookup failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-search me-1"></i>Search';
    }
  }

  document.getElementById('loc-lookup-btn')?.addEventListener('click', doLookup);
  document.getElementById('loc-lookup')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
  });

  // ── Save ──
  document.getElementById('location-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lat = parseFloat(document.getElementById('loc-lat').value);
    const lon = parseFloat(document.getElementById('loc-lon').value);
    const payload = {
      name: document.getElementById('loc-profile-name').value.trim() || 'Default',
      callsign: document.getElementById('loc-callsign').value.trim().toUpperCase(),
      city: document.getElementById('loc-city').value,
      lat: isNaN(lat) ? 0 : lat,
      lon: isNaN(lon) ? 0 : lon,
      units: document.querySelector('input[name="loc-units"]:checked')?.value || 'imperial',
      gridsquare: document.getElementById('loc-gridsquare').value.trim(),
    };
    try {
      if (activeId) {
        await apiPut(`/settings/location/profiles/${activeId}`, payload);
      } else {
        await apiPut('/settings/location', payload);
      }
      showMsg('success', 'Location saved.');
    } catch (err) {
      showMsg('danger', err.message);
    }
  });
}
