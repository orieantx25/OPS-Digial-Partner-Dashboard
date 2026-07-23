'use client';

import { Fragment } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { EMPTY_EXECUTIVE_CHARTS } from '@/lib/empty-defaults';
import { KPI_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { cn, formatNumber, formatPct } from '@/lib/utils';

const CONNECTED_SPLIT_ROWS: { key: 'ai_connected' | 'ac_connected'; label: string }[] = [
  { key: 'ai_connected', label: 'AI Connected' },
  { key: 'ac_connected', label: 'AC Connected' },
];

export default function FunnelPage() {
  const filters = useEffectiveFilters();
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);

  const { data: funnel, loading, isFetching } = useFetch({
    fetcher: () => api.getFunnel(filters),
    deps: [JSON.stringify(filters)],
  });

  const displayFunnel = funnel ?? EMPTY_EXECUTIVE_CHARTS.funnel;
  const conversions = (displayFunnel.extra?.conversions as number[]) || [];
  const drops = (displayFunnel.extra?.drops as number[]) || [];
  const connectedSplit = (displayFunnel.extra?.connected_split as {
    ai_connected?: number;
    ac_connected?: number;
  }) || { ai_connected: 0, ac_connected: 0 };

  return (
    <div className={cn('space-y-4', isFetching && funnel && 'opacity-90')}>
      <PageHeader title="Lead Funnel" />
      <FetchingHint active={isFetching} />
      {loading && !funnel ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <>
          <ChartPanel chart={displayFunnel} height={400} />
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
                        {stage === 'Connected' ? (
                          <button
                            type="button"
                            className="hover:text-accent transition-colors"
                            onClick={() =>
                              openExplorer('Connected', KPI_LEAD_FILTERS.connected)
                            }
                          >
                            {stage}
                          </button>
                        ) : (
                          stage
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
                            <button
                              type="button"
                              className="hover:text-text transition-colors"
                              onClick={() => openExplorer(label, KPI_LEAD_FILTERS[key])}
                            >
                              {label}
                            </button>
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
        </>
      )}
    </div>
  );
}
