'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { DataTable } from '@/components/tables/data-table';
import { SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { CampusAdmissionRow, ChartData } from '@/types';
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

export default function CampusAdmissionsPage() {
  const filters = useMemo(() => ({}), []);
  const chartSm = useChartHeight(220, 200);

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getCampusAdmissions(filters),
    deps: [],
  });

  const campusChart = data?.campus_chart as ChartData | undefined;
  const genderChart = data?.gender_chart as ChartData | undefined;
  const campusGenderCharts = data?.campus_gender_charts ?? [];
  const feeStatus = data?.fee_status;
  const statusChart = feeStatus?.status_chart as ChartData | undefined;
  const rows = data?.rows ?? [];
  const verifiedSem1 = data?.verified_sem1 ?? feeStatus?.verified ?? 0;

  const columns: ColumnDef<CampusAdmissionRow>[] = useMemo(
    () => [
      { accessorKey: 'sheet_id', header: 'ID', meta: { width: '7%' } },
      { accessorKey: 'student_name', header: 'Name', meta: { width: '12%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '14%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '9%' } },
      { accessorKey: 'campus_code', header: 'Campus', meta: { width: '9%' } },
      {
        accessorKey: 'state',
        header: 'Region',
        meta: { width: '10%' },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'gender',
        header: 'Gender',
        meta: { width: '8%' },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      { accessorKey: 'amount_inr', header: 'Amount', meta: { width: '9%' } },
      { accessorKey: 'paid_at', header: 'Paid at', meta: { width: '10%' } },
      {
        accessorKey: 'matched_to_block',
        header: 'Block match',
        meta: { width: '8%' },
        cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
      },
      { accessorKey: 'status', header: 'Status', meta: { width: '8%' } },
    ],
    []
  );

  return (
    <div className={cn('space-y-5 sm:space-y-6', isFetching && data && 'opacity-90')}>
      {!isStaticDataMode() && (
        <p className="text-[10px] text-text-secondary/80 border border-border/60 bg-surface/50 px-3 py-2 rounded-sm">
          Student list from All Payments sheet · fee status from LMS (Verified = Sem1 paid) ·
          gender/region from block payment email/phone match. Syncs on Sync LSQ when Google is
          configured.
        </p>
      )}

      {loading && !data ? <PageSkeleton /> : <FetchingHint active={isFetching} />}

      {!loading && !data?.has_sheet ? (
        <div className="panel p-6 sm:p-8 border border-border text-center max-w-lg mx-auto">
          <p className="text-sm text-text-secondary leading-relaxed">
            Admissions will appear after Sync LSQ pulls the Fee Verification Google sheets, or after
            a manual All Payments upload in DP Dashboard.
          </p>
        </div>
      ) : data?.has_sheet ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Sem1 verified (LMS)
              </div>
              <div className="text-2xl font-semibold mt-1 text-green-500">
                {formatNumber(verifiedSem1)}
              </div>
            </div>
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Partly paid
              </div>
              <div className="text-2xl font-semibold mt-1">
                {formatNumber(feeStatus?.partly_paid ?? 0)}
              </div>
            </div>
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Under review
              </div>
              <div className="text-2xl font-semibold mt-1 text-yellow-400">
                {formatNumber(feeStatus?.under_review ?? 0)}
              </div>
            </div>
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Rejected
              </div>
              <div className="text-2xl font-semibold mt-1 text-red-500">
                {formatNumber(feeStatus?.rejected ?? 0)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Payments list rows
              </div>
              <div className="text-2xl font-semibold mt-1">
                {formatNumber(data.total_paid)}
              </div>
            </div>
            <div className="panel p-4 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Matched to block
              </div>
              <div className="text-2xl font-semibold mt-1">
                {formatNumber(data.matched_to_block)}
              </div>
            </div>
            <div className="panel p-4 border border-border col-span-2 lg:col-span-1">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Unmatched to block
              </div>
              <div className="text-2xl font-semibold mt-1">
                {formatNumber(data.unmatched_to_block)}
              </div>
            </div>
          </div>

          {(statusChart || campusChart || genderChart) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              {statusChart && (statusChart.categories?.length ?? 0) > 0 && (
                <div className="lg:col-span-4 min-w-0">
                  <ChartPanel chart={statusChart} height={chartSm} />
                </div>
              )}
              <div className="lg:col-span-4 min-w-0">
                {campusChart && (campusChart.categories?.length ?? 0) > 0 ? (
                  <ChartPanel chart={campusChart} height={chartSm} />
                ) : (
                  <div className="panel border border-border h-[200px] flex items-center justify-center text-sm text-text-secondary">
                    No campus chart
                  </div>
                )}
              </div>
              <div className="lg:col-span-4 min-w-0">
                {genderChart && (genderChart.categories?.length ?? 0) > 0 ? (
                  <ChartPanel chart={genderChart} height={chartSm} />
                ) : (
                  <div className="panel border border-border h-[200px] flex items-center justify-center text-sm text-text-secondary">
                    No gender chart (needs block match)
                  </div>
                )}
              </div>
            </div>
          )}

          {campusGenderCharts.length > 0 && (
            <section className="space-y-3 panel p-4 sm:p-5 border border-border">
              <SectionHeader
                title="Gender by campus"
                subtitle="Paid admissions · gender from block payment match"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {campusGenderCharts.map((item) => (
                  <ChartPanel
                    key={item.campus_code}
                    chart={item.gender_chart}
                    height={chartSm - 16}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3 panel p-4 sm:p-5 border border-border">
            <SectionHeader
              title="Admission payments"
              subtitle={`${formatNumber(
                isStaticDataMode() ? data?.total_paid ?? 0 : rows.length
              )} ${isStaticDataMode() ? 'paid' : 'rows'}`}
            />
            {isStaticDataMode() ? null : (
              <DataTable
                data={rows}
                columns={columns}
                exportFilename="campus_admissions.csv"
                searchPlaceholder="Search email, campus, state…"
                height="auto"
              />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
