# Ham Shack Cockpit

A weather monitoring dashboard for ham radio operators. Monitors wind speed and lightning distance, automatically executes Kasa smart plug shutdown sequences to protect equipment, and sends email alerts.

**Features**
- Live wind and temperature gauges with forecast overlay
- Lightning distance monitoring (Tomorrow.io)
- Animated local radar map (RainViewer)
- Kasa smart plug control and automated shutdown workflows
- Email notifications and daily weather digests
- Secure login with JWT authentication

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac, or Linux)
- An [OpenWeatherMap](https://openweathermap.org/api) API key (free tier works)
- A [Tomorrow.io](https://www.tomorrow.io/) API key (free tier works)

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

**2. Start the app**

```bash
docker compose up --build -d
```

This builds both containers and starts them in the background. First build takes a few minutes.

**3. Open the app**

Navigate to: **https://localhost:5000**

Your browser will warn about a self-signed certificate — click through to proceed (this is expected).

**4. Create your account**

On first run you'll be prompted to create an admin account with your email and a password.

**5. Configure your settings**

Go to **Settings** and fill in:

- **Location** — your city, latitude/longitude, and preferred units (imperial/metric)
- **API Keys** — paste your OpenWeatherMap and Tomorrow.io keys
- **Kasa** — add your smart plug devices by IP address (optional)
- **SMTP** — email server settings for notifications (optional)

---

## Stopping the App

```bash
docker compose down
```

---

## Data

Weather settings and event history are stored in `./data/shack_weather.db` (SQLite). This directory is created automatically on first run and persists across restarts.
