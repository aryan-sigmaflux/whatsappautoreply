# Sigmaflux Auto Reply

Keyword auto-replies for WhatsApp numbers connected through **GetGabs**. GetGabs' own
auto-reply is unreliable, so GetGabs only forwards incoming messages to our webhook; we
match keywords and send the reply back through the GetGabs send API.

- Frontend: `https://webhook.sigmaflux.in` (Vercel, root directory `frontend/`)
- Backend: `https://api.webhook.sigmaflux.in` (Docker container on the VPS)
- Repo: `https://github.com/aryan-sigmaflux/whatsappautoreply` (branch `main`)
- Users are the Sigmaflux team. There is no signup; everyone sees every workspace.

## Layout

```
backend/                  FastAPI + async SQLAlchemy (asyncpg), Python 3.12
  app/main.py             app, CORS, create_all + admin seed on startup, /media static mount
  app/config.py           Settings from env / .env (see backend/.env.example)
  app/models.py           User, Workspace, Trigger, Flow, FlowSession, ProcessedMessage
  app/schemas.py          Pydantic models, incl. one response model per reply type + WhatsApp limits
  app/security.py         bcrypt, JWT (PyJWT), Fernet encryption for GetGabs API keys
  app/deps.py             current_user, workspace_or_404
  app/routers/            auth, workspaces, triggers (+ /try), flows (+ /simulate), uploads, webhook
  app/services/matcher.py extract_text() + find_match(): all matching rules live here
  app/services/getgabs.py build_message() (trigger -> GetGabs payload) + send()
  app/services/flows.py   flow engine: pure functions (run, choose, next_target, clean_graph)
  app/services/conversation.py  what to send for one inbound message (flows + triggers)
  app/create_user.py      CLI: add a login / reset a password
frontend/                 Next.js 16 App Router, React 19, Tailwind 4, React Query, zustand
  lib/api.ts              types, fetch wrapper, all endpoint calls, labels
  store/session.ts        persisted token, user, selected workspaceId
  components/AppShell.tsx sidebar (Setup, Auto Reply, Flow Builder), workspace switcher, auth guard;
                          `bare` prop = no sidebar (used by the full-screen flow canvas)
  components/ResponseForm.tsx   per-reply-type forms + validation, shared by triggers and flow steps
  components/TriggerEditor.tsx  create/edit keyword trigger
  components/ResponsePreview.tsx WhatsApp-style preview
  components/TryMessageModal.tsx "Try a message" (dry run, sends nothing)
  components/flow/        Flow Builder: FlowBuilder (canvas, palette, save), nodes (step components,
                          handles, BuilderContext), NodeEditor (side panel), TestPanel (chat simulator)
  app/setup, app/auto-reply, app/auto-reply/new, app/auto-reply/[id], app/flows, app/flows/[id], app/login
screenshots/              GetGabs UI references (gitignored)
```

## Core concepts

- **Workspace** = one GetGabs account. It stores the GetGabs API key (Fernet-encrypted with
  `ENCRYPTION_KEY`) and a random `webhook_token`. GetGabs payloads have no account id and no
  signature, so the URL `/webhook/{token}` is the only thing that routes a message to its
  workspace. "Generate new URL" rotates the token.
- **Trigger**: `match_type` is `equals | contains | any`, plus `keywords[]` and an optional
  `source` (matched against `referral_source_domain`, e.g. `facebook`). `response_type` is
  `text | file | quick_reply | cta_url | list | location | flow`, and `response` is JSONB validated
  by `RESPONSE_MODELS[response_type]`. A `flow` trigger's response is `{flow_id}` and starts that flow.
- **Matching** (`matcher.py`) ignores case and repeated whitespace. Priority: Equals >
  Contains > Any. Within a level, a source-restricted trigger beats an unrestricted one, then
  the longest Contains keyword, then the oldest trigger. Exactly one reply per message.
  - Contains is a plain substring match, so "pest" matches "pesticide".
- **Button/list taps** arrive with `message_text` as a JSON string. `extract_text()` matches
  on the tapped title, which lets triggers chain. Media messages give empty text, so only
  Any triggers fire for them.
- **`{{name}}`** in reply text is replaced with the payload's `profile_name`.

## Flows

- **Flow** = `graph` JSONB in React Flow's shape: `nodes [{id, type, position, data}]` and
  `edges [{id, source, sourceHandle, target}]`. `status` is `active | draft`; drafts never run.
- **Step types** (`services/flows.py` docstring has the exact `data` shapes):
  - `start`: exactly one, can't be deleted. Output `next`.
  - `send`: text, file, cta_url or location. Output `next`; chains straight on.
  - `buttons` (quick reply) and `list`: wait for a reply. One output per button/row id, plus `default`.
  - `question`: sends text and waits. One output per case (`equals`/`contains` keywords), plus `default`.
  - A step with nothing connected ends the flow. `MAX_STEPS = 25` stops loops of sending steps.
- **Choosing an option:** the reply's text equals a button/row title (or its id), or matches a
  case's keywords.
- **FlowSession** (one row per workspace + contact) stores the waiting step. It expires after
  24 hours (`SESSION_HOURS`).
- **Saving:** a draft may be incomplete. Saving as Active runs `clean_graph(strict=True)`, which
  checks every step and requires the Trigger to be connected. Saving always drops connections
  to options that no longer exist.
- `nodeHandles` / `nodeProblem` in `components/flow/nodes.tsx` mirror the backend's handles and
  validation; keep the two in sync.
- A flow can't be deleted while a trigger uses it (409).
- `/flows/{id}/simulate` runs the unsaved canvas graph for the Test panel and sends nothing.

## Webhook flow (`routers/webhook.py`)

GetGabs treats anything except a fast 200 as a failure and retries. The handler:
1. Looks up the workspace by token (unknown token → 404) and sets `last_webhook_at`.
2. Inserts `(workspace_id, message_id)` into `processed_messages` with ON CONFLICT DO
   NOTHING. A duplicate means a retry and is ignored.
3. Ignores paused workspaces and `direction != inbound`.
4. Returns 200, then `conversation.handle()` decides what to send, in a `BackgroundTask`:
   1. The contact is mid-flow and the reply picks an option → follow that path.
   2. Otherwise an **Equals** keyword trigger wins, even mid-flow (so "hi" restarts).
   3. Mid-flow with a `default` path → follow it.
   4. Otherwise the normal trigger matching.
   - A non-flow trigger ends the contact's flow.
   - If nothing fires, the contact stays where they were, so a later button tap still works.

Send failures are only written to the container log. There is no message log in the UI;
the user chose not to have one.

## GetGabs API (from their Postman docs)

Docs: https://documenter.getpostman.com/view/40451098/2sAYJ1k2VV
(The raw collection JSON is at `documenter.gw.postman.com/api/collections/40451098/2sAYJ1k2VV`.)

- Send: `POST https://app.getgabs.com/sendservicemessages/sendmessages`. JSON body with
  `to`, `api_key`, `messaging_product: "whatsapp"`, `recipient_type: "individual"`, and
  Meta-style `type` + content (`text`, `image|video|audio|document {link, caption, filename}`,
  `interactive` of type `button | cta_url | list`, `location`). Success means the response
  has `messages[0].id`.
- Incoming webhook fields: `message_id`, `message_from`, `message_text`, `message_type`,
  `message_sub_type`, `direction`, `profile_name`, `referral_source_domain`,
  `referral_source_type`.
- Service messages only reach customers inside the 24-hour window, which an inbound
  message always opens.
- Templates (`/whatsappbusiness/send-templated-message`) are not used.

## Conventions

- **Frontend: read `frontend/AGENTS.md`.** Next.js 16 differs from older versions; check
  `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs.
  - Pages are client components wrapped in `<AppShell>`.
  - Use `useParams()` for route params. Avoid `useSearchParams` (it needs Suspense).
  - Page files may only export the default component; shared pieces go in `components/`.
- Input components in `components/ui.tsx` are typed with `React.ComponentProps<'input'>`
  etc., so `ref` passes through (React 19).
- API base URL comes from `NEXT_PUBLIC_API_URL`, which is baked in at build time, so
  redeploy Vercel after changing it.
- Backend errors are `HTTPException(detail=str)`. The frontend's `errorMessage()` also
  flattens FastAPI 422 lists.
- **No migrations.** Tables come from `Base.metadata.create_all` at startup, which creates
  new tables but never alters existing ones. Changing columns needs Alembic or a manual
  `ALTER TABLE` on the VPS.
- Git: commit as the user only. **No Claude co-author / attribution lines** in commits or PRs.

## Checking changes

- Frontend: `cd frontend && npx next build && npx eslint .`
- UI: Playwright works for checking the canvas. Run a backend on `pgserver` plus `next dev`, and
  seed the session via localStorage key `autoreply-session` (zustand persist: `{state:{token,user,workspaceId}}`).
- Backend: there is no test suite yet. For a real-Postgres check, use the `pgserver` pip
  package (embedded Postgres) with FastAPI's `TestClient`, and monkeypatch
  `app.services.getgabs.send` so nothing is sent.
  - Don't use other projects' database credentials for this.

## Production (VPS)

- `ssh aryan@185.193.19.205`: Ubuntu 24.04 managed by **aaPanel**. It hosts many other
  projects (CRM, ambe, memorae, bniconnect, n8n…). **Don't touch anything that isn't ours.**
  - Ports in use: 8000, 8001, 8003, 8005, 8010, 8100, 8101, 5433, 6380, 55432, 9000/9001,
    11434, 13762 (panel).
- **Container** `autoreply-api`: built from `~/whatsappautoreply/backend` and run with
  `--network host`. It listens on `127.0.0.1:8020` (`HOST`/`PORT` in `.env`).
- **Data:**
  - Env file: `~/whatsappautoreply/backend/.env` (chmod 600, never commit it).
  - Uploaded media: `~/whatsappautoreply-data/media`, mounted at `/data/media`.
- **Database:** aaPanel Postgres 16 at `127.0.0.1:5432`, database `autoreply`, role
  `autoreply`. Its psql is `/www/server/pgsql/bin/psql -U postgres -h 127.0.0.1`
  (local connections are `trust`).
- **nginx is aaPanel's:**
  - Binary: `/www/server/nginx/sbin/nginx -c /www/server/nginx/conf/nginx.conf`. Always run
    `-t` before `-s reload`.
  - Site: `/www/server/panel/vhost/nginx/api.webhook.sigmaflux.in.conf`, created in aaPanel
    with an aaPanel SSL certificate.
  - Reverse proxy: `/www/server/panel/vhost/nginx/proxy/api.webhook.sigmaflux.in/autoreply_api.conf`
    (`location ^~ /` → `127.0.0.1:8020`, `client_max_body_size 110m`).
- **Cloudflare DNS:** `api.webhook` and `webhook` must stay **DNS only (grey cloud)**. The
  free Cloudflare certificate doesn't cover two-level subdomains, so the orange cloud breaks
  HTTPS.
- **CORS** allows `https://webhook.sigmaflux.in` and `http://localhost:3000` (`CORS_ORIGINS`).
  Add Vercel preview URLs there if they're needed.
- Logs: `docker logs -f autoreply-api`.
- Redeploy the backend:
  ```bash
  cd ~/whatsappautoreply && git pull && cd backend && docker build -t autoreply-api . && \
  docker rm -f autoreply-api && docker run -d --name autoreply-api --restart unless-stopped \
    --network host --env-file ~/whatsappautoreply/backend/.env \
    -v ~/whatsappautoreply-data/media:/data/media autoreply-api
  ```
- Add a login or reset a password:
  `docker exec -it autoreply-api python -m app.create_user EMAIL 'PASSWORD' 'Name'`
- The frontend redeploys automatically on push to `main` (Vercel).

## Not built (by choice)

- GetGabs' "Default Actions" (working hours, first message) and "Chat Distribution".
- Template, WhatsApp Flow/Form, Chatbot/AI Chatbot, Address and payment reply types.
- Flow steps that save answers ("Collected Data"), delays, or appointment booking.
- Message log, fired counts, per-contact cooldown.
- A users page (logins are managed by CLI).
