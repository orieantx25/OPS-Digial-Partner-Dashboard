'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { DataTable } from '@/components/tables/data-table';
import { CampusBlockKpiDashboard } from '@/components/dashboard/campus-block-kpi-dashboard';
import { SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { ChartData } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { isStaticDataMode } from '@/lib/static-mode';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

function ChartSkeleton() {
  return (
    <div className="panel border border-border bg-surface h-[200px] sm:h-[220px] animate-pulse flex items-center justify-center">
      <span className="text-xs text-text-secondary">Loading chart…</span>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="panel h-[88px] bg-surface border border-border animate-pulse"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

/** Overall campus block dashboard — no digital-partner attribution charts. */
export default function CampusBlockPage() {
  const filters = useMemo(() => ({}), []);
  const chartSm = useChartHeight(220, 200);

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getCampusBifurcation(filters),
    deps: [],
  });

  const adjustedCampusChart = data?.adjusted_sheet_campus_chart as ChartData | undefined;
  const adjustedGenderChart = data?.adjusted_sheet_gender_chart as ChartData | undefined;
  const adjustedCampusGenderCharts = data?.adjusted_sheet_campus_gender_charts ?? [];

  const campusTableRows = useMemo(() => {
    const grossList = data?.sheet_by_campus ?? [];
    const adjustedList = data?.adjusted_sheet_by_campus ?? [];
    const grossMap = new Map(grossList.map((r) => [r.campus_code, r]));
    const adjMap = new Map(adjustedList.map((r) => [r.campus_code, r]));
    const codes = new Set([
      ...grossList.map((r) => r.campus_code),
      ...adjustedList.map((r) => r.campus_code),
    ]);

    return Array.from(codes)
      .map((code) => {
        const adj = adjMap.get(code);
        const gross = grossMap.get(code);
        const row = adj ?? gross;
        if (!row) return null;
        const grossBlock = gross?.block_paid ?? row.block_paid;
        const activeBlock = adj?.block_paid ?? grossBlock;
        const male =
          row.by_gender.find((g) => g.gender.toLowerCase() === 'male')?.count ?? 0;
        const female =
          row.by_gender.find((g) => g.gender.toLowerCase() === 'female')?.count ?? 0;
        const other = activeBlock - male - female;
        return {
          campus_code: code,
          campus_name: row.campus_name,
          active_block: activeBlock,
          gross_block: grossBlock,
          refunded: Math.max(0, grossBlock - activeBlock),
          male,
          female,
          other: other > 0 ? other : 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.active_block - a.active_block);
  }, [data?.adjusted_sheet_by_campus, data?.sheet_by_campus]);

  const campusColumns: ColumnDef<(typeof campusTableRows)[number]>[] = [
    { accessorKey: 'campus_code', header: 'Code', meta: { width: '10%' } },
    { accessorKey: 'campus_name', header: 'Campus', meta: { width: '22%' } },
    { accessorKey: 'active_block', header: 'Active block', meta: { width: '11%' } },
    { accessorKey: 'gross_block', header: 'Gross block', meta: { width: '11%' } },
    { accessorKey: 'refunded', header: 'Refunded', meta: { width: '10%' } },
    { accessorKey: 'male', header: 'Male', meta: { width: '9%' } },
    { accessorKey: 'female', header: 'Female', meta: { width: '9%' } },
    { accessorKey: 'other', header: 'Other', meta: { width: '9%' } },
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
            Campus block data will appear after the ops team publishes snapshots from the Digital
            Partner dashboard.
          </p>
        </div>
      ) : data?.has_sheet ? (
        <>
          <section className="space-y-4 panel p-4 sm:p-5 border border-border">
            <SectionHeader
              title="Block distribution"
              subtitle="Active counts after excluding matched refund cases"
            />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-7 min-w-0">
                {adjustedCampusChart && (
                  <ChartPanel chart={adjustedCampusChart} height={chartSm} />
                )}
              </div>
              <div className="lg:col-span-5 min-w-0">
                {adjustedGenderChart && (
                  <ChartPanel chart={adjustedGenderChart} height={chartSm} />
                )}
              </div>
            </div>
          </section>

          <CampusBlockKpiDashboard data={data} />

          {adjustedCampusGenderCharts.length > 0 && (
            <section className="space-y-3 panel p-4 sm:p-5 border border-border">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-1 px-1">
                Gender split by campus
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {adjustedCampusGenderCharts.map((item) => (
                  <ChartPanel
                    key={`adj-${item.campus_code}`}
                    chart={item.gender_chart}
                    height={chartSm - 16}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3 panel p-4 sm:p-5 border border-border">
            <SectionHeader
              title="Campus summary table"
              subtitle={`${formatNumber(campusTableRows.length)} campuses · active vs gross block`}
            />
            <DataTable
              data={campusTableRows}
              columns={campusColumns}
              exportFilename="campus_block_summary.csv"
              searchPlaceholder="Search campus…"
              height="auto"
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
