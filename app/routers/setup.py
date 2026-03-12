from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from dependencies import get_db
from models import User
from schemas import SetupRequest, TokenResponse
from auth import hash_password, create_access_token

router = APIRouter(tags=["setup"])


@router.get("/setup/status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count()).select_from(User))
    count = result.scalar()
    return {"needs_setup": count == 0}


@router.post("/setup", response_model=TokenResponse, status_code=201)
async def setup(body: SetupRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar() > 0:
        raise HTTPException(status_code=403, detail="Setup already completed")

    user = User(email=body.email, hashed_pw=hash_password(body.password))
    db.add(user)
    await db.commit()

    token = create_access_token(body.email)
    return {"access_token": token}
