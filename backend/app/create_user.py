"""
Create a team login, or reset an existing user's password.

    docker exec -it autoreply-api python -m app.create_user you@sigmaflux.com 'password' 'Your Name'
"""

import asyncio
import sys

from sqlalchemy import func, select

from app.database import Base, SessionLocal, engine
from app.models import User
from app.security import hash_password


async def main(email: str, password: str, name: str) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(func.lower(User.email) == email.lower()))
        if user:
            user.password_hash = hash_password(password)
            user.is_active = True
            print(f"Password reset for {email}")
        else:
            db.add(User(email=email.lower(), name=name, password_hash=hash_password(password)))
            print(f"Created {email}")
        await db.commit()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: python -m app.create_user EMAIL PASSWORD [NAME]")
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else sys.argv[1].split("@")[0]))
