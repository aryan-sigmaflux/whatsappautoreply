# Sigmaflux Auto Reply

Keyword auto replies for GetGabs WhatsApp accounts. GetGabs forwards incoming
messages to our webhook; we match them against keyword triggers and reply
through the GetGabs send API.

| Part     | Where                               | Stack                                   |
| -------- | ----------------------------------- | --------------------------------------- |
| Frontend | `webhook.sigmaflux.in` (Vercel)     | Next.js 16, Tailwind 4, React Query     |
| Backend  | `api.webhook.sigmaflux.in` (VPS)    | FastAPI in Docker, PostgreSQL on host   |

## How it works

- **Workspaces** — each connected GetGabs account is a workspace with its own
  API key (encrypted at rest) and its own secret webhook URL,
  `https://api.webhook.sigmaflux.in/webhook/<token>`. GetGabs payloads carry
  no account id, so the token in the URL is what routes a message to its account.
- **Webhook** — answers `200` immediately (GetGabs counts slow or non-200
  responses as failures and retries), drops duplicates by `message_id`, ignores
  outbound echoes, then replies in the background.
- **Matching** — case- and whitespace-insensitive. Equals beats Contains beats
  Any message; a trigger limited to the chat's source (e.g. `facebook`) beats an
  unrestricted one; the longest Contains keyword wins. One reply per message.
  Quick-reply and list taps are matched on the tapped title, so triggers can chain.
- **Replies** — Text, File (image/video/audio/document), Quick Reply (≤3
  buttons), CTA URL, List and Location, sent as GetGabs *service messages*
  (`POST app.getgabs.com/sendservicemessages/sendmessages`). `{{name}}` becomes
  the customer's WhatsApp profile name.
- **Uploads** are stored on the VPS (`/data/media` volume) and served publicly
  at `/media/...` under random names so WhatsApp can download them.

## Deploy the backend (VPS)

### 1. DNS
- `api.webhook.sigmaflux.in` → A record to the VPS IP.
- `webhook.sigmaflux.in` → CNAME to Vercel (Vercel shows the exact value).

### 2. Database (host PostgreSQL)
```bash
sudo -u postgres psql <<'SQL'
CREATE USER autoreply WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE autoreply OWNER autoreply;
SQL
```
Tables are created automatically on first start.

### 3. Config
```bash
sudo mkdir -p /opt/autoreply/media
sudo cp backend/.env.example /opt/autoreply/.env
sudo nano /opt/autoreply/.env   # fill DATABASE_URL, SECRET_KEY, ENCRYPTION_KEY, ADMIN_*
```
Generate secrets with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
Keep `ENCRYPTION_KEY` safe and unchanged: if it changes, saved API keys can't be decrypted and must be re-entered.

### 4. Build and run (plain Docker, no compose)
```bash
cd backend
docker build -t autoreply-api .
docker run -d --name autoreply-api --restart unless-stopped \
  --network host \
  --env-file /opt/autoreply/.env \
  -v /opt/autoreply/media:/data/media \
  autoreply-api
docker logs -f autoreply-api
curl http://127.0.0.1:8010/health
```
`--network host` lets the container reach PostgreSQL on `127.0.0.1:5432`. The API
listens on `127.0.0.1:8010` only (change with `-e PORT=...`).

Update later:
```bash
docker build -t autoreply-api . && docker rm -f autoreply-api && <the docker run command above>
```

### 5. Nginx + HTTPS
`/etc/nginx/sites-available/api.webhook.sigmaflux.in`:
```nginx
server {
    server_name api.webhook.sigmaflux.in;
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/api.webhook.sigmaflux.in /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.webhook.sigmaflux.in
```

### 6. Team logins
The `ADMIN_EMAIL` / `ADMIN_PASSWORD` user is created on first start. Add more
people (or reset a password) with:
```bash
docker exec -it autoreply-api python -m app.create_user name@sigmaflux.com 'password' 'Full Name'
```

## Deploy the frontend (Vercel)
- Import the repo, set **Root Directory** to `frontend`.
- Environment variable: `NEXT_PUBLIC_API_URL=https://api.webhook.sigmaflux.in`
- Add the domain `webhook.sigmaflux.in`.

## Connect a GetGabs account
1. Sign in → **Setup** → **Connect account**, enter a name and the GetGabs production API key.
2. Copy the webhook URL into GetGabs' webhook settings for that number.
3. Turn off GetGabs' own keyword triggers for the same keywords, or customers get two replies.
4. Message the number from WhatsApp; Setup shows "Connected" once the webhook arrives.
5. Use **Send test** to confirm the API key, then build triggers under **Auto Reply**
   and check them with **Try a message**.

Simulate an incoming message:
```bash
curl -X POST https://api.webhook.sigmaflux.in/webhook/<token> \
  -H 'Content-Type: application/json' \
  -d '{"message_id":"test-1","message_from":"919876543210","profile_name":"Test","message_text":"price list","message_type":"text","direction":"inbound"}'
```
(Change `message_id` on each try; repeats are treated as GetGabs retries and ignored.)

## Run locally
```bash
# backend
cd backend
python -m venv venv && venv/Scripts/pip install -r requirements.txt   # venv/bin on Linux/macOS
cp .env.example .env   # point DATABASE_URL at a local DB, MEDIA_DIR=./media, PUBLIC_BASE_URL=http://localhost:8010
venv/Scripts/uvicorn app.main:app --port 8010 --reload

# frontend
cd frontend
cp .env.example .env.local
npm install && npm run dev   # http://localhost:3000
```

## Notes
- Service messages only reach customers inside WhatsApp's 24-hour window, which
  an inbound message always opens, so auto replies are fine.
- Schema changes: tables are created with `create_all` on startup, which adds new
  tables but doesn't alter existing ones. Add Alembic before changing columns.
