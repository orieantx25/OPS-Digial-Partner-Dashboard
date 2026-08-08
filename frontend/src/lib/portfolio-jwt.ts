import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const PORTAL_AUD = 'portal';
const LOAN_OPS_AUD = 'loan-ops';

function getSecret(): Uint8Array {
  const raw = process.env.PORTAL_AUTH_SECRET?.trim();
  if (!raw) {
    throw new Error('PORTAL_AUTH_SECRET is not configured');
  }
  return new TextEncoder().encode(raw);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface TokenPayload extends JWTPayload {
  email?: string;
}

export async function createPortalToken(
  email: string,
  remember: boolean
): Promise<string> {
  const normalized = normalizeEmail(email);
  return new SignJWT({ email: normalized })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(normalized)
    .setIssuedAt()
    .setExpirationTime(remember ? '30d' : '8h')
    .setAudience(PORTAL_AUD)
    .sign(getSecret());
}

export async function verifyPortalToken(
  token: string
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: PORTAL_AUD,
    });
    const email = (payload as TokenPayload).email ?? payload.sub;
    if (!email) return null;
    return { email: normalizeEmail(String(email)) };
  } catch {
    return null;
  }
}

export async function createHandoffToken(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  return new SignJWT({ email: normalized })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(normalized)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience(LOAN_OPS_AUD)
    .sign(getSecret());
}

export async function verifyHandoffToken(
  token: string
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: LOAN_OPS_AUD,
    });
    const email = (payload as TokenPayload).email ?? payload.sub;
    if (!email) return null;
    return { email: normalizeEmail(String(email)) };
  } catch {
    return null;
  }
}
