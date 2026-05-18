export function renderHelp(container) {
  container.innerHTML = `
<div class="help-page" style="max-width:900px;margin:0 auto;color:#e0e0e0;padding-bottom:60px">

  <!-- Title -->
  <div class="text-center mb-5 mt-2">
    <h1 style="color:#7eb8f7;font-size:2rem"><i class="bi bi-broadcast-pin me-2"></i>Ham Shack Navigator</h1>
    <div style="color:#94a3b8;font-size:1.05rem">User Manual</div>
    <hr style="border-color:#2a2a4a;margin-top:1.5rem"/>
  </div>

  <!-- TOC -->
  <div class="card mb-5" style="background:#12122a;border-color:#2a2a4a">
    <div class="card-header" style="background:#1a1a3e;color:#7eb8f7"><i class="bi bi-list-ul me-2"></i>Table of Contents</div>
    <div class="card-body" style="columns:2;column-gap:2rem;font-size:0.9rem">
      <div><a href="#h-intro" class="help-toc-link">1. Introduction</a></div>
      <div><a href="#h-requirements" class="help-toc-link">2. System Requirements</a></div>
      <div><a href="#h-install" class="help-toc-link">3. Installation</a></div>
      <div><a href="#h-firstrun" class="help-toc-link">4. Initial Setup</a></div>
      <div><a href="#h-dashboard" class="help-toc-link">5. The Dashboard</a></div>
      <div><a href="#h-equipment" class="help-toc-link">6. Equipment Control</a></div>
      <div><a href="#h-workflows" class="help-toc-link">7. Workflows &amp; Automation</a></div>
      <div><a href="#h-monitoring" class="help-toc-link">8. Weather Monitoring &amp; Protection</a></div>
      <div><a href="#h-notifications" class="help-toc-link">9. Notifications</a></div>
      <div><a href="#h-integrations" class="help-toc-link">10. Integrations</a></div>
      <div><a href="#h-settings" class="help-toc-link">11. Settings Reference</a></div>
      <div><a href="#h-users" class="help-toc-link">12. User Management</a></div>
      <div><a href="#h-events" class="help-toc-link">13. Events Log</a></div>
      <div><a href="#h-webhook" class="help-toc-link">14. Remote Webhook API</a></div>
      <div><a href="#h-maintenance" class="help-toc-link">15. Maintenance</a></div>
      <div><a href="#h-troubleshooting" class="help-toc-link">16. Troubleshooting</a></div>
    </div>
  </div>

  <!-- 1. Introduction -->
  <h2 id="h-intro" class="help-section-title">1. Introduction</h2>
  <p>Ham Shack Navigator is a self-hosted web dashboard for amateur radio operators. It runs on a Raspberry Pi (or any Linux server) and provides a real-time, at-a-glance view of everything happening in and around the shack — weather conditions, propagation data, station equipment, and DX activity — all in one screen.</p>
  <p>The backend is a <strong>FastAPI</strong> (Python) application with a SQLite database. The frontend is plain HTML/CSS/JavaScript served over HTTPS. Everything runs in Docker containers, making setup and maintenance straightforward on any platform.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Key Features</h4>
  <ul>
    <li><strong>Weather monitoring</strong> with automatic station shutdown when thresholds are exceeded (wind, lightning)</li>
    <li><strong>Station equipment control</strong> via TP-Link Kasa smart plugs, Shelly relays, and Home Assistant</li>
    <li><strong>Workflow automation</strong> — build step-by-step power sequences, schedule them, or trigger remotely</li>
    <li><strong>Solar &amp; propagation data</strong> — SFI, A-index, K-index, sunspot count, MUF</li>
    <li><strong>DX Cluster band activity</strong> heatmap by region</li>
    <li><strong>PSK Reporter spot map</strong> with greyline overlay and band-colored markers</li>
    <li><strong>FlexRadio 6400 integration</strong> — real-time frequency, mode, power, and SWR display with click-to-tune and click-to-change-mode controls, frequency step buttons, and keyboard shortcuts</li>
    <li><strong>CW decoder</strong> — live Morse decoding from the FlexRadio DAX audio stream, with WPM and SNR display</li>
    <li><strong>Draggable dashboard tiles</strong> — rearrange the layout to suit your workflow</li>
    <li><strong>Notifications</strong> via email, Telegram, IFTTT, and ntfy push notifications</li>
    <li><strong>Multi-user</strong> with Admin and Read-Only roles</li>
    <li><strong>Remote webhook API</strong> for Stream Deck and mobile app integration</li>
  </ul>

  <!-- 2. Requirements -->
  <h2 id="h-requirements" class="help-section-title">2. System Requirements</h2>
  <h4 style="color:#7eb8f7">Hardware</h4>
  <ul>
    <li>Raspberry Pi 4 (recommended) or any 64-bit Linux server with at least 1 GB RAM</li>
    <li>Windows or macOS computers are also supported via Docker Desktop</li>
  </ul>
  <h4 style="color:#7eb8f7">Software</h4>
  <ul>
    <li><a href="https://www.docker.com/products/docker-desktop/" target="_blank" style="color:#7eb8f7">Docker Desktop</a> (Windows, macOS) or Docker Engine + Docker Compose (Linux)</li>
    <li>A modern web browser (Chrome, Firefox, or Edge recommended)</li>
  </ul>
  <h4 style="color:#7eb8f7">Required API Keys (free tier works for both)</h4>
  <ul>
    <li><a href="https://openweathermap.org/api" target="_blank" style="color:#7eb8f7">OpenWeatherMap</a> — One Call API 2.5 (free)</li>
    <li><a href="https://www.tomorrow.io/" target="_blank" style="color:#7eb8f7">Tomorrow.io</a> — free tier (500 requests/day)</li>
  </ul>
  <h4 style="color:#7eb8f7">Optional</h4>
  <ul>
    <li>QRZ.com XML subscription (for callsign lookups from the PSK Reporter map)</li>
    <li>Telegram Bot token (for mobile notifications)</li>
    <li>ntfy topic — free push notifications via <a href="https://ntfy.sh" target="_blank" style="color:#7eb8f7">ntfy.sh</a> or a self-hosted server</li>
    <li>SMTP server access (for email notifications)</li>
    <li>IFTTT account (for webhook integrations)</li>
    <li>TP-Link Kasa smart plugs/strips on your local network</li>
    <li>Shelly smart relays (Gen 1 or Gen 2) on your local network</li>
    <li>FlexRadio 6000/6400 series on your local network (SmartSDR required for DAX audio)</li>
    <li>Home Assistant instance</li>
  </ul>

  <!-- 3. Installation -->
  <h2 id="h-install" class="help-section-title">3. Installation</h2>

  <h4 style="color:#7eb8f7">Getting the Code</h4>
  <p>If you have collaborator access to the repository:</p>
  <pre class="help-code">git clone https://github.com/wild4gadgets/Ham-Shack-Navigator.git
cd Ham-Shack-Navigator</pre>
  <p>If you received a ZIP archive, extract it and open a terminal in the extracted folder.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Windows</h4>
  <ol>
    <li>Install <a href="https://www.docker.com/products/docker-desktop/" target="_blank" style="color:#7eb8f7">Docker Desktop for Windows</a>. During installation, enable the WSL 2 backend when prompted.</li>
    <li>Open PowerShell or Windows Terminal in the project folder.</li>
    <li>Create your <code>.env</code> file:
      <pre class="help-code">Copy-Item .env.example .env</pre>
    </li>
    <li>Open <code>.env</code> in a text editor and replace the placeholder with a random secret:
      <pre class="help-code"># Run this in PowerShell to generate the secret:
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })</pre>
      Paste the output as the value of <code>JWT_SECRET</code> in <code>.env</code>.
    </li>
    <li>Start the application:
      <pre class="help-code">docker compose up --build -d</pre>
    </li>
    <li>Open your browser and navigate to <strong>https://localhost:5000</strong>. Click through the browser's certificate warning (expected on first run with a self-signed certificate).</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">macOS</h4>
  <ol>
    <li>Install <a href="https://www.docker.com/products/docker-desktop/" target="_blank" style="color:#7eb8f7">Docker Desktop for Mac</a>.</li>
    <li>Open Terminal in the project folder.</li>
    <li>Create your <code>.env</code> file:
      <pre class="help-code">cp .env.example .env</pre>
    </li>
    <li>Generate and set your JWT secret:
      <pre class="help-code">openssl rand -hex 32</pre>
      Paste the output as the value of <code>JWT_SECRET</code> in <code>.env</code>.
    </li>
    <li>Start the application:
      <pre class="help-code">docker compose up --build -d</pre>
    </li>
    <li>Open <strong>https://localhost:5000</strong>. If Safari blocks the certificate, use Chrome or Firefox instead.</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Linux / Raspberry Pi</h4>
  <ol>
    <li>Install Docker Engine and Docker Compose:
      <pre class="help-code">curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then verify:
docker --version</pre>
    </li>
    <li>Clone the repository and enter the folder:
      <pre class="help-code">git clone https://github.com/wild4gadgets/Ham-Shack-Navigator.git
cd Ham-Shack-Navigator</pre>
    </li>
    <li>Create and populate your <code>.env</code> file:
      <pre class="help-code">cp .env.example .env
# Generate a secret and set it:
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env</pre>
    </li>
    <li>Start the application:
      <pre class="help-code">docker compose up --build -d</pre>
      On a Raspberry Pi 4, the first build takes about 3–5 minutes.
    </li>
    <li>Open <strong>https://localhost:5000</strong> on the Pi, or <strong>https://&lt;pi-ip&gt;:5000</strong> from another device on your network.</li>
  </ol>

  <div class="alert alert-info mt-3 mb-3" style="background:#1a2a3a;border-color:#3a6a8a;color:#a0c8e8;font-size:0.9rem">
    <i class="bi bi-info-circle me-2"></i>
    <strong>Custom domain with SSL:</strong> If you have a domain name pointed at your server, place your SSL certificate and private key at <code>./ssl/cert.pem</code> and <code>./ssl/key.pem</code> before starting. The nginx container will pick them up automatically. Let's Encrypt certificates are supported.
  </div>

  <h4 style="color:#7eb8f7">Stopping and Restarting</h4>
  <pre class="help-code"># Stop the app (data is preserved):
docker compose down

# Start again:
docker compose up -d

# View logs:
docker compose logs app -f</pre>

  <!-- 4. Initial Setup -->
  <h2 id="h-firstrun" class="help-section-title">4. Initial Setup</h2>
  <h4 style="color:#7eb8f7">Creating Your Admin Account</h4>
  <p>On first launch, the app detects that no users exist and shows a setup form. Enter your email address and a password. The password must meet these requirements:</p>
  <ul>
    <li>Minimum 10 characters</li>
    <li>At least one uppercase letter</li>
    <li>At least one lowercase letter</li>
    <li>At least one digit</li>
    <li>At least one special character (e.g., <code>!</code>, <code>@</code>, <code>#</code>)</li>
  </ul>
  <p>The first account created is automatically assigned the <strong>Admin</strong> role.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Minimum Required Configuration</h4>
  <p>After logging in, go to <strong>Settings</strong> and configure at minimum:</p>
  <ol>
    <li><strong>Station Info</strong> — Enter your callsign, city, latitude/longitude, and unit preference (imperial/metric). You can type a city name, GPS coordinates, or a Maidenhead grid square and the system will look up the location automatically. The grid square is also computed automatically from your coordinates.</li>
    <li><strong>API Keys</strong> — Paste your OpenWeatherMap and Tomorrow.io API keys. Weather data will not load until both are entered.</li>
  </ol>
  <p>All other settings (equipment, notifications, integrations) are optional and can be added later.</p>

  <!-- 5. Dashboard -->
  <h2 id="h-dashboard" class="help-section-title">5. The Dashboard</h2>
  <p>The dashboard is the main real-time view. It auto-refreshes via WebSocket — most data updates without a manual page reload.</p>

  <h4 style="color:#7eb8f7">Navigation Bar</h4>
  <p>The top navigation bar contains:</p>
  <ul>
    <li>Your <strong>callsign</strong> and "Ham Shack Navigator" brand (click to return to dashboard)</li>
    <li><strong>Local</strong> and <strong>UTC clocks</strong> in 7-segment LED style, updating every second</li>
    <li>Navigation links: <strong>Dashboard</strong>, <strong>Workflows</strong> (admin), <strong>Settings</strong>, <strong>Events</strong>, <strong>Users</strong> (admin), <strong>Help</strong></li>
    <li><strong>Logout</strong> button and role indicator badge (Admin or Read Only)</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Dashboard Tile Layout</h4>
  <p>Each section of the dashboard is a draggable tile. Grab the <strong>grip handle</strong> (<i class="bi bi-grip-horizontal"></i>) at the top-left of any tile and drag it to a new position. Your layout is saved automatically and restored on your next visit. To return to the default order, click the <strong>Reset Layout</strong> button (<i class="bi bi-layout-three-columns"></i>) in the monitoring bar header.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Dashboard Pins (Quick Controls)</h4>
  <p>At the top of the dashboard, any Kasa port or Shelly channel that has "Show on Dashboard" enabled appears as a quick-control button. Click once to toggle on/off. The button color reflects the current state (green = on, gray = off). State is polled every 30 seconds.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Monitoring &amp; Status Bar</h4>
  <p>The card below the pins contains the FlexRadio status and monitoring controls:</p>
  <ul>
    <li><strong>FlexRadio status</strong> — frequency (with step buttons), mode, power, TX/RX state, and SWR. See the <a href="#h-flexradio-status" class="help-toc-link" style="display:inline">FlexRadio Status</a> section below for full details.</li>
    <li><strong>Monitoring badge</strong> — Armed (green) or Disarmed. Click to arm or disarm automated weather protection.</li>
    <li><strong>Cooldown timer</strong> — shown after an automatic shutdown; counts down before auto-shutdown can trigger again.</li>
    <li><strong>Run Startup / Run Shutdown</strong> button — click to manually trigger your station's system workflow.</li>
    <li><strong>Reset Layout</strong> button — restores the default tile order.</li>
    <li><strong>Refresh</strong> button — forces an immediate weather data refresh.</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem" id="h-flexradio-status">FlexRadio Status Bar</h4>
  <p>When a FlexRadio 6000/6400 series radio is connected, its status appears in the bottom of the monitoring bar with full real-time controls:</p>
  <ul>
    <li><strong>Frequency badge</strong> (green) — shows current VFO frequency in MHz and the amateur band (e.g., "14.074 MHz · 20m"). Click the badge to open the <strong>Tune dialog</strong> — type any frequency in MHz and press Enter or click Tune to QSY directly.</li>
    <li><strong>Step buttons</strong> — four buttons surround the frequency badge:
      <table class="table table-sm mt-2 mb-2" style="color:#e0e0e0;font-size:0.85rem;border-color:#2a2a4a;width:auto">
        <thead style="background:#1a1a3e;color:#7eb8f7"><tr><th>Button</th><th>Action</th><th>Keyboard shortcut</th></tr></thead>
        <tbody style="background:#12122a">
          <tr><td><strong>&lt;&lt;</strong></td><td>Decrease by large step</td><td><code>&lt;</code> (Shift+,)</td></tr>
          <tr><td><strong>&lt;</strong></td><td>Decrease by small step</td><td><code>,</code></td></tr>
          <tr><td><strong>&gt;</strong></td><td>Increase by small step</td><td><code>.</code></td></tr>
          <tr><td><strong>&gt;&gt;</strong></td><td>Increase by large step</td><td><code>&gt;</code> (Shift+.)</td></tr>
        </tbody>
      </table>
      Default step sizes: <strong>50 kHz</strong> (small) and <strong>100 kHz</strong> (large). Configure in Settings → FlexRadio → Frequency Step Sizes.
    </li>
    <li><strong>Mode badge</strong> (green) — shows current mode (USB, LSB, CW, AM, etc.). Click to open the <strong>Mode dialog</strong> and select a new mode (AM, CW, DIGL, DIGU, LSB, RTTY, USB).</li>
    <li><strong>Power badge</strong> — forward power in watts.</li>
    <li><strong>TX / RX badge</strong> — red TX when transmitting, green RX when receiving.</li>
    <li><strong>SWR badge</strong> — color-coded: green ≤2:1, orange ≤3:1, red &gt;3:1.</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Keyboard Shortcuts</h4>
  <p>These shortcuts are active on the dashboard when the cursor is not in a text input:</p>
  <table class="table table-sm" style="color:#e0e0e0;font-size:0.875rem;border-color:#2a2a4a">
    <thead style="background:#1a1a3e;color:#7eb8f7">
      <tr><th>Key</th><th>Action</th></tr>
    </thead>
    <tbody style="background:#12122a">
      <tr><td><code>,</code></td><td>Step frequency down by small step</td></tr>
      <tr><td><code>.</code></td><td>Step frequency up by small step</td></tr>
      <tr><td><code>&lt;</code> (Shift+,)</td><td>Step frequency down by large step</td></tr>
      <tr><td><code>&gt;</code> (Shift+.)</td><td>Step frequency up by large step</td></tr>
      <tr><td><code>+</code> / <code>=</code></td><td>Zoom in on radar and PSK Reporter maps</td></tr>
      <tr><td><code>-</code></td><td>Zoom out on radar and PSK Reporter maps</td></tr>
    </tbody>
  </table>
  <p>Frequency step shortcuts require a FlexRadio to be connected. Step sizes are configurable in Settings → FlexRadio.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">CW Decoder Tile</h4>
  <p>The CW Decoder tile appears automatically when the FlexRadio is in CW, CWL, or CWU mode. It decodes Morse code in real time from the DAX audio stream. The tile shows:</p>
  <ul>
    <li><strong>Decoded text</strong> — two scrolling lines of monospace green text. When a line fills, content scrolls up. Click <strong>Clear</strong> (<i class="bi bi-trash"></i>) to reset.</li>
    <li><strong>WPM</strong> — estimated code speed in words per minute.</li>
    <li><strong>SNR</strong> — signal-to-noise ratio in dB, color-coded: green ≥10 dB, yellow ≥3 dB, red &lt;3 dB.</li>
    <li><strong>Tone (Hz)</strong> — the CW sidetone frequency to listen for. Adjust if your sidetone doesn't match.</li>
    <li><strong>Threshold slider</strong> — detection sensitivity (0.01–0.50). Lower = more sensitive; higher = fewer false triggers. Changes take effect immediately.</li>
  </ul>
  <p>DAX audio must be enabled in Settings → FlexRadio and the correct DAX channel must match the channel assigned in SmartSDR. The CW decoder only runs when DAX is enabled.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Weather Cards</h4>
  <p>Three analog-gauge weather cards display current conditions:</p>
  <ul>
    <li><strong>Wind</strong> — current gust speed with forecast min/max. Color shifts toward red as it approaches your threshold.</li>
    <li><strong>Temperature</strong> — current temperature with forecast high/low.</li>
    <li><strong>Lightning Distance</strong> — nearest detected lightning strike. Shows "None detected within 250 miles" when clear. Data is aggregated from Tomorrow.io, NWS, and RainViewer.</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">24-Hour Forecast Strip</h4>
  <p>A scrollable hourly forecast showing weather icons, precipitation probability, wind speed, and temperature. Below the strip, any active NWS weather alerts are displayed with color coding:</p>
  <ul>
    <li><span style="color:#ff4444">■</span> <strong>Red</strong> — Extreme</li>
    <li><span style="color:#ff8800">■</span> <strong>Orange</strong> — Severe</li>
    <li><span style="color:#ffcc00">■</span> <strong>Yellow</strong> — Moderate</li>
    <li><span style="color:#4488ff">■</span> <strong>Blue</strong> — Minor</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Local Radar Map</h4>
  <p>An animated precipitation radar map centered on your station location. Use the playback controls (Previous, Play/Pause, Next) to step through frames. The timestamp of the currently displayed frame is shown. Use <code>+</code>/<code>-</code> keyboard shortcuts to zoom. The map auto-centers on your configured location.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Solar / Propagation Card</h4>
  <p>Displays current space weather data from HamQSL:</p>
  <ul>
    <li><strong>SFI</strong> — Solar Flux Index (higher = better HF conditions; ≥150 is excellent)</li>
    <li><strong>A-index</strong> — geomagnetic activity averaged over 24 hours (lower = better; ≤7 is quiet)</li>
    <li><strong>K-index</strong> — current geomagnetic activity (0–9; lower = better)</li>
    <li><strong>Sunspot count</strong> — daily sunspot number</li>
    <li><strong>MUF</strong> — estimated Maximum Usable Frequency at your station location (from NOAA GloTEC)</li>
  </ul>
  <p>Each value is color-coded (green/yellow/red) based on its impact on propagation.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Band Activity (DX Cluster) Heatmap</h4>
  <p>A heatmap showing DX spot activity per HF band (160m through 2m), broken down by continent. Color intensity represents activity level. The region can be changed in Settings → DX Cluster. Data refreshes every 5 minutes (configurable).</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">PSK Reporter Spot Map</h4>
  <p>An interactive world map showing reception spots from PSKReporter.info. Controls:</p>
  <ul>
    <li><strong>Callsign</strong> — enter your callsign and press Enter or click Refresh</li>
    <li><strong>Direction</strong> — "Heard by others" (your signal received) or "You heard" (stations you received)</li>
    <li><strong>Bands / Modes</strong> — filter spots by band and mode (leave blank for all)</li>
    <li><strong>Timespan</strong> — 15 minutes to 6 hours of spot history</li>
    <li><strong>QRZ Lookup</strong> — enter a callsign to see station details in a popup (requires QRZ XML subscription)</li>
    <li><strong>Center Map</strong> — re-centers the map on your station location</li>
    <li><strong>Pause / Resume</strong> — stop or resume the 5-minute auto-refresh</li>
  </ul>
  <p>Each spot marker is colored by band (20m = green, 40m = yellow, 10m = red, etc.) and shows the SNR value. A greyline terminator overlay shows the day/night boundary in real time. All settings persist between sessions.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Recent Events</h4>
  <p>A live feed of the most recent shack activity events — workflow runs, device actions, monitoring state changes. Click <strong>View All</strong> to open the full paginated Events log.</p>

  <!-- 6. Equipment Control -->
  <h2 id="h-equipment" class="help-section-title">6. Equipment Control</h2>
  <h4 style="color:#7eb8f7">TP-Link Kasa Devices</h4>
  <p>Ham Shack Navigator supports TP-Link Kasa smart plugs and power strips. Devices are controlled over your local network by IP address — no cloud account required.</p>
  <p>To add a Kasa device: go to <strong>Settings → Kasa Devices</strong>, enter the device's local IP address, give it a name, select the device type (plug or strip), and save. The system discovers the number of ports automatically. You can then label each port (e.g., "Amplifier", "Radio") and choose which ports appear as Quick Controls on the dashboard.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Shelly Devices</h4>
  <p>Shelly Gen 1 and Gen 2/Pro relays are supported. Go to <strong>Settings → Shelly Devices</strong>, enter the device IP, name, number of channels, and generation. Label each channel and enable dashboard visibility as needed.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Dashboard Quick Controls (Pins)</h4>
  <p>Any Kasa port or Shelly channel with "Show on Dashboard" enabled appears as a button at the top of the dashboard. This gives you one-click control of individual outlets without navigating to a settings page. Device state is polled every 30 seconds to keep the button state current.</p>

  <!-- 7. Workflows -->
  <h2 id="h-workflows" class="help-section-title">7. Workflows &amp; Automation</h2>
  <p>Workflows are ordered sequences of actions — turning devices on or off, pausing, or firing IFTTT events. They are the primary automation mechanism in Ham Shack Navigator.</p>

  <h4 style="color:#7eb8f7">Creating a Workflow</h4>
  <ol>
    <li>Go to <strong>Workflows</strong> in the navigation bar (admin only).</li>
    <li>Click <strong>New Workflow</strong> and enter a name.</li>
    <li>Add steps using the step editor. Each step can be:
      <ul>
        <li><strong>Kasa</strong> — turn a specific Kasa port on or off</li>
        <li><strong>Shelly</strong> — turn a specific Shelly channel on or off</li>
        <li><strong>Pause</strong> — wait a specified number of seconds before the next step</li>
        <li><strong>IFTTT</strong> — fire an IFTTT webhook event with optional value1/value2/value3 parameters</li>
      </ul>
    </li>
    <li>Drag steps to reorder them.</li>
    <li>Click <strong>Save</strong>.</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">System Workflows: Startup and Shutdown</h4>
  <p>Two special workflows named exactly <strong>Startup</strong> and <strong>Shutdown</strong> are treated as system workflows. They can be:</p>
  <ul>
    <li>Triggered manually from the dashboard (Run Startup / Run Shutdown button)</li>
    <li>Triggered automatically when weather thresholds are breached (Shutdown only)</li>
    <li>Triggered remotely via the webhook API</li>
  </ul>
  <p>These names are case-sensitive. The system also tracks the last executed system workflow in the database for Home Assistant integration.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Scheduling Workflows</h4>
  <p>Any workflow can be scheduled to run automatically. In the Workflows page, find a workflow and click <strong>Add Schedule</strong>. Set the local time (HH:MM) and select which days of the week it should run. Multiple schedules can be assigned to the same workflow. Schedules can be enabled or disabled without deleting them.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Running a Workflow Manually</h4>
  <p>From the Workflows page, click the <strong>Run</strong> button next to any workflow. A 202 Accepted response means the workflow has been queued. Check the Events log to confirm completion. Workflows execute steps sequentially in the background — the UI does not block while they run.</p>

  <!-- 8. Monitoring -->
  <h2 id="h-monitoring" class="help-section-title">8. Weather Monitoring &amp; Automated Protection</h2>
  <p>Ham Shack Navigator continuously polls weather data when monitoring is <strong>Armed</strong>. If conditions exceed your configured thresholds, the system automatically triggers the Shutdown workflow to protect your station equipment.</p>

  <h4 style="color:#7eb8f7">How It Works</h4>
  <ol>
    <li>The weather poller runs every <em>poll interval</em> seconds (default: 300 seconds / 5 minutes).</li>
    <li>After each poll, current wind speed and lightning distance are compared against your thresholds.</li>
    <li>If <strong>either</strong> threshold is exceeded and monitoring is Armed:
      <ul>
        <li>The Shutdown workflow runs immediately</li>
        <li>All configured notifications are sent (email, Telegram, IFTTT, ntfy)</li>
        <li>A cooldown period starts (default: 30 minutes)</li>
        <li>The dashboard shows a shutdown alert via WebSocket</li>
      </ul>
    </li>
    <li>During the cooldown period, no further automatic shutdowns can trigger — this prevents rapid cycling if conditions remain bad.</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Arming and Disarming</h4>
  <p>Click the <strong>Monitoring</strong> badge on the dashboard to toggle between Armed and Disarmed. You might disarm when you are actively at the station and want to stay on the air despite marginal conditions, then re-arm when you leave.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Configuring Thresholds</h4>
  <p>Go to <strong>Settings → Thresholds</strong>:</p>
  <ul>
    <li><strong>Wind gust threshold</strong> — mph (or km/h in metric mode). Default: 35 mph.</li>
    <li><strong>Lightning distance threshold</strong> — miles (or km). Default: 10 miles.</li>
    <li><strong>Poll interval</strong> — seconds between weather checks. Minimum 60 seconds. Default: 300 seconds.</li>
    <li><strong>Shutdown cooldown</strong> — minutes to wait after a shutdown before auto-shutdown can trigger again. Default: 30 minutes.</li>
    <li><strong>NWS Severe Weather Alert Notifications</strong> — choose <em>None</em> (off), <em>Watch or Warning</em> (notify for any Watch or Warning issued for your location), or <em>Warning only</em> (only the more urgent Warning level). Notifications fire through all configured channels when the active alert set changes — you won't be re-notified for the same ongoing event on every poll cycle. US locations only.</li>
  </ul>

  <!-- 9. Notifications -->
  <h2 id="h-notifications" class="help-section-title">9. Notifications</h2>
  <p>Ham Shack Navigator can notify you through four channels. Each can be independently enabled or disabled via <strong>Settings → Notification Toggles</strong>.</p>

  <h4 style="color:#7eb8f7">Email (SMTP)</h4>
  <p>Configure in <strong>Settings → SMTP / Email</strong>:</p>
  <ul>
    <li>SMTP host, port (default 587), username, and password</li>
    <li>From address and To address</li>
    <li>Use the <strong>Test</strong> button to verify your configuration before relying on it</li>
    <li><strong>Daily digest</strong> — optional daily status email sent at a configured local time</li>
  </ul>
  <p>Gmail users: use an App Password (not your regular password) and SMTP host <code>smtp.gmail.com</code> on port 587.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Telegram</h4>
  <p>Configure in <strong>Settings → Telegram</strong>:</p>
  <ol>
    <li>Create a bot via <a href="https://t.me/BotFather" target="_blank" style="color:#7eb8f7">@BotFather</a> on Telegram and copy the bot token.</li>
    <li>Find your chat ID: send a message to your bot, then call <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> to find your chat ID.</li>
    <li>Paste both into the settings form and click <strong>Test</strong> to verify.</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">IFTTT</h4>
  <p>Configure in <strong>Settings → IFTTT Automations</strong>:</p>
  <ul>
    <li>Enter your IFTTT Webhooks key</li>
    <li>Set event names for shutdown (<code>ham_shack_shutdown</code> by default) and threshold alerts (<code>ham_shack_alert</code> by default)</li>
    <li>Workflows can also include IFTTT steps to fire any custom event with up to 3 value parameters</li>
  </ul>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">ntfy</h4>
  <p>Configure in <strong>Settings → ntfy</strong>:</p>
  <ol>
    <li>Install the free <a href="https://ntfy.sh" target="_blank" style="color:#7eb8f7">ntfy</a> app on your phone (iOS or Android).</li>
    <li>Choose a unique, hard-to-guess topic name (e.g. <code>my-ham-shack-4729</code>). Anyone who knows the topic can subscribe, so don't use something obvious.</li>
    <li>Subscribe to your topic in the ntfy app.</li>
    <li>Enter the topic in Settings → ntfy, enable the integration, and click <strong>Test</strong> to verify.</li>
  </ol>
  <p>Leave the Server URL as <code>https://ntfy.sh</code> unless you self-host ntfy. The Token field is only needed for access-controlled topics on a self-hosted server.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Notification Toggles</h4>
  <p>Go to <strong>Settings → Notification Toggles</strong> to independently enable/disable:</p>
  <ul>
    <li>Shutdown email / Daily digest email</li>
    <li>Shutdown Telegram message / Threshold alert Telegram message</li>
    <li>Shutdown IFTTT event / Threshold alert IFTTT event</li>
    <li>Shutdown ntfy notification / Threshold alert ntfy notification</li>
  </ul>

  <!-- 10. Integrations -->
  <h2 id="h-integrations" class="help-section-title">10. Integrations</h2>

  <h4 style="color:#7eb8f7">FlexRadio 6000/6400 Series</h4>
  <p>Configure in <strong>Settings → FlexRadio</strong>. Enter the local IP address of your FlexRadio and enable the connection. Once connected, the status bar shows real-time frequency, mode, power, SWR, and TX/RX state with full interactive controls (see Section 5).</p>

  <p><strong>DAX Audio &amp; CW Decoder</strong></p>
  <p>Ham Shack Navigator can receive the FlexRadio DAX (Digital Audio eXchange) RX audio stream over UDP and use it to decode CW (Morse code) in real time.</p>
  <ul>
    <li>Enable <strong>DAX RX audio stream</strong> in Settings → FlexRadio and set the <strong>DAX Channel</strong> to match the channel assigned to your primary slice in SmartSDR.</li>
    <li>The CW decoder uses a Goertzel filter tuned to the configured tone frequency. Set the <strong>CW Tone Frequency</strong> (Hz) to match your radio's CW sidetone pitch (typical: 600–800 Hz).</li>
    <li>The <strong>CW Detection Threshold</strong> (0.05–0.60) controls sensitivity — lower values detect weaker signals but may false-trigger on noise; higher values are more selective.</li>
    <li>The CW Decoder tile on the dashboard is only shown when the radio is in CW, CWL, or CWU mode. Tone and threshold can also be adjusted live from the tile itself without going to settings.</li>
  </ul>

  <p><strong>Frequency Step Sizes</strong></p>
  <p>The step sizes used by the &lt;&lt;/&lt;/&gt;/&gt;&gt; buttons and keyboard shortcuts are configurable in Settings → FlexRadio → Frequency Step Sizes. Defaults are 50 kHz (small) and 100 kHz (large). Sizes are stored in kHz and can be set to any value (e.g., 1 kHz, 5 kHz, 500 kHz).</p>

  <div class="alert alert-warning mt-2 mb-3" style="background:#2a2000;border-color:#6a5000;color:#d4a800;font-size:0.9rem">
    <i class="bi bi-exclamation-triangle me-2"></i>
    <strong>After changing Python-side settings (IP address, DAX settings, step sizes):</strong> Settings are saved immediately when you click Save. However, if you update and rebuild the application from a new release, you must run <code>docker compose up --build -d</code> to pick up backend changes. The radio connection restarts automatically when FlexRadio settings are saved.
  </div>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Home Assistant</h4>
  <p>Configure in <strong>Settings → Home Assistant</strong>. Two modes are available:</p>
  <p><strong>Pull mode</strong> — Home Assistant polls Ham Shack Navigator for sensor data using a static bearer token. In HA's <code>configuration.yaml</code>, add REST sensors pointing to:</p>
  <ul>
    <li><code>/api/v1/ha/sensor/wind_mph</code> — current wind speed</li>
    <li><code>/api/v1/ha/sensor/lightning_miles</code> — nearest lightning distance</li>
    <li><code>/api/v1/ha/sensor/monitoring_armed</code> — monitoring status (on/off)</li>
    <li><code>/api/v1/ha/sensor/in_cooldown</code> — cooldown status</li>
    <li><code>/api/v1/ha/sensor/last_shutdown</code> — last shutdown timestamp</li>
  </ul>
  <p>The settings page provides a complete YAML example that you can copy directly into your HA configuration. Generate the poll token in settings and include it as <code>Authorization: Bearer &lt;token&gt;</code> in the HA REST sensor headers.</p>
  <p><strong>Push mode</strong> — Ham Shack Navigator pushes state updates to your HA instance after each monitoring poll and on shutdown events. Requires a Home Assistant long-lived access token and your HA URL.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">QRZ Lookup</h4>
  <p>Configure in <strong>Settings → API Keys</strong>. Enter your QRZ.com username and password (an XML Data subscription is required). Once configured, the PSK Reporter map provides a QRZ lookup button that shows station details (name, location, QTH, grid square) for any callsign.</p>

  <!-- 11. Settings Reference -->
  <h2 id="h-settings" class="help-section-title">11. Settings Reference</h2>
  <div style="overflow-x:auto">
  <table class="table table-sm" style="color:#e0e0e0;font-size:0.875rem;border-color:#2a2a4a">
    <thead style="background:#1a1a3e;color:#7eb8f7">
      <tr><th>Tab</th><th>Key Settings</th><th>Notes</th></tr>
    </thead>
    <tbody style="background:#12122a">
      <tr><td><strong>Station Info</strong></td><td>Callsign, lat/lon, city, units, Maidenhead grid, location profiles</td><td>Type a city, GPS coords, or grid square to auto-look up. Supports named multi-location profiles (e.g., home, portable).</td></tr>
      <tr><td><strong>API Keys</strong></td><td>OpenWeatherMap key, Tomorrow.io key, QRZ credentials</td><td>OWM and Tomorrow.io are required for weather. QRZ requires an XML Data subscription.</td></tr>
      <tr><td><strong>Thresholds</strong></td><td>Wind mph, lightning miles, poll interval, cooldown, NWS alert notify level</td><td>Drives automatic shutdown logic. NWS alert notifications fire on new alerts through all configured channels.</td></tr>
      <tr><td><strong>DX Cluster</strong></td><td>Region (NA/EU/AS/AF/SA/OC), refresh interval</td><td>Affects band activity heatmap.</td></tr>
      <tr><td><strong>PSK Reporter</strong></td><td>Default callsign, direction, bands, modes, timespan</td><td>Persisted dashboard defaults.</td></tr>
      <tr><td><strong>FlexRadio</strong></td><td>Radio IP, enable toggle, DAX RX enable, DAX channel, CW tone freq (Hz), CW threshold, small step (kHz), large step (kHz)</td><td>FlexRadio 6000/6400 series. DAX requires SmartSDR running on the same network. Step sizes control &lt;&lt;/&lt;/&gt;/&gt;&gt; buttons and keyboard shortcuts.</td></tr>
      <tr><td><strong>Kasa Devices</strong></td><td>Device IP, name, type, port labels, dashboard pins</td><td>Multiple devices supported.</td></tr>
      <tr><td><strong>Shelly Devices</strong></td><td>Device IP, name, channels, generation, labels, pins</td><td>Gen 1 and Gen 2 supported.</td></tr>
      <tr><td><strong>Home Assistant</strong></td><td>Poll token, HA URL, HA access token</td><td>Pull and push modes are independent.</td></tr>
      <tr><td><strong>IFTTT</strong></td><td>Webhook key, event names, enable toggle</td><td>Also used in workflow steps.</td></tr>
      <tr><td><strong>SMTP / Email</strong></td><td>Host, port, credentials, from/to, digest time</td><td>Use an App Password for Gmail.</td></tr>
      <tr><td><strong>Telegram</strong></td><td>Bot token, chat ID</td><td>Get bot token from @BotFather.</td></tr>
      <tr><td><strong>ntfy</strong></td><td>Server URL, topic, optional token</td><td>Free push notifications; ntfy.sh or self-hosted.</td></tr>
      <tr><td><strong>Notification Toggles</strong></td><td>Per-channel, per-event enable/disable</td><td>Covers email, Telegram, IFTTT, and ntfy. Visible to read-only users.</td></tr>
      <tr><td><strong>Remote Webhook</strong></td><td>Generate API key for external workflow invocation</td><td>Used by Stream Deck, mobile apps.</td></tr>
      <tr><td><strong>Account</strong></td><td>Change password, change email</td><td>Available to all users.</td></tr>
    </tbody>
  </table>
  </div>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Location Profiles</h4>
  <p>Settings → Station Info supports multiple named location profiles (e.g., "Home", "Portable", "Contest Site"). Each profile stores a callsign, coordinates, city, units preference, and Maidenhead grid square. Switching profiles immediately updates all weather data and maps to the new location. This is useful for operators who work from multiple locations or who share the dashboard with a club.</p>

  <!-- 12. User Management -->
  <h2 id="h-users" class="help-section-title">12. User Management</h2>
  <p>User management is accessible to admin users via the <strong>Users</strong> link in the navigation bar.</p>
  <h4 style="color:#7eb8f7">Roles</h4>
  <ul>
    <li><strong>Admin</strong> — full access to all settings, workflows, device control, and user management</li>
    <li><strong>Read Only</strong> — can view the dashboard and events log; can only adjust their own notification toggles and account password; cannot control devices or edit settings</li>
  </ul>
  <h4 style="color:#7eb8f7;margin-top:1.5rem">Creating Users</h4>
  <p>On the Users page, click <strong>New User</strong>, enter an email address, initial password, and select a role. Share the credentials with the new user and advise them to change their password immediately via Settings → Account.</p>
  <h4 style="color:#7eb8f7;margin-top:1.5rem">Managing Users</h4>
  <p>From the Users page you can change a user's role or delete their account. You cannot delete your own account.</p>

  <!-- 13. Events Log -->
  <h2 id="h-events" class="help-section-title">13. Events Log</h2>
  <p>The <strong>Events</strong> page maintains a complete audit log of all significant activity. Events are paginated (50 per page) and can be filtered by type and severity.</p>
  <h4 style="color:#7eb8f7">Event Types</h4>
  <ul>
    <li><strong>workflow_started / workflow_completed / workflow_failed</strong> — workflow execution lifecycle</li>
    <li><strong>kasa_action / shelly_action</strong> — device on/off control</li>
    <li><strong>ifttt_step_started / ifttt_step_completed / ifttt_step_failed</strong> — IFTTT step execution</li>
    <li><strong>monitoring_armed / monitoring_disarmed</strong> — monitoring state changes</li>
    <li><strong>shutdown_triggered / wind_alert / lightning_alert</strong> — automatic protection events</li>
    <li><strong>email_sent</strong> — email notification delivery</li>
    <li><strong>login</strong> — user login events</li>
  </ul>
  <h4 style="color:#7eb8f7;margin-top:1.5rem">Severity Levels</h4>
  <ul>
    <li><span style="color:#4a9a4a">■</span> <strong>Info</strong> — normal operational events</li>
    <li><span style="color:#aaaa44">■</span> <strong>Warning</strong> — threshold breaches, step failures</li>
    <li><span style="color:#aa4444">■</span> <strong>Critical</strong> — system errors requiring attention</li>
  </ul>

  <!-- 14. Remote Webhook API -->
  <h2 id="h-webhook" class="help-section-title">14. Remote Webhook API</h2>
  <p>The webhook API allows any workflow to be invoked remotely over HTTPS with an API key — from a Stream Deck, mobile shortcut, or any HTTP client. No browser login is required.</p>

  <h4 style="color:#7eb8f7">Setup</h4>
  <ol>
    <li>Go to <strong>Settings → Remote Webhook</strong>.</li>
    <li>Click <strong>Generate Key</strong>. The full API key is shown once — copy it immediately.</li>
    <li>The key is stored securely and only the last 4 characters are shown in the UI afterward. Use <strong>Regenerate</strong> to issue a new key (this invalidates the old one).</li>
  </ol>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Invoking a Workflow</h4>
  <pre class="help-code">POST /api/v1/webhooks/workflows/{workflow_name}
Authorization: Bearer &lt;your-api-key&gt;
  -- or --
X-API-Key: &lt;your-api-key&gt;

# Example using curl:
curl -X POST https://&lt;your-server&gt;:5000/api/v1/webhooks/workflows/Startup \\
  -H "X-API-Key: &lt;your-api-key&gt;"

# Response (202 Accepted):
{"running": true, "workflow_id": 1, "workflow_name": "Startup"}</pre>
  <p>Workflow names are <strong>case-sensitive</strong>. Spaces must be URL-encoded as <code>%20</code>. A 202 response means the workflow was accepted and is running in the background. Check the Events log to confirm completion.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Stream Deck Configuration</h4>
  <p>Using the <strong>Web Requests</strong> plugin by data-enabler:</p>
  <ul>
    <li><strong>Method:</strong> POST</li>
    <li><strong>URL:</strong> <code>https://&lt;your-server&gt;:5000/api/v1/webhooks/workflows/Startup</code></li>
    <li><strong>Headers:</strong> <code>X-API-Key: &lt;your-api-key&gt;</code></li>
    <li><strong>Content Type:</strong> application/json (or leave blank)</li>
  </ul>
  <p>Rate limit: 30 requests per minute per IP address.</p>

  <!-- 15. Maintenance -->
  <h2 id="h-maintenance" class="help-section-title">15. Maintenance</h2>
  <h4 style="color:#7eb8f7">Updating the Application</h4>
  <pre class="help-code">cd Ham-Shack-Navigator
git pull
docker compose up --build -d</pre>
  <p>Always use <code>--build</code> after a <code>git pull</code> — backend Python changes are baked into the Docker image and require a rebuild to take effect. The database and all settings are preserved across rebuilds.</p>
  <p>Back up <code>./data/shack_weather.db</code> before updating if you have important event history.</p>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Database</h4>
  <p>All data is stored in <code>./data/shack_weather.db</code> (SQLite). This file is mounted as a Docker volume and persists across container restarts and rebuilds. To back it up:</p>
  <pre class="help-code">docker compose down
cp data/shack_weather.db data/shack_weather.db.backup
docker compose up -d</pre>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">Viewing Logs</h4>
  <pre class="help-code"># Follow live logs:
docker compose logs app -f

# Last 50 lines:
docker compose logs app --tail=50</pre>

  <h4 style="color:#7eb8f7;margin-top:1.5rem">SSL Certificate Renewal</h4>
  <p>If you use Let's Encrypt certificates, renew them and replace the files at <code>./ssl/cert.pem</code> and <code>./ssl/key.pem</code>, then restart the nginx container:</p>
  <pre class="help-code">docker compose restart nginx</pre>

  <!-- 16. Troubleshooting -->
  <h2 id="h-troubleshooting" class="help-section-title">16. Troubleshooting</h2>
  <div style="display:flex;flex-direction:column;gap:1rem">

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Weather data is not loading</strong>
        <p class="mt-1 mb-0">Verify your OpenWeatherMap and Tomorrow.io API keys in Settings → API Keys. Both are required. Keys may take up to 2 hours to activate after registration on the provider's side.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Browser shows certificate warning</strong>
        <p class="mt-1 mb-0">On a fresh install with a self-signed certificate, browsers warn about the certificate. Click "Advanced" and proceed. If you have a domain name, replace the self-signed cert with a Let's Encrypt certificate — the warning will go away.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Kasa or Shelly device not responding</strong>
        <p class="mt-1 mb-0">Confirm the device is on the same local network as the server and that you have the correct IP address. Kasa and Shelly devices require <strong>local API access</strong> — ensure the device's mobile app has not disabled local control.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Webhook / Stream Deck button shows error (!)</strong>
        <p class="mt-1 mb-0">Ensure the API key is formatted correctly in the Headers field as <code>X-API-Key: &lt;key&gt;</code>. The webhook endpoint requires CORS — if using a browser-based plugin, ensure you are connecting via HTTP or HTTPS with a valid certificate (not a self-signed cert that the browser rejects silently).</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Scheduled workflow did not run</strong>
        <p class="mt-1 mb-0">Schedules use local time based on the server's timezone (set via <code>TZ</code> in your <code>.env</code> file). Verify the schedule is enabled and that the configured time matches your intent. Check the Events log for <code>workflow_started</code> or <code>workflow_failed</code> entries around the scheduled time.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">FlexRadio not showing on dashboard</strong>
        <p class="mt-1 mb-0">Verify the FlexRadio IP address in Settings → FlexRadio and that the radio is powered on and reachable from the server. The connection uses TCP port 4992 (SmartSDR API). Both the server and radio must be on the same subnet.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">CW decoder tile not appearing</strong>
        <p class="mt-1 mb-0">The CW tile only appears when the radio is in CW, CWL, or CWU mode. Also verify that DAX RX audio is enabled in Settings → FlexRadio, the correct DAX channel is set, and SmartSDR has DAX running with that channel assigned to your primary slice. The server must be able to receive UDP on port 4991.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">FlexRadio settings revert after saving</strong>
        <p class="mt-1 mb-0">This happens when the Docker image is outdated. After a <code>git pull</code>, always run <code>docker compose up --build -d</code> — not just <code>docker compose up -d</code>. Backend Python code is baked into the image at build time; starting without <code>--build</code> runs the old image.</p>
      </div>
    </div>

    <div class="card" style="background:#1a1a2e;border-color:#2a2a4a">
      <div class="card-body">
        <strong style="color:#7eb8f7">Container fails to start after update</strong>
        <p class="mt-1 mb-0">Check the logs: <code>docker compose logs app --tail=50</code>. Common causes are a missing <code>.env</code> file or an invalid <code>JWT_SECRET</code>. Ensure <code>JWT_SECRET</code> is set in your <code>.env</code> file.</p>
      </div>
    </div>

  </div>

  <hr style="border-color:#2a2a4a;margin-top:3rem"/>
  <div class="text-center" style="color:#64748b;font-size:0.8rem;margin-top:1rem">
    Ham Shack Navigator &mdash; User Manual &mdash; K0EHR
  </div>

</div>

<style>
  .help-section-title {
    color: #7eb8f7;
    border-bottom: 1px solid #2a2a4a;
    padding-bottom: 0.4rem;
    margin-top: 2.5rem;
    margin-bottom: 1rem;
    font-size: 1.35rem;
  }
  .help-toc-link {
    color: #94a3b8;
    text-decoration: none;
    display: block;
    padding: 0.15rem 0;
  }
  .help-toc-link:hover { color: #7eb8f7; }
  .help-code {
    background: #1a1a2e;
    color: #e0e0e0;
    font-size: 0.78rem;
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0.5rem 0 1rem;
  }
  .help-page ul, .help-page ol { padding-left: 1.5rem; margin-bottom: 0.75rem; }
  .help-page li { margin-bottom: 0.25rem; }
  .help-page p { margin-bottom: 0.75rem; line-height: 1.65; }
  .help-page code {
    background: #1a1a2e;
    color: #a0d8a0;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.875em;
  }
  .help-page strong { color: #c8d8f0; }
</style>
`;

  // Smooth scroll for TOC links
  container.querySelectorAll('.help-toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
