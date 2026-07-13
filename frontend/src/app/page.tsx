'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch, useDebouncedValue } from '@/hooks/use-fetch';
import { useAppStore, useEffectiveFilters } from '@/store/app-store';
import { MetricStrip } from '@/components/dashboard/metric-strip';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartPanel } from '@/components/charts/chart-panel';
import { IndiaMap } from '@/components/charts/india-map';
import { DataTable, useLeadColumns } from '@/components/tables/data-table';
import { EMPTY_EXECUTIVE_CHARTS, EMPTY_KPIS } from '@/lib/empty-defaults';
import { useDatasetStats } from '@/hooks/use-dataset-stats';
import { formatNumber } from '@/lib/utils';
import { ChartData } from '@/types';

function buildBlockAmountPoints(chart: ChartData | undefined): string[] {
  if (!chart?.categories?.length) {
    return ['No partner block amount data is available for the current filters.'];
  }

  const totals = (chart.extra?.block_amount_total as number[] | undefined) ?? [];
  const blockSeries = chart.series.find((s) => s.name === 'Block Amount')?.data ?? [];
  const clashSeries = chart.series.find((s) => s.name === 'Counsellor Clashes')?.data ?? [];
  const rows = chart.categories
    .map((partner, i) => ({
      partner: String(partner),
      block: Number(
        totals[i] ??
          (Number(blockSeries[i] || 0) + Number(clashSeries[i] || 0))
      ),
    }))
    .filter((r) => r.partner)
    .sort((a, b) => b.block - a.block || a.partner.localeCompare(b.partner));

  const total = rows.reduce((sum, r) => sum + r.block, 0);
  const withBlocks = rows.filter((r) => r.block > 0);
  const withoutBlocks = rows.filter((r) => r.block === 0);

  if (total === 0) {
    return [
      `Across ${formatNumber(rows.length)} partners in view, no leads have paid block amount yet.`,
    ];
  }

  const points = [
    `Total block amount paid across partners: ${formatNumber(total)}`,
    ...withBlocks.map((r) => `${r.partner}: ${formatNumber(r.block)}`),
  ];

  if (withoutBlocks.length > 0) {
    points.push(
      `No block amount paid: ${withoutBlocks.map((r) => r.partner).join(', ')}`
    );
  }

  return points;
}

const METRIC_GROUPS = [
  {
    title: 'Pipeline',
    keys: [
      'total_leads', 'connected', 'ai_connected', 'ac_connected', 'mql', 'sql',
      'applications', 'test_registrations', 'offer_letters', 'block_amount_paid', 'admissions',
    ],
  },
  {
    title: 'Engagement',
    keys: ['contactability', 'never_dialed', 'avg_dial_count', 'ai_calls', 'dnp_pct'],
  },
];

const TREND_OPTIONS = [
  { key: 'daily_leads', label: 'Daily' },
  { key: 'weekly_leads', label: 'Weekly' },
  { key: 'monthly_leads', label: 'Monthly' },
] as const;

export default function ExecutivePage() {
  const filters = useEffectiveFilters();
  const { totalRows } = useDatasetStats();
  const setDrillDown = useAppStore((s) => s.setDrillDown);
  const [trend, setTrend] = useState<(typeof TREND_OPTIONS)[number]['key']>('monthly_leads');
  const [leadSearch, setLeadSearch] = useState('');
  const debouncedLeadSearch = useDebouncedValue(leadSearch, 300);

  const { data: kpis } = useFetch({
    fetcher: () => api.getExecutiveKpis(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: charts } = useFetch({
    fetcher: () => api.getExecutiveCharts(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: leads } = useFetch({
    fetcher: () =>
      api.search(
        { ...filters, search: debouncedLeadSearch || filters.search },
        1,
        100
      ),
    deps: [JSON.stringify(filters), debouncedLeadSearch],
  });

  const { data: stateSummary } = useFetch({
    fetcher: () => api.getGeographicStates(filters),
    deps: [JSON.stringify(filters)],
  });

  const columns = useLeadColumns();
  const displayKpis = kpis ?? EMPTY_KPIS;
  const displayCharts = { ...EMPTY_EXECUTIVE_CHARTS, ...(charts ?? {}) };
  const displayLeads = leads?.items ?? [];
  const blockAmountPoints = useMemo(
    () => buildBlockAmountPoints(displayCharts.partner_comparison),
    [displayCharts.partner_comparison]
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Overview" totalRows={totalRows} />

      {/* PERFORMANCE — charts first, tell the story at a glance */}
      <SectionHeader
        title="Performance"
        action={
          <div className="flex border border-border">
            {TREND_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTrend(opt.key)}
                className={
                  'px-3 py-1 text-xs ' +
                  (trend === opt.key
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text')
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />
      <ChartPanel chart={displayCharts[trend]} height={300} />

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-5">
          <ChartPanel chart={displayCharts.funnel} height={340} />
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartPanel chart={displayCharts.partner_comparison} height={340} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-4">
          <IndiaMap
            data={stateSummary ?? []}
            dimension="leads"
            dimensionLabel="Leads"
            title="Lead Distribution — India"
            height={280}
          />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <ChartPanel chart={displayCharts.lead_sources} height={280} />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <ChartPanel chart={displayCharts.contactability_trend} height={280} />
        </div>
      </div>

      <SectionHeader
        title="Block amount by partner"
        subtitle="Summary of block amount paid"
      />
      <div className="panel p-4">
        <ul className="space-y-2 text-sm text-text">
          {blockAmountPoints.map((point) => (
            <li key={point} className="flex gap-2 leading-relaxed">
              <span className="text-primary shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* KEY METRICS — supporting numbers, grouped for readability */}
      <SectionHeader title="Key Metrics" subtitle="vs. previous period" />
      <MetricStrip metrics={displayKpis} groups={METRIC_GROUPS} />

      {/* LEAD EXPLORER */}
      <SectionHeader title="Lead Explorer" subtitle="Click any metric box above to filter leads, or search below" />
      <DataTable
        data={displayLeads as unknown as Record<string, unknown>[]}
        columns={columns}
        onRowClick={(row) => {
          if (row.partner) setDrillDown({ partner: String(row.partner), state: String(row.state) });
        }}
        exportFilename="executive_leads.csv"
        searchPlaceholder="Search ID, name, email, phone, partner, state..."
        searchValue={leadSearch}
        onSearchChange={setLeadSearch}
        totalCount={leads?.total}
        height={360}
      />
    </div>
  );
}
