# Environment Variables

## Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| APP_NAME | DP Analytics Platform | Application name |
| APP_ENV | development | Environment (development/production) |
| DEBUG | true | Debug mode |
| SECRET_KEY | change-me | JWT signing key |
| API_PREFIX | /api/v1 | API route prefix |
| DATA_DIR | ./data | Root data directory |
| PARQUET_DIR | ./data/parquet | Parquet storage path |
| METADATA_DB_URL | sqlite:///./data/metadata.db | SQLAlchemy database URL |
| DUCKDB_PATH | ./data/analytics.duckdb | DuckDB file path |
| MAX_UPLOAD_SIZE_MB | 5120 | Max upload size (5 GB) |
| MAX_FILES_PER_BATCH | 100 | Max files per upload |
| ALLOWED_EXTENSIONS | .xlsx,.xls,.csv,.zip | Allowed file types |
| JWT_ALGORITHM | HS256 | JWT algorithm |
| JWT_EXPIRE_MINUTES | 480 | Token expiry |
| CORS_ORIGINS | http://localhost:3000 | Allowed CORS origins (comma-separated; include Vercel URL in prod) |
| ANALYTICS_CACHE_TTL_SECONDS | 300 | Analytics cache TTL |
| LOG_LEVEL | INFO | Logging level |
| LEADSQUARED_ACCESS_KEY | | LSQ API access key (admin / local only) |
| LEADSQUARED_SECRET_KEY | | LSQ API secret key |
| LEADSQUARED_API_HOST | https://api-in21.leadsquared.com/v2 | LSQ API host |
| LEADSQUARED_SYNC_ENABLED | false | Allow Sync LSQ API — **false** on public host |
| LEADSQUARED_PAGE_SIZE | 1000 | Sync page size |
| LEADSQUARED_SYNC_WORKERS | 3 | Parallel window fetch workers |
| SYNC_ADMIN_TOKEN | | Optional token for sync endpoints |

### Public backend (Railway / Render)

```env
LEADSQUARED_SYNC_ENABLED=false
CORS_ORIGINS=https://your-app.vercel.app
SECRET_KEY=<strong-random>
```

Do not put LSQ keys on the public service unless you temporarily sync there as admin.

## Frontend (`frontend/.env.local` or Vercel env)

| Variable | Default | Description |
|----------|---------|-------------|
| NEXT_PUBLIC_DATA_MODE | (unset) | Set `static` on Vercel leadership build — loads `/data/snapshots` (no backend) |
| NEXT_PUBLIC_LEADERSHIP_MODE | (unset) | Set `true` to hide upload, LSQ sync, lead explorer, CSV export, custom filters |
| NEXT_PUBLIC_API_URL | http://localhost:8000 | Backend base URL (omit when `DATA_MODE=static`) |
| NEXT_PUBLIC_AUTO_LOGIN | true (unless `false`) | Auto-login so viewers need no login form |
| NEXT_PUBLIC_DEFAULT_USER | ops | Auto-login username |
| NEXT_PUBLIC_DEFAULT_PASSWORD | ops123 | Auto-login password |
| NEXT_PUBLIC_ENABLE_UPLOAD | true (unless `false`) | Show Upload UI — **false** on Vercel |
| NEXT_PUBLIC_ENABLE_LSQ_SYNC | false | Show Sync LSQ — **true** locally only; **false** on Vercel |

### LeadSquared sync tips

- Keep `LEADSQUARED_SYNC_ENABLED=true` and both keys in `backend/.env`; restart uvicorn after editing `.env` (settings are cached).
- Avoid saving backend files while Sync LSQ runs under `uvicorn --reload` — reload kills in-flight jobs.
- After changing block-paid / partner rules, click **Full** once (or Sync LSQ then check the success message for `block paid by partner: …`). Incremental sync recomputes flags from stored `contact_stage`, but Full refreshes CRM stage text.
- Block Amount Paid counts **only** when CRM **Contact Stage** is exactly “Block Amount Paid”. In LeadSquared that field is `ProspectStage` (not `mx_Contact_Stage`, which is often empty). Main Lead Stages (`mx_Main_Lead_Stages`) are ignored for this metric. Sync success message lists counts by partner.

### Local admin

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ENABLE_UPLOAD=true
NEXT_PUBLIC_ENABLE_LSQ_SYNC=true
NEXT_PUBLIC_AUTO_LOGIN=true
```

### Public Vercel (static leadership — recommended)

```env
NEXT_PUBLIC_DATA_MODE=static
NEXT_PUBLIC_LEADERSHIP_MODE=true
NEXT_PUBLIC_ENABLE_UPLOAD=false
NEXT_PUBLIC_ENABLE_LSQ_SYNC=false
NEXT_PUBLIC_AUTO_LOGIN=false
```

Publish data first: `npm run publish:snapshots` then push `frontend/public/data/snapshots/`.

### Public Vercel + live API (alternative)

```env
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.up.railway.app
NEXT_PUBLIC_ENABLE_UPLOAD=false
NEXT_PUBLIC_ENABLE_LSQ_SYNC=false
NEXT_PUBLIC_AUTO_LOGIN=true
```
