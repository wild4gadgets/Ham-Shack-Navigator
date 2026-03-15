import { navigate } from './router.js';
import { clearToken, getToken } from './state.js';

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  window.location.hash = '#/login';
});

// Hash routing
window.addEventListener('hashchange', () => navigate());
window.addEventListener('load', () => navigate());

// Initial navigation
navigate();

// ── 7-segment LED clocks ─────────────────────────────────────────────────────

const SEG_MAP = {
  '0':[1,1,1,1,1,1,0], '1':[0,1,1,0,0,0,0], '2':[1,1,0,1,1,0,1],
  '3':[1,1,1,1,0,0,1], '4':[0,1,1,0,0,1,1], '5':[1,0,1,1,0,1,1],
  '6':[1,0,1,1,1,1,1], '7':[1,1,1,0,0,0,0], '8':[1,1,1,1,1,1,1],
  '9':[1,1,1,1,0,1,1],
};

function segDigit(ch) {
  const s = SEG_MAP[ch] || [0,0,0,0,0,0,0];
  // segments: a, b, c, d, e, f, g
  return `<div class="seg-digit">
    <span class="seg seg-a${s[0]?' on':''}"></span>
    <span class="seg seg-b${s[1]?' on':''}"></span>
    <span class="seg seg-c${s[2]?' on':''}"></span>
    <span class="seg seg-d${s[3]?' on':''}"></span>
    <span class="seg seg-e${s[4]?' on':''}"></span>
    <span class="seg seg-f${s[5]?' on':''}"></span>
    <span class="seg seg-g${s[6]?' on':''}"></span>
  </div>`;
}

function renderSegTime(h, m) {
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const colon = `<div class="seg-colon"><span class="seg-dot"></span><span class="seg-dot"></span></div>`;
  return segDigit(hh[0]) + segDigit(hh[1]) + colon + segDigit(mm[0]) + segDigit(mm[1]);
}

function updateClocks() {
  const now = new Date();
  const local = document.getElementById('clock-local-display');
  const utc   = document.getElementById('clock-utc-display');
  if (local) local.innerHTML = renderSegTime(now.getHours(), now.getMinutes());
  if (utc)   utc.innerHTML   = renderSegTime(now.getUTCHours(), now.getUTCMinutes());
}

updateClocks();
setInterval(updateClocks, 1000);
