'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Route, GitBranch } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const JOURNEY_NAV = [
  {
    href: '/admission-journey',
    label: 'Admission journey',
    icon: Route,
  },
  {
    href: '/admission-journey/pipeline',
    label: 'Overall pipeline',
    icon: GitBranch,
  },
] as const;

export function AdmissionJourneySidebar() {
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-52 bg-surface border-r border-border flex-col z-30">
      <div className="px-4 py-4 border-b border-primary bg-black">
        <Image
          src="/logo-dark.png"
          alt="upGrad School of Technology"
          width={180}
          height={70}
          priority
          className="w-full h-auto object-contain"
        />
        <div className="text-text-secondary text-[10px] uppercase tracking-widest mt-2">
          Admission journey
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        <div className="mb-2 px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 py-2 text-sm text-text-secondary hover:text-text border-l-2 border-l-transparent hover:bg-panel/50 pl-2"
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            <span>Report hub</span>
          </Link>
        </div>
        <div className="mb-2">
          <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-text-secondary">
            Dashboard
          </div>
          {JOURNEY_NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/admission-journey'
                ? pathname === item.href ||
                  /^\/admission-journey\/(?!pipeline)[^/]+$/.test(pathname)
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2 text-sm border-l-2 transition-none',
                  active
                    ? 'border-l-primary bg-panel text-text'
                    : 'border-l-transparent text-text-secondary hover:text-text hover:bg-panel/50'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      {user && (
        <div className="p-3 border-t border-border">
          <div className="px-1 text-xs text-text-secondary">
            <div className="text-text truncate">{user.username}</div>
          </div>
        </div>
      )}
    </aside>
  );
}
