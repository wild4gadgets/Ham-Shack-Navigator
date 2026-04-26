# Ham Shack Cockpit: A Self-Hosted Dashboard for the Modern Ham Radio Operator

If you've ever wished you could monitor weather conditions, track propagation, control your station equipment, and watch DX spots — all from a single screen — Ham Shack Cockpit might be exactly what you've been looking for.

Ham Shack Cockpit is a self-hosted web application designed to run on a Raspberry Pi (or any Linux server) and give amateur radio operators a real-time, at-a-glance view of everything happening in and around the shack.

---

## What It Does

### Weather Monitoring & Automated Protection

At its core, Ham Shack Cockpit is a weather-aware station guardian. It continuously polls weather data and monitors conditions that matter to operators: wind speed, temperature, and lightning activity. When conditions exceed user-defined thresholds — say, winds over 35 mph or lightning within 10 miles — the system automatically triggers a station shutdown sequence to protect your equipment.

The dashboard displays:
- **Wind** and **Temperature** gauges with forecast min/max markers
- **Lightning distance** from multiple detection sources, or "None detected within 250 miles" when the sky is clear
- A **24-hour forecast strip** with icons, precipitation probability, and wind speed
- **Active NWS weather alerts** (Watches, Warnings, Advisories) color-coded by severity — Extreme in red, Severe in orange, Moderate in yellow, Minor in blue
- An animated **local radar** map with frame-by-frame playback

### FlexRadio Integration

Ham Shack Cockpit connects directly to a FlexRadio 6000/6400 series radio over TCP and provides a full control panel in the dashboard status bar:

- **Real-time display** of frequency, mode, forward power, SWR, and TX/RX state — all updating live
- **Click the frequency** to open a tune dialog — type any frequency in MHz and press Enter to QSY
- **Click the mode badge** to open a mode picker (AM, CW, DIGL, DIGU, LSB, RTTY, USB)
- **Frequency step buttons** (`<<` / `<` / `>` / `>>`) step the VFO up or down by configurable amounts without opening any dialog
- **Keyboard shortcuts** — `,` and `.` for small steps, `<` and `>` for large steps — for hands-free frequency tuning while operating
- **Step sizes are configurable** in Settings → FlexRadio (defaults: 50 kHz small, 100 kHz large)

### CW Decoder

When the FlexRadio is in CW mode, Ham Shack Cockpit can decode Morse code in real time from the DAX audio stream:

- **Two-line scrolling display** of decoded text in green monospace
- **WPM** (words per minute) and **SNR** (signal-to-noise ratio in dB) shown live
- **Tone frequency** and **detection threshold** adjustable directly from the tile without going to settings
- The decoder tile appears automatically when the radio enters CW mode and hides when it leaves
- Uses the FlexRadio DAX RX audio stream (configurable channel); requires SmartSDR running on the same network

### Station Equipment Control

Ham Shack Cockpit integrates directly with popular smart plug platforms:

- **TP-Link Kasa** smart strips and plugs — individually labeled and controllable from the dashboard
- **Shelly** smart relays (Gen 1 and Gen 2)
- **Home Assistant** — push state changes or pull sensor data from an existing HA instance

Dashboard pins for each outlet appear at the top of the screen for one-click on/off control.

### Workflows & Scheduled Automation

Power sequencing matters in a ham shack. The Workflows engine lets you build step-by-step sequences — turn off the amplifier, pause 5 seconds, power down the radio, pause 3 seconds, cut the antenna switch — and assign them to named workflows. Two special system workflows ("Startup" and "Shutdown") can be triggered manually from the dashboard or fired automatically when weather thresholds are breached.

Workflows can also be scheduled by day of week and local time, so your station can come up every morning and go down every evening automatically.

### Draggable Dashboard

Every tile on the dashboard is draggable. Grab the grip handle and rearrange the layout to match your workflow — put the CW decoder next to the FlexRadio status, move the radar below the solar data, whatever works for you. The layout is saved per-user and restored on your next visit. A Reset Layout button returns everything to the default order.

### Solar & Propagation Data

A dedicated Solar/Propagation tile displays current space weather indices critical to HF operators: Solar Flux Index (SFI), A-index, K-index, sunspot number, and estimated MUF — with color-coded indicators to tell you at a glance whether conditions favor DX or not.

### DX Cluster Band Activity

A live band activity heatmap pulls data from a DX cluster and shows spot counts across HF bands, broken down by region. It's a quick way to see where the action is without launching a dedicated DX client.

### PSK Reporter Spot Map

One of the more visual features is the PSK Reporter integration. Enter your callsign, choose a direction (signals you've been heard by, or signals you've heard), select modes and bands, and Ham Shack Cockpit fetches spots from PSKReporter.info and plots them on an interactive world map.

- Each spot is a **band-colored circle marker** (20m is green, 40m is yellow, 10m is red, and so on)
- **SNR values** float next to each callsign label
- A **greyline terminator overlay** shows the day/night boundary in real time
- All your settings — callsign, bands, modes, timespan — persist between sessions
- Spots auto-refresh every 5 minutes

### Notifications

When something important happens — a threshold breach, a shutdown event, or a daily status summary — Ham Shack Cockpit can reach you through:

- **Email** (SMTP/Gmail)
- **Telegram** bot messages
- **IFTTT** webhooks

### Multi-User Access with Role-Based Control

The application supports multiple user accounts. Admins have full access to settings, workflows, and equipment control. Read-only users can view the dashboard and monitor conditions but cannot make changes — useful for sharing a view of your shack with a club or family member.

### Multi-Location Profiles

Settings → Station Info supports multiple named location profiles (e.g., Home, Portable, Contest Site). Switching profiles immediately updates weather, radar, maps, and the Maidenhead grid square to the new location.

---

## How It's Built

Ham Shack Cockpit runs as a Docker container on a Raspberry Pi. The backend is a **FastAPI** (Python) application with a SQLite database. The frontend is plain HTML/CSS/JavaScript with no framework — just Bootstrap 5, Leaflet.js for maps, and vanilla ES modules. The whole thing is served over HTTPS via an nginx reverse proxy.

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac, or Linux) or Docker Engine + Docker Compose (Linux/Pi)
- An [OpenWeatherMap](https://openweathermap.org/api) API key (free tier works)
- A [Tomorrow.io](https://www.tomorrow.io/) API key (free tier works)

**Optional hardware/accounts:**
- FlexRadio 6000/6400 series (SmartSDR required for DAX audio/CW decoding)
- TP-Link Kasa smart plugs/strips
- Shelly smart relays (Gen 1 or Gen 2)
- Home Assistant instance
- QRZ.com XML Data subscription (for callsign lookups)
- Telegram bot (for mobile notifications)
- SMTP server (for email notifications)

---

## Getting the Code

This is a private repository. You need to be invited as a collaborator, or receive a zip of the source from the repo owner.

**If you have collaborator access:**
```bash
git clone https://github.com/wild4gadgets/Ham-Shack-Cockpit.git
cd Ham-Shack-Cockpit
```

**If you received a zip:**
Extract it and open a terminal in the extracted folder.

---

## Setup

**1. Create your `.env` file**

Copy the example and fill it in:

```bash
# Mac/Linux/WSL
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder with a real random secret. Generate one with:

```powershell
# Windows PowerShell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```
```bash
# Mac/Linux/WSL
openssl rand -hex 32
```

Set `TZ` to your local timezone (e.g., `TZ=America/Denver`) so scheduled workflows run at the correct local time.

**2. Start the app**

```bash
docker compose up --build -d
```

This builds both containers and starts them in the background. First build takes a few minutes.

**3. Open the app**

Navigate to: **https://localhost:5000**

> **macOS note:** Safari may block self-signed certificates more aggressively. If you can't proceed, try Chrome or Firefox.

Your browser will warn about a self-signed certificate — click through to proceed (this is expected).

**4. Create your account**

On first run you'll be prompted to create an admin account with your email and a password.

**5. Configure your settings**

Go to **Settings** and fill in:

- **Station Info** — your callsign, city, latitude/longitude, and preferred units (imperial/metric)
- **API Keys** — paste your OpenWeatherMap and Tomorrow.io keys
- **FlexRadio** — IP address and DAX settings if you have a FlexRadio 6000/6400 (optional)
- **Kasa** — add your smart plug devices by IP address (optional)
- **Shelly** — add your Shelly relay devices by IP address (optional)
- **SMTP** — email server settings for notifications (optional)
- **Telegram** — bot token and chat ID for mobile alerts (optional)

---

## Updating

Always rebuild the Docker image after pulling new code — backend changes are baked into the image:

```bash
git pull
docker compose up --build -d
```

Running `docker compose up -d` without `--build` after a `git pull` will start the **old** image and settings changes may not persist correctly.

---

## Stopping the App

```bash
docker compose down
```

---

## Data

All settings and event history are stored in `./data/shack_weather.db` (SQLite). This directory is created automatically on first run and persists across restarts and rebuilds. Back it up before updating:

```bash
docker compose down
cp data/shack_weather.db data/shack_weather.db.backup
docker compose up -d
```
