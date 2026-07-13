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
    <div className="flex items-end justify-between gap-4 mt-1">
      <div>
        <h2 className="text-[11px] uppercase tracking-widest text-text-secondary">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-text-secondary/70 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  totalRows?: number;
  action?: React.ReactNode;
}

/** Standard page title with dataset context. */
export function PageHeader({ title, totalRows, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text border-l-4 border-primary pl-3">
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
