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
| `NEXT_PUBLIC_PORTAL_AUTH` | `true` |
| `PORTAL_AUTH_SECRET` | long random string |
| `ALLOWED_EMAIL_HASHES_B64` | base64-encoded bcrypt hashes (see below) |
| `PORTAL_LOGIN_URL` | `https://your-app.vercel.app/login` |
| `NEXT_PUBLIC_LOAN_OPS_URL` | `https://loan-ops.vercel.app` |

Paste the `ALLOWED_EMAIL_HASHES_B64` line into Vercel. Do not use raw `ALLOWED_EMAIL_HASHES` — `$` in bcrypt breaks env loading.

```bash
cd frontend
node scripts/hash-allowlist-emails.mjs user1@example.com user2@example.com
```

Loan-ops handoff: see [`docs/LOAN_OPS_PORTAL_AUTH.md`](../../docs/LOAN_OPS_PORTAL_AUTH.md).

5. Do **not** add `NEXT_PUBLIC_API_URL`.
6. Click **Deploy**.

## After each local data refresh

### One-click (dashboard Sync button)

With `LEADERSHIP_AUTO_DEPLOY_ON_SYNC=true` in `backend/.env`, clicking **Sync** in the ops dashboard:

1. Runs LSQ sync (leads, persona, refunds, block-paid flags)
2. Publishes leadership snapshots (uses existing Metabase block CSV if you did not upload a new one)
3. Commits and pushes `frontend/public/data/snapshots/` to `main` — Vercel redeploys automatically

Start API **without** `--reload` during sync:

```bash
cd backend
.venv\Scripts\uvicorn app.main:app --port 8000
```

Then use **Sync & deploy** in the filter bar (or `npm run dev` for the frontend).

### CLI alternative

```bash
npm run sync:deploy
```

Use when auto-deploy is off, or for `--full` / `--no-push` from the terminal.

### Manual steps

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

## Mobile (< 1024px)

Leadership builds get a phone-first shell: top bar + hamburger drawer, bottom tabs (Overview / Funnel / Partners / More), wrapping date presets, stacked charts, and card-style summary tables. Desktop sidebar remains at `lg` and above.
