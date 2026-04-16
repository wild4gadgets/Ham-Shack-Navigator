from fastapi import Request
from slowapi import Limiter


def _get_real_ip(request: Request) -> str:
    """Use X-Real-IP set by nginx; fall back to direct connection IP."""
    return request.headers.get("X-Real-IP") or request.client.host


limiter = Limiter(key_func=_get_real_ip)
