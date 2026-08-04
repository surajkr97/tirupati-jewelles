from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings

REFRESH_TOKEN_EXPIRE_DAYS = 30


def _encode(user_id: int, secret: str, expires_in: timedelta) -> str:
    return jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) + expires_in},
        secret,
        algorithm=settings.algorithm,
    )


def _decode(token: str, secret: str) -> int | None:
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.algorithm])
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None


def create_access_token(user_id: int) -> str:
    expires_in = timedelta(minutes=settings.access_token_expire_minutes)
    return _encode(user_id, settings.secret_key, expires_in)


def create_refresh_token(user_id: int) -> str:
    expires_in = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return _encode(user_id, settings.refresh_token_secret, expires_in)


def decode_access_token(token: str) -> int | None:
    return _decode(token, settings.secret_key)


def decode_refresh_token(token: str) -> int | None:
    return _decode(token, settings.refresh_token_secret)
