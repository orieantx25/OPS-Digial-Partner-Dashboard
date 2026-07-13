'use client';

import { KpiMetric } from '@/types';
import { cn, formatNumber, formatPercent, formatPct } from '@/lib/utils';

interface KpiCardProps {
  metric: KpiMetric;
  format?: 'number' | 'currency' | 'percent';
  onClick?: () => void;
}

export function KpiCard({ metric, format = 'number', onClick }: KpiCardProps) {
  const isPositive = metric.change_pct > 0;
  const isNegative = metric.change_pct < 0;

  const displayValue =
    format === 'currency'
      ? `₹${formatNumber(metric.current)}`
      : format === 'percent'
      ? formatPct(metric.current)
      : formatNumber(metric.current);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'panel p-3 text-left w-full border-t-2 border-t-primary',
        'hover:outline hover:outline-1 hover:outline-primary transition-none',
        onClick && 'cursor-pointer'
      )}
    >
      <div className="text-text-secondary text-xs uppercase tracking-wide mb-1">
        {metric.label}
      </div>
      <div className="kpi-value text-2xl font-semibold text-text mb-1">{displayValue}</div>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'text-xs font-mono',
            isPositive && 'text-success',
            isNegative && 'text-danger',
            !isPositive && !isNegative && 'text-text-secondary'
          )}
        >
          {formatPercent(metric.change_pct)}
        </span>
        <span className="text-text-secondary text-xs">vs prev</span>
      </div>
      {metric.trend.length > 0 && (
        <svg viewBox="0 0 80 20" className="w-full h-5 mt-2" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="#E31E24"
            strokeWidth="1.5"
            points={metric.trend
              .map((v, i) => {
                const max = Math.max(...metric.trend, 1);
                const x = (i / Math.max(metric.trend.length - 1, 1)) * 80;
                const y = 18 - (v / max) * 16;
                return `${x},${y}`;
              })
              .join(' ')}
          />
        </svg>
      )}
    </button>
  );
}

interface KpiGridProps {
  metrics: KpiMetric[];
  columns?: number;
}

export function KpiGrid({ metrics, columns = 5 }: KpiGridProps) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {metrics.map((m) => (
        <KpiCard key={m.key} metric={m} format={m.key.includes('roi') || m.key.includes('dnp') ? 'percent' : m.key === 'revenue' ? 'currency' : 'number'} />
      ))}
    </div>
  );
}
