import { apiGet, apiPut, apiPost } from '../../api.js';

function _notifEventsHtml(n) {
  const chk = (id, val, label, hint) => `
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" id="${id}" ${val !== false ? 'checked' : ''}>
      <label class="form-check-label" for="${id}">
        <strong>${label}</strong>
        <div class="form-text">${hint}</div>
      </label>
    </div>`;
  return `
    <hr style="border-color:#2a2a4a">
    <h6 class="text-white-50 mb-2">Notification Events</h6>
    <p class="form-text mb-3">Choose which events are sent via Telegram.</p>
    ${chk('tg-evt-shutdown',       n.shutdown_telegram,       'Equipment shutdown',       'Send message when weather protection shuts down equipment.')}
    ${chk('tg-evt-threshold',      n.threshold_telegram,      'Weather threshold alert',  'Send message when lightning or wind exceeds configured thresholds.')}
    ${chk('tg-evt-flexradio-down', n.flexradio_down_telegram, 'FlexRadio down',           'Send message when a FlexRadio fails ping checks (also requires per-radio notification to be enabled).')}
  `;
}

export async function renderTelegramTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';
  let data, notif;
  try {
    [data, notif] = await Promise.all([
      apiGet('/settings/telegram'),
      apiGet('/settings/notifications'),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load Telegram settings: ${err.message}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-telegram me-2"></i>Telegram Bot</div>
      <div class="card-body">
        <div id="tg-msg" class="alert" style="display:none"></div>

        <div class="mb-4 p-3 rounded" style="font-size:0.875rem;background:#0f3460;border:1px solid #1a4a80;color:#e0e0e0">
          <strong>Setup:</strong>
          <ol class="mb-0 mt-1">
            <li>Message <strong>@BotFather</strong> on Telegram and use <code>/newbot</code> to create a bot. Copy the API token it gives you.</li>
            <li>Send any message to your new bot (this is required before you can get the chat ID).</li>
            <li>Visit <code>https://api.telegram.org/bot&lt;YOUR_TOKEN&gt;/getUpdates</code> in your browser and find <code>chat.id</code> in the response.</li>
          </ol>
        </div>

        <form id="tg-form">
          <div class="mb-3">
            <label class="form-label">Bot Token</label>
            <input type="password" class="form-control" id="tg-token" value="${data.bot_token || ''}" placeholder="123456789:ABCdefGhIjklMnopQrsTUVwxyz" />
          </div>
          <div class="mb-3">
            <label class="form-label">Chat ID</label>
            <input type="text" class="form-control" id="tg-chat-id" value="${data.chat_id || ''}" placeholder="e.g. -100123456789 or 123456789" />
            <div class="form-text">Use a negative number for group chats, positive for direct messages.</div>
          </div>
          <div class="mb-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="tg-enabled" ${data.enabled ? 'checked' : ''} />
              <label class="form-check-label" for="tg-enabled">Enable Telegram notifications</label>
            </div>
          </div>

          ${_notifEventsHtml(notif || {})}

          <div class="d-flex gap-2 mt-3">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline-info" id="btn-test-tg">Send Test Message</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('tg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('tg-msg');
    try {
      await apiPut('/settings/telegram', {
        bot_token: document.getElementById('tg-token').value || null,
        chat_id: document.getElementById('tg-chat-id').value || null,
        enabled: document.getElementById('tg-enabled').checked,
      });
      await apiPut('/settings/notifications', {
        ...(notif || {}),
        shutdown_telegram:       document.getElementById('tg-evt-shutdown').checked,
        threshold_telegram:      document.getElementById('tg-evt-threshold').checked,
        flexradio_down_telegram: document.getElementById('tg-evt-flexradio-down').checked,
      });
      msg.className = 'alert alert-success';
      msg.textContent = 'Telegram settings saved.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });

  document.getElementById('btn-test-tg').addEventListener('click', async () => {
    const msg = document.getElementById('tg-msg');
    msg.className = 'alert alert-info';
    msg.textContent = 'Sending test message...';
    msg.style.display = '';
    try {
      await apiPost('/settings/telegram/test', {});
      msg.className = 'alert alert-success';
      msg.textContent = 'Test message sent!';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = `Test failed: ${err.message}`;
    }
  });
}
