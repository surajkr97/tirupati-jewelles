# server/tests/test_auth.py
import pytest

from app.core.config import settings

EMAIL = "suraj@example.com"
PASSWORD = "supersecret123"


@pytest.fixture()
def registered(client):
    client.post(
        "/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "confirm_password": PASSWORD},
    )
    return client


def login(client, password=PASSWORD):
    # OAuth2PasswordRequestForm reads form-encoded data, not JSON, and names the
    # field `username` even though we look the user up by email.
    return client.post("/auth/login", data={"username": EMAIL, "password": password})


def test_register_rejects_mismatched_passwords(client):
    res = client.post(
        "/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "confirm_password": "different"},
    )
    assert res.status_code == 400


def test_register_rejects_duplicate_email(registered):
    res = registered.post(
        "/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "confirm_password": PASSWORD},
    )
    assert res.status_code == 400


def test_login_sets_httponly_cookie(registered):
    res = login(registered)
    assert res.status_code == 200

    cookie = res.headers["set-cookie"]
    assert settings.cookie_name in cookie
    assert "HttpOnly" in cookie
    assert f"SameSite={settings.cookie_samesite}".lower() in cookie.lower()


def test_login_with_wrong_password_returns_401(registered):
    assert login(registered, password="wrongpassword").status_code == 401


def test_me_works_via_cookie_alone(registered):
    login(registered)
    # TestClient keeps the cookie jar, so no Authorization header is sent here.
    res = registered.get("/auth/me")
    assert res.status_code == 200
    assert res.json()["email"] == EMAIL


def test_me_works_via_bearer_header(registered):
    token = login(registered).json()["access_token"]
    registered.cookies.clear()
    res = registered.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_me_without_credentials_returns_401(client):
    assert client.get("/auth/me").status_code == 401


def test_me_with_garbage_token_returns_401(client):
    res = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


def test_cors_preflight_allows_credentials_from_the_frontend(client):
    # Without these two headers the browser drops the auth cookie silently and
    # every protected request 401s with no useful error in the console.
    res = client.options(
        "/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert res.headers["access-control-allow-credentials"] == "true"


def test_cors_rejects_unlisted_origin(client):
    res = client.options(
        "/auth/login",
        headers={
            "Origin": "http://evil.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in res.headers


def test_logout_clears_the_cookie(registered):
    login(registered)
    res = registered.post("/auth/logout")
    assert res.status_code == 204

    # The cookie is gone from the jar, so the next call is unauthenticated.
    assert registered.get("/auth/me").status_code == 401
