# BudgetTracker

Self-hosted rewrite of the Google Sheets + Apps Script budget tracker. FastAPI + Postgres
backend, React + Vite dashboard, Telegram bot preserved as a logging frontend.

The legacy files (`BudgetTracker.gs`, `BudgetTrackerPrototype.xlsx`) are kept at the repo
root as read-only reference and seed input.

## Quickstart (local Docker)

```bash
cp .env.example .env
# fill TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY when you need the bot
docker compose up -d --build
curl http://localhost:8000/healthz
```

Expected: `{"status":"ok","db":true}`.

Dashboard: `http://localhost:5173` · API: `http://localhost:8000` · DB: `localhost:5432`.

Press **N** anywhere on the dashboard to open the quick-log drawer.

## Layout

```
backend/        FastAPI + SQLAlchemy + Alembic + APScheduler
frontend/       React + Vite + Recharts + TanStack Query
docker-compose.yml
.env.example
BudgetTracker.gs                   # legacy reference, not executed
BudgetTrackerPrototype.xlsx        # seed source for Phase 2 import
```

## Status

All seven phases landed:

1. Scaffold repo + Docker stack
2. Schema + Alembic migration + xlsx importer (973 historical txns)
3. Core CRUD API + password auth
4. Telegram bot + Gemini port
5. Subscriptions (daily reminder job + confirm/skip flow)
6. React dashboard (Overview, Monthly, Daily, Categories, Subscriptions, Transactions, Settings)
7. AWS migration notes (below)

Full plan: `/home/josia/.claude/plans/this-folder-contains-a-spicy-giraffe.md`

## AWS migration notes

The local stack is intentionally a two-file lift: `docker-compose.yml` plus the `backend/` and
`frontend/` images. The following is how each piece translates to AWS when we're ready. Nothing
here is implemented yet — it's a map, not a script.

### Target shape

```
Route 53  ─►  ACM + ALB  ──►  ECS Fargate   (backend, FastAPI)
                         └──►  CloudFront + S3  (frontend, static)
                  │
                  ├──►  RDS Postgres 16  (private subnet)
                  └──►  Secrets Manager / SSM  (Gemini key, session secret, DB url)
```

Single small region (ap-southeast-3 / Jakarta) is fine for a personal tool. Multi-AZ on the RDS
instance, single-AZ Fargate service — failover matters for data, not for a dashboard I'm the only
user of.

### Component-by-component

**Backend (FastAPI) → ECS Fargate**
- Build and push `backend/Dockerfile` to ECR: `aws ecr get-login-password | docker login …`.
- One Fargate service, 1× task, 0.5 vCPU / 1 GB. Scale to zero is not worth the cold start for a
  budget tool.
- Task role needs: Secrets Manager read, CloudWatch Logs write, S3 read if we move the xlsx seed
  out of the image.
- Health check: `GET /healthz` on the ALB target group; task definition `healthCheck` points at the
  same endpoint.
- **Gotcha:** APScheduler runs *inside* the process, so only one task replica may run at a time.
  Set `desiredCount: 1` and `maximumPercent: 100, minimumHealthyPercent: 0` so deployments replace
  rather than scale out. If we ever need >1 replica, move the daily job out to EventBridge + a Lambda
  (or a separate scheduled Fargate task) — *don't* leave APScheduler running in parallel tasks.

**Database → RDS Postgres 16**
- `db.t4g.micro` Multi-AZ, gp3 20 GB, automated backups 7 days. Public access **off** — put it in
  private subnets, Fargate reaches it via a security-group rule.
- Run `alembic upgrade head` once from a one-off task (`aws ecs run-task` with the same image and
  command override).
- Seed script: bake `BudgetTrackerPrototype.xlsx` into the image or fetch from S3, then
  `python -m app.seed.import_xlsx` one-off. After the first run, don't run it again unless
  rebuilding history.
- The existing connection string in `app/config.py` reads `DATABASE_URL` directly, so switching to
  RDS is a pure env-var change.

**Frontend → S3 + CloudFront**
- `cd frontend && npm run build` produces `dist/`. Sync to S3: `aws s3 sync dist/ s3://ledger-frontend/`.
- CloudFront in front for TLS + gzip + HTTP/2. Default root object `index.html`, error response
  404 → `index.html` (SPA routing).
- The API base URL for prod isn't hardcoded — `frontend/src/api.ts` uses `/` as prefix and goes
  through Vite's proxy in dev. For prod, either serve the frontend at the same origin behind the
  ALB (add a CloudFront behavior that forwards `/api/*` to the ALB and strips the prefix) or set
  `VITE_API_BASE` at build time and enable CORS with credentials on the backend.
- **CORS note:** the session cookie is `samesite=lax, httponly`. If the frontend is on a separate
  origin (`*.cloudfront.net`), switch to `samesite=none, secure=true` and set
  `CORSMiddleware(allow_credentials=True, allow_origins=[<frontend origin>])`.

**Secrets → Secrets Manager (or SSM Parameter Store)**
- Currently read from `.env`: `DATABASE_URL`, `SESSION_SECRET`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`,
  `GEMINI_API_KEY`, `ADMIN_PASSWORD`.
- In ECS, wire these via `secrets` in the task definition (`valueFrom: arn:aws:secretsmanager:…`).
  Fargate pulls them at task start and injects as env — no app changes required.
- Rotation: Gemini key is manual (Google console); DB password is handled by RDS if we opt in to
  managed rotation — it costs nothing and is worth it.

**Telegram webhook → ALB public listener**
- `POST /telegram/webhook` must be reachable from Telegram's edges with a valid TLS cert. Cheapest
  path: ACM cert on the ALB + a Route 53 record. Point Telegram at
  `https://ledger.example.com/telegram/webhook` via `POST /telegram/set_webhook` one-time.
- Restrict by `secret_token` header (Telegram supports this; add it to the webhook set call and
  verify on receipt) rather than trying to IP-allowlist Telegram's ranges.
- Alternative: API Gateway → Lambda → SQS → ECS. Overkill for a personal bot; skip unless we start
  fielding public traffic.

**Scheduler → stays in-process, for now**
- The daily job at 07:00 server tz is simple enough that APScheduler inside the Fargate task is
  the right answer. If we ever need it to survive task restarts at exactly 07:00, move to
  EventBridge rule → Lambda → calls `POST /subscriptions/_run_daily` (already implemented as a
  manual trigger for this reason).

### What to ship, in order

1. Terraform (or CDK) in a new `infra/` directory: VPC, ALB, ECS cluster + service, RDS, Secrets
   Manager entries, S3 + CloudFront. Keep the state in S3 + DynamoDB lock.
2. GitHub Actions: on push to `main`, build + push backend image to ECR, update service with the
   new task def revision; `npm ci && npm run build && aws s3 sync` for the frontend; invalidate
   CloudFront.
3. Domain + ACM cert, point Telegram webhook at it.
4. Snapshot the local Postgres (`pg_dump`), restore to RDS.

Non-goals for the first AWS pass: blue/green deploys, autoscaling, multi-region, WAF. Add them
only if something actually hurts.

### Cost sketch (ap-southeast-3, month, USD)

| Item | Sizing | Est. |
|------|--------|------|
| Fargate | 1× 0.5 vCPU / 1 GB, 24/7 | ~$18 |
| RDS | db.t4g.micro Multi-AZ, 20 GB gp3 | ~$30 |
| ALB | 1 ALB, low traffic | ~$16 |
| S3 + CloudFront | <5 GB, <10 GB egress | ~$2 |
| Route 53 | 1 hosted zone + ACM (free) | ~$1 |
| Secrets Manager | 6 secrets | ~$2.40 |
| **Total** | | **~$70** |

Single-AZ RDS drops ~$15; dropping the ALB in favor of a public Fargate task + CloudFront only
(origin to the task's public IP, which rotates — don't) isn't viable. If $70/month is too much
for a personal tool, the right answer is "keep running docker-compose on a Hetzner / Lightsail
VPS for $6" rather than a different AWS topology.
