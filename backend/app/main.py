import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import User
from app.routers import auth, triggers, uploads, webhook, workspaces
from app.security import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


async def _seed_admin() -> None:
    if not (settings.admin_email and settings.admin_password):
        return
    async with SessionLocal() as db:
        exists = await db.scalar(select(User).where(func.lower(User.email) == settings.admin_email.lower()))
        if not exists:
            db.add(
                User(
                    email=settings.admin_email.lower(),
                    name=settings.admin_name,
                    password_hash=hash_password(settings.admin_password),
                )
            )
            await db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _seed_admin()
    yield


app = FastAPI(title="Sigmaflux Auto Reply", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(triggers.router)
app.include_router(uploads.router)
app.include_router(webhook.router)

Path(settings.media_dir).mkdir(parents=True, exist_ok=True)
# Public on purpose: WhatsApp downloads reply media from here. Names are random UUIDs.
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")


@app.get("/health")
async def health():
    return {"ok": True}
