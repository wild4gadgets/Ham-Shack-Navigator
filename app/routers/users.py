from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user, require_admin
from models import User
from schemas import (
    ChangePasswordRequest, ChangeEmailRequest,
    CreateUserRequest, UpdateUserRoleRequest, AdminUserResponse,
)
from auth import verify_password, hash_password, create_access_token

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "role": current_user.role}


@router.put("/me/email")
async def change_email(
    body: ChangeEmailRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_pw):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    result = await db.execute(select(User).where(User.email == body.new_email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")

    current_user.email = body.new_email
    db.add(current_user)
    await db.commit()
    return {"detail": "Email updated"}


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


# --- Admin: user management ---

@router.get("", response_model=list[AdminUserResponse])
async def list_users(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [AdminUserResponse.from_orm_user(u) for u in users]


@router.post("", status_code=201)
async def create_user(
    body: CreateUserRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")

    user = User(email=body.email, hashed_pw=hash_password(body.password), role=body.role)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.from_orm_user(user)


@router.put("/{user_id}/role")
async def update_user_role(
    user_id: int,
    body: UpdateUserRoleRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = body.role
    db.add(user)
    await db.commit()
    return AdminUserResponse.from_orm_user(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.delete(user)
    await db.commit()
