import { NextRequest, NextResponse } from 'next/server';
import { createHandoffToken, verifyPortalToken } from '@/lib/portfolio-jwt';
import { LOAN_OPS_URL, PORTAL_TOKEN_COOKIE } from '@/lib/portal-mode';

function tokenFromRequest(request: NextRequest): string | null {
  const cookie = request.cookies.get(PORTAL_TOKEN_COOKIE)?.value;
  if (cookie) return cookie;
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export async function POST(request: NextRequest) {
  const token = tokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const session = await verifyPortalToken(token);
  if (!session) {
    return NextResponse.json({ detail: 'Invalid session' }, { status: 401 });
  }

  const handoff = await createHandoffToken(session.email);
  const base = LOAN_OPS_URL.replace(/\/$/, '');
  const url = `${base}/auth/handoff?token=${encodeURIComponent(handoff)}`;

  return NextResponse.json({ url });
}
