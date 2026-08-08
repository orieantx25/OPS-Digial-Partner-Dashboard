'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { IndiaMap } from '@/components/charts/india-map';
import { SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { DataTable } from '@/components/tables/data-table';
import { CampusBifurcation, ChartData, StateSummary } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { fetchSnapshotJson, isStaticDataMode } from '@/lib/static-mode';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

function ChartSkeleton() {
  return (
    <div className="panel border border-border bg-surface h-[280px] sm:h-[480px] animate-pulse flex items-center justify-center">
      <span className="text-xs text-text-secondary">Loading chart…</span>
    </div>
  );
}

function pickStateRows(data: CampusBifurcation | null | undefined): {
  rows: StateSummary[];
  usingActive: boolean;
} {
  const adjusted = data?.adjusted_sheet_state_summary;
  const gross = data?.sheet_state_summary;
  if (adjusted && adjusted.length > 0) {
    return { rows: adjusted, usingActive: true };
  }
  if (gross && gross.length > 0) {
    return { rows: gross, usingActive: false };
  }
  return { rows: [], usingActive: false };
}

function formatStateLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 panel border border-border bg-surface h-[280px] sm:h-[480px] animate-pulse" />
        <div className="lg:col-span-5 panel border border-border bg-surface h-[280px] sm:h-[480px] animate-pulse" />
      </div>
      <div className="panel border border-border bg-surface h-[200px] animate-pulse" />
    </div>
  );
}

export default function CampusBlockGeographyPage() {
  const filters = useMemo(() => ({}), []);
  const chartH = useChartHeight(520, 280);

  const { data, loading, isFetching } = useFetch({
    fetcher: async () => {
      const live = await api.getCampusBifurcation(filters);
      const picked = pickStateRows(live);
      if (picked.rows.length > 0 || isStaticDataMode()) {
        return live;
      }
      try {
        const snap = await fetchSnapshotJson<CampusBifurcation>(
          'all/campus_bifurcation.json'
        );
        if (pickStateRows(snap).rows.length === 0) return live;
        return {
          ...live,
          sheet_state_summary: snap.sheet_state_summary,
          adjusted_sheet_state_summary: snap.adjusted_sheet_state_summary,
        };
      } catch {
        return live;
      }
    },
    deps: [],
  });

  const { rows: stateRows, usingActive } = useMemo(
    () => pickStateRows(data),
    [data]
  );

  const totalMapped = useMemo(
    () => stateRows.reduce((s, r) => s + r.leads, 0),
    [stateRows]
  );

  const statePieChart = useMemo((): ChartData | null => {
    const positive = stateRows
      .filter((r) => r.leads > 0)
      .sort((a, b) => b.leads - a.leads);
    if (positive.length === 0) return null;
    return {
      chart_id: 'campus_block_state_distribution',
      chart_type: 'donut',
      title: '',
      categories: positive.map((r) => formatStateLabel(r.state)),
      series: [
        {
          name: 'Block paid',
          data: positive.map((r) => r.leads),
        },
      ],
      extra: {
        center_total: totalMapped,
        center_label: 'Total block',
        compact_donut: true,
        show_slice_labels: true,
      },
    };
  }, [stateRows, totalMapped]);

  const tableRows = useMemo(() => {
    const total = totalMapped;
    return stateRows.map((r) => ({
      state: formatStateLabel(r.state),
      block_paid: r.leads,
      share_pct: total > 0 ? (r.leads / total) * 100 : 0,
    }));
  }, [stateRows, totalMapped]);

  const columns: ColumnDef<(typeof tableRows)[number]>[] = [
    { accessorKey: 'state', header: 'State', meta: { width: '50%' } },
    {
      accessorKey: 'block_paid',
      header: 'Block paid',
      meta: { width: '25%' },
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'share_pct',
      header: 'Share',
      meta: { width: '25%' },
      cell: ({ getValue }) => `${Number(getValue() || 0).toFixed(1)}%`,
    },
  ];

  return (
    <div className={cn('space-y-5 sm:space-y-6', isFetching && data && 'opacity-90')}>
      {!isStaticDataMode() && (
        <p className="text-[10px] text-text-secondary/80 border border-border/60 bg-surface/50 px-3 py-2 rounded-sm">
          Local mode loads live analytics from the backend (~2–4s). Production uses pre-published
          snapshots and is typically much faster.
        </p>
      )}

      {loading && !data ? (
        <PageSkeleton />
      ) : (
        <FetchingHint active={isFetching} />
      )}

      {!loading && !data?.has_sheet ? (
        <div className="panel p-6 sm:p-8 border border-border text-center max-w-lg mx-auto">
          <p className="text-sm text-text-secondary leading-relaxed">
            Geography will appear after the ops team publishes campus block snapshots.
          </p>
        </div>
      ) : data?.has_sheet ? (
        <>
          <section className="space-y-4 panel p-4 sm:p-5 border border-border">
            <SectionHeader
              title="Block paid by state"
              subtitle={
                usingActive
                  ? `Active block amounts after excluding matched refunds · ${formatNumber(totalMapped)} mapped`
                  : `Block payment sheet · ${formatNumber(totalMapped)} mapped`
              }
            />
            {stateRows.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
                <div className="lg:col-span-7 min-w-0 h-full">
                  <IndiaMap
                    data={stateRows}
                    dimension="leads"
                    dimensionLabel="Block paid"
                    height={chartH}
                    zeroAreaColor="#2A2A2A"
                    className="h-full box-border"
                  />
                </div>
                <div className="lg:col-span-5 min-w-0 h-full">
                  {statePieChart ? (
                    <ChartPanel
                      chart={statePieChart}
                      height={chartH}
                      className="h-full box-border"
                    />
                  ) : (
                    <div className="panel border border-border h-full flex items-center justify-center text-sm text-text-secondary">
                      No state distribution to chart
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary py-8 text-center">
                No state values found on the block payment sheet.
              </p>
            )}
          </section>

          {tableRows.length > 0 && (
            <section className="space-y-3 panel p-4 sm:p-5 border border-border">
              <SectionHeader
                title="State summary"
                subtitle={`${formatNumber(tableRows.length)} states · from payment sheet`}
              />
              <DataTable
                data={tableRows}
                columns={columns}
                exportFilename="campus_block_by_state.csv"
                searchPlaceholder="Search state…"
                height="auto"
              />
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
