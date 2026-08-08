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
  if (pathname.startsWith('/logo')) return true;
  if (pathname === '/api/auth/login') return true;
  // Static marketing/brand assets under public/
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|txt|xml)$/i.test(pathname)) return true;
  return false;
}

async function readPortalToken(request: NextRequest): Promise<string | null> {
  const cookie = request.cookies.get(PORTAL_TOKEN_COOKIE)?.value;
  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  return cookie || bearer || null;
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

  if (PORTAL_AUTH && !isPublicPath(pathname)) {
    const token = await readPortalToken(request);
    const session = token ? await verifyPortalToken(token) : null;

    if (!session) {
      if (pathname.startsWith('/api/')) {
        if (pathname.startsWith('/api/auth/me') && request.method === 'GET') {
          return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        }
        return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.search = '';
      loginUrl.searchParams.set('return', pathname);
      return NextResponse.redirect(loginUrl);
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
    /*
     * Protect app routes when portal auth is on; also cover snapshot APIs.
     * Skip Next internals and common static files.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
