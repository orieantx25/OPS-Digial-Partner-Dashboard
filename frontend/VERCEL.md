# Vercel — leadership dashboard (checklist)

Repo: connect **orieantx25/OPS-Digial-Partner-Dashboard**.

## One-time setup (Vercel dashboard)

1. **Add New Project** → Import this GitHub repo.
2. **Root Directory** → set to `frontend` (Edit → select `frontend`).
3. **Framework Preset** → Next.js (auto).
4. **Environment Variables** (Production + Preview):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_DATA_MODE` | `static` |
| `NEXT_PUBLIC_LEADERSHIP_MODE` | `true` |
| `NEXT_PUBLIC_ENABLE_UPLOAD` | `false` |
| `NEXT_PUBLIC_ENABLE_LSQ_SYNC` | `false` |
| `NEXT_PUBLIC_AUTO_LOGIN` | `false` |

5. Do **not** add `NEXT_PUBLIC_API_URL`.
6. Click **Deploy**.

## After each local data refresh

```bash
npm run publish:snapshots
git add frontend/public/data/snapshots
git commit -m "Refresh leadership snapshots"
git push origin main
```

Vercel redeploys automatically from `main`. Leadership sees new charts after the deploy finishes.

## Local smoke-test (optional)

```bash
cd frontend
# temporarily use static env
set NEXT_PUBLIC_DATA_MODE=static
set NEXT_PUBLIC_LEADERSHIP_MODE=true
npm run build && npm run start
```

Open http://localhost:3000 — charts should load with no backend on :8000.
