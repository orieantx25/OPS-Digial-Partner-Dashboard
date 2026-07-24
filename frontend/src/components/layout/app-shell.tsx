'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { FilterBar } from './filter-bar';
import { MobileTopBar } from './mobile-top-bar';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { EmptyDatasetBanner } from '@/components/dashboard/empty-dataset-banner';
import { PublishedDataBanner } from '@/components/dashboard/published-data-banner';
import { QuickUploadModal } from '@/components/upload/quick-upload-modal';
import { LeadExplorerDrawer } from '@/components/leads/lead-explorer-drawer';
import { useDatasetStats } from '@/hooks/use-dataset-stats';
import { canUpload, useAuthBootstrap } from '@/hooks/use-auth-bootstrap';
import { isLeadershipMode } from '@/lib/static-mode';
import { cn } from '@/lib/utils';

/** Pages where the global filter bar does not apply (ops/upload tools). */
const HIDE_FILTER_BAR = new Set(['/upload', '/block-payment']);

export function AppShell({ children }: { children: React.ReactNode }) {
  const authReady = useAuthBootstrap();
  const { totalRows } = useDatasetStats();
  const pathname = usePathname();
  const showFilterBar = !HIDE_FILTER_BAR.has(pathname);
  const leadership = isLeadershipMode();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-secondary text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />
      <MobileTopBar />
      <MobileNavDrawer />
      {leadership && <MobileBottomNav />}
      {canUpload() && <QuickUploadModal />}
      {!leadership && <LeadExplorerDrawer />}
      <div
        className={cn(
          'min-h-screen flex flex-col ml-0 lg:ml-52',
          leadership && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0'
        )}
      >
        {showFilterBar && <FilterBar />}
        <main className="flex-1 p-3 sm:p-4">
          <PublishedDataBanner />
          <EmptyDatasetBanner totalRows={totalRows} />
          {children}
        </main>
      </div>
    </div>
  );
}
