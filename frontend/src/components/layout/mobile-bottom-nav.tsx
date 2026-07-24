'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Filter, Users, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOBILE_BOTTOM_TABS } from '@/lib/nav';
import { useMobileNavStore } from '@/store/mobile-nav-store';

const TAB_ICONS = {
  executive: LayoutDashboard,
  funnel: Filter,
  partner: Users,
} as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const openDrawer = useMobileNavStore((s) => s.openDrawer);

  const isMoreActive = !MOBILE_BOTTOM_TABS.some(
    (t) =>
      pathname === t.href || (t.href !== '/' && pathname.startsWith(t.href))
  );

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <div className="grid grid-cols-4 h-14">
        {MOBILE_BOTTOM_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const active =
            pathname === tab.href ||
            (tab.href !== '/' && pathname.startsWith(tab.href));
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wide',
                active ? 'text-primary' : 'text-text-secondary'
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={openDrawer}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wide',
            isMoreActive ? 'text-primary' : 'text-text-secondary'
          )}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
