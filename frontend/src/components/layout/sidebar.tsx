'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Upload } from 'lucide-react';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { cn } from '@/lib/utils';
import { NAV_GROUPS, NAV_ICONS, NAV_PAGES } from '@/lib/nav';
import { useAppStore } from '@/store/app-store';
import { useUploadStore } from '@/store/upload-store';

export function Sidebar() {
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);
  const openUpload = useUploadStore((s) => s.openUpload);

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
          Digital Partner Analytics
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => {
          const pages = NAV_PAGES.filter((p) => p.group === group);
          if (!pages.length) return null;
          return (
            <div key={group} className="mb-2">
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-text-secondary">
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
                    className={cn(
                      'flex items-center gap-2.5 px-4 py-2 text-sm border-l-2 transition-none',
                      active
                        ? 'border-l-primary bg-panel text-text'
                        : 'border-l-transparent text-text-secondary hover:text-text hover:bg-panel/50'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{page.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border space-y-2">
        {canUpload() && (
          <button
            type="button"
            onClick={openUpload}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
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
  );
}
