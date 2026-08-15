'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { CampusBlockSidebar } from '@/components/layout/campus-block-sidebar';
import { PublishedDataBanner } from '@/components/dashboard/published-data-banner';
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap';
import { cn } from '@/lib/utils';

export function CampusBlockShell({ children }: { children: React.ReactNode }) {
  const authReady = useAuthBootstrap();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const onGeography = pathname.startsWith('/campus-block/geography');
  const onAdmissions = pathname.startsWith('/campus-block/admissions');
  const pageTitle = onGeography
    ? 'Geography'
    : onAdmissions
      ? 'Admissions'
      : 'Block amount';

  if (!authReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-secondary text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <CampusBlockSidebar />

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-surface border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3 px-3 h-14">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex items-center justify-center w-11 h-11 -ml-1 text-text shrink-0"
            aria-label="Open navigation"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Image
              src="/logo-dark.png"
              alt=""
              width={72}
              height={28}
              className="h-7 w-auto object-contain shrink-0"
              priority
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text truncate leading-tight">
                {pageTitle}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-text-secondary truncate">
                Campus and admission Dashboard
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 bg-surface border-r border-border p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                Navigation
              </p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-text-secondary hover:text-text"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Link
              href="/"
              onClick={() => setDrawerOpen(false)}
              className="flex items-center gap-2.5 py-2.5 px-2 text-sm text-text-secondary hover:text-text"
            >
              <LayoutGrid className="w-4 h-4" />
              Report hub
            </Link>
            <Link
              href="/campus-block"
              onClick={() => setDrawerOpen(false)}
              className={cn(
                'flex items-center gap-2.5 py-2.5 px-2 text-sm pl-2 border-l-2',
                !onGeography && !onAdmissions
                  ? 'text-text border-primary bg-panel'
                  : 'text-text-secondary border-transparent hover:text-text'
              )}
            >
              Block amount
            </Link>
            <Link
              href="/campus-block/admissions"
              onClick={() => setDrawerOpen(false)}
              className={cn(
                'flex items-center gap-2.5 py-2.5 px-2 text-sm pl-2 border-l-2',
                onAdmissions
                  ? 'text-text border-primary bg-panel'
                  : 'text-text-secondary border-transparent hover:text-text'
              )}
            >
              Admissions
            </Link>
            <Link
              href="/campus-block/geography"
              onClick={() => setDrawerOpen(false)}
              className={cn(
                'flex items-center gap-2.5 py-2.5 px-2 text-sm pl-2 border-l-2',
                onGeography
                  ? 'text-text border-primary bg-panel'
                  : 'text-text-secondary border-transparent hover:text-text'
              )}
            >
              Geography
            </Link>
          </div>
        </div>
      )}

      <div className={cn('min-h-screen flex flex-col ml-0 lg:ml-52')}>
        <main className="flex-1 p-3 sm:p-4">
          <PublishedDataBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
