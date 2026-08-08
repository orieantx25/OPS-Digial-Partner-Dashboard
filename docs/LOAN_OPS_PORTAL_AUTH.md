# Loan Operations — portal handoff auth

Implement these changes in the **loan-ops** Vercel project so direct visits to [loan-ops.vercel.app](https://loan-ops.vercel.app/) cannot bypass login.

## Shared configuration (both apps)

Use the **same** values on the reports portal and loan-ops:

```env
PORTAL_AUTH_SECRET=<long-random-string>
PORTAL_LOGIN_URL=https://your-portal.vercel.app/login
```

On the portal only:

```env
NEXT_PUBLIC_LOAN_OPS_URL=https://loan-ops.vercel.app
```

## Handoff flow

1. User signs in on the reports portal with an allowlisted email.
2. User clicks **Loan Operations** → portal calls `POST /api/auth/handoff` and redirects to:

   `https://loan-ops.vercel.app/auth/handoff?token=<jwt>`

3. Loan-ops validates the JWT (`aud: loan-ops`, 5-minute expiry, signed with `PORTAL_AUTH_SECRET`).
4. On success, loan-ops sets an httpOnly cookie `loan_ops_session` (30 days) and redirects to `/`.

## loan-ops implementation checklist

### 1. `src/lib/portfolio-auth.ts` (copy from portal or share package)

- `verifyHandoffToken(token)` — same logic as portal repo (`jose`, audience `loan-ops`).

### 2. `src/app/auth/handoff/route.ts`

```typescript
// GET /auth/handoff?token=...
// - verifyHandoffToken
// - set cookie loan_ops_session = new session JWT (aud: loan-ops-app, 30d)
// - redirect to /
```

### 3. `src/middleware.ts`

- Public: `/login` (if local fallback), `/auth/handoff`, `_next`, static assets.
- All other routes: require valid `loan_ops_session` cookie.
- If missing → redirect to `PORTAL_LOGIN_URL?return=loans`.

### 4. Session cookie

- Name: `loan_ops_session`
- httpOnly, secure in production, sameSite=lax, path=/, maxAge 30d.

## Security notes

- Direct URL to loan-ops without a cookie → redirect to portal login (no data shown).
- Handoff tokens are single-use in practice (short TTL); do not log full tokens.
- Optional: enable **Vercel Deployment Protection** on both projects.
- The portal allowlist (`ALLOWED_EMAIL_HASHES`) controls who can generate handoff tokens; loan-ops trusts only signed handoffs from the shared secret.

## Local testing

1. Set matching `PORTAL_AUTH_SECRET` in both `.env.local` files.
2. Portal: `NEXT_PUBLIC_PORTAL_AUTH=true`, `NEXT_PUBLIC_LOAN_OPS_URL=http://localhost:3001`
3. Run loan-ops on port 3001, portal on 3000.
4. Sign in → Loan Operations → should land on loan-ops with session cookie.
