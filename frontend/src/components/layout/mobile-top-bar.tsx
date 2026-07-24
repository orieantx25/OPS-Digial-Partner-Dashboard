'use client';

import Image from 'next/image';
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { pageTitleForPath } from '@/lib/nav';
import { useMobileNavStore } from '@/store/mobile-nav-store';

export function MobileTopBar() {
  const pathname = usePathname();
  const openDrawer = useMobileNavStore((s) => s.openDrawer);
  const title = pageTitleForPath(pathname);

  return (
    <header className="lg:hidden sticky top-0 z-40 bg-surface border-b border-border pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3 px-3 h-14">
        <button
          type="button"
          onClick={openDrawer}
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
            <div className="text-sm font-semibold text-text truncate leading-tight">{title}</div>
            <div className="text-[10px] uppercase tracking-widest text-text-secondary truncate">
              Partner Analytics
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
