import { NextRequest, NextResponse } from 'next/server';
import { createPortalToken, normalizeEmail } from '@/lib/portfolio-jwt';
import {
  isPortalAdminEmail,
  verifyEmailAllowlist,
} from '@/lib/portfolio-allowlist';
import { PORTAL_TOKEN_COOKIE } from '@/lib/portal-mode';

export const runtime = 'nodejs';

const SESSION_MAX_AGE = 8 * 60 * 60; // matches JWT when remember=false
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email : '';
    const remember = Boolean(body.remember);

    if (!email.trim()) {
      return NextResponse.json({ detail: 'Email is required' }, { status: 400 });
    }

    const allowed = await verifyEmailAllowlist(email);
    if (!allowed) {
      return NextResponse.json(
        { detail: 'This email is not authorized to access the portal' },
        { status: 403 }
      );
    }

    const normalized = normalizeEmail(email);
    const isAdmin = isPortalAdminEmail(normalized);
    const token = await createPortalToken(normalized, remember);
    const response = NextResponse.json({
      email: normalized,
      is_admin: isAdmin,
      remember,
    });

    // Always set cookie so middleware can authorize navigation (Remember me only changes TTL).
    response.cookies.set(PORTAL_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
