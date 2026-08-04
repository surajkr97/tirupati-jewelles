from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth.tokens import decode_access_token
from app.core.config import settings
from app.database import get_db
from app.models.user import User

# auto_error=False so a missing header falls through to the cookie check below
# instead of raising 401 on its own. Keeping the scheme registered is what gives
# Swagger its Authorize button.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_token(
    header_token: str | None = Depends(oauth2_scheme),
    cookie_token: str | None = Cookie(None, alias=settings.cookie_name),
) -> str:
    """Accept the token from either transport.

    The browser sends it as an httpOnly cookie; Swagger and any non-browser
    client send it as `Authorization: Bearer`. An explicit header wins so you
    can test as another user in /docs while still logged in as yourself.
    """
    token = header_token or cookie_token
    if token is None:
        raise CREDENTIALS_EXCEPTION
    return token


def get_current_user(
    token: str = Depends(get_token), db: Session = Depends(get_db)
) -> User:
    user_id = decode_access_token(token)
    if user_id is None:
        raise CREDENTIALS_EXCEPTION

    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_EXCEPTION
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
