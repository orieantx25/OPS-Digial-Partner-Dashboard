import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
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

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  const token = tokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifyPortalToken(token);
  if (!session) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  const rel = context.params.path.join('/');
  if (!rel || rel.includes('..')) {
    return NextResponse.json({ detail: 'Invalid path' }, { status: 400 });
  }

  const filePath = path.join(
    process.cwd(),
    'public',
    'data',
    'snapshots',
    rel
  );

  try {
    const raw = await readFile(filePath, 'utf8');
    return new NextResponse(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return NextResponse.json({ detail: 'Snapshot not found' }, { status: 404 });
  }
}
