'use client';

import { KpiMetric } from '@/types';
import { cn, formatCurrency, formatNumber, formatPct } from '@/lib/utils';
import { KPI_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { isLeadershipMode } from '@/lib/static-mode';

const PERCENT_KEYS = new Set(['roi', 'dnp_pct']);
const DECIMAL_KEYS = new Set(['avg_dial_count']);
const CURRENCY_KEYS = new Set(['revenue']);

export function formatMetricValue(metric: KpiMetric): string {
  if (CURRENCY_KEYS.has(metric.key)) return formatCurrency(metric.current);
  if (PERCENT_KEYS.has(metric.key)) return formatPct(metric.current);
  if (DECIMAL_KEYS.has(metric.key)) return formatNumber(metric.current, 2);
  return formatNumber(metric.current);
}

function metricValueClass(formatted: string): string {
  const len = formatted.length;
  if (len > 11) return 'text-sm';
  if (len > 9) return 'text-base';
  if (len > 7) return 'text-lg';
  return 'text-xl';
}

function DeltaBadge({ metric }: { metric: KpiMetric }) {
  const positive = metric.change_pct > 0;
  const negative = metric.change_pct < 0;
  if (metric.change_pct === 0) {
    return <span className="text-text-secondary text-[11px] font-mono">—</span>;
  }
  return (
    <span
      className={cn(
        'text-[11px] font-mono',
        positive && 'text-success',
        negative && 'text-danger'
      )}
    >
      {positive ? '▲' : '▼'} {Math.abs(metric.change_pct).toFixed(2)}%
    </span>
  );
}

/** Compact metric cell — dense, readable, no heavy borders. */
export function MetricCell({ metric }: { metric: KpiMetric }) {
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);
  const formatted = formatMetricValue(metric);
  const filterKey = KPI_LEAD_FILTERS[metric.key];
  const interactive = !isLeadershipMode();

  const body = (
    <>
      <div
        className={cn(
          'text-text-secondary text-[10px] uppercase tracking-wide mb-1 truncate',
          interactive && 'group-hover:text-text'
        )}
      >
        {metric.label}
      </div>
      <div className="flex items-baseline justify-between gap-1.5 min-w-0">
        <span
          className={cn(
            'kpi-value font-semibold text-text leading-none tabular-nums min-w-0 truncate',
            metricValueClass(formatted)
          )}
          title={formatted}
        >
          {formatted}
        </span>
        <span className="shrink-0">
          <DeltaBadge metric={metric} />
        </span>
      </div>
    </>
  );

  if (!interactive) {
    return (
      <div className="px-3 py-3 border-r border-b border-border last:border-r-0 min-w-0 text-left w-full min-h-[72px]">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openExplorer(metric.label, filterKey)}
      className="px-3 py-3 border-r border-b border-border last:border-r-0 min-w-0 text-left w-full hover:bg-surface/80 transition-colors cursor-pointer group min-h-[72px]"
      title={`View ${metric.label} leads`}
    >
      {body}
    </button>
  );
}

interface MetricGroup {
  title: string;
  keys: string[];
}

interface MetricStripProps {
  metrics: KpiMetric[];
  groups: MetricGroup[];
}

/**
 * Groups related KPIs under compact headers to reduce visual noise.
 * Analytical best practice: cluster metrics by meaning, not a flat wall of boxes.
 */
export function MetricStrip({ metrics, groups }: MetricStripProps) {
  const byKey = new Map(metrics.map((m) => [m.key, m]));

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const groupMetrics = group.keys
          .map((k) => byKey.get(k))
          .filter((m): m is KpiMetric => Boolean(m));
        if (!groupMetrics.length) return null;
        return (
          <div key={group.title} className="panel">
            <div className="px-3 py-1.5 border-b border-border bg-surface/50">
              <span className="text-[10px] uppercase tracking-widest text-text-secondary">
                {group.title}
              </span>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 128px), 1fr))`,
              }}
            >
              {groupMetrics.map((m) => (
                <MetricCell key={m.key} metric={m} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
