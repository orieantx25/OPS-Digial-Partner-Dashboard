'use client';

import { cn, formatNumber } from '@/lib/utils';

export type KpiItem = {
  label: string;
  value: number | string;
  sub?: string;
  primary?: boolean;
};

export function KpiBlock({ label, value, sub, primary }: KpiItem) {
  return (
    <div
      className={cn(
        'panel bg-surface px-3 py-2.5 sm:px-4 sm:py-3 min-h-[68px] sm:min-h-[72px]',
        'min-w-0 w-full sm:min-w-[9rem] sm:flex-1'
      )}
    >
      <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-text-secondary leading-snug line-clamp-2">
        {label}
      </div>
      <div
        className={cn(
          'text-base sm:text-lg font-semibold kpi-value mt-1 tabular-nums',
          primary ? 'text-primary' : 'text-text'
        )}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
      {sub && (
        <div className="text-[9px] sm:text-[10px] text-text-secondary mt-0.5 line-clamp-2">
          {sub}
        </div>
      )}
    </div>
  );
}

export function KpiCategoryRow({
  title,
  items,
  compact,
}: {
  title: string;
  items: KpiItem[];
  /** Tighter spacing for stacked mobile dashboards */
  compact?: boolean;
}) {
  return (
    <div className={cn(compact ? 'space-y-1.5' : 'space-y-2')}>
      <div className="text-[10px] uppercase tracking-widest text-text-secondary font-medium px-1">
        {title}
      </div>
      <div
        className={cn(
          'grid grid-cols-2 gap-2',
          'sm:flex sm:flex-wrap sm:gap-3'
        )}
      >
        {items.map((item) => (
          <KpiBlock key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

export function KpiDashboardStack({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4 sm:space-y-5', className)}>
      {children}
    </div>
  );
}
