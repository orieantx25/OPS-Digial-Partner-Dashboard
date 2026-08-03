'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { DataTable } from '@/components/tables/data-table';
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

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getCampusBifurcation(filters),
    deps: [JSON.stringify(filters)],
  });

  const sheetByCampus = data?.sheet_by_campus ?? [];
  const byCampus = data?.by_campus ?? [];
  const topCampusDigital = byCampus[0];
  const topCampusOverall = sheetByCampus[0];

  const tableRows = useMemo(
    () =>
      sheetByCampus.map((row) => {
        const male = row.by_gender.find((g) => g.gender.toLowerCase() === 'male')?.count ?? 0;
        const female = row.by_gender.find((g) => g.gender.toLowerCase() === 'female')?.count ?? 0;
        const other = row.block_paid - male - female;
        return {
          campus_code: row.campus_code,
          campus_name: row.campus_name,
          block_paid: row.block_paid,
          male,
          female,
          other: other > 0 ? other : 0,
        };
      }),
    [sheetByCampus]
  );

  const columns: ColumnDef<(typeof tableRows)[number]>[] = [
    { accessorKey: 'campus_code', header: 'Campus Code', meta: { width: '12%' } },
    { accessorKey: 'campus_name', header: 'Campus', meta: { width: '22%' } },
    { accessorKey: 'block_paid', header: 'Block Paid', meta: { width: '12%' } },
    { accessorKey: 'male', header: 'Male', meta: { width: '10%' } },
    { accessorKey: 'female', header: 'Female', meta: { width: '10%' } },
    { accessorKey: 'other', header: 'Other', meta: { width: '10%' } },
  ];

  const sheetCampusChart = data?.sheet_campus_chart as ChartData | undefined;
  const sheetGenderChart = data?.sheet_gender_chart as ChartData | undefined;
  const sheetCampusGenderCharts = data?.sheet_campus_gender_charts ?? [];
  const campusChart = data?.campus_chart as ChartData | undefined;
  const genderChart = data?.gender_chart as ChartData | undefined;
  const campusGenderCharts = data?.campus_gender_charts ?? [];
  const partnerGenderChart = data?.partner_gender_chart as ChartData | undefined;
  const partnerCampusChart = data?.partner_campus_chart as ChartData | undefined;
  const digitalPartnerShareChart = data?.digital_partner_share_chart as ChartData | undefined;

  return (
    <div className={cn('space-y-4', isFetching && data && 'opacity-90')}>
      <PageHeader title="Campus Bifurcation" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}

      {!data?.has_sheet ? (
        <p className="text-text-secondary text-sm panel p-4">
          Upload a block amount paid sheet on Block Payment to see campus and gender breakdown
          for matched block-paid leads.
        </p>
      ) : (
        <>
          <div className="panel grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border max-w-5xl">
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Block Paid (Digital Partners)
              </div>
              <div className="text-lg font-semibold text-text kpi-value mt-1">
                {formatNumber(data.total_block_paid)}
              </div>
            </div>
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Sheet total
              </div>
              <div className="text-lg font-semibold text-text kpi-value mt-1">
                {formatNumber(data.sheet_total ?? 0)}
              </div>
            </div>
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Digital partner share
              </div>
              <div className="text-lg font-semibold text-primary kpi-value mt-1">
                {formatNumber(data.digital_partner_count ?? data.matched_count)}
              </div>
              <div className="text-[10px] text-text-secondary mt-0.5">
                {formatNumber(data.digital_partner_share_pct ?? 0)}% of sheet
              </div>
            </div>
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Top Campus
              </div>
              <div className="text-sm font-semibold text-text mt-1 truncate">
                {topCampusOverall?.campus_name ?? '—'}
              </div>
              <div className="text-[10px] text-text-secondary mt-0.5">
                {topCampusOverall ? formatNumber(topCampusOverall.block_paid) : '—'}
              </div>
            </div>
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Top Campus (Digital Partners)
              </div>
              <div className="text-sm font-semibold text-text mt-1 truncate">
                {topCampusDigital?.campus_name ?? '—'}
              </div>
              <div className="text-[10px] text-text-secondary mt-0.5">
                {topCampusDigital ? formatNumber(topCampusDigital.block_paid) : '—'}
              </div>
            </div>
          </div>

          <SectionHeader
            title="Block amount received"
            subtitle="All payment-sheet block amounts — full sheet, not limited to digital partners"
          />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-4 max-w-md lg:max-w-none">
              {digitalPartnerShareChart && (
                <ChartPanel chart={digitalPartnerShareChart} height={240} />
              )}
            </div>
            <div className="lg:col-span-5">
              {sheetCampusChart && <ChartPanel chart={sheetCampusChart} height={240} />}
            </div>
            <div className="lg:col-span-3">
              {sheetGenderChart && <ChartPanel chart={sheetGenderChart} height={240} />}
            </div>
          </div>

          <SectionHeader title="All block received — campus × gender" />
          {sheetCampusGenderCharts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sheetCampusGenderCharts.map((item) => (
                <ChartPanel
                  key={`sheet-${item.campus_code}`}
                  chart={item.gender_chart}
                  height={220}
                />
              ))}
            </div>
          )}
          <DataTable
            data={tableRows}
            columns={columns}
            exportFilename="sheet_campus_bifurcation.csv"
            searchPlaceholder="Search campus…"
            height="auto"
          />

          <SectionHeader
            title="Digital partner block paid by campus & gender"
            subtitle="Matched digital-partner leads only — campus from SeatBlocking: CollegeCode"
          />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-7">
              {campusChart && <ChartPanel chart={campusChart} height={240} />}
            </div>
            <div className="lg:col-span-5">
              {genderChart && <ChartPanel chart={genderChart} height={240} />}
            </div>
          </div>

          <SectionHeader title="Digital partner — campus × gender" />
          {campusGenderCharts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {campusGenderCharts.map((item) => (
                <ChartPanel
                  key={item.campus_code}
                  chart={item.gender_chart}
                  height={220}
                />
              ))}
            </div>
          )}

          <SectionHeader
            title="Share of digital partner"
            subtitle="Partner attribution from master — by gender and campus"
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {partnerGenderChart && (
              <ChartPanel chart={partnerGenderChart} height={280} />
            )}
            {partnerCampusChart && (
              <ChartPanel chart={partnerCampusChart} height={280} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
