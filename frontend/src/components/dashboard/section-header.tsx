'use client';

import { formatNumber } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

/** Consistent section divider to establish visual hierarchy across dashboards. */
export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4 mt-1">
      <div className="min-w-0">
        <h2 className="text-[11px] uppercase tracking-widest text-text-secondary">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-text-secondary/70 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 w-full sm:w-auto">{action}</div>}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  totalRows?: number;
  action?: React.ReactNode;
}

/** Standard page title with dataset context. Hidden on mobile (title is in top bar). */
export function PageHeader({ title, totalRows, action }: PageHeaderProps) {
  return (
    <div className="hidden lg:flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base sm:text-lg font-semibold text-text border-l-4 border-primary pl-3 truncate">
          {title}
        </h1>
        {typeof totalRows === 'number' && totalRows > 0 && (
          <span className="text-xs text-text-secondary kpi-value">
            {formatNumber(totalRows)} records
          </span>
        )}
      </div>
      {action}
    </div>
  );
}
