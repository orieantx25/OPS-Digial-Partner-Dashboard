'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { DataTable } from '@/components/tables/data-table';
import { RefundCasesKpiDashboard } from '@/components/dashboard/refund-cases-kpi-dashboard';
import { SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { ChartData, RefundCaseRow } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { isLeadershipMode, isStaticDataMode } from '@/lib/static-mode';

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

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        active ? 'bg-primary/15 text-primary' : 'bg-border text-text-secondary'
      )}
    >
      {label}
    </span>
  );
}

/** Standalone refund dashboard — own shell, KPIs, charts, and case table. */
export default function RefundCasesPage() {
  const leadership = isLeadershipMode();
  const filters = useMemo(() => ({}), []);
  const chartSm = useChartHeight(220, 200);

  const { data: campus, loading, isFetching } = useFetch({
    fetcher: () => api.getCampusBifurcation(filters),
    deps: [],
  });

  const { data: sheetStatus } = useFetch({
    fetcher: () => api.getRefundStatus(),
    deps: [],
  });

  const { data: cases, loading: casesLoading } = useFetch({
    fetcher: () => api.getRefundCases(filters, 1, 500),
    deps: [],
    enabled: !leadership,
  });

  const overallRefundChart = campus?.overall_refund_by_campus_chart as
    | ChartData
    | undefined;

  const statusChart = useMemo((): ChartData | null => {
    const refund = campus?.refund_summary;
    if (!refund) return null;
    const retained = refund.retained_cases ?? 0;
    const processed = refund.refund_processed ?? 0;
    const refunded = refund.refunded_cases ?? refund.refund_cases ?? 0;
    const pending = Math.max(
      0,
      (refund.total_cases ?? 0) - retained - processed - refunded
    );
    const categories: string[] = [];
    const values: number[] = [];
    const push = (label: string, value: number) => {
      if (value > 0) {
        categories.push(label);
        values.push(value);
      }
    };
    push('Retained', retained);
    push('Refund request sent to university', processed);
    push('Refunded', refunded);
    push('Pending', pending);
    if (!categories.length) return null;
    return {
      chart_id: 'refund_status_mix',
      chart_type: 'donut',
      title: 'Final status mix',
      categories,
      series: [{ name: 'Cases', data: values }],
      extra: {
        center_total: refund.total_cases ?? 0,
        center_label: 'Total applied',
        compact_donut: true,
        show_slice_labels: true,
        slice_colors: {
          Retained: '#22C55E',
          'Refund request sent to university': '#EAB308',
          Refunded: '#E31E24',
          Pending: '#3B82F6',
        },
      },
    };
  }, [campus?.refund_summary]);

  const rows = cases?.items ?? [];
  const hasRefundData =
    (sheetStatus?.has_data ?? false) ||
    (campus?.refund_summary?.total_cases ?? 0) > 0 ||
    rows.length > 0;

  const columns: ColumnDef<RefundCaseRow>[] = useMemo(
    () => [
      { accessorKey: 'serial_no', header: 'S No.', meta: { width: '6%' } },
      { accessorKey: 'student_name', header: 'Student', meta: { width: '12%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '12%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '9%' } },
      { accessorKey: 'campus', header: 'Campus', meta: { width: '10%' } },
      {
        accessorKey: 'status_finance',
        header: 'Finance Status',
        meta: { width: '10%' },
      },
      {
        accessorKey: 'final_status',
        header: 'Final Status',
        meta: { width: '10%' },
        cell: ({ row }) => (
          <StatusBadge
            active={row.original.is_refund}
            label={String(row.original.final_status || '—')}
          />
        ),
      },
      {
        id: 'flags',
        header: 'Flags',
        meta: { width: '14%' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.matched_to_block_payment && (
              <StatusBadge active label="Block sheet" />
            )}
            {row.original.is_digital_partner_block_paid && (
              <StatusBadge active label="DP block paid" />
            )}
          </div>
        ),
      },
      {
        accessorKey: 'matched_campus_code',
        header: 'Matched campus',
        meta: { width: '8%' },
      },
      { accessorKey: 'utr', header: 'UTR', meta: { width: '9%' } },
    ],
    []
  );

  return (
    <div className={cn('space-y-5 sm:space-y-6', isFetching && campus && 'opacity-90')}>
      {!isStaticDataMode() && (
        <p className="text-[10px] text-text-secondary/80 border border-border/60 bg-surface/50 px-3 py-2 rounded-sm">
          Local mode loads live analytics from the backend (~2–4s). Production uses pre-published
          snapshots and is typically much faster.
        </p>
      )}

      {loading && !campus ? (
        <PageSkeleton />
      ) : (
        <FetchingHint active={isFetching} />
      )}

      {!loading && !hasRefundData ? (
        <div className="panel p-6 sm:p-8 border border-border text-center max-w-lg mx-auto">
          <p className="text-sm text-text-secondary leading-relaxed">
            Refund case data will appear after the ops team syncs or uploads the refund tracking
            sheet and publishes snapshots.
          </p>
        </div>
      ) : hasRefundData && campus ? (
        <>
          <RefundCasesKpiDashboard data={campus} />

          <section className="space-y-4 panel p-4 sm:p-5 border border-border">
            <SectionHeader
              title="Refund distribution"
              subtitle="Overall status mix and campus split from the refund tracking sheet"
            />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-5 min-w-0">
                {statusChart && <ChartPanel chart={statusChart} height={chartSm} />}
              </div>
              <div className="lg:col-span-7 min-w-0">
                {overallRefundChart && (
                  <ChartPanel chart={overallRefundChart} height={chartSm} />
                )}
              </div>
            </div>
          </section>

          {!leadership &&
            (casesLoading && !cases ? (
              <p className="text-text-secondary text-sm">Loading cases…</p>
            ) : (
              <section className="space-y-3 panel p-4 sm:p-5 border border-border">
                <SectionHeader
                  title="Refund cases"
                  subtitle={`${formatNumber(sheetStatus?.row_count ?? cases?.total ?? rows.length)} total cases in sheet`}
                />
                <DataTable
                  data={rows}
                  columns={columns}
                  exportFilename="refund_cases.csv"
                  searchPlaceholder="Search student, email, UTR, status…"
                  height="auto"
                />
              </section>
            ))}
        </>
      ) : null}
    </div>
  );
}
