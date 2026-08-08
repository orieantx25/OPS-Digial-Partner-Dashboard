import { NextRequest, NextResponse } from 'next/server';
import { isPortalAdminEmail } from '@/lib/portfolio-allowlist';
import { verifyPortalToken } from '@/lib/portfolio-jwt';
import { PORTAL_TOKEN_COOKIE } from '@/lib/portal-mode';

function tokenFromRequest(request: NextRequest): string | null {
  const cookie = request.cookies.get(PORTAL_TOKEN_COOKIE)?.value;
  if (cookie) return cookie;
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export async function GET(request: NextRequest) {
  const token = tokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const session = await verifyPortalToken(token);
  if (!session) {
    return NextResponse.json({ detail: 'Invalid session' }, { status: 401 });
  }

  return NextResponse.json({
    email: session.email,
    is_admin: isPortalAdminEmail(session.email),
  });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PORTAL_TOKEN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
