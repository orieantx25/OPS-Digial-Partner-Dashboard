# Security and data protection

## Architecture

| Surface | Data | Protection |
|---------|------|------------|
| **Ops (local)** | Full DuckDB / parquet, lead explorer, exports | JWT auth, rate limits, no public OpenAPI in production |
| **Leadership (Vercel)** | Aggregated JSON snapshots only | No API, no row-level PII in published files, `robots.txt` + bot middleware on `/data/snapshots` |

## Backend (`APP_ENV=production`)

Set in your hosted API environment (Railway / Render / Docker):

```env
APP_ENV=production
SECRET_KEY=<long-random-string>
REQUIRE_API_AUTH=true          # auto-enabled when APP_ENV=production
DISABLE_OPENAPI=true           # auto-enabled — /docs and /openapi.json disabled
CORS_ORIGINS=https://your-ops-frontend.example

# LeadSquared sync (ops only)
LEADSQUARED_SYNC_ENABLED=true
SYNC_ADMIN_TOKEN=<long-random-string>   # required in production for POST /sync/leadsquared
```

- All `/api/v1/analytics/*`, uploads, refunds, block-payment, and sync routes require a valid JWT (except `POST /auth/login`).
- Upload, export, CSV download, and LSQ sync require **operations** or **admin** role.
- Rate limiting: 120 req/min default; stricter on login and sync/upload.
- Security headers on every API response (`X-Frame-Options`, `HSTS`, etc.).

### Ops frontend (local)

```env
NEXT_PUBLIC_AUTO_LOGIN=false          # production-like
NEXT_PUBLIC_SYNC_ADMIN_TOKEN=<same as SYNC_ADMIN_TOKEN>  # for Sync button when token required
```

Change default seeded passwords after first deploy (`admin`, `ops`, etc.) or create new users in the metadata DB.

## Leadership (Vercel static)

```env
NEXT_PUBLIC_DATA_MODE=static
NEXT_PUBLIC_LEADERSHIP_MODE=true
NEXT_PUBLIC_ENABLE_UPLOAD=false
NEXT_PUBLIC_ENABLE_LSQ_SYNC=false
NEXT_PUBLIC_AUTO_LOGIN=false
```

Published snapshots **strip**:

- Refund case rows (counts only)
- Block payment backtracking / clash rows (aggregates only)
- Partner detail lead lists and clash rows

Re-publish after data changes:

```bash
npm run publish:snapshots
```

Commit only `frontend/public/data/snapshots/` — never commit `backend/data/` or `.env`.

### Extra hardening (recommended)

- Enable **Vercel Deployment Protection** (password or SSO) on the leadership URL.
- Do not set `NEXT_PUBLIC_DEFAULT_PASSWORD` on any public deployment.

## What is still public on leadership

Aggregated charts, KPIs, state-level counts, and partner-level metrics remain in snapshot JSON. They are intended for leadership viewers but can be downloaded if someone has the URL. Deployment Protection addresses that layer.
