import { apiGet, apiPut, apiPost } from '../../api.js';

const INP = 'background:#1a1f2e;color:#e0e0e0;border-color:#2a2a4a';

const DEFAULTS = {
  name: 'My FlexRadio',
  ip: '',
  enabled: false,
  ping_enabled: true,
  ping_interval_sec: 30,
  dax_enabled: true,
  dax_channel: 1,
  freq_step_small_khz: 50.0,
  freq_step_large_khz: 100.0,
  tx_button_label: 'MOX',
  notify_smtp: false,
  notify_ntfy: false,
  notify_telegram: false,
  notify_ifttt: false,
  notify_consecutive_failures: 3,
  notify_cooldown_min: 30,
};

function _setIndicator(el, success, rtt_ms, customText) {
  if (!el) return;
  if (customText !== undefined) {
    el.style.color = '#adb5bd';
    el.textContent = customText;
    return;
  }
  if (success === true) {
    el.style.color = '#28a745';
    el.textContent = rtt_ms !== null ? `● Success — ${rtt_ms} ms` : '● Success';
  } else if (success === false) {
    el.style.color = '#dc3545';
    el.textContent = '● Failed — host unreachable';
  } else {
    el.textContent = '';
  }
}

function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function radioCardHtml(radio, index) {
  const r = { ...DEFAULTS, ...radio };
  const daxEnabled  = r.dax_enabled;
  const headerId    = `flex-heading-${index}`;
  const collapseId  = `flex-collapse-${index}`;
  const isPrimary   = r.enabled;
  const pingEnabled = r.ping_enabled !== false;

  const pingBadgeCls = pingEnabled ? 'badge bg-info ms-2' : 'badge bg-secondary ms-2';
  const pingBadgeTxt = pingEnabled ? 'Ping On' : 'Ping Off';

  return `
    <div class="accordion-item bg-transparent border border-secondary mb-2 rounded"
      data-radio-index="${index}" data-primary="${isPrimary}">
      <div class="d-flex align-items-center" id="${headerId}">
        <button class="accordion-button collapsed flex-grow-1 d-flex align-items-center gap-2"
          type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}"
          style="background:#1a1f2e;color:#e0e0e0;border:none;border-radius:6px 0 0 6px;min-width:0">
          <i class="bi bi-broadcast-pin text-info flex-shrink-0"></i>
          <span class="flex-radio-title fw-semibold text-truncate">${_esc(r.name || 'Unnamed Radio')}</span>
          <span class="text-muted small text-truncate">${_esc(r.ip || 'no IP set')}</span>
          <span class="${pingBadgeCls} flex-shrink-0">${pingBadgeTxt}</span>
        </button>
        <div class="d-flex align-items-center px-3 flex-shrink-0 border-start border-secondary"
          style="height:100%">
          <div class="form-check form-switch mb-0">
            <input class="form-check-input flex-primary-input" type="checkbox" role="switch"
              id="flex-primary-${index}" data-primary-index="${index}" ${isPrimary ? 'checked' : ''}>
            <label class="form-check-label${isPrimary ? ' fw-bold' : ''}"
              id="flex-primary-label-${index}" for="flex-primary-${index}"
              style="white-space:nowrap;color:#e0e0e0">Primary Radio</label>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger flex-delete-btn flex-shrink-0 me-2"
          data-index="${index}" title="Delete radio" style="border-radius:0 6px 6px 0">
          <i class="bi bi-trash"></i>
        </button>
      </div>
      <div id="${collapseId}" class="accordion-collapse collapse">
        <div class="accordion-body" style="background:#12172a">

          <div class="mb-3">
            <label class="form-label">Radio Name</label>
            <input type="text" class="form-control flex-field" data-field="name"
              placeholder="My FlexRadio" value="${_esc(r.name)}" style="${INP}">
            <div class="form-text">A friendly name to identify this radio.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Radio IP Address</label>
            <input type="text" class="form-control flex-field" data-field="ip"
              placeholder="192.168.1.x" value="${_esc(r.ip)}" style="${INP}">
            <div class="form-text">Local IP address of your FlexRadio. Leave blank to disable.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Radio Ping Interval (seconds)</label>
            <div class="d-flex align-items-center gap-3">
              <input type="number" class="form-control flex-field" data-field="ping_interval_sec"
                min="5" step="1" value="${r.ping_interval_sec}" style="${INP};width:8rem">
              <span class="flex-ping-indicator small"></span>
            </div>
            <div class="form-text">How often to ping the radio IP to check network reachability. Minimum 5 seconds.</div>
            <div class="mt-2">
              <button type="button" class="btn btn-sm btn-outline-secondary flex-ping-btn" data-index="${index}">
                Ping test
              </button>
            </div>
          </div>

          <div class="mb-3 form-check form-switch">
            <input class="form-check-input flex-field" type="checkbox" data-field="ping_enabled"
              id="flex-ping-enabled-${index}" ${pingEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-ping-enabled-${index}">Enable ping connectivity test</label>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-2">FlexRadio Down Notification</h6>
          <p class="form-text mb-3">Send a notification after consecutive ping failures indicate the radio is unreachable.</p>

          <div class="mb-3">
            <label class="form-label small mb-2">Notify via</label>
            <div class="d-flex flex-wrap gap-3">
              <div class="form-check">
                <input class="form-check-input flex-field" type="checkbox" data-field="notify_smtp"
                  id="flex-notify-smtp-${index}" ${r.notify_smtp ? 'checked' : ''}>
                <label class="form-check-label" for="flex-notify-smtp-${index}">Email (SMTP)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input flex-field" type="checkbox" data-field="notify_ntfy"
                  id="flex-notify-ntfy-${index}" ${r.notify_ntfy ? 'checked' : ''}>
                <label class="form-check-label" for="flex-notify-ntfy-${index}">ntfy</label>
              </div>
              <div class="form-check">
                <input class="form-check-input flex-field" type="checkbox" data-field="notify_telegram"
                  id="flex-notify-telegram-${index}" ${r.notify_telegram ? 'checked' : ''}>
                <label class="form-check-label" for="flex-notify-telegram-${index}">Telegram</label>
              </div>
              <div class="form-check">
                <input class="form-check-input flex-field" type="checkbox" data-field="notify_ifttt"
                  id="flex-notify-ifttt-${index}" ${r.notify_ifttt ? 'checked' : ''}>
                <label class="form-check-label" for="flex-notify-ifttt-${index}">IFTTT</label>
              </div>
            </div>
          </div>

          <div class="row mb-4">
            <div class="col-auto">
              <label class="form-label">Failed pings before alerting</label>
              <input type="number" class="form-control flex-field" data-field="notify_consecutive_failures"
                min="1" step="1" value="${r.notify_consecutive_failures}" style="${INP};width:6rem">
              <div class="form-text">Consecutive failures before sending a notification.</div>
            </div>
            <div class="col-auto">
              <label class="form-label">Notification cooldown (minutes)</label>
              <input type="number" class="form-control flex-field" data-field="notify_cooldown_min"
                min="1" step="1" value="${r.notify_cooldown_min}" style="${INP};width:6rem">
              <div class="form-text">Pause pings for this long after an outage is detected.</div>
            </div>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">DAX Audio</h6>

          <div class="mb-3 form-check form-switch">
            <input class="form-check-input flex-field" type="checkbox" data-field="dax_enabled"
              id="flex-dax-enabled-${index}" ${daxEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="flex-dax-enabled-${index}">Enable DAX RX audio stream</label>
          </div>

          <div class="mb-4 flex-dax-options" style="${daxEnabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <label class="form-label">DAX Channel</label>
            <select class="form-select flex-field" data-field="dax_channel" style="${INP}">
              ${[1,2,3,4,5,6,7,8].map(n =>
                `<option value="${n}"${r.dax_channel === n ? ' selected' : ''}>${n}</option>`
              ).join('')}
            </select>
            <div class="form-text">DAX RX channel assigned to the primary slice in SmartSDR.</div>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">Transmit Button</h6>

          <div class="mb-4">
            <label class="form-label">Transmit Button Name</label>
            <input type="text" class="form-control flex-field" data-field="tx_button_label"
              maxlength="4" placeholder="MOX" value="${_esc(r.tx_button_label)}"
              style="${INP};width:6rem;text-transform:uppercase">
            <div class="form-text">Label shown on the TX toggle button in the status bar (up to 4 characters). Common choices: MOX, PTT, TX.</div>
          </div>

          <hr style="border-color:#2a2a4a">
          <h6 class="text-white-50 mb-3">Frequency Step Sizes</h6>

          <div class="row mb-4">
            <div class="col">
              <label class="form-label">Small Step (kHz)</label>
              <input type="number" class="form-control flex-field" data-field="freq_step_small_khz"
                min="0.001" step="0.001" value="${r.freq_step_small_khz}" style="${INP}">
              <div class="form-text">Step size for &lt; / &gt; buttons and , / . keys.</div>
            </div>
            <div class="col">
              <label class="form-label">Large Step (kHz)</label>
              <input type="number" class="form-control flex-field" data-field="freq_step_large_khz"
                min="0.001" step="0.001" value="${r.freq_step_large_khz}" style="${INP}">
              <div class="form-text">Step size for &lt;&lt; / &gt;&gt; buttons and &lt; / &gt; keys.</div>
            </div>
          </div>

          <div class="d-flex gap-2">
            <button type="button" class="btn btn-primary btn-sm flex-save-btn" data-index="${index}">Save</button>
            <button type="button" class="btn btn-outline-secondary btn-sm flex-cancel-btn" data-index="${index}">Cancel</button>
          </div>

        </div>
      </div>
    </div>
  `;
}

function collectRadios(accordion) {
  const cards = accordion.querySelectorAll('[data-radio-index]');
  return Array.from(cards).map(card => {
    const get = (field) => {
      const el = card.querySelector(`[data-field="${field}"]`);
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number') return parseFloat(el.value) || 0;
      return el.value.trim();
    };
    const txLabel = get('tx_button_label') || '';
    return {
      name:                          get('name') || 'My FlexRadio',
      ip:                            get('ip') ?? '',
      enabled:                       card.dataset.primary === 'true',
      ping_enabled:                  get('ping_enabled') ?? true,
      ping_interval_sec:             Math.max(5, parseInt(get('ping_interval_sec'), 10) || 30),
      dax_enabled:                   get('dax_enabled') ?? true,
      dax_channel:                   parseInt(get('dax_channel'), 10) || 1,
      tx_button_label:               (txLabel.toUpperCase() || 'MOX').slice(0, 4),
      freq_step_small_khz:           parseFloat(get('freq_step_small_khz')) || 50.0,
      freq_step_large_khz:           parseFloat(get('freq_step_large_khz')) || 100.0,
      notify_smtp:                   get('notify_smtp') ?? false,
      notify_ntfy:                   get('notify_ntfy') ?? false,
      notify_telegram:               get('notify_telegram') ?? false,
      notify_ifttt:                  get('notify_ifttt') ?? false,
      notify_consecutive_failures:   Math.max(1, parseInt(get('notify_consecutive_failures'), 10) || 3),
      notify_cooldown_min:           Math.max(1, parseInt(get('notify_cooldown_min'), 10) || 30),
    };
  });
}

export async function renderFlexRadioTab(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';

  let data;
  try {
    data = await apiGet('/settings/flexradio');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load FlexRadio settings: ${_esc(err.message)}</div>`;
    return;
  }

  let radios = Array.isArray(data?.radios) ? data.radios : [];
  let savedRadios = JSON.parse(JSON.stringify(radios));

  function render() {
    container.innerHTML = `
      <div class="card">
        <div class="card-header d-flex align-items-center justify-content-between">
          <span><i class="bi bi-broadcast-pin me-2"></i>FlexRadio</span>
          <button type="button" class="btn btn-sm btn-outline-info" id="flex-add-btn">
            <i class="bi bi-plus-lg me-1"></i>Add Radio
          </button>
        </div>
        <div class="card-body">
          <div id="flex-msg" class="alert" style="display:none"></div>
          ${radios.length === 0
            ? '<p class="text-muted">No radios configured. Click <strong>Add Radio</strong> to get started.</p>'
            : ''
          }
          <div class="accordion" id="flex-accordion">
            ${radios.map((r, i) => radioCardHtml(r, i)).join('')}
          </div>
        </div>
      </div>
    `;

    document.getElementById('flex-add-btn').addEventListener('click', () => {
      radios.push({ ...DEFAULTS });
      render();
      const lastCollapse = document.getElementById(`flex-collapse-${radios.length - 1}`);
      if (lastCollapse) lastCollapse.classList.add('show');
    });

    document.getElementById('flex-accordion').addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.flex-delete-btn');
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.index, 10);
        radios.splice(idx, 1);
        render();
        return;
      }

      const saveBtn = e.target.closest('.flex-save-btn');
      if (saveBtn) {
        const acc = document.getElementById('flex-accordion');
        const collected = collectRadios(acc);
        const msg = document.getElementById('flex-msg');
        try {
          await apiPut('/settings/flexradio', { radios: collected });
          radios = collected;
          savedRadios = JSON.parse(JSON.stringify(collected));
          msg.className = 'alert alert-success';
          msg.textContent = 'FlexRadio settings saved.';
          msg.style.display = '';
        } catch (err) {
          msg.className = 'alert alert-danger';
          msg.textContent = err.message;
          msg.style.display = '';
        }
        return;
      }

      const cancelBtn = e.target.closest('.flex-cancel-btn');
      if (cancelBtn) {
        radios = JSON.parse(JSON.stringify(savedRadios));
        render();
        return;
      }

      const pingBtn = e.target.closest('.flex-ping-btn');
      if (pingBtn) {
        const card = pingBtn.closest('[data-radio-index]');
        const ip = card.querySelector('[data-field="ip"]')?.value.trim();
        const indicator = card.querySelector('.flex-ping-indicator');
        if (!ip) {
          _setIndicator(indicator, null, null, 'No IP address set');
          return;
        }
        pingBtn.disabled = true;
        _setIndicator(indicator, null, null, 'Pinging…');
        try {
          const res = await apiPost('/settings/flexradio/ping', { ip });
          _setIndicator(indicator, res.success, res.rtt_ms);
        } catch (err) {
          _setIndicator(indicator, false, null, `Error: ${err.message}`);
        } finally {
          pingBtn.disabled = false;
        }
      }
    });

    // Load background ping status when a card is expanded
    document.getElementById('flex-accordion').addEventListener('show.bs.collapse', async (e) => {
      const card = e.target.closest('[data-radio-index]');
      if (!card) return;
      const indicator = card.querySelector('.flex-ping-indicator');
      if (!indicator || indicator.textContent) return;
      try {
        const status = await apiGet('/flexradio/status');
        if (status.ping_online !== null && status.ping_online !== undefined) {
          _setIndicator(indicator, status.ping_online, status.ping_rtt_ms ?? null);
        }
      } catch { /* radio may not be connected yet */ }
    });

    document.getElementById('flex-accordion').addEventListener('change', (e) => {
      if (e.target.classList.contains('flex-primary-input')) {
        const idx = parseInt(e.target.dataset.primaryIndex, 10);
        radios.forEach((r, i) => { r.enabled = (i === idx); });
        document.querySelectorAll('.flex-primary-input').forEach(input => {
          const i = parseInt(input.dataset.primaryIndex, 10);
          const active = i === idx;
          input.checked = active;
          const lbl = document.getElementById(`flex-primary-label-${i}`);
          if (lbl) lbl.className = `form-check-label${active ? ' fw-bold' : ''}`;
          const card = input.closest('[data-radio-index]');
          if (card) card.dataset.primary = String(active);
        });
        return;
      }
      if (e.target.dataset.field === 'dax_enabled') {
        const card = e.target.closest('[data-radio-index]');
        const opts = card?.querySelector('.flex-dax-options');
        if (opts) opts.style.cssText = e.target.checked ? '' : 'opacity:0.5;pointer-events:none';
      }
    });

  }

  render();
}
