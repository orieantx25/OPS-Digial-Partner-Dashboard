'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useAppStore, useEffectiveFilters } from '@/store/app-store';
import { DataTable } from '@/components/tables/data-table';
import { InsightStrip } from '@/components/dashboard/insight-strip';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { ChartData } from '@/types';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  { ssr: false }
);

interface PartnerRoiRow {
  partner: string;
  advance?: number | null;
  incentive_per_admission?: number | null;
  advance_only?: boolean;
  block_amount_paid?: number;
  counsellor_clashes?: number;
  block_amount_roi?: number;
  incentive_total?: number | null;
  cost?: number | null;
  revenue?: number | null;
  profit?: number | null;
  roi_pct?: number | null;
  gap_to_breakeven?: number | null;
  blocks_needed?: number | null;
  status?: string;
}

interface RoiTotals {
  block_amount_paid: number;
  counsellor_clashes: number;
  block_amount_roi: number;
  incentive_total: number;
  breakeven_partners: number;
  partners_below_breakeven: number;
  has_clash_sheet?: boolean;
}

function statusClass(status?: string): string {
  if (status === 'Break even') return 'text-emerald-400';
  if (status === 'Below break even') return 'text-amber-400';
  return 'text-text-secondary';
}

export default function RoiPage() {
  const filters = useEffectiveFilters();
  const setDrillDown = useAppStore((s) => s.setDrillDown);

  const { data, loading, isFetching } = useFetch({
    fetcher: () =>
      api.getRevenue(filters) as Promise<{
        partners: PartnerRoiRow[];
        totals: RoiTotals;
      }>,
    deps: [JSON.stringify(filters)],
  });

  const { data: goals } = useFetch({
    fetcher: () => api.getGoals(filters),
    deps: [JSON.stringify(filters)],
  });

  const partners = data?.partners ?? [];
  const totals = data?.totals;

  const insightItems = useMemo(() => {
    const items: {
      text: string;
      actionLabel?: string;
      onAction?: () => void;
    }[] = [];
    const below = partners
      .filter((p) => p.status === 'Below break even')
      .sort((a, b) => Number(b.gap_to_breakeven || 0) - Number(a.gap_to_breakeven || 0));
    if (below.length) {
      const top = below[0];
      items.push({
        text: `${below.length} partner(s) below breakeven — worst gap: ${top.partner} (${formatCurrency(Number(top.gap_to_breakeven || 0))}).`,
        actionLabel: `Focus ${top.partner}`,
        onAction: () => setDrillDown({ partner: top.partner }),
      });
    }
    const clashes = Number(totals?.counsellor_clashes || 0);
    if (clashes > 0) {
      items.push({
        text: `${formatNumber(clashes)} counsellor clash(es) excluded from Block ROI.`,
      });
    }
    const behind = goals?.totals?.behind ?? 0;
    if (behind > 0) {
      items.push({
        text: `${behind} partner(s) still short of breakeven block targets.`,
      });
    }
    if (!items.length && partners.length) {
      items.push({ text: 'All tracked partners are at or above breakeven on Block ROI.' });
    }
    return items.slice(0, 3);
  }, [partners, totals, goals, setDrillDown]);

  const statusChart: ChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of partners) {
      const s = p.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    const categories = Object.keys(counts);
    return {
      chart_id: 'roi_status_mix',
      chart_type: 'donut',
      title: 'Partner status mix',
      categories,
      series: [{ name: 'Partners', data: categories.map((c) => counts[c]) }],
    };
  }, [partners]);

  const gapChart: ChartData = useMemo(() => {
    const rows = partners
      .filter((p) => Number(p.gap_to_breakeven || 0) > 0)
      .sort((a, b) => Number(b.gap_to_breakeven || 0) - Number(a.gap_to_breakeven || 0))
      .slice(0, 8);
    return {
      chart_id: 'roi_gap_bar',
      chart_type: 'bar',
      title: 'Gap to breakeven (₹)',
      categories: rows.map((r) => r.partner),
      series: [
        {
          name: 'Gap',
          data: rows.map((r) => Number(r.gap_to_breakeven || 0)),
        },
      ],
      extra: { horizontal: true },
    };
  }, [partners]);

  const columns: ColumnDef<PartnerRoiRow>[] = useMemo(
    () => [
      { accessorKey: 'partner', header: 'Partner', meta: { minWidth: 130 } },
      {
        accessorKey: 'advance',
        header: 'Advance',
        meta: { minWidth: 110 },
        cell: ({ getValue }) => {
          const v = getValue();
          return v == null ? '—' : formatCurrency(Number(v));
        },
      },
      {
        accessorKey: 'incentive_per_admission',
        header: 'Incentive per Admission',
        meta: { minWidth: 150 },
        cell: ({ row, getValue }) => {
          if (row.original.advance_only) {
            return <span className="text-text-secondary text-xs">Advance only</span>;
          }
          const v = getValue();
          return v == null ? '—' : Number(v) === 0 ? '—' : formatCurrency(Number(v));
        },
      },
      {
        accessorKey: 'block_amount_paid',
        header: 'Block Paid',
        meta: { minWidth: 100 },
        cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
      },
      {
        accessorKey: 'counsellor_clashes',
        header: 'Counsellor Clashes',
        meta: { minWidth: 130 },
        cell: ({ getValue }) => {
          const n = Number(getValue() || 0);
          return (
            <span className={cn(n > 0 && 'text-amber-300 font-medium')}>
              {formatNumber(n)}
            </span>
          );
        },
      },
      {
        accessorKey: 'block_amount_roi',
        header: 'Block (ROI) / Admissions',
        meta: { minWidth: 140 },
        cell: ({ getValue }) => (
          <span className="text-emerald-400 font-medium kpi-value">
            {formatNumber(Number(getValue() || 0))}
          </span>
        ),
      },
      {
        accessorKey: 'incentive_total',
        header: 'Incentive Total',
        meta: { minWidth: 120 },
        cell: ({ row, getValue }) => {
          if (row.original.advance_only) {
            return <span className="text-text-secondary">₹0</span>;
          }
          const v = getValue();
          return v == null ? '—' : formatCurrency(Number(v));
        },
      },
      {
        accessorKey: 'cost',
        header: 'Total Cost',
        meta: { minWidth: 120 },
        cell: ({ row, getValue }) => {
          const v = getValue();
          if (v == null) return '—';
          return (
            <span title={row.original.advance_only ? 'Advance only (no incentive)' : undefined}>
              {formatCurrency(Number(v))}
            </span>
          );
        },
      },
      {
        accessorKey: 'gap_to_breakeven',
        header: 'Gap to Break Even',
        meta: { minWidth: 130 },
        cell: ({ getValue }) => {
          const v = getValue();
          if (v == null) return '—';
          const n = Number(v);
          if (n <= 0) {
            return <span className="text-emerald-400">0</span>;
          }
          return (
            <span className="text-amber-300 font-medium">{formatCurrency(n)}</span>
          );
        },
      },
      {
        accessorKey: 'blocks_needed',
        header: 'Blocks to Break Even',
        meta: { minWidth: 140 },
        cell: ({ getValue }) => {
          const v = getValue();
          if (v == null) return '—';
          const n = Number(v);
          if (n <= 0) {
            return <span className="text-emerald-400">0</span>;
          }
          return (
            <span className="text-amber-300 font-medium">{formatNumber(n)}</span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { minWidth: 130 },
        cell: ({ getValue }) => (
          <span className={cn('text-xs font-medium', statusClass(String(getValue() || '')))}>
            {String(getValue() || '—')}
          </span>
        ),
      },
    ],
    []
  );

  const goalColumns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'block_roi', header: 'Block ROI' },
    { accessorKey: 'target_blocks', header: 'Target blocks' },
    { accessorKey: 'gap_blocks', header: 'Gap' },
    { accessorKey: 'progress_pct', header: 'Progress %' },
    { accessorKey: 'status', header: 'Status' },
  ];

  return (
    <div className={cn('space-y-4', isFetching && data && 'opacity-90')}>
      <PageHeader title="ROI" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}

      <InsightStrip title="ROI insights" items={insightItems} />

      <SectionHeader
        title="Partner ROI Overview"
        subtitle="Cost = Advance + (Incentive × Block ROI) · Revenue = ₹5.5L × Block ROI · Break even when Revenue ≥ Cost · College Wollege is advance-only"
      />

      {!totals?.has_clash_sheet && (
        <p className="text-xs text-amber-400 panel p-3">
          Upload the block amount paid sheet on Block Payment to exclude counsellor
          clashes from ROI. Until then, all block paid counts are used as the admission proxy.
        </p>
      )}

      <div className="panel grid grid-cols-2 md:grid-cols-3 gap-px bg-border">
        {[
          {
            label: 'Block (ROI)',
            value: formatNumber(Number(totals?.block_amount_roi || 0)),
            accent: true,
          },
          {
            label: 'Counsellor Clashes',
            value: formatNumber(Number(totals?.counsellor_clashes || 0)),
            warn: Number(totals?.counsellor_clashes || 0) > 0,
          },
          {
            label: 'Below Break Even',
            value: formatNumber(Number(totals?.partners_below_breakeven || 0)),
            warn: Number(totals?.partners_below_breakeven || 0) > 0,
          },
        ].map((m) => (
          <div
            key={m.label}
            className={cn(
              'bg-surface px-3 py-3',
              m.warn && 'bg-amber-500/5',
              m.accent && 'bg-emerald-500/5'
            )}
          >
            <div className="text-[10px] uppercase tracking-widest text-text-secondary">
              {m.label}
            </div>
            <div
              className={cn(
                'text-base font-semibold kpi-value mt-1',
                m.accent && 'text-emerald-400',
                m.warn && 'text-amber-300'
              )}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartPanel chart={statusChart} height={260} />
        <ChartPanel
          chart={gapChart}
          height={260}
          onCategoryClick={(partner) => setDrillDown({ partner })}
        />
      </div>

      <SectionHeader
        title="Progress to breakeven targets"
        subtitle="Target blocks = advance recovery from Block ROI economics"
      />
      <DataTable
        data={(goals?.partners ?? []) as Record<string, unknown>[]}
        columns={goalColumns}
        exportFilename="roi_goals.csv"
        height={240}
      />

      <SectionHeader title="Partner Breakeven & ROI" />
      <DataTable
        data={partners as unknown as Record<string, unknown>[]}
        columns={columns as ColumnDef<Record<string, unknown>>[]}
        exportFilename="partner_roi.csv"
        searchPlaceholder="Search partners…"
        height={420}
      />
    </div>
  );
}
