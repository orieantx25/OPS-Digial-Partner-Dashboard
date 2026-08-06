import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BOT_UA =
  /bot|crawl|spider|scrap|headless|curl\/|wget\/|python-requests|httpx\/|aiohttp|scrapy|go-http-client/i;

export function middleware(request: NextRequest) {
  const ua = request.headers.get('user-agent') || '';
  const looksLikeBrowser =
    /mozilla|chrome|safari|firefox|edge|opera/i.test(ua) && !BOT_UA.test(ua);

  if (!looksLikeBrowser && BOT_UA.test(ua)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: '/data/snapshots/:path*',
};
