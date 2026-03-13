import { renderLocationTab } from '../components/settings/location.js';
import { renderApiKeysTab } from '../components/settings/api-keys.js';
import { renderThresholdsTab } from '../components/settings/thresholds.js';
import { renderKasaTab } from '../components/settings/kasa.js';
import { renderWorkflowsTab } from '../components/settings/workflows.js';
import { renderSmtpTab } from '../components/settings/smtp.js';
import { renderNotificationsTab } from '../components/settings/notifications.js';
import { renderIftttTab } from '../components/settings/ifttt.js';
import { renderTelegramTab } from '../components/settings/telegram.js';
import { renderHomeAssistantTab } from '../components/settings/home-assistant.js';
import { renderAccountTab } from '../components/settings/account.js';

const TABS = [
  { id: 'location', label: 'Location', icon: 'geo-alt' },
  { id: 'api-keys', label: 'API Keys', icon: 'key' },
  { id: 'thresholds', label: 'Thresholds', icon: 'sliders' },
  { id: 'kasa', label: 'Kasa Devices', icon: 'plug' },
  { id: 'workflows', label: 'Workflows', icon: 'diagram-3' },
  { id: 'smtp', label: 'SMTP / Email', icon: 'envelope' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'ifttt', label: 'IFTTT', icon: 'arrow-left-right' },
  { id: 'telegram', label: 'Telegram', icon: 'telegram' },
  { id: 'home-assistant', label: 'Home Assistant', icon: 'house-gear' },
  { id: 'account', label: 'Account', icon: 'person' },
];

const RENDERERS = {
  location: renderLocationTab,
  'api-keys': renderApiKeysTab,
  thresholds: renderThresholdsTab,
  kasa: renderKasaTab,
  workflows: renderWorkflowsTab,
  smtp: renderSmtpTab,
  notifications: renderNotificationsTab,
  ifttt: renderIftttTab,
  telegram: renderTelegramTab,
  'home-assistant': renderHomeAssistantTab,
  account: renderAccountTab,
};

export function renderSettings(container) {
  const activeTab = window.location.hash.split('/')[2] || 'location';

  container.innerHTML = `
    <div class="row g-0">
      <div class="col-md-2">
        <div class="card h-100">
          <div class="card-header"><small>Settings</small></div>
          <div class="list-group list-group-flush" id="settings-nav">
            ${TABS.map(t => `
              <a href="#/settings/${t.id}" class="list-group-item list-group-item-action d-flex align-items-center gap-2 ${t.id === activeTab ? 'active' : ''}" style="background:var(--card-bg);color:#e0e0e0;border-color:#2a2a4a" data-tab="${t.id}">
                <i class="bi bi-${t.icon}"></i> <small>${t.label}</small>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="col-md-10 ps-3">
        <div id="settings-content"></div>
      </div>
    </div>
  `;

  const renderTab = (tabId) => {
    const content = document.getElementById('settings-content');
    if (!content) return;
    content.innerHTML = '';
    const fn = RENDERERS[tabId] || RENDERERS.location;
    fn(content);
  };

  renderTab(activeTab);

  // Tab navigation
  document.getElementById('settings-nav').addEventListener('click', (e) => {
    const link = e.target.closest('[data-tab]');
    if (!link) return;
    document.querySelectorAll('#settings-nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    renderTab(link.dataset.tab);
  });
}
