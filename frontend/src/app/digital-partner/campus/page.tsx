'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { useEffectiveFilters } from '@/store/app-store';
import { DataTable } from '@/components/tables/data-table';
import { CampusKpiDashboard } from '@/components/dashboard/campus-kpi-dashboard';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { ChartData } from '@/types';
import { cn, formatNumber } from '@/lib/utils';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  { ssr: false }
);

export default function CampusPage() {
  const filters = useEffectiveFilters();
  const chartSm = useChartHeight(220, 200);
  const chartMd = useChartHeight(240, 210);
  const chartLg = useChartHeight(260, 220);

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getCampusBifurcation(filters),
    deps: [JSON.stringify(filters)],
  });

  const adjustedCampusChart = data?.adjusted_sheet_campus_chart as ChartData | undefined;
  const adjustedGenderChart = data?.adjusted_sheet_gender_chart as ChartData | undefined;
  const adjustedCampusGenderCharts = data?.adjusted_sheet_campus_gender_charts ?? [];
  const dpRefundChart = data?.dp_refund_by_campus_chart as ChartData | undefined;
  const genderChart = data?.gender_chart as ChartData | undefined;
  const campusGenderCharts = data?.campus_gender_charts ?? [];
  const partnerGenderChart = data?.partner_gender_chart as ChartData | undefined;
  const partnerCampusChart = data?.partner_campus_chart as ChartData | undefined;
  const digitalPartnerShareChart = data?.digital_partner_share_chart as ChartData | undefined;

  const refundSummary = data?.refund_summary;
  const grossTotal = data?.sheet_total ?? 0;
  const activeTotal = data?.adjusted_sheet_total ?? grossTotal;
  const refundCases = refundSummary?.refund_cases ?? 0;

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
    <div className={cn('space-y-6', isFetching && data && 'opacity-90')}>
      <PageHeader title="Campus Bifurcation" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}

      {!data?.has_sheet ? (
        <p className="text-text-secondary text-sm panel p-4">
          Upload a block amount paid sheet on Block Payment to see campus and gender breakdown.
        </p>
      ) : (
        <>
          <CampusKpiDashboard data={data} />

          {/* Section A — Overall */}
          <section className="space-y-3 panel p-3 sm:p-4">
            <SectionHeader
              title="Overall — all block received"
              subtitle="Active counts after excluding matched refund cases"
            />
            <p className="text-xs text-text-secondary">
              Total payment {formatNumber(grossTotal)} · Refunds {formatNumber(refundCases)} ·
              Active {formatNumber(activeTotal)}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4 max-w-md lg:max-w-none">
                {digitalPartnerShareChart && (
                  <ChartPanel chart={digitalPartnerShareChart} height={chartSm} />
                )}
              </div>
              <div className="lg:col-span-5">
                {adjustedCampusChart && (
                  <ChartPanel chart={adjustedCampusChart} height={chartSm} />
                )}
              </div>
              <div className="lg:col-span-3">
                {adjustedGenderChart && (
                  <ChartPanel chart={adjustedGenderChart} height={chartSm} />
                )}
              </div>
            </div>
            {adjustedCampusGenderCharts.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {adjustedCampusGenderCharts.map((item) => (
                  <ChartPanel
                    key={`adj-${item.campus_code}`}
                    chart={item.gender_chart}
                    height={chartSm - 20}
                  />
                ))}
              </div>
            )}
            {dpRefundChart && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2 border-t border-border">
                <ChartPanel chart={dpRefundChart} height={chartSm} />
              </div>
            )}
          </section>

          {/* Section B — Digital partners (detail) */}
          <section className="space-y-3 panel p-3 sm:p-4">
            <SectionHeader
              title="Digital partners — detail"
              subtitle="Matched block-paid leads by gender and partner (not refund-adjusted)"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {genderChart && <ChartPanel chart={genderChart} height={chartMd} />}
              {campusGenderCharts.map((item) => (
                <ChartPanel
                  key={item.campus_code}
                  chart={item.gender_chart}
                  height={chartMd}
                />
              ))}
            </div>
            {(partnerGenderChart || partnerCampusChart) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2 border-t border-border">
                {partnerGenderChart && (
                  <ChartPanel chart={partnerGenderChart} height={chartLg} />
                )}
                {partnerCampusChart && (
                  <ChartPanel chart={partnerCampusChart} height={chartLg} />
                )}
              </div>
            )}
          </section>

          {/* Section C — By campus */}
          <section className="space-y-3 panel p-3 sm:p-4">
            <SectionHeader
              title="By campus"
              subtitle="Active vs gross block on each campus (payment sheet)"
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
      )}
    </div>
  );
}
