from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import CREDENTIALS_EXCEPTION
from app.auth.passwords import hash_password, verify_password
from app.auth.schemas import RegisterRequest, TokenResponse
from app.auth.tokens import create_access_token, create_refresh_token
from app.models.user import User


def register(request: RegisterRequest, db: Session) -> User:
    if request.password != request.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match"
        )

    existing_user = db.execute(
        select(User).where(User.email == request.email)
    ).scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    new_user = User(email=request.email, password_hash=hash_password(request.password))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


def login(email: str, password: str, db: Session) -> TokenResponse:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise CREDENTIALS_EXCEPTION

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)
