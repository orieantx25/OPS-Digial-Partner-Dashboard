'use client';

import { cn, formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';

interface ClickableMetricBoxProps {
  label: string;
  value: string;
  subtext?: string;
  onClick?: () => void;
  className?: string;
}

/** KPI tile — clickable for ops (opens Lead Explorer); static on leadership/Vercel. */
export function ClickableMetricBox({
  label,
  value,
  subtext,
  onClick,
  className,
}: ClickableMetricBoxProps) {
  const interactive = Boolean(onClick) && !isLeadershipMode();

  const body = (
    <>
      <div
        className={cn(
          'text-[10px] text-text-secondary uppercase tracking-wide mb-1',
          interactive && 'group-hover:text-text'
        )}
      >
        {label}
      </div>
      <div className="kpi-value text-xl font-semibold">{value}</div>
      {subtext && (
        <div className="text-[10px] text-text-secondary mt-0.5">{subtext}</div>
      )}
    </>
  );

  if (!interactive) {
    return (
      <div
        className={cn(
          'px-3 py-2.5 border-r border-b border-border last:border-r-0 text-left w-full',
          className
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2.5 border-r border-b border-border last:border-r-0 text-left w-full',
        'hover:bg-surface/80 transition-colors cursor-pointer group',
        className
      )}
      title={`View ${label} leads`}
    >
      {body}
    </button>
  );
}

export function formatMetricBoxValue(count: number | undefined): string {
  return count != null ? formatNumber(count) : '—';
}
