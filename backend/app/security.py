import base64
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

settings = get_settings()

# Any string works as ENCRYPTION_KEY; it is stretched into a valid Fernet key.
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.encryption_key.encode()).digest()))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expires}, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> str | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"]).get("sub")
    except jwt.PyJWTError:
        return None


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str | None:
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def mask(value: str) -> str:
    return value[:4] + "••••" + value[-4:] if len(value) > 10 else "••••"
