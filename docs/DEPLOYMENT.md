# Deployment

## Leadership dashboard on Vercel (no hosted DB) — recommended

Leadership viewers get a **static Next.js** app on Vercel. Charts load from JSON snapshots under `frontend/public/data/snapshots/`. There is **no FastAPI / DuckDB / SQLite** on Vercel.

| Who | Where | What they do |
|-----|--------|----------------|
| You (ops) | Local PC | Upload sheets, Sync LSQ, explore lead lists |
| Leadership | Vercel URL | Summary charts only; frozen until you republish |

### Day-to-day publish loop

1. Locally: upload / Sync LSQ as usual (`uvicorn` + `npm run dev`).
2. Publish snapshots:

```bash
npm run publish:snapshots
# or: python backend/scripts/publish_snapshots.py
```

3. Commit and push `frontend/public/data/snapshots/` (JSON only — do **not** commit `backend/data/*.parquet` or `.env`).
4. Vercel rebuilds from `frontend/` Root Directory.

### Vercel project settings

- **Root Directory:** `frontend`
- **Framework:** Next.js
- Env vars — copy from [`frontend/.env.vercel.example`](../frontend/.env.vercel.example):

```env
NEXT_PUBLIC_DATA_MODE=static
NEXT_PUBLIC_LEADERSHIP_MODE=true
NEXT_PUBLIC_ENABLE_UPLOAD=false
NEXT_PUBLIC_ENABLE_LSQ_SYNC=false
NEXT_PUBLIC_AUTO_LOGIN=false
```

Do **not** set `NEXT_PUBLIC_API_URL` in this mode (API rewrites are disabled).

### What leadership can / cannot do

- **Can:** date presets (All time / Last 7d / MTD / 30d / This month), Daily/Weekly/Monthly chart toggles, Partner Analytics click → partner detail.
- **Cannot:** upload, Sync LSQ, Lead Explorer / row search, CSV export, custom filter combinations outside published presets.

---

## Docker Compose (local / single host)

```bash
docker compose up --build -d
```

Services:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000

Data persisted in `dp-data` Docker volume.

## Alternative: live API behind Vercel (Railway / Render)

If you need full custom filters on the public URL, host FastAPI + Parquet/DuckDB on Railway/Render and point Vercel at it (view-only flags, no static mode). See below.

| Layer | Where | Role |
|-------|--------|------|
| Frontend | Vercel | Shareable URL; view-only flags |
| Backend | Railway or Render | Serves `/api/v1/analytics/*` from persistent `data/` |
| Sync / upload | Your laptop only | Refresh data, then copy into the volume |

### What you must provide (go-live)

Cloud accounts and secrets cannot be created from this repo alone. Before the public link works:

1. Push latest code to the GitHub repo Vercel/Railway will deploy from.
2. **Railway** (or Render) account — Web Service from `backend/`, volume at `/app/data`.
3. Seed `backend/data/` onto that volume after a local Sync LSQ / uploads (parquet + duckdb + metadata.db).
4. Backend env: strong `SECRET_KEY`, `CORS_ORIGINS=https://<vercel-domain>`, `LEADSQUARED_SYNC_ENABLED=false`.
5. **Vercel** account — root `frontend/`, env from [`frontend/.env.vercel.example`](../frontend/.env.vercel.example) with `NEXT_PUBLIC_API_URL` = your Railway URL.
6. Send back the final **Vercel URL** and **backend URL** so `CORS_ORIGINS` can be locked to the real domain.

### Block payment sheet (Metabase)

Block amount paid rows come from Metabase (not LSQ sync). Export CSV, then upload on the local **Block Payment** tab.

- Question (browser): https://analytics.ugsot.com/public/question/546e2871-cdb2-45c9-9f63-6ef4bcf0f2d1  
- Public CSV export (no login if sharing stays on):

```text
https://analytics.ugsot.com/api/public/card/546e2871-cdb2-45c9-9f63-6ef4bcf0f2d1/query/csv
```

On upload, if **Source at Payment** / **Campaign at Payment** are blank or `Not Found`, the API derives them from **Utm Activity** (`utm_source` → source, `utm_campaign` → campaign after the `application-fee` segment). Pre-filled columns are kept. After upload, copy `backend/data/` to the Railway volume when refreshing the public site.

### 1. Backend on Railway

1. New project → deploy from GitHub → **Root Directory** = `backend` (uses `backend/Dockerfile` + `backend/railway.toml`).
2. Add a **Volume** mounted at `/app/data` (parquet, duckdb, sqlite metadata).
3. Set environment variables:

```env
APP_ENV=production
DEBUG=false
SECRET_KEY=<long-random-string>
CORS_ORIGINS=https://YOUR-APP.vercel.app
LEADSQUARED_SYNC_ENABLED=false
DATA_DIR=/app/data
PARQUET_DIR=/app/data/parquet
METADATA_DB_URL=sqlite:////app/data/metadata.db
DUCKDB_PATH=/app/data/analytics.duckdb
LOG_LEVEL=WARNING
```

4. Seed data once:
   - Run Sync LSQ / upload **locally**, then upload/copy `backend/data/` into the volume (Railway CLI, SFTP, or one-shot deploy with files), **or**
   - Temporarily set LSQ keys + `LEADSQUARED_SYNC_ENABLED=true`, sync once, then set `LEADSQUARED_SYNC_ENABLED=false` again.
5. Confirm `GET https://YOUR-BACKEND.up.railway.app/health` and `GET .../api/v1/sync/config` → `"enabled": false`.

### 2. Backend on Render (alternative)

1. New **Web Service** from repo; Docker; root `backend/` (or use `backend/render.yaml` Blueprint).
2. Attach a **persistent disk** at `/app/data`.
3. Same env vars as Railway; Render injects `$PORT` automatically (Dockerfile already uses it).
4. Seed `data/` the same way as Railway.

### 3. Frontend on Vercel

1. Import the repo; **Root Directory** = `frontend`.
2. Environment variables (Production):

```env
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.up.railway.app
NEXT_PUBLIC_ENABLE_UPLOAD=false
NEXT_PUBLIC_ENABLE_LSQ_SYNC=false
NEXT_PUBLIC_AUTO_LOGIN=true
NEXT_PUBLIC_DEFAULT_USER=ops
NEXT_PUBLIC_DEFAULT_PASSWORD=ops123
```

3. Deploy → share `https://something.vercel.app`.
4. `next.config.js` rewrites `/api/v1/*` to `NEXT_PUBLIC_API_URL`.

Keep local `frontend/.env.local` with upload/sync **enabled** for admin work:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ENABLE_UPLOAD=true
NEXT_PUBLIC_ENABLE_LSQ_SYNC=true
```

### 4. Share checklist

- [ ] Open Vercel URL in an incognito window — charts load; **no** Upload / Sync LSQ buttons
- [ ] Public backend `/api/v1/sync/config` returns `"enabled": false`
- [ ] Local app still shows Upload + Sync LSQ
- [ ] `CORS_ORIGINS` includes the exact Vercel domain (and custom domain if any)
- [ ] Volume has seeded parquet so filters/charts are not empty

### Refreshing public data later

Re-sync or upload on your laptop, then replace files on the Railway/Render volume under `/app/data` (or briefly enable sync on the host as admin only). Redeploy is not required if the volume is updated in place — restart the API process if DuckDB holds locks.

---

## Manual production (single machine)

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Frontend
```bash
cd frontend
npm install
npm run build
npm start
```

## Production Checklist

- [ ] Set strong `SECRET_KEY` in environment
- [ ] Change default user passwords (especially if auto-login is off)
- [ ] Configure `CORS_ORIGINS` to production domain(s)
- [ ] Use HTTPS (Vercel + Railway/Render provide this)
- [ ] Mount persistent volume for `data/` directory
- [ ] Set `LOG_LEVEL=WARNING` in production
- [ ] Keep `LEADSQUARED_*` keys off the public host (or sync disabled)
- [ ] Configure backup for Parquet and SQLite files

## Scaling

- **Horizontal API scaling:** Run multiple uvicorn workers behind load balancer (shared volume or object storage required for parquet)
- **Data scaling:** Parquet + DuckDB handles 20M+ rows on single node
- **Future:** Migrate metadata SQLite to PostgreSQL for multi-instance deployments
