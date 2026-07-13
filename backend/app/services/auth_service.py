"""Authentication and RBAC."""

import uuid
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.domain.models import UserInfo, UserRole
from app.infrastructure.database import UserRecord, get_session_factory

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DEFAULT_USERS = [
    {"username": "admin", "password": "admin123", "role": UserRole.ADMIN},
    {"username": "ops", "password": "ops123", "role": UserRole.OPERATIONS},
    {"username": "mgmt", "password": "mgmt123", "role": UserRole.MANAGEMENT},
    {"username": "partner", "password": "partner123", "role": UserRole.PARTNER, "partner_scope": "Partner A"},
    {"username": "viewer", "password": "viewer123", "role": UserRole.READ_ONLY},
]


class AuthService:
    def __init__(self):
        self.settings = get_settings()

    def hash_password(self, password: str) -> str:
        return pwd_context.hash(password)

    def verify_password(self, plain: str, hashed: str) -> bool:
        return pwd_context.verify(plain, hashed)

    def create_token(self, user: UserInfo) -> str:
        expire = datetime.utcnow() + timedelta(minutes=self.settings.jwt_expire_minutes)
        payload = {
            "sub": user.id,
            "username": user.username,
            "role": user.role.value,
            "partner_scope": user.partner_scope,
            "exp": expire,
        }
        return jwt.encode(payload, self.settings.secret_key, algorithm=self.settings.jwt_algorithm)

    def decode_token(self, token: str) -> Optional[UserInfo]:
        try:
            payload = jwt.decode(
                token, self.settings.secret_key, algorithms=[self.settings.jwt_algorithm]
            )
            return UserInfo(
                id=payload["sub"],
                username=payload["username"],
                role=UserRole(payload["role"]),
                partner_scope=payload.get("partner_scope"),
            )
        except JWTError:
            return None

    def seed_users(self) -> None:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            if db.query(UserRecord).count() > 0:
                return
            for u in DEFAULT_USERS:
                record = UserRecord(
                    id=str(uuid.uuid4()),
                    username=u["username"],
                    password_hash=self.hash_password(u["password"]),
                    role=u["role"].value,
                    partner_scope=u.get("partner_scope"),
                    created_at=datetime.utcnow(),
                )
                db.add(record)
            db.commit()
        finally:
            db.close()

    def authenticate(self, username: str, password: str) -> Optional[UserInfo]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            record = db.query(UserRecord).filter(UserRecord.username == username).first()
            if not record or not self.verify_password(password, record.password_hash):
                return None
            return UserInfo(
                id=record.id,
                username=record.username,
                role=UserRole(record.role),
                partner_scope=record.partner_scope,
            )
        finally:
            db.close()

    def can_write(self, user: UserInfo) -> bool:
        return user.role in (UserRole.ADMIN, UserRole.OPERATIONS)

    def apply_partner_scope(self, user: UserInfo, filters: dict) -> dict:
        if user.role == UserRole.PARTNER and user.partner_scope:
            filters["partner"] = [user.partner_scope]
        return filters
