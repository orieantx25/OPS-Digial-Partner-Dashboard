'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { X, Upload } from 'lucide-react';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { cn } from '@/lib/utils';
import { NAV_GROUPS, NAV_ICONS, NAV_PAGES } from '@/lib/nav';
import { useAppStore } from '@/store/app-store';
import { useMobileNavStore } from '@/store/mobile-nav-store';
import { useUploadStore } from '@/store/upload-store';

export function MobileNavDrawer() {
  const pathname = usePathname();
  const open = useMobileNavStore((s) => s.drawerOpen);
  const closeDrawer = useMobileNavStore((s) => s.closeDrawer);
  const user = useAppStore((s) => s.user);
  const openUpload = useUploadStore((s) => s.openUpload);

  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closeDrawer]);

  if (!open) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close navigation"
        onClick={closeDrawer}
      />
      <aside
        className="absolute left-0 top-0 h-full w-[min(20rem,88vw)] bg-surface border-r border-border flex flex-col shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="px-4 py-4 border-b border-primary bg-black flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <Image
              src="/logo-dark.png"
              alt="upGrad School of Technology"
              width={160}
              height={56}
              className="w-full max-w-[160px] h-auto object-contain"
            />
            <div className="text-text-secondary text-[10px] uppercase tracking-widest mt-2">
              Digital Partner Analytics
            </div>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="flex items-center justify-center w-11 h-11 text-text-secondary hover:text-text shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_GROUPS.map((group) => {
            const pages = NAV_PAGES.filter((p) => p.group === group);
            if (!pages.length) return null;
            return (
              <div key={group} className="mb-2">
                <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-text-secondary">
                  {group}
                </div>
                {pages.map((page) => {
                  const Icon = NAV_ICONS[page.id] || NAV_ICONS.executive;
                  const active =
                    pathname === page.href ||
                    (page.href !== '/' && pathname.startsWith(page.href));
                  return (
                    <Link
                      key={page.id}
                      href={page.href}
                      onClick={closeDrawer}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 text-sm border-l-2 min-h-[44px]',
                        active
                          ? 'border-l-primary bg-panel text-text'
                          : 'border-l-transparent text-text-secondary active:bg-panel/50'
                      )}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{page.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {canUpload() && (
            <button
              type="button"
              onClick={() => {
                closeDrawer();
                openUpload();
              }}
              className="btn-primary w-full flex items-center justify-center gap-2 text-sm min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              Upload Data
            </button>
          )}
          {user && (
            <div className="px-1 text-xs text-text-secondary">
              <div className="text-text">{user.username}</div>
              <div className="uppercase tracking-wide">{user.role}</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
