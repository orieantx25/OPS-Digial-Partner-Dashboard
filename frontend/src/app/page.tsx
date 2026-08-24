'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  IndianRupee,
  LayoutDashboard,
  Loader2,
  Route,
  Undo2,
} from 'lucide-react';
import { usePortalAuthStore } from '@/store/portal-auth-store';
import { isPortalAuthEnabled } from '@/lib/portal-mode';

const DASHBOARDS = [
  {
    id: 'digital-partner',
    title: 'Digital Partner',
    description:
      'Partner pipeline, funnel, block payment reconciliation, refunds, and executive KPIs.',
    href: '/digital-partner',
    icon: LayoutDashboard,
    external: false,
  },
  {
    id: 'campus-block',
    title: 'Campus Admission and Block Dashboard',
    description:
      'Campus block payment bifurcation, refunds, and gender splits.',
    href: '/campus-block',
    icon: Building2,
    external: false,
  },
  {
    id: 'refund-cases',
    title: 'Refund Cases',
    description:
      'Refund sheet KPIs, retained vs processed vs refunded, and campus distribution.',
    href: '/refund-cases',
    icon: Undo2,
    external: false,
  },
  {
    id: 'admission-journey',
    title: 'Admission Journey',
    description:
      'Back track all admissions and block Paid students',
    href: '/admission-journey',
    icon: Route,
    external: false,
  },
  {
    id: 'loans',
    title: 'Loan Operations',
    description:
      'Loan pipeline, vendor tracking, risk cases, and campus bifurcation.',
    href: null,
    icon: IndianRupee,
    external: true,
  },
] as const;

export default function PortalHubPage() {
  const email = usePortalAuthStore((s) => s.email);
  const clearSession = usePortalAuthStore((s) => s.clearSession);
  const memoryToken = usePortalAuthStore((s) => s.memoryToken);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);

  const signOut = async () => {
    await fetch('/api/auth/me', { method: 'DELETE', credentials: 'include' });
    clearSession();
    window.location.href = '/login';
  };

  const openLoans = async () => {
    setLoansError(null);
    setLoansLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;
      const res = await fetch('/api/auth/handoff', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not open Loan Operations');
      window.location.href = data.url as string;
    } catch (e) {
      setLoansError(e instanceof Error ? e.message : 'Could not open Loan Operations');
      setLoansLoading(false);
    }
  };

  const cardClass =
    'group relative flex flex-col h-full min-h-[220px] p-6 lg:p-7 bg-panel border border-border rounded-sm transition-all duration-200 hover:border-primary/50 hover:bg-[#252628] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2';

  return (
    <div className="min-h-screen bg-[#0F0F10] text-white flex flex-col">
      <header className="border-b border-border/80 px-6 lg:px-10 py-5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-5 min-w-0">
          <Image
            src="/logo-dark.png"
            alt="upGrad School of Technology"
            width={160}
            height={56}
            className="h-9 w-auto object-contain shrink-0"
          />
          <div className="hidden sm:block border-l border-border/80 pl-5 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              Report hub
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Analytics hub</h1>
        </div>
        </div>
        <div className="flex items-center gap-4 text-sm shrink-0">
          {email && (
            <span className="text-text-secondary hidden md:inline truncate max-w-[240px] text-xs">
              {email}
            </span>
          )}
          {isPortalAuthEnabled() && (
              <button
                type="button"
              onClick={signOut}
              className="text-text-secondary hover:text-white text-[10px] uppercase tracking-[0.15em] transition-colors"
            >
              Sign out
            </button>
            )}
          </div>
      </header>

      <main className="flex-1 flex flex-col justify-center w-full max-w-6xl mx-auto px-6 lg:px-10 py-10 lg:py-14">
        {loansError && (
          <p className="text-danger text-sm mb-6 text-center" role="alert">{loansError}</p>
        )}

        <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DASHBOARDS.map((card) => {
            const Icon = card.icon;
            const Arrow = card.external ? ArrowUpRight : ArrowRight;

            const inner = (
              <>
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-sm bg-primary/10 border border-primary/25">
                  <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
          </div>
                <h2 className="text-lg font-semibold tracking-tight mb-2 pr-6">{card.title}</h2>
                <p className="text-sm text-text-secondary leading-relaxed flex-1 line-clamp-2">
                  {card.description}
                </p>
                <div className="mt-5 flex items-center justify-between gap-3 pt-4 border-t border-border/60">
                  {card.id === 'loans' && loansLoading ? (
                    <span className="text-xs text-text-secondary flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Opening…
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.15em] text-text-secondary group-hover:text-primary transition-colors">
                      {card.external ? 'Open app' : 'Open dashboard'}
                    </span>
                  )}
                  <Arrow
                    className="h-4 w-4 text-text-secondary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 group-hover:text-primary shrink-0"
                    strokeWidth={2}
                  />
          </div>
              </>
            );

            if (card.external) {
              return (
              <button
                  key={card.id}
                type="button"
                  onClick={openLoans}
                  disabled={loansLoading}
                  className={`${cardClass} text-left disabled:opacity-60 disabled:pointer-events-none`}
                >
                  {inner}
              </button>
              );
            }

            return (
              <Link key={card.id} href={card.href!} className={cardClass}>
                {inner}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
