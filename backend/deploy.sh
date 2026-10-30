#!/usr/bin/env bash
# Rebuild and restart the autoreply-api container on the VPS.
#
# GitHub Actions runs this on every push to main that changes backend/. By hand:
#   cd ~/whatsappautoreply && git pull --ff-only && bash backend/deploy.sh
#
# If the new container doesn't answer /health, the previous image is started again.
set -euo pipefail

NAME=autoreply-api
ROOT="$HOME/whatsappautoreply"
ENV_FILE="$ROOT/backend/.env"
MEDIA="$HOME/whatsappautoreply-data/media"
HEALTH=http://127.0.0.1:8020/health

start() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped --network host \
    --env-file "$ENV_FILE" -v "$MEDIA:/data/media" "$1" >/dev/null
}

healthy() {
  for _ in $(seq 1 30); do
    curl -fs "$HEALTH" >/dev/null && return 0
    sleep 1
  done
  return 1
}

cd "$ROOT/backend"
echo "Deploying $(git log -1 --format='%h %s')"

# Keep the running image as :previous so a broken build can be rolled back.
old_previous=$(docker image inspect -f '{{.Id}}' "$NAME:previous" 2>/dev/null || true)
docker image tag "$NAME:latest" "$NAME:previous" 2>/dev/null || true

docker build -q -t "$NAME:latest" . >/dev/null
start "$NAME:latest"

if ! healthy; then
  echo "New container isn't healthy. Last log lines:"
  docker logs --tail 40 "$NAME" 2>&1 || true
  if docker image inspect "$NAME:previous" >/dev/null 2>&1; then
    echo "Rolling back to the previous image."
    start "$NAME:previous"
    healthy && echo "Previous version is running again." || echo "Previous version isn't healthy either."
  fi
  exit 1
fi

# Delete the image that just lost its :previous tag (only ours, only if nothing else uses it).
if [ -n "$old_previous" ] && [ "$(docker image inspect -f '{{len .RepoTags}}' "$old_previous" 2>/dev/null)" = "0" ]; then
  docker image rm "$old_previous" >/dev/null 2>&1 || true
fi

echo "Deployed and healthy."
