from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    # Shared secret for the X-Refresh-Key header on POST /rates/internal/refresh.
    refresh_secret_key: str
    # Signs refresh JWTs. Never leaves the server — keep distinct from refresh_secret_key.
    refresh_token_secret: str

    # Auth cookie. Locally the frontend (:3000) and API (:8000) are same-site, so
    # lax/insecure works. In production they sit on different domains, which makes
    # the cookie cross-site — that needs samesite="none" and secure=True.
    cookie_name: str = "access_token"
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_secure: bool = False
    cookie_domain: str | None = None

    class Config:
        env_file = ".env"


settings = Settings()
