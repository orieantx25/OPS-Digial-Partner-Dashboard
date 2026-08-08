/** Portfolio portal (email login + multi-dashboard hub) helpers. */

export function isPortalAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PORTAL_AUTH === 'true';
}

export const PORTAL_TOKEN_COOKIE = 'portal_token';

export const LOAN_OPS_URL =
  process.env.NEXT_PUBLIC_LOAN_OPS_URL || 'https://loan-ops.vercel.app';
