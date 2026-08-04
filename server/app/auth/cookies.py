from fastapi import Response

from app.core.config import settings

# Browsers match a cookie for deletion on name + path + domain. If these differ
# even slightly between set and delete, the delete silently does nothing and the
# user stays logged in — so both paths read from the same place.
COOKIE_PATH = "/"


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        samesite=settings.cookie_samesite,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path=COOKIE_PATH,
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.cookie_name,
        httponly=True,
        samesite=settings.cookie_samesite,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path=COOKIE_PATH,
    )
