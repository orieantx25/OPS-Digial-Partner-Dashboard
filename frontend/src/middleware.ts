import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyPortalToken } from '@/lib/portfolio-jwt';
import { PORTAL_TOKEN_COOKIE } from '@/lib/portal-mode';

const BOT_UA =
  /bot|crawl|spider|scrap|headless|curl\/|wget\/|python-requests|httpx\/|aiohttp|scrapy|go-http-client/i;

const PORTAL_AUTH = process.env.NEXT_PUBLIC_PORTAL_AUTH === 'true';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
  if (pathname === '/api/auth/login') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ua = request.headers.get('user-agent') || '';

  if (pathname.startsWith('/data/snapshots')) {
    const looksLikeBrowser =
      /mozilla|chrome|safari|firefox|edge|opera/i.test(ua) && !BOT_UA.test(ua);
    if (!looksLikeBrowser && BOT_UA.test(ua)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  if (PORTAL_AUTH) {
    const needsSnapshotAuth =
      pathname.startsWith('/data/snapshots') || pathname.startsWith('/api/snapshots');

    if (needsSnapshotAuth) {
      const cookie = request.cookies.get(PORTAL_TOKEN_COOKIE)?.value;
      const header = request.headers.get('authorization');
      const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
      const token = cookie || bearer;
      if (!token) {
        return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
      }
      const session = await verifyPortalToken(token);
      if (!session) {
        return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
      }
    }

    if (
      pathname.startsWith('/api/auth/handoff') ||
      pathname.startsWith('/api/auth/me') ||
      pathname.startsWith('/api/snapshots')
    ) {
      if (pathname.startsWith('/api/auth/login')) {
        return NextResponse.next();
      }
      const cookie = request.cookies.get(PORTAL_TOKEN_COOKIE)?.value;
      const header = request.headers.get('authorization');
      const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
      const token = cookie || bearer;
      if (!token && !pathname.startsWith('/api/auth/login')) {
        if (pathname.startsWith('/api/auth/me') && request.method === 'GET') {
          return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        }
        if (pathname.startsWith('/api/auth/handoff') || pathname.startsWith('/api/snapshots')) {
          return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
        }
      }
    }
  }

  const response = NextResponse.next();

  if (pathname.startsWith('/data/snapshots') || pathname.startsWith('/api/snapshots')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Cache-Control', 'private, no-store');
  }

  return response;
}

export const config = {
  matcher: [
    '/data/snapshots/:path*',
    '/api/snapshots/:path*',
    '/api/auth/:path*',
  ],
};
