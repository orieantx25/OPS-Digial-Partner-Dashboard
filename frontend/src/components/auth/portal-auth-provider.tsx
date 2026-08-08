'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isPortalAuthEnabled } from '@/lib/portal-mode';
import { usePortalAuthStore } from '@/store/portal-auth-store';

const PUBLIC_PREFIXES = ['/login'];

export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const ready = usePortalAuthStore((s) => s.ready);
  const email = usePortalAuthStore((s) => s.email);
  const bootstrap = usePortalAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (isPortalAuthEnabled()) {
      bootstrap();
    }
  }, [bootstrap]);

  if (!isPortalAuthEnabled()) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6]">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!email && !isPublic) {
    const returnTo = encodeURIComponent(pathname || '/');
    router.replace(`/login?return=${returnTo}`);
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6]">
        <p className="text-sm text-gray-500">Redirecting to login…</p>
      </div>
    );
  }

  if (email && pathname === '/login') {
    router.replace('/');
    return null;
  }

  return <>{children}</>;
}
