import { renderLocationTab } from '../components/settings/location.js';
import { renderApiKeysTab } from '../components/settings/api-keys.js';
import { renderThresholdsTab } from '../components/settings/thresholds.js';
import { renderKasaTab } from '../components/settings/kasa.js';
import { renderShellyTab } from '../components/settings/shelly.js';
import { renderWorkflowsTab } from '../components/settings/workflows.js';
import { renderSmtpTab } from '../components/settings/smtp.js';
import { renderNotificationsTab } from '../components/settings/notifications.js';
import { renderIftttTab } from '../components/settings/ifttt.js';
import { renderTelegramTab } from '../components/settings/telegram.js';
import { renderHomeAssistantTab } from '../components/settings/home-assistant.js';
import { renderAccountTab } from '../components/settings/account.js';
import { renderDxclusterTab } from '../components/settings/dxcluster.js';
import { renderPskReporterTab } from '../components/settings/pskreporter.js';
import { isAdmin } from '../state.js';

// Full NAV — admin sees all, readonly sees only notifications + account
const ADMIN_NAV = [
  { id: 'location',  label: 'Station Info', icon: 'geo-alt' },
  { id: 'api-keys',  label: 'API Keys', icon: 'key' },
  { id: 'thresholds', label: 'Thresholds', icon: 'sliders' },
  { id: 'dxcluster',    label: 'DX Cluster',    icon: 'reception-4'   },
  { id: 'pskreporter', label: 'PSK Reporter',  icon: 'broadcast-pin' },
  {
    groupId: 'controls', label: 'Controls', icon: 'toggles',
    children: [
      { id: 'kasa',           label: 'Kasa Devices',   icon: 'plug' },
      { id: 'shelly',         label: 'Shelly Devices', icon: 'toggles' },
      { id: 'home-assistant', label: 'Home Assistant', icon: 'house-gear' },
      { id: 'ifttt',          label: 'IFTTT',          icon: 'arrow-left-right' },
    ],
  },
  { id: 'workflows', label: 'Workflows', icon: 'diagram-3' },
  {
    groupId: 'notifications', label: 'Notifications', icon: 'bell',
    children: [
      { id: 'smtp',          label: 'SMTP / Email', icon: 'envelope' },
      { id: 'telegram',      label: 'Telegram',     icon: 'telegram' },
      { id: 'notifications', label: 'Toggles',      icon: 'toggles' },
    ],
  },
  { id: 'account', label: 'Account', icon: 'person' },
];

const READONLY_NAV = [
  {
    groupId: 'notifications', label: 'Notifications', icon: 'bell',
    children: [
      { id: 'notifications', label: 'Toggles', icon: 'toggles' },
    ],
  },
  { id: 'account', label: 'Account', icon: 'person' },
];

const RENDERERS = {
  location:         renderLocationTab,
  'api-keys':       renderApiKeysTab,
  thresholds:       renderThresholdsTab,
  kasa:             renderKasaTab,
  shelly:           renderShellyTab,
  workflows:        renderWorkflowsTab,
  smtp:             renderSmtpTab,
  notifications:    renderNotificationsTab,
  ifttt:            renderIftttTab,
  telegram:         renderTelegramTab,
  'home-assistant': renderHomeAssistantTab,
  dxcluster:        renderDxclusterTab,
  pskreporter:      renderPskReporterTab,
  account:          renderAccountTab,
};

const ITEM_STYLE = 'background:var(--card-bg);color:#e0e0e0;border-color:#2a2a4a';
const GROUP_STYLE = 'background:#12122a;color:#94a3b8;border-color:#2a2a4a;cursor:pointer;user-select:none';

function renderNavItem(entry, activeTab) {
  if (entry.groupId) {
    const hasActive = entry.children.some(c => c.id === activeTab);
    const collapseId = `grp-${entry.groupId}`;
    const children = entry.children.map(c => `
      <a href="#/settings/${c.id}"
         class="list-group-item list-group-item-action d-flex align-items-center gap-2 ps-4 ${c.id === activeTab ? 'active' : ''}"
         style="${ITEM_STYLE}" data-tab="${c.id}">
        <i class="bi bi-${c.icon}" style="font-size:0.85rem"></i>
        <small>${c.label}</small>
      </a>`).join('');

    return `
      <a class="list-group-item d-flex align-items-center gap-2 fw-semibold"
         style="${GROUP_STYLE};font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em"
         data-bs-toggle="collapse" data-bs-target="#${collapseId}"
         aria-expanded="true" href="#">
        <i class="bi bi-${entry.icon}" style="font-size:0.85rem"></i>
        <small>${entry.label}</small>
        <i class="bi bi-chevron-down ms-auto grp-chevron" style="font-size:0.6rem;transition:transform 0.2s"></i>
      </a>
      <div class="collapse show" id="${collapseId}">
        ${children}
      </div>`;
  }

  return `
    <a href="#/settings/${entry.id}"
       class="list-group-item list-group-item-action d-flex align-items-center gap-2 ${entry.id === activeTab ? 'active' : ''}"
       style="${ITEM_STYLE}" data-tab="${entry.id}">
      <i class="bi bi-${entry.icon}" style="font-size:0.85rem"></i>
      <small>${entry.label}</small>
    </a>`;
}

export function renderSettings(container) {
  const NAV = isAdmin() ? ADMIN_NAV : READONLY_NAV;

  // For read-only users, ensure they can only access allowed tabs
  const allowedTabs = new Set();
  NAV.forEach(entry => {
    if (entry.groupId) entry.children.forEach(c => allowedTabs.add(c.id));
    else allowedTabs.add(entry.id);
  });

  let activeTab = window.location.hash.split('/')[2] || (isAdmin() ? 'location' : 'notifications');
  if (!allowedTabs.has(activeTab)) activeTab = isAdmin() ? 'location' : 'notifications';

  container.innerHTML = `
    <div class="row g-0">
      <div class="col-md-2">
        <div class="card h-100">
          <div class="card-header"><small>Settings</small></div>
          <div class="list-group list-group-flush" id="settings-nav">
            ${NAV.map(entry => renderNavItem(entry, activeTab)).join('')}
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
    const defaultTab = isAdmin() ? 'location' : 'notifications';
    const fn = RENDERERS[tabId] || RENDERERS[defaultTab];
    fn(content);
  };

  renderTab(activeTab);

  // Tab clicks (only items with data-tab, not group headers)
  document.getElementById('settings-nav').addEventListener('click', (e) => {
    const link = e.target.closest('[data-tab]');
    if (!link) return;
    document.querySelectorAll('#settings-nav [data-tab]').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    renderTab(link.dataset.tab);
  });

  // Chevron rotation on collapse toggle
  document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(toggle => {
    const target = document.querySelector(toggle.dataset.bsTarget);
    if (!target) return;
    target.addEventListener('hide.bs.collapse', () => {
      toggle.querySelector('.grp-chevron').style.transform = 'rotate(-90deg)';
    });
    target.addEventListener('show.bs.collapse', () => {
      toggle.querySelector('.grp-chevron').style.transform = '';
    });
  });
}
