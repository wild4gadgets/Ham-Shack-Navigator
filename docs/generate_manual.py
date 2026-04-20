"""Generate Ham Shack Cockpit User Manual as a DOCX file."""
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

doc = Document()

# ── Page margins ──────────────────────────────────────────────────────────────
for section in doc.sections:
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1.25)
    section.right_margin = Inches(1.25)

# ── Styles ────────────────────────────────────────────────────────────────────
styles = doc.styles

def set_font(style, name='Calibri', size=11, bold=False, color=None):
    f = style.font
    f.name = name
    f.size = Pt(size)
    f.bold = bold
    if color:
        f.color.rgb = RGBColor(*color)

# Normal
set_font(styles['Normal'], size=11)

# Heading 1
h1 = styles['Heading 1']
set_font(h1, size=18, bold=True, color=(31, 78, 121))
h1.paragraph_format.space_before = Pt(18)
h1.paragraph_format.space_after = Pt(6)

# Heading 2
h2 = styles['Heading 2']
set_font(h2, size=14, bold=True, color=(31, 78, 121))
h2.paragraph_format.space_before = Pt(14)
h2.paragraph_format.space_after = Pt(4)

# Heading 3
h3 = styles['Heading 3']
set_font(h3, size=12, bold=True, color=(68, 114, 196))
h3.paragraph_format.space_before = Pt(10)
h3.paragraph_format.space_after = Pt(2)

# Code style
if 'Code' not in [s.name for s in styles]:
    code_style = styles.add_style('Code', WD_STYLE_TYPE.PARAGRAPH)
else:
    code_style = styles['Code']
set_font(code_style, name='Courier New', size=9)
code_style.paragraph_format.space_before = Pt(4)
code_style.paragraph_format.space_after = Pt(4)
code_style.paragraph_format.left_indent = Inches(0.25)

def add_heading(text, level=1):
    return doc.add_heading(text, level=level)

def add_para(text='', bold_parts=None):
    p = doc.add_paragraph()
    if bold_parts:
        for part, is_bold in bold_parts:
            run = p.add_run(part)
            run.bold = is_bold
    else:
        p.add_run(text)
    return p

def add_bullet(text, level=0):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.left_indent = Inches(0.25 + level * 0.25)
    run = p.add_run(text)
    return p

def add_numbered(text, level=0):
    p = doc.add_paragraph(style='List Number')
    p.paragraph_format.left_indent = Inches(0.25 + level * 0.25)
    p.add_run(text)
    return p

def add_code(text):
    p = doc.add_paragraph(style='Code')
    p.clear()
    run = p.add_run(text)
    run.font.name = 'Courier New'
    run.font.size = Pt(9)
    # Light gray shading
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), 'F2F2F2')
    pPr.append(shd)
    return p

def add_note(text, note_type='Note'):
    p = doc.add_paragraph()
    run = p.add_run(f'{note_type}: ')
    run.bold = True
    run.font.color.rgb = RGBColor(68, 114, 196)
    p.add_run(text)
    p.paragraph_format.left_indent = Inches(0.25)
    return p

def add_table_row(table, cells, header=False):
    row = table.add_row()
    for i, text in enumerate(cells):
        cell = row.cells[i]
        cell.text = text
        if header:
            for run in cell.paragraphs[0].runs:
                run.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)

# ── Cover Page ────────────────────────────────────────────────────────────────
title_p = doc.add_paragraph()
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
title_run = title_p.add_run('Ham Shack Cockpit')
title_run.font.size = Pt(28)
title_run.font.bold = True
title_run.font.color.rgb = RGBColor(31, 78, 121)

sub_p = doc.add_paragraph()
sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub_run = sub_p.add_run('User Manual')
sub_run.font.size = Pt(16)
sub_run.font.color.rgb = RGBColor(89, 89, 89)

doc.add_paragraph()
tagline = doc.add_paragraph()
tagline.alignment = WD_ALIGN_PARAGRAPH.CENTER
tagline.add_run('A Self-Hosted Dashboard for the Modern Ham Radio Operator')

doc.add_paragraph()
doc.add_page_break()

# ── Table of Contents placeholder ─────────────────────────────────────────────
add_heading('Table of Contents', 1)
toc_items = [
    '1. Introduction',
    '2. System Requirements',
    '3. Installation (Windows, macOS, Linux / Raspberry Pi)',
    '4. Initial Setup',
    '5. The Dashboard',
    '6. Equipment Control',
    '7. Workflows & Automation',
    '8. Weather Monitoring & Automated Protection',
    '9. Notifications',
    '10. Integrations',
    '11. Settings Reference',
    '12. User Management',
    '13. Events Log',
    '14. Remote Webhook API',
    '15. Maintenance',
    '16. Troubleshooting',
]
for item in toc_items:
    add_para(item)
doc.add_page_break()

# ── 1. Introduction ───────────────────────────────────────────────────────────
add_heading('1. Introduction', 1)
add_para('Ham Shack Cockpit is a self-hosted web dashboard for amateur radio operators. It runs on a Raspberry Pi (or any Linux server) and provides a real-time, at-a-glance view of everything happening in and around the shack — weather conditions, propagation data, station equipment, and DX activity — all in one screen.')
add_para('The backend is a FastAPI (Python) application with a SQLite database. The frontend is plain HTML/CSS/JavaScript served over HTTPS. Everything runs in Docker containers, making setup and maintenance straightforward on any platform.')

add_heading('Key Features', 2)
add_bullet('Weather monitoring with automatic station shutdown when thresholds are exceeded (wind, lightning)')
add_bullet('Station equipment control via TP-Link Kasa smart plugs, Shelly relays, and Home Assistant')
add_bullet('Workflow automation — build step-by-step power sequences, schedule them, or trigger remotely')
add_bullet('Solar & propagation data — SFI, A-index, K-index, sunspot count, and MUF estimate')
add_bullet('DX Cluster band activity heatmap by region')
add_bullet('PSK Reporter spot map with greyline overlay and band-colored markers')
add_bullet('Notifications via email, Telegram, and IFTTT')
add_bullet('Multi-user access with Admin and Read-Only roles')
add_bullet('Remote webhook API for Stream Deck and mobile app integration')

# ── 2. Requirements ───────────────────────────────────────────────────────────
add_heading('2. System Requirements', 1)

add_heading('Hardware', 2)
add_bullet('Raspberry Pi 4 (recommended) or any 64-bit Linux server with at least 1 GB RAM')
add_bullet('Windows or macOS computers are also supported via Docker Desktop')

add_heading('Software', 2)
add_bullet('Docker Desktop (Windows, macOS) or Docker Engine + Docker Compose (Linux)')
add_bullet('A modern web browser (Chrome, Firefox, or Edge recommended)')

add_heading('Required API Keys (free tier works for both)', 2)
add_bullet('OpenWeatherMap — One Call API 2.5 (free tier): https://openweathermap.org/api')
add_bullet('Tomorrow.io — free tier (500 requests/day): https://www.tomorrow.io/')

add_heading('Optional', 2)
add_bullet('QRZ.com XML subscription (for callsign lookups)')
add_bullet('Telegram Bot token (for mobile push notifications)')
add_bullet('SMTP server or Gmail account (for email notifications)')
add_bullet('IFTTT account with Webhooks service enabled')
add_bullet('TP-Link Kasa smart plugs or power strips on your local network')
add_bullet('Shelly smart relays (Gen 1 or Gen 2) on your local network')
add_bullet('FlexRadio 6400 transceiver on your local network')
add_bullet('Home Assistant instance')

# ── 3. Installation ───────────────────────────────────────────────────────────
add_heading('3. Installation', 1)

add_heading('Getting the Code', 2)
add_para('If you have collaborator access to the repository:')
add_code('git clone https://github.com/wild4gadgets/Ham-Shack-Cockpit.git\ncd Ham-Shack-Cockpit')
add_para('If you received a ZIP archive, extract it and open a terminal in the extracted folder.')

add_heading('Windows', 2)
add_numbered('Install Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/). During installation, enable the WSL 2 backend when prompted.')
add_numbered('Open PowerShell or Windows Terminal in the project folder.')
add_numbered('Create your .env file:')
add_code('Copy-Item .env.example .env')
add_numbered('Open .env in a text editor. Generate a random secret by running this in PowerShell:')
add_code('-join ((1..32) | ForEach-Object { \'{0:x2}\' -f (Get-Random -Max 256) })')
add_para('Paste the output as the value of JWT_SECRET in .env.')
add_numbered('Start the application:')
add_code('docker compose up --build -d')
add_numbered('Open your browser and navigate to https://localhost:5000. Click through the certificate warning (expected on first run with a self-signed certificate).')

add_heading('macOS', 2)
add_numbered('Install Docker Desktop for Mac (https://www.docker.com/products/docker-desktop/).')
add_numbered('Open Terminal in the project folder.')
add_numbered('Create your .env file:')
add_code('cp .env.example .env')
add_numbered('Generate and set your JWT secret:')
add_code('openssl rand -hex 32')
add_para('Paste the output as the value of JWT_SECRET in .env.')
add_numbered('Start the application:')
add_code('docker compose up --build -d')
add_numbered('Open https://localhost:5000. If Safari blocks the certificate, use Chrome or Firefox instead.')

add_heading('Linux / Raspberry Pi', 2)
add_numbered('Install Docker Engine and Docker Compose:')
add_code('curl -fsSL https://get.docker.com | sh\nsudo usermod -aG docker $USER\n# Log out and back in, then verify:\ndocker --version')
add_numbered('Clone the repository:')
add_code('git clone https://github.com/wild4gadgets/Ham-Shack-Cockpit.git\ncd Ham-Shack-Cockpit')
add_numbered('Create and populate your .env file:')
add_code('cp .env.example .env\n# Generate a secret and set it:\necho "JWT_SECRET=$(openssl rand -hex 32)" > .env')
add_numbered('Start the application:')
add_code('docker compose up --build -d')
add_para('On a Raspberry Pi 4, the first build takes approximately 3–5 minutes.')
add_numbered('Open https://localhost:5000 on the Pi, or https://<pi-ip>:5000 from another device on your network.')

add_note('Custom domain with SSL: If you have a domain name pointed at your server, place your SSL certificate and private key at ./ssl/cert.pem and ./ssl/key.pem before starting. The nginx container picks them up automatically. Let\'s Encrypt certificates are supported.')

add_heading('Stopping and Restarting', 2)
add_code('# Stop the app (data is preserved):\ndocker compose down\n\n# Start again:\ndocker compose up -d\n\n# View logs:\ndocker compose logs app -f')

# ── 4. Initial Setup ──────────────────────────────────────────────────────────
add_heading('4. Initial Setup', 1)

add_heading('Creating Your Admin Account', 2)
add_para('On first launch, the app detects that no users exist and shows a setup form. Enter your email address and a password. Password requirements:')
add_bullet('Minimum 10 characters')
add_bullet('At least one uppercase letter')
add_bullet('At least one lowercase letter')
add_bullet('At least one digit')
add_bullet('At least one special character (e.g., !, @, #)')
add_para('The first account created is automatically assigned the Admin role.')

add_heading('Minimum Required Configuration', 2)
add_para('After logging in, go to Settings and configure at minimum:')
add_numbered('Station Info — Enter your callsign, city, latitude/longitude, and unit preference (imperial/metric). You can type a city name, GPS coordinates, or Maidenhead grid square and the system will look up the location. A Maidenhead grid square is computed automatically from coordinates.')
add_numbered('API Keys — Paste your OpenWeatherMap and Tomorrow.io API keys. Weather data will not load until both keys are entered.')
add_para('All other settings (equipment, notifications, integrations) are optional and can be added at any time.')

# ── 5. Dashboard ──────────────────────────────────────────────────────────────
add_heading('5. The Dashboard', 1)
add_para('The dashboard is the main real-time view. It auto-refreshes via WebSocket — most data updates without a manual page reload.')

add_heading('Navigation Bar', 2)
add_bullet('Your callsign and "Ham Shack Cockpit" brand (click to return to dashboard)')
add_bullet('Local and UTC clocks in 7-segment LED style, updating every second')
add_bullet('Navigation links: Dashboard, Workflows (admin), Settings, Events, Users (admin)')
add_bullet('Help button (opens this manual)')
add_bullet('Logout button')
add_bullet('Role indicator badge (Admin or Read Only)')

add_heading('Dashboard Pins (Quick Controls)', 2)
add_para('At the top of the dashboard, any Kasa port or Shelly channel with "Show on Dashboard" enabled appears as a quick-control button. Click once to toggle on/off. Green = on, gray = off. State is polled every 30 seconds.')

add_heading('Monitoring Control Bar', 2)
add_para('Below the dashboard pins:')
add_bullet('Monitoring status — Armed (will auto-shutdown on threshold breach) or Disarmed')
add_bullet('Arm / Disarm button — toggles automated weather protection')
add_bullet('Run Startup / Run Shutdown buttons — manually trigger station workflows')
add_bullet('Cooldown timer — shows remaining cooldown time after a shutdown')

add_heading('Weather Cards', 2)
add_bullet('Wind — current gust speed with forecast min/max; color shifts toward red as it approaches your threshold')
add_bullet('Temperature — current temperature with forecast high/low')
add_bullet('Lightning Distance — nearest detected strike; shows "None detected within 250 miles" when clear; aggregated from Tomorrow.io, NWS, and RainViewer')

add_heading('24-Hour Forecast Strip', 2)
add_para('Scrollable hourly forecast with weather icons, precipitation probability, wind speed, and temperature. Below the strip, active NWS weather alerts are shown color-coded by severity: Red (Extreme), Orange (Severe), Yellow (Moderate), Blue (Minor).')

add_heading('Local Radar Map', 2)
add_para('Animated precipitation radar centered on your station location. Playback controls: Previous, Play/Pause, Next. Frame timestamp is displayed. The map auto-centers on your configured location.')

add_heading('Solar / Propagation Card', 2)
add_bullet('SFI (Solar Flux Index) — higher = better HF; ≥150 is excellent')
add_bullet('A-index — 24-hour geomagnetic average; ≤7 is quiet')
add_bullet('K-index — current geomagnetic activity (0–9; lower = better)')
add_bullet('Sunspot count — daily sunspot number')
add_bullet('MUF — estimated Maximum Usable Frequency at your location (NOAA GloTEC)')
add_para('Each value is color-coded (green/yellow/red) based on its propagation impact.')

add_heading('Band Activity (DX Cluster) Heatmap', 2)
add_para('Spot counts per HF band (160m through 2m) broken down by continent. Color intensity represents activity level. Region is configurable in Settings → DX Cluster. Refreshes every 5 minutes.')

add_heading('PSK Reporter Spot Map', 2)
add_para('Interactive world map of PSKReporter.info spots with band-colored markers (20m = green, 40m = yellow, 10m = red, etc.) and SNR labels. A greyline terminator overlay shows the day/night boundary. Controls:')
add_bullet('Callsign — enter your callsign and press Enter or click Refresh')
add_bullet('Direction — "Heard by others" or "You heard"')
add_bullet('Bands / Modes — filter (leave blank for all)')
add_bullet('Timespan — 15 minutes to 6 hours')
add_bullet('QRZ Lookup — station details popup')
add_bullet('Center Map — re-centers on your station')
add_bullet('Pause / Resume — stop/resume 5-minute auto-refresh')
add_para('All settings persist between sessions.')

add_heading('FlexRadio Status', 2)
add_para('If a FlexRadio 6400 is configured, shows real-time frequency, mode, forward power, and SWR. Updates via UDP from the radio.')

# ── 6. Equipment Control ──────────────────────────────────────────────────────
add_heading('6. Equipment Control', 1)

add_heading('TP-Link Kasa Devices', 2)
add_para('Ham Shack Cockpit supports Kasa smart plugs and power strips via local IP — no cloud account required. Go to Settings → Kasa Devices, enter the device IP, give it a name, select type (plug or strip), and save. The system discovers port count automatically. Label each port (e.g., "Amplifier", "Radio") and enable dashboard visibility as needed.')

add_heading('Shelly Devices', 2)
add_para('Shelly Gen 1 and Gen 2/Pro relays are supported. Go to Settings → Shelly Devices, enter the IP, name, channel count, and generation. Label each channel and configure dashboard visibility.')

add_heading('Dashboard Quick Controls', 2)
add_para('Any Kasa port or Shelly channel with "Show on Dashboard" enabled appears as a button at the top of the dashboard. Green = on, gray = off. State is polled every 30 seconds.')

# ── 7. Workflows ──────────────────────────────────────────────────────────────
add_heading('7. Workflows & Automation', 1)
add_para('Workflows are ordered sequences of actions — device control, delays, and IFTTT events. They are the primary automation mechanism.')

add_heading('Creating a Workflow', 2)
add_numbered('Go to Workflows in the navigation bar (admin only).')
add_numbered('Click New Workflow and enter a name.')
add_numbered('Add steps: Kasa (port on/off), Shelly (channel on/off), Pause (wait N seconds), or IFTTT (fire event with optional value1/value2/value3).')
add_numbered('Drag steps to reorder them.')
add_numbered('Click Save.')

add_heading('System Workflows: Startup and Shutdown', 2)
add_para('Two special workflows named exactly "Startup" and "Shutdown" are treated as system workflows. They can be:')
add_bullet('Triggered manually from the dashboard')
add_bullet('Triggered automatically when weather thresholds are breached (Shutdown only)')
add_bullet('Triggered remotely via the webhook API')
add_note('These names are case-sensitive. The names must be exactly "Startup" and "Shutdown".')

add_heading('Scheduling Workflows', 2)
add_para('Any workflow can be scheduled to run automatically. On the Workflows page, find a workflow and click Add Schedule. Set the UTC time (HH:MM) and select days of week. Multiple schedules can be assigned to the same workflow and independently enabled/disabled.')
add_note('All scheduled times are in UTC. Convert from your local time accordingly.')

add_heading('Running a Workflow Manually', 2)
add_para('From the Workflows page, click Run next to any workflow. A 202 Accepted response means it has been queued. Workflows run in the background — check the Events log to confirm completion.')

# ── 8. Monitoring ─────────────────────────────────────────────────────────────
add_heading('8. Weather Monitoring & Automated Protection', 1)
add_para('When monitoring is Armed, Ham Shack Cockpit continuously polls weather data and triggers the Shutdown workflow automatically if conditions become dangerous.')

add_heading('How It Works', 2)
add_numbered('The weather poller runs every poll interval seconds (default: 300 / 5 minutes).')
add_numbered('After each poll, wind speed and lightning distance are compared against your thresholds.')
add_numbered('If either threshold is exceeded and monitoring is Armed: the Shutdown workflow runs, all configured notifications are sent, and a cooldown period starts.')
add_numbered('During cooldown, no further automatic shutdowns trigger — preventing rapid cycling.')

add_heading('Arming and Disarming', 2)
add_para('Use the Arm / Disarm button on the dashboard. Disarm when you are at the station and want to stay on the air despite marginal conditions; re-arm when you leave.')

add_heading('Configuring Thresholds', 2)
add_para('Go to Settings → Thresholds:')
add_bullet('Wind gust threshold — mph (or km/h in metric mode). Default: 35 mph.')
add_bullet('Lightning distance threshold — miles (or km). Default: 10 miles.')
add_bullet('Poll interval — seconds between weather checks. Minimum 60. Default: 300.')
add_bullet('Shutdown cooldown — minutes to wait after shutdown before re-triggering. Default: 30.')

add_heading('Manual Shutdown', 2)
add_para('Click Run Shutdown on the dashboard to trigger the Shutdown workflow immediately, regardless of weather conditions or monitoring state.')

# ── 9. Notifications ──────────────────────────────────────────────────────────
add_heading('9. Notifications', 1)
add_para('Ham Shack Cockpit can notify you through three channels, each independently enabled/disabled via Settings → Notification Toggles.')

add_heading('Email (SMTP)', 2)
add_para('Configure in Settings → SMTP / Email: host, port (default 587), username, password, from/to addresses. Use the Test button to verify. Gmail users: use an App Password and smtp.gmail.com on port 587.')
add_bullet('Shutdown email — sent when the Shutdown workflow is triggered automatically')
add_bullet('Daily digest — optional daily status summary sent at a configured UTC time')

add_heading('Telegram', 2)
add_numbered('Create a bot via @BotFather on Telegram and copy the bot token.')
add_numbered('Find your chat ID: message your bot, then call https://api.telegram.org/bot<TOKEN>/getUpdates.')
add_numbered('Paste both values in Settings → Telegram and click Test.')

add_heading('IFTTT', 2)
add_para('Configure in Settings → IFTTT Automations: enter your Webhooks key and set event names for shutdown (default: ham_shack_shutdown) and threshold alerts (default: ham_shack_alert). Workflows can also include IFTTT steps with up to 3 value parameters.')

add_heading('Notification Toggles', 2)
add_para('Settings → Notification Toggles allows independent enable/disable for: shutdown email, daily digest email, shutdown Telegram, threshold alert Telegram, shutdown IFTTT, threshold alert IFTTT.')

# ── 10. Integrations ──────────────────────────────────────────────────────────
add_heading('10. Integrations', 1)

add_heading('Home Assistant', 2)
add_para('Configure in Settings → Home Assistant. Two modes:')
add_para('Pull mode — Home Assistant polls Ham Shack Cockpit for sensor data. Add REST sensors in configuration.yaml using the static bearer token shown in the settings page. Available sensor slugs: wind_mph, lightning_miles, monitoring_armed, in_cooldown, last_shutdown. The settings page provides a complete YAML example.')
add_para('Push mode — Ham Shack Cockpit pushes state to your HA instance after each monitoring poll and on shutdown. Requires a Home Assistant long-lived access token and your HA URL.')

add_heading('FlexRadio 6400', 2)
add_para('Configure in Settings → FlexRadio. Enter the radio\'s local IP and enable the integration. Displays real-time frequency, mode, power output, and SWR on the dashboard via UDP. Reconnects automatically if the radio is power-cycled.')

add_heading('QRZ Lookup', 2)
add_para('Configure in Settings → API Keys. Enter QRZ.com username and password (XML Data subscription required). Once configured, the PSK Reporter map provides a QRZ lookup button that shows station details for any callsign.')

# ── 11. Settings Reference ────────────────────────────────────────────────────
add_heading('11. Settings Reference', 1)

table = doc.add_table(rows=1, cols=3)
table.style = 'Table Grid'
hdr_cells = table.rows[0].cells
for i, text in enumerate(['Tab', 'Key Settings', 'Notes']):
    hdr_cells[i].text = text
    for run in hdr_cells[i].paragraphs[0].runs:
        run.bold = True

rows_data = [
    ('Station Info', 'Callsign, lat/lon, city, units, Maidenhead grid', 'Supports multi-location profiles'),
    ('API Keys', 'OpenWeatherMap, Tomorrow.io, QRZ credentials', 'Required for weather data'),
    ('Thresholds', 'Wind, lightning distance, poll interval, cooldown', 'Drives automatic shutdown'),
    ('DX Cluster', 'Region, refresh interval', 'Affects band activity heatmap'),
    ('PSK Reporter', 'Callsign, direction, bands, modes, timespan', 'Persisted dashboard defaults'),
    ('FlexRadio', 'Radio IP, enable toggle', 'FlexRadio 6400 only'),
    ('Kasa Devices', 'Device IP, name, type, port labels, dashboard pins', 'Multiple devices supported'),
    ('Shelly Devices', 'Device IP, name, channels, generation, labels, pins', 'Gen 1 and Gen 2 supported'),
    ('Workflows', 'Create/edit workflows and schedules', 'Also via Workflows nav link'),
    ('Remote Webhook', 'Generate API key for external invocation', 'Stream Deck, mobile apps'),
    ('Home Assistant', 'Poll token, HA URL, HA access token', 'Pull and push modes independent'),
    ('IFTTT', 'Webhook key, event names, enable toggle', 'Also used in workflow steps'),
    ('SMTP / Email', 'Host, port, credentials, from/to, digest time', 'App Password for Gmail'),
    ('Telegram', 'Bot token, chat ID', 'Get bot from @BotFather'),
    ('Notification Toggles', 'Per-channel, per-event enable/disable', 'Visible to read-only users'),
    ('Account', 'Change password, change email (admin)', 'Available to all users'),
]
for row_data in rows_data:
    row = table.add_row()
    for i, text in enumerate(row_data):
        row.cells[i].text = text

doc.add_paragraph()

# ── 12. User Management ───────────────────────────────────────────────────────
add_heading('12. User Management', 1)
add_para('User management is available to admin users via the Users link in the navigation bar.')

add_heading('Roles', 2)
add_bullet('Admin — full access to all settings, workflows, device control, and user management')
add_bullet('Read Only — view dashboard and events; adjust own notification toggles and password only; cannot control devices or edit settings')

add_heading('Creating Users', 2)
add_para('On the Users page, click New User, enter an email address, initial password, and select a role. Share credentials with the new user and advise them to change their password via Settings → Account.')

add_heading('Managing Users', 2)
add_para('From the Users page you can change a user\'s role or delete their account. You cannot delete your own account.')

# ── 13. Events Log ────────────────────────────────────────────────────────────
add_heading('13. Events Log', 1)
add_para('The Events page maintains a complete audit log. Events are paginated (50 per page) and can be filtered by type and severity.')

add_heading('Event Types', 2)
add_bullet('workflow_started / workflow_completed / workflow_failed — workflow lifecycle')
add_bullet('kasa_action / shelly_action — device control actions')
add_bullet('ifttt_step_started / ifttt_step_completed / ifttt_step_failed — IFTTT steps')
add_bullet('monitoring_armed / monitoring_disarmed — protection state changes')
add_bullet('shutdown_triggered / wind_alert / lightning_alert — automatic protection events')
add_bullet('email_sent — email notification delivery')

add_heading('Severity Levels', 2)
add_bullet('Info — normal operational events')
add_bullet('Warning — threshold breaches, step failures')
add_bullet('Critical — system errors requiring attention')

# ── 14. Remote Webhook API ────────────────────────────────────────────────────
add_heading('14. Remote Webhook API', 1)
add_para('The webhook API allows any workflow to be invoked remotely over HTTPS — from a Stream Deck, mobile shortcut, or any HTTP client. No browser login is required.')

add_heading('Setup', 2)
add_numbered('Go to Settings → Remote Webhook.')
add_numbered('Click Generate Key. The full API key is shown once — copy it immediately.')
add_numbered('The key is stored securely; only the last 4 characters are shown afterward. Use Regenerate to issue a new key, which invalidates the old one.')

add_heading('Invoking a Workflow', 2)
add_code('POST /api/v1/webhooks/workflows/{workflow_name}\nAuthorization: Bearer <your-api-key>\n  -- or --\nX-API-Key: <your-api-key>\n\n# Example using curl:\ncurl -X POST https://your-server:5000/api/v1/webhooks/workflows/Startup \\\n  -H "X-API-Key: <your-api-key>"\n\n# Response (202 Accepted):\n{"running": true, "workflow_id": 1, "workflow_name": "Startup"}')
add_note('Workflow names are case-sensitive. Spaces must be URL-encoded as %20. A 202 response means the workflow was accepted and is running in the background. Check the Events log to confirm completion.')

add_heading('Stream Deck Configuration', 2)
add_para('Using the Web Requests plugin by data-enabler:')
add_bullet('Method: POST')
add_bullet('URL: https://<your-server>:5000/api/v1/webhooks/workflows/Startup')
add_bullet('Headers: X-API-Key: <your-api-key>')
add_bullet('Content Type: application/json (or leave blank)')
add_para('Rate limit: 30 requests per minute per IP address.')

# ── 15. Maintenance ───────────────────────────────────────────────────────────
add_heading('15. Maintenance', 1)

add_heading('Updating the Application', 2)
add_code('cd Ham-Shack-Cockpit\ngit pull\ndocker compose build app\ndocker compose up -d')
add_para('The database is preserved across updates.')

add_heading('Database Backup', 2)
add_para('All data is stored in ./data/shack_weather.db (SQLite). To back it up:')
add_code('docker compose down\ncp data/shack_weather.db data/shack_weather.db.backup\ndocker compose up -d')

add_heading('Viewing Logs', 2)
add_code('# Follow live logs:\ndocker compose logs app -f\n\n# Last 50 lines:\ndocker compose logs app --tail=50')

add_heading('SSL Certificate Renewal', 2)
add_para('Replace ./ssl/cert.pem and ./ssl/key.pem with renewed certificates, then:')
add_code('docker compose restart nginx')

# ── 16. Troubleshooting ───────────────────────────────────────────────────────
add_heading('16. Troubleshooting', 1)

issues = [
    ('Weather data is not loading',
     'Verify your OpenWeatherMap and Tomorrow.io API keys in Settings → API Keys. Both are required. New keys may take up to 2 hours to activate after registration.'),
    ('Browser shows certificate warning',
     'On a fresh install with a self-signed certificate, browsers warn about the certificate. Click "Advanced" and proceed. If you have a domain name, replace the self-signed cert with a Let\'s Encrypt certificate.'),
    ('Kasa or Shelly device not responding',
     'Confirm the device is on the same local network as the server. Verify the IP address. Ensure the device\'s mobile app has not disabled local API control.'),
    ('Webhook / Stream Deck button shows error (!)',
     'Ensure the API key header is formatted as "X-API-Key: <key>". The endpoint handles CORS — if using a browser-based plugin, connect via HTTP or use HTTPS with a certificate the browser trusts.'),
    ('Scheduled workflow did not run',
     'Schedules use UTC time. Verify the schedule is enabled and the time is correct. Check the Events log for workflow_started or workflow_failed entries around the scheduled time.'),
    ('FlexRadio not showing on dashboard',
     'Verify the FlexRadio IP in Settings → FlexRadio and that the radio is on and reachable. The listener uses UDP — both devices must be on the same subnet.'),
    ('Container fails to start after update',
     'Run: docker compose logs app --tail=50. Common causes: missing .env file or invalid JWT_SECRET. Ensure JWT_SECRET is set in .env.'),
]
for title, body in issues:
    p = doc.add_paragraph()
    run = p.add_run(title)
    run.bold = True
    run.font.color.rgb = RGBColor(31, 78, 121)
    doc.add_paragraph(body)
    doc.add_paragraph()

# ── Footer ────────────────────────────────────────────────────────────────────
doc.add_page_break()
footer_p = doc.add_paragraph()
footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer_run = footer_p.add_run('Ham Shack Cockpit User Manual — K0EHR')
footer_run.font.color.rgb = RGBColor(128, 128, 128)
footer_run.font.size = Pt(9)

# ── Save ──────────────────────────────────────────────────────────────────────
output_path = '/home/markehr/projects/Ham-Shack-Cockpit/docs/Ham-Shack-Cockpit-User-Manual.docx'
doc.save(output_path)
print(f'Saved: {output_path}')
