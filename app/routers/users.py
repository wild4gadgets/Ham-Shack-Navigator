from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import get_db, get_current_user
from models import User
from schemas import ChangePasswordRequest
from auth import verify_password, hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.put("/me/password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_pw):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    current_user.hashed_pw = hash_password(body.new_password)
    db.add(current_user)
    await db.commit()
    return {"detail": "Password updated"}
