import { apiGet, apiPut } from '../../api.js';

export async function renderThresholdsTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  const data = await apiGet('/settings/thresholds');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-sliders me-2"></i>Alert Thresholds</div>
      <div class="card-body">
        <div id="thresh-msg" class="alert" style="display:none"></div>
        <form id="thresholds-form">
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label">Wind Gust Threshold (mph)</label>
              <input type="number" step="0.1" min="1" class="form-control" id="wind-mph" value="${data.wind_mph ?? 35}" />
              <div class="form-text">Trigger shutdown if wind gusts exceed this speed.</div>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Lightning Distance Threshold (miles)</label>
              <input type="number" step="0.1" min="1" class="form-control" id="lightning-miles" value="${data.lightning_miles ?? 10}" />
              <div class="form-text">Trigger shutdown if lightning closer than this distance.</div>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">AccuWeather Thunderstorm Probability Threshold (%)</label>
              <input type="number" step="1" min="1" max="100" class="form-control" id="thunderstorm-prob-pct" value="${data.thunderstorm_prob_pct ?? 70}" />
              <div class="form-text">Trigger shutdown if AccuWeather next-hour thunderstorm probability reaches this level. Set to 100 to disable.</div>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Poll Interval (seconds)</label>
              <input type="number" step="1" min="60" max="3600" class="form-control" id="poll-interval" value="${data.poll_interval_sec ?? 300}" />
              <div class="form-text">How often to check weather. Min 60s.</div>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Shutdown Cooldown (minutes)</label>
              <input type="number" step="1" min="1" class="form-control" id="cooldown-min" value="${data.cooldown_min ?? 30}" />
              <div class="form-text">Wait this long before allowing another shutdown.</div>
            </div>
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label">NWS Severe Weather Alert Notifications</label>
            <select class="form-select" id="nws-alert-notify">
              <option value="none"    ${(data.nws_alert_notify ?? 'none') === 'none'    ? 'selected' : ''}>None — don't send notifications</option>
              <option value="watch"   ${(data.nws_alert_notify ?? 'none') === 'watch'   ? 'selected' : ''}>Watch or Warning</option>
              <option value="warning" ${(data.nws_alert_notify ?? 'none') === 'warning' ? 'selected' : ''}>Warning only</option>
            </select>
            <div class="form-text">Send a notification when NWS issues a Watch or Warning for your location. Uses all configured notification channels.</div>
          </div>
          <div class="row mb-3">
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="log-weather-data" ${data.log_weather_data ? 'checked' : ''}>
                <label class="form-check-label" for="log-weather-data" style="color:#fff">Log all external API calls to event log</label>
              </div>
              <div class="form-text">Records wind, temperature, and lightning readings in the dashboard event log on every poll cycle.</div>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('thresholds-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('thresh-msg');
    try {
      await apiPut('/settings/thresholds', {
        wind_mph: parseFloat(document.getElementById('wind-mph').value),
        lightning_miles: parseFloat(document.getElementById('lightning-miles').value),
        thunderstorm_prob_pct: parseInt(document.getElementById('thunderstorm-prob-pct').value),
        poll_interval_sec: parseInt(document.getElementById('poll-interval').value),
        cooldown_min: parseInt(document.getElementById('cooldown-min').value),
        log_weather_data: document.getElementById('log-weather-data').checked,
        nws_alert_notify: document.getElementById('nws-alert-notify').value,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Thresholds saved. Poll interval updated.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
