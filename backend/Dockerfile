FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=127.0.0.1 \
    PORT=8010

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /data/media
VOLUME ["/data/media"]

# Runs with --network host so it can reach the host's PostgreSQL on 127.0.0.1;
# nginx on the host proxies api.webhook.sigmaflux.in to HOST:PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host $HOST --port $PORT --proxy-headers --forwarded-allow-ips='*'"]
