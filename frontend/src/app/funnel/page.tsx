'use client';

import { Fragment, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { InsightStrip } from '@/components/dashboard/insight-strip';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { DataTable } from '@/components/tables/data-table';
import { EMPTY_EXECUTIVE_CHARTS } from '@/lib/empty-defaults';
import { FUNNEL_STAGE_LEAD_FILTERS } from '@/lib/funnel-filters';
import { KPI_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';

const CONNECTED_SPLIT_ROWS: { key: 'ai_connected' | 'ac_connected'; label: string }[] = [
  { key: 'ai_connected', label: 'AI Connected' },
  { key: 'ac_connected', label: 'AC Connected' },
];

export default function FunnelPage() {
  const filters = useEffectiveFilters();
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);
  const leadership = isLeadershipMode();
  const [cohortBy, setCohortBy] = useState<'week' | 'month'>('month');

  const { data: funnel, loading, isFetching } = useFetch({
    fetcher: () => api.getFunnel(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: trends } = useFetch({
    fetcher: () => api.getFunnelTrends(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: cohorts } = useFetch({
    fetcher: () => api.getCohorts(filters, cohortBy),
    deps: [JSON.stringify(filters), cohortBy],
  });

  const displayFunnel = funnel ?? EMPTY_EXECUTIVE_CHARTS.funnel;
  const conversions = (displayFunnel.extra?.conversions as number[]) || [];
  const drops = (displayFunnel.extra?.drops as number[]) || [];
  const connectedSplit = (displayFunnel.extra?.connected_split as {
    ai_connected?: number;
    ac_connected?: number;
  }) || { ai_connected: 0, ac_connected: 0 };

  const insightItems = useMemo(() => {
    const items: { text: string; actionLabel?: string; onAction?: () => void }[] = [];
    if (displayFunnel.categories.length && drops.length) {
      let maxIdx = 1;
      for (let i = 1; i < drops.length; i++) {
        if ((drops[i] ?? 0) > (drops[maxIdx] ?? 0)) maxIdx = i;
      }
      if ((drops[maxIdx] ?? 0) > 0) {
        const from = String(displayFunnel.categories[maxIdx - 1] ?? '');
        const to = String(displayFunnel.categories[maxIdx] ?? '');
        items.push({
          text: `Largest drop-off: ${from} → ${to} (${formatPct(drops[maxIdx])} lost).`,
          ...(leadership
            ? {}
            : {
                actionLabel: `View ${to}`,
                onAction: () => openExplorer(to, FUNNEL_STAGE_LEAD_FILTERS[to]),
              }),
        });
      }
    }
    const leadCount = Number(displayFunnel.series[0]?.data[0] || 0);
    const connectedIdx = displayFunnel.categories.indexOf('Connected');
    const blockIdx = displayFunnel.categories.indexOf('Block Amount Paid');
    if (leadCount > 0 && connectedIdx >= 0) {
      const connected = Number(displayFunnel.series[0]?.data[connectedIdx] || 0);
      items.push({
        text: `Lead → Connected: ${formatPct((connected / leadCount) * 100)} (${formatNumber(connected)}).`,
        ...(leadership
          ? {}
          : {
              actionLabel: 'Explore',
              onAction: () => openExplorer('Connected', KPI_LEAD_FILTERS.connected),
            }),
      });
    }
    if (leadCount > 0 && blockIdx >= 0) {
      const block = Number(displayFunnel.series[0]?.data[blockIdx] || 0);
      items.push({
        text: `Lead → Block Amount Paid: ${formatPct((block / leadCount) * 100)} (${formatNumber(block)}).`,
        ...(leadership
          ? {}
          : {
              actionLabel: 'Explore',
              onAction: () =>
                openExplorer('Block Amount Paid', KPI_LEAD_FILTERS.block_amount_paid),
            }),
      });
    }
    return items.slice(0, 3);
  }, [displayFunnel, drops, openExplorer, leadership]);

  const cohortColumns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'cohort', header: 'Cohort' },
    { accessorKey: 'leads', header: 'Leads' },
    { accessorKey: 'avg_age_days', header: 'Avg Age (days)' },
    { accessorKey: 'connected_pct', header: 'Connected %' },
    { accessorKey: 'block_pct', header: 'Block %' },
    { accessorKey: 'admissions', header: 'Admissions' },
  ];

  return (
    <div className={cn('space-y-4', isFetching && funnel && 'opacity-90')}>
      <PageHeader title="Lead Funnel" />
      <FetchingHint active={isFetching} />
      {loading && !funnel ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <>
          <InsightStrip title="Funnel insights" items={insightItems} />
          <ChartPanel
            chart={displayFunnel}
            height={400}
            onCategoryClick={
              leadership
                ? undefined
                : (stage) => openExplorer(stage, FUNNEL_STAGE_LEAD_FILTERS[stage])
            }
          />
          <SectionHeader title="Stage Breakdown" />
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b border-border">
                <tr>
                  <th className="text-left p-3 text-text-secondary text-xs uppercase">Stage</th>
                  <th className="text-right p-3 text-text-secondary text-xs uppercase">Count</th>
                  <th className="text-right p-3 text-text-secondary text-xs uppercase">Conversion %</th>
                  <th className="text-right p-3 text-text-secondary text-xs uppercase">Drop %</th>
                </tr>
              </thead>
              <tbody>
                {displayFunnel.categories.map((stage, i) => (
                  <Fragment key={stage}>
                    <tr className="border-b border-border/50">
                      <td className="p-3 font-medium">
                        {leadership ? (
                          stage
                        ) : (
                          <button
                            type="button"
                            className="hover:text-accent transition-colors"
                            onClick={() =>
                              openExplorer(String(stage), FUNNEL_STAGE_LEAD_FILTERS[String(stage)])
                            }
                          >
                            {stage}
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-right kpi-value">
                        {formatNumber(Number(displayFunnel.series[0]?.data[i] || 0))}
                      </td>
                      <td className="p-3 text-right text-success">
                        {formatPct(conversions[i] ?? 0)}
                      </td>
                      <td className="p-3 text-right text-danger">
                        {formatPct(drops[i] ?? 0)}
                      </td>
                    </tr>
                    {stage === 'Connected' &&
                      CONNECTED_SPLIT_ROWS.map(({ key, label }) => (
                        <tr key={key} className="border-b border-border/50 bg-surface/30">
                          <td className="p-3 pl-8 text-text-secondary">
                            {leadership ? (
                              label
                            ) : (
                              <button
                                type="button"
                                className="hover:text-text transition-colors"
                                onClick={() => openExplorer(label, KPI_LEAD_FILTERS[key])}
                              >
                                {label}
                              </button>
                            )}
                          </td>
                          <td className="p-3 text-right kpi-value text-text-secondary">
                            {formatNumber(Number(connectedSplit[key] || 0))}
                          </td>
                          <td className="p-3 text-right text-text-secondary">—</td>
                          <td className="p-3 text-right text-text-secondary">—</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHeader
            title="Conversion trends"
            subtitle="Monthly stage rates as % of leads created that month"
          />
          {trends && <ChartPanel chart={trends} height={300} />}

          <SectionHeader
            title="Lead cohorts"
            action={
              <div className="flex border border-border">
                {(['month', 'week'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setCohortBy(g)}
                    className={
                      'px-3 py-1 text-xs ' +
                      (cohortBy === g
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary hover:text-text')
                    }
                  >
                    By {g}
                  </button>
                ))}
              </div>
            }
          />
          <DataTable
            data={(cohorts?.cohorts ?? []) as Record<string, unknown>[]}
            columns={cohortColumns}
            exportFilename="funnel_cohorts.csv"
            height={280}
          />
        </>
      )}
    </div>
  );
}
