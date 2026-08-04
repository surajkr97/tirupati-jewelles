from fastapi import APIRouter, Depends, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.cookies import clear_auth_cookie, set_auth_cookie
from app.auth.dependencies import get_current_user
from app.auth.schemas import RegisterRequest, TokenResponse
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    return service.register(request, db)


@router.post("/login", response_model=TokenResponse)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    tokens = service.login(form_data.username, form_data.password, db)
    # Browsers get the token as an httpOnly cookie and ignore the body; Swagger
    # and non-browser clients read the body and send it back as a header.
    set_auth_cookie(response, tokens.access_token)
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    # Deliberately unauthenticated: logging out with an already-expired token
    # should still clear the cookie rather than fail with a 401.
    clear_auth_cookie(response)


@router.get("/me", response_model=UserOut)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    return current_user
