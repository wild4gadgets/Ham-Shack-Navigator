from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user
from models import User
from schemas import LoginRequest, TokenResponse, UserResponse
from auth import verify_password, create_access_token, create_ws_ticket
from limiter import limiter
from services.monitoring_service import log_event

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_pw):
        await log_event(db, "login_failed", "warning",
                        f"Failed login attempt for {body.email}",
                        {"email": body.email, "ip": ip})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_access_token(user.email)
    await log_event(db, "login", "info",
                    f"User {user.email} logged in",
                    {"email": user.email, "ip": ip})
    return {"access_token": token}


@router.post("/ws-ticket")
async def get_ws_ticket(current_user: User = Depends(get_current_user)):
    """Issue a short-lived (30 s), single-use ticket for WebSocket authentication.
    Clients should fetch this immediately before opening the WebSocket connection."""
    return {"ticket": create_ws_ticket()}


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "role": current_user.role, "is_active": current_user.is_active}
