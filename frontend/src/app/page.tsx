'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useFetch, useDebouncedValue } from '@/hooks/use-fetch';
import { useAppStore, useEffectiveFilters } from '@/store/app-store';
import { MetricStrip } from '@/components/dashboard/metric-strip';
import { AlertsPanel } from '@/components/dashboard/alerts-panel';
import { InsightStrip } from '@/components/dashboard/insight-strip';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { DataTable, useLeadColumns } from '@/components/tables/data-table';
import { EMPTY_EXECUTIVE_CHARTS, EMPTY_KPIS } from '@/lib/empty-defaults';
import { FUNNEL_STAGE_LEAD_FILTERS } from '@/lib/funnel-filters';
import { useDatasetStats } from '@/hooks/use-dataset-stats';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { isLeadershipMode } from '@/lib/static-mode';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { ChartData, KpiMetric } from '@/types';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  {
    ssr: false,
    loading: () => (
      <div className="panel h-[280px] flex items-center justify-center text-text-secondary text-sm">
        Loading chart…
      </div>
    ),
  }
);

const IndiaMap = dynamic(
  () => import('@/components/charts/india-map').then((m) => m.IndiaMap),
  {
    ssr: false,
    loading: () => (
      <div className="panel h-[280px] flex items-center justify-center text-text-secondary text-sm">
        Loading map…
      </div>
    ),
  }
);

const BLOCK_BULLET_TOP_N = 5;

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

  const top = withBlocks.slice(0, BLOCK_BULLET_TOP_N);
  const points = [
    `Total block amount paid across partners: ${formatNumber(total)}`,
    ...top.map((r) => `${r.partner}: ${formatNumber(r.block)}`),
  ];

  if (withBlocks.length > BLOCK_BULLET_TOP_N) {
    points.push(
      `+${withBlocks.length - BLOCK_BULLET_TOP_N} more partner(s) with block payments`
    );
  }

  if (withoutBlocks.length > 0) {
    points.push(
      `${withoutBlocks.length} partner(s) with zero block amount paid`
    );
  }

  return points;
}

function overviewInsights(
  kpis: KpiMetric[],
  funnel: ChartData | undefined,
  partners: ChartData | undefined
): { text: string }[] {
  const items: { text: string }[] = [];
  const byKey = new Map(kpis.map((k) => [k.key, k]));

  const drops = (funnel?.extra?.drops as number[] | undefined) ?? [];
  if (funnel?.categories?.length && drops.length) {
    let maxIdx = 1;
    for (let i = 1; i < drops.length; i++) {
      if ((drops[i] ?? 0) > (drops[maxIdx] ?? 0)) maxIdx = i;
    }
    if ((drops[maxIdx] ?? 0) > 0) {
      const from = funnel.categories[maxIdx - 1] ?? 'prior';
      const to = funnel.categories[maxIdx] ?? 'next';
      items.push({
        text: `Largest drop-off: ${from} → ${to} (${formatPct(drops[maxIdx])} lost).`,
      });
    }
  }

  const block = byKey.get('block_amount_paid');
  const offerLetters = byKey.get('offer_letters');
  if (block && offerLetters && offerLetters.current > 0) {
    items.push({
      text: `Offer Letter → Block conversion: ${formatPct((block.current / offerLetters.current) * 100)} (${formatNumber(block.current)} of ${formatNumber(offerLetters.current)} offer letters).`,
    });
  } else if (block && offerLetters && offerLetters.current === 0 && block.current > 0) {
    items.push({
      text: `Block amount paid: ${formatNumber(block.current)} (no offer letters in scope to convert from).`,
    });
  }

  if (partners?.categories?.length && partners.series[0]?.data?.length) {
    const leadData = partners.series[0].data.map((v) => Number(v) || 0);
    const maxI = leadData.indexOf(Math.max(...leadData));
    const minI = leadData.indexOf(Math.min(...leadData));
    if (maxI >= 0 && minI >= 0 && maxI !== minI) {
      items.push({
        text: `Partner spread: ${partners.categories[maxI]} leads (${formatNumber(leadData[maxI])}) vs ${partners.categories[minI]} (${formatNumber(leadData[minI])}).`,
      });
    }
  }

  return items.slice(0, 5);
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

const METRIC_TREND_OPTIONS = [
  { key: 'leads_trend', label: 'Leads trend' },
  { key: 'test_taker_trend', label: 'Test taker trend' },
  { key: 'persona_know_more_trend', label: 'Persona (know more about btech) trend' },
  { key: 'block_amount_trend', label: 'Block amount trend' },
] as const;

export default function ExecutivePage() {
  const router = useRouter();
  const filters = useEffectiveFilters();
  const { totalRows } = useDatasetStats();
  const setDrillDown = useAppStore((s) => s.setDrillDown);
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);
  const leadership = isLeadershipMode();
  const [trend, setTrend] = useState<(typeof TREND_OPTIONS)[number]['key']>('monthly_leads');
  const [metricTrend, setMetricTrend] =
    useState<(typeof METRIC_TREND_OPTIONS)[number]['key']>('leads_trend');
  const [compareGrain, setCompareGrain] = useState<'week' | 'month'>('week');
  const [leadSearch, setLeadSearch] = useState('');
  const debouncedLeadSearch = useDebouncedValue(leadSearch, 300);
  const hasDateRange = Boolean(filters.date_from && filters.date_to);

  const { data: kpis, isFetching: kpisFetching } = useFetch({
    fetcher: () => api.getExecutiveKpis(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: charts, isFetching: chartsFetching } = useFetch({
    fetcher: () => api.getExecutiveCharts(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: alerts } = useFetch({
    fetcher: () => api.getAlerts(filters),
    deps: [JSON.stringify(filters)],
  });

  const { data: compare, loading: compareLoading, error: compareError } = useFetch({
    fetcher: () => api.getCompare(filters, compareGrain),
    deps: [JSON.stringify(filters), compareGrain],
  });

  const chartsReady = charts != null;

  const { data: leads } = useFetch({
    fetcher: () =>
      api.search(
        { ...filters, search: debouncedLeadSearch || filters.search },
        1,
        25
      ),
    deps: [JSON.stringify(filters), debouncedLeadSearch],
    enabled: chartsReady && !leadership,
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
  const insightItems = useMemo(
    () =>
      overviewInsights(
        displayKpis,
        displayCharts.funnel,
        displayCharts.partner_comparison
      ),
    [displayKpis, displayCharts.funnel, displayCharts.partner_comparison]
  );
  const isRefreshing = (kpisFetching || chartsFetching) && Boolean(kpis || charts);

  return (
    <div className={cn('space-y-5', isRefreshing && 'opacity-90')}>
      <PageHeader title="Overview" totalRows={totalRows} />
      <FetchingHint active={isRefreshing} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        <div className="lg:col-span-7 min-h-[200px]">
          <InsightStrip title="What stands out" items={insightItems} />
        </div>
        <div className="lg:col-span-5 min-h-[200px]">
          <AlertsPanel alerts={alerts ?? []} maxHeightClass="max-h-[280px]" />
        </div>
      </div>

      <SectionHeader
        title="Period compare"
        action={
          <div className="flex border border-border">
            {(['week', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setCompareGrain(g)}
                className={
                  'px-3 py-1 text-xs uppercase ' +
                  (compareGrain === g
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text')
                }
              >
                {g === 'week' ? 'WoW' : 'MoM'}
              </button>
            ))}
          </div>
        }
      />
      <div className="panel grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        {(compare?.kpis ?? []).slice(0, 4).map((k) => (
          <div key={k.key} className="bg-surface px-3 py-3">
            <div className="text-[10px] uppercase tracking-widest text-text-secondary">
              {k.label}
            </div>
            <div className="text-base font-semibold kpi-value mt-1">
              {formatNumber(k.current)}
            </div>
            <div
              className={cn(
                'text-[11px] font-mono mt-0.5',
                k.change_pct > 0 && 'text-success',
                k.change_pct < 0 && 'text-danger',
                k.change_pct === 0 && 'text-text-secondary'
              )}
            >
              {k.change_pct === 0
                ? '—'
                : `${k.change_pct > 0 ? '▲' : '▼'} ${Math.abs(k.change_pct).toFixed(1)}% vs prior ${compareGrain}`}
            </div>
            {compare?.current_from && (
              <div className="text-[10px] text-text-secondary mt-1">
                {compare.current_from} → {compare.current_to}
              </div>
            )}
          </div>
        ))}
        {compareLoading && !compare?.kpis?.length && (
          <div className="bg-surface px-3 py-3 col-span-full text-xs text-text-secondary">
            Loading compare metrics…
          </div>
        )}
        {!compareLoading && compareError && (
          <div className="bg-surface px-3 py-3 col-span-full text-xs text-danger">
            Could not load period compare: {compareError}
          </div>
        )}
        {!compareLoading && !compareError && compare && !compare.kpis?.length && (
          <div className="bg-surface px-3 py-3 col-span-full text-xs text-text-secondary">
            No compare metrics for this scope.
          </div>
        )}
      </div>

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
          <ChartPanel
            chart={displayCharts.funnel}
            height={340}
            onCategoryClick={(stage) => {
              openExplorer(stage, FUNNEL_STAGE_LEAD_FILTERS[stage]);
            }}
          />
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartPanel
            chart={displayCharts.partner_comparison}
            height={340}
            onCategoryClick={(partner) => {
              if (leadership) {
                router.push(`/partner?partner=${encodeURIComponent(partner)}`);
                return;
              }
              setDrillDown({ partner });
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-4 min-w-0 h-[320px] [&>.panel]:h-full [&>.panel]:box-border">
          <IndiaMap
            data={stateSummary ?? []}
            dimension="leads"
            dimensionLabel="Leads"
            title="Lead Distribution — India"
            height={268}
          />
        </div>
        <div className="col-span-12 lg:col-span-4 min-w-0 h-[320px] [&>.panel]:h-full [&>.panel]:box-border">
          <ChartPanel chart={displayCharts.lead_sources} height={268} />
        </div>
        <div className="col-span-12 lg:col-span-4 min-w-0 h-[320px]">
          <div className="panel p-3 h-full box-border flex flex-col overflow-hidden">
            <div className="mb-2 shrink-0 min-w-0 space-y-1.5">
              <div className="text-sm font-semibold text-text">Trend</div>
              <select
                className="w-full min-w-0 appearance-none bg-surface border border-border text-text text-xs py-1.5 px-3 rounded-none text-center [text-align-last:center] focus:outline-none focus:border-border hover:border-border"
                value={metricTrend}
                onChange={(e) =>
                  setMetricTrend(e.target.value as (typeof METRIC_TREND_OPTIONS)[number]['key'])
                }
                aria-label="Select trend metric"
              >
                {METRIC_TREND_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key} className="text-left">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChartPanel
                chart={{
                  ...(displayCharts[metricTrend] ?? EMPTY_EXECUTIVE_CHARTS.leads_trend),
                  title: '',
                  extra: {
                    ...(displayCharts[metricTrend]?.extra ?? {}),
                    compact_grid: true,
                  },
                }}
                height={228}
                className="!border-0 !bg-transparent !p-0"
              />
            </div>
          </div>
        </div>
      </div>

      <SectionHeader
        title="Block amount by partner"
        subtitle="Top partners by block amount paid"
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

      <SectionHeader
        title="Key Metrics"
        subtitle={
          hasDateRange
            ? 'vs prior equal period'
            : 'Set a date range (or preset) to see period-over-period deltas'
        }
      />
      <MetricStrip metrics={displayKpis} groups={METRIC_GROUPS} />

      {!leadership && (
        <>
          <SectionHeader
            title="Lead Explorer"
            subtitle="Click any metric box above to filter leads, or search below"
          />
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
        </>
      )}
    </div>
  );
}
