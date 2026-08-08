'use client';

import Link from 'next/link';
import Image from 'next/image';
import { LayoutGrid, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { RefundCasesSidebar } from '@/components/layout/refund-cases-sidebar';
import { PublishedDataBanner } from '@/components/dashboard/published-data-banner';
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap';
import { isPortalAuthEnabled } from '@/lib/portal-mode';
import { cn } from '@/lib/utils';

export function RefundCasesShell({ children }: { children: React.ReactNode }) {
  const authReady = useAuthBootstrap();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-secondary text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <RefundCasesSidebar />

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
                Refund cases
              </div>
              <div className="text-[10px] uppercase tracking-widest text-text-secondary truncate">
                Refund dashboard
              </div>
            </div>
          </div>
        </div>
      </header>

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
            {isPortalAuthEnabled() && (
              <Link
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-2.5 py-2.5 px-2 text-sm text-text-secondary hover:text-text"
              >
                <LayoutGrid className="w-4 h-4" />
                Report hub
              </Link>
            )}
            <Link
              href="/refund-cases"
              onClick={() => setDrawerOpen(false)}
              className="flex items-center gap-2.5 py-2.5 px-2 text-sm text-text border-l-2 border-primary bg-panel pl-2"
            >
              Refund cases
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
