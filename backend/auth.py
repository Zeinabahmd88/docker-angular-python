import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from database import SessionLocal
from models import User


# Set a real secret before using this outside your own computer:
#   PowerShell:  $env:SECRET_KEY = "<long random text>"
#   Generate one: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # the user logs in again after 24 hours

password_hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)

# Used so a login for an unknown email takes about as long as a real one
_DUMMY_HASH = password_hasher.hash("not-a-real-password")


def get_db():
    """Open a database session for each request and always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def authenticate(db: Session, email: str, password: str) -> User | None:
    """Return the user if the email and password are correct, otherwise None."""
    user = db.query(User).filter(User.email == email).first()

    if user is None:
        password_hasher.verify(password, _DUMMY_HASH)
        return None

    if not password_hasher.verify(password, user.password_hash):
        return None

    return user


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise unauthorized

    user = db.query(User).filter(User.id == user_id).first()

    if user is None:
        raise unauthorized

    return user