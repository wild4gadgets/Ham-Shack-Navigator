import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
import bcrypt

SECRET_KEY = os.getenv("JWT_SECRET", "insecure-default-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# ── WebSocket one-time tickets ────────────────────────────────────────────────
# Short-lived (30 s), single-use tokens that replace long-lived JWTs in WS URLs.
# JWTs in query strings appear in nginx access logs; tickets do not.

_ws_tickets: dict[str, float] = {}  # ticket → monotonic expiry
_WS_TICKET_TTL = 30  # seconds


def create_ws_ticket() -> str:
    ticket = secrets.token_urlsafe(32)
    now = time.monotonic()
    # Prune expired entries to prevent unbounded growth
    expired = [k for k, v in _ws_tickets.items() if v < now]
    for k in expired:
        del _ws_tickets[k]
    _ws_tickets[ticket] = now + _WS_TICKET_TTL
    return ticket


def consume_ws_ticket(ticket: str) -> bool:
    """Validate and consume a ticket. Returns True once; False thereafter."""
    now = time.monotonic()
    expiry = _ws_tickets.pop(ticket, None)
    return expiry is not None and expiry >= now


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {"sub": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str:
    """Returns email (sub) or raises JWTError."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    email: str = payload.get("sub")
    if not email:
        raise JWTError("No subject in token")
    return email
