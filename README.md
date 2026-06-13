# Ham Shack Navigator

A self-hosted web dashboard for amateur radio operators. Monitor weather conditions, track propagation, control station equipment, and watch DX spots — all from a single screen.

Runs in Docker on a Raspberry Pi, Linux server, Windows PC, or Mac. No cloud account required.

---

## What It Does

### Weather Monitoring & Automated Protection

Ham Shack Navigator continuously polls weather data and monitors conditions that matter to operators: wind speed, temperature, and lightning activity. When conditions exceed user-defined thresholds — say, winds over 35 mph or lightning within 10 miles — the system automatically triggers a station shutdown sequence to protect your equipment.

The dashboard displays:
- **Wind** and **Temperature** gauges with forecast min/max markers
- **Lightning distance** from multiple detection sources, or "None detected within 250 miles" when clear
- A **24-hour forecast strip** with icons, precipitation probability, and wind speed
- **Active NWS weather alerts** (Watches, Warnings, Advisories) color-coded by severity — Extreme in red, Severe in orange, Moderate in yellow, Minor in blue
- An animated **local radar** map with frame-by-frame playback

### FlexRadio Integration

Connects directly to a FlexRadio 6000/6400 series radio over TCP:

- **Real-time display** of frequency, mode, forward power, SWR, and TX/RX state — all updating live
- **Click the frequency** to open a tune dialog — type any frequency in MHz and press Enter to QSY
- **Click the mode badge** to open a mode picker (AM, CW, DIGL, DIGU, LSB, RTTY, USB)
- **Frequency step buttons** (`<<` / `<` / `>` / `>>`) step the VFO up or down by configurable amounts
- **Keyboard shortcuts** — `,` and `.` for small steps, `<` and `>` for large steps — for hands-free tuning while operating
- **Step sizes are configurable** in Settings → FlexRadio (defaults: 50 kHz small, 100 kHz large)

### CW Decoder

** EXPERIMENTAL ** When the FlexRadio is in CW mode, Ham Shack Navigator can decode Morse code in real time from the DAX audio stream:

- **Two-line scrolling display** of decoded text in green monospace
- **WPM** and **SNR** shown live
- **Tone frequency** and **detection threshold** adjustable from the tile
- The decoder tile appears automatically when the radio enters CW mode

### Station Equipment Control

- **TP-Link Kasa** smart strips and plugs — individually labeled and controllable from the dashboard
- **Shelly** smart relays (Gen 1 and Gen 2)
- **Home Assistant** — push state changes or pull sensor data from an existing HA instance

### Workflows & Scheduled Automation

Build step-by-step power sequencing workflows (turn off amp → pause 5s → power down radio → pause 3s → cut antenna switch) and assign them to named workflows. Two special system workflows ("Startup" and "Shutdown") can be triggered manually, fired automatically on threshold breaches, or invoked via the webhook API. Workflows can be scheduled by day of week and local time.

### Draggable Dashboard & Layout Profiles

Every tile is draggable. Layouts are saved per-user and restored on the next visit. **Dashboard Profiles** let you save multiple named layouts and switch between them instantly.

### Solar & Propagation Data

Solar Flux Index (SFI), A-index, K-index, sunspot number, and estimated MUF — with color-coded indicators to tell you at a glance whether conditions favor DX.

### DX Cluster Band Activity

A live band activity heatmap pulls data from a DX cluster and shows spot counts across HF bands, broken down by region.

### PSK Reporter Spot Map

Fetches spots from PSKReporter.info and plots them on an interactive world map. Band-colored circle markers, SNR values, greyline terminator overlay. Spots auto-refresh every 5 minutes.

### Notifications

- **Email** (SMTP/Gmail)
- **Telegram** bot messages
- **IFTTT** webhooks
- **ntfy** push notifications (free, self-hostable; iOS/Android app)

### Multi-User Access

Admin and Read-Only roles. Admins have full access; read-only users can view the dashboard and monitor conditions but cannot make changes.

---

## How It's Built

Ham Shack Navigator runs as a Docker container. The backend is a **FastAPI** (Python) application with a SQLite database. The frontend is plain HTML/CSS/JavaScript — Bootstrap 5, Leaflet.js for maps, vanilla ES modules. Everything is served over HTTPS via an nginx reverse proxy with an auto-generated self-signed certificate.

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) or Docker Engine + Docker Compose (Linux/Pi)
- An [OpenWeatherMap](https://openweathermap.org/api) API key (free tier works)
- A [Tomorrow.io](https://www.tomorrow.io/) API key (free tier works)

**Optional:**
- FlexRadio 6000/6400 series (SmartSDR required for DAX audio/CW decoding)
- TP-Link Kasa smart plugs/strips
- Shelly smart relays (Gen 1 or Gen 2)
- Home Assistant instance
- QRZ.com XML Data subscription (for callsign lookups)
- Telegram bot (for mobile notifications)
- ntfy topic (for push notifications — free at ntfy.sh or self-hosted)
- SMTP server (for email notifications)

---

## Installation

### Windows

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/). During installation, enable the WSL 2 backend when prompted.

2. Clone the repository (or extract the ZIP archive) and open PowerShell in the project folder:
   ```powershell
   git clone https://github.com/wild4gadgets/Ham-Shack-Navigator.git
   cd Ham-Shack-Navigator
   ```

3. Create your `.env` file:
   ```powershell
   Copy-Item .env.example .env
   ```

4. Open `.env` in a text editor. Generate a random JWT secret and paste it in:
   ```powershell
   # Run in PowerShell to generate the secret:
   -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
   ```
   Set `TZ` to your local timezone (e.g., `TZ=America/Chicago`).

5. Start the application:
   ```powershell
   docker compose up --build -d
   ```

6. Open **https://localhost:5000** in your browser. Click through the certificate warning (expected — the container generates a self-signed cert on first start).

### macOS

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/).

2. Clone the repository and open Terminal in the project folder:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Ham-Shack-Navigator.git
   cd Ham-Shack-Navigator
   ```

3. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```

4. Generate a JWT secret and set it in `.env`:
   ```bash
   openssl rand -hex 32
   ```
   Also set `TZ` to your local timezone (e.g., `TZ=America/Los_Angeles`).

5. Start the application:
   ```bash
   docker compose up --build -d
   ```

6. Open **https://localhost:5000**. If Safari blocks the certificate, use Chrome or Firefox instead.

### Linux / Raspberry Pi

1. Install Docker Engine and Docker Compose:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in, then verify:
   docker --version
   ```

2. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Ham-Shack-Navigator.git
   cd Ham-Shack-Navigator
   ```

3. Create and populate your `.env` file:
   ```bash
   cp .env.example .env
   # Generate a secret:
   openssl rand -hex 32
   # Paste it into .env as JWT_SECRET=...
   # Also set TZ=America/Denver (or your timezone)
   ```

4. Start the application:
   ```bash
   docker compose up --build -d
   ```
   On a Raspberry Pi 4, the first build takes about 3–5 minutes.

5. Open **https://localhost:5000** on the Pi, or **https://\<pi-ip\>:5000** from another device on your network.

> **Custom SSL:** If you have a domain name pointed at your server, place your certificate and private key at `./ssl/cert.pem` and `./ssl/key.pem` before starting. The nginx container picks them up automatically. Let's Encrypt certificates are supported.

---

## Initial Setup

On first launch, the app shows a setup form — enter your email address and a password to create the admin account (the first account is automatically admin).

Then go to **Settings** and configure at minimum:

1. **Station Info** — callsign, city, latitude/longitude, and unit preference. You can type a city name, GPS coordinates, or a Maidenhead grid square and the system looks up the location automatically.
2. **API Keys** — paste your OpenWeatherMap and Tomorrow.io API keys. Weather data will not load until both are entered.

All other settings (equipment, notifications, integrations) are optional and can be added later.

---

## Updating

Always rebuild after pulling new code — backend changes are baked into the image:

```bash
git pull
docker compose up --build -d
```

Running `docker compose up -d` without `--build` after a `git pull` will start the **old** image.

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

---

## Emergency Password Reset

If you are locked out of your admin account, use the included `init.sh` script while the container is running:

```bash
# Linux/macOS:
./init.sh your@email.com NewP@ssword1

# Windows (PowerShell):
bash init.sh your@email.com NewP@ssword1
```

---

## Viewing Logs

```bash
# Follow live:
docker compose logs app -f

# Last 50 lines:
docker compose logs app --tail=50
```

---

## License

MIT
