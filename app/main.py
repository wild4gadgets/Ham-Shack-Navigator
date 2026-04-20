# Patch zoneinfo before python-kasa is imported so Kasa devices that report
# POSIX timezone strings (e.g. "MST7MDT") don't crash on ZoneInfoNotFoundError.
import zoneinfo as _zi

_POSIX_TZ_MAP = {
    "MST7MDT": "America/Denver",
    "EST5EDT": "America/New_York",
    "CST6CDT": "America/Chicago",
    "PST8PDT": "America/Los_Angeles",
    "MST": "America/Phoenix",
    "HST": "Pacific/Honolulu",
    "AST4ADT": "America/Halifax",
}
_OrigZoneInfo = _zi.ZoneInfo

class _ZoneInfoCompat(_OrigZoneInfo):
    def __new__(cls, key):
        return _OrigZoneInfo(_POSIX_TZ_MAP.get(key, key))

_zi.ZoneInfo = _ZoneInfoCompat

import logging
logging.basicConfig(level=logging.INFO)

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import init_db
from ws_manager import manager
from auth import consume_ws_ticket
from scheduler import start_scheduler, shutdown_scheduler
from limiter import limiter

from routers import (
    setup as setup_router,
    auth as auth_router,
    users as users_router,
    settings as settings_router,
    weather as weather_router,
    monitoring as monitoring_router,
    kasa as kasa_router,
    shelly as shelly_router,
    shutdown as shutdown_router,
    events as events_router,
    workflows as workflows_router,
    ha_state as ha_state_router,
    dashboard_pins as dashboard_pins_router,
    solar as solar_router,
    dxcluster as dxcluster_router,
    pskreporter as pskreporter_router,
    qrz as qrz_router,
    flexradio as flexradio_router,
    webhook as webhook_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_scheduler()
    yield
    await shutdown_scheduler()


app = FastAPI(
    title="Ham Shack Cockpit",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# API routers
prefix = "/api/v1"
app.include_router(setup_router.router, prefix=prefix)
app.include_router(auth_router.router, prefix=prefix)
app.include_router(users_router.router, prefix=prefix)
app.include_router(settings_router.router, prefix=prefix)
app.include_router(weather_router.router, prefix=prefix)
app.include_router(monitoring_router.router, prefix=prefix)
app.include_router(kasa_router.router, prefix=prefix)
app.include_router(shelly_router.router, prefix=prefix)
app.include_router(shutdown_router.router, prefix=prefix)
app.include_router(events_router.router, prefix=prefix)
app.include_router(workflows_router.router, prefix=prefix)
app.include_router(ha_state_router.router, prefix=prefix)
app.include_router(dashboard_pins_router.router, prefix=prefix)
app.include_router(solar_router.router, prefix=prefix)
app.include_router(dxcluster_router.router, prefix=prefix)
app.include_router(pskreporter_router.router, prefix=prefix)
app.include_router(qrz_router.router, prefix=prefix)
app.include_router(flexradio_router.router, prefix=prefix)
app.include_router(webhook_router.router, prefix=prefix)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket, ticket: str = Query(...)):
    if not consume_ws_ticket(ticket):
        await websocket.close(code=4001)
        return

    await manager.connect(websocket)
    try:
        while True:
            # Keep alive — clients send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Serve static files (SPA)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
