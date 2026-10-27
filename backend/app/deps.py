import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Workspace
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = decode_access_token(creds.credentials) if creds else None
    user = await db.get(User, uuid.UUID(user_id)) if user_id else None
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


async def workspace_or_404(
    workspace_id: uuid.UUID,
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    ws = await db.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return ws
