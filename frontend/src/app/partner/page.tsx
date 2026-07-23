'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useAppStore, useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { ChartData, PartnerCounsellorClash, PartnerCounsellorClashes } from '@/types';
import { DataTable, useLeadColumns } from '@/components/tables/data-table';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ClickableMetricBox } from '@/components/dashboard/clickable-metric-box';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { KPI_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { isLeadershipMode } from '@/lib/static-mode';

interface PartnerDetail {
  partner?: string;
  overview?: Record<string, number | string>;
  block_amount_leads?: Record<string, unknown>[];
  contact_stage_summary?: {
    contact_stage: string;
    leads: number;
    pct: number;
  }[];
  block_counsellor_clashes?: PartnerCounsellorClashes;
  performance_score?: number;
  trend?: { month?: string; leads?: number }[];
  daily_leads?: ChartData;
  weekly_leads?: ChartData;
  monthly_leads?: ChartData;
}

const PARTNER_TREND_OPTIONS = [
  { key: 'daily_leads', label: 'Daily' },
  { key: 'weekly_leads', label: 'Weekly' },
  { key: 'monthly_leads', label: 'Monthly' },
] as const;

function emptyPartnerTrendChart(id: string, title: string): ChartData {
  return {
    chart_id: id,
    chart_type: 'line',
    title,
    categories: [],
    series: [{ name: 'Leads', data: [] }],
  };
}

/** Prefer API time-series charts; fall back to legacy monthly `trend` rows. */
function resolvePartnerTrendChart(
  detail: PartnerDetail | null | undefined,
  key: (typeof PARTNER_TREND_OPTIONS)[number]['key'],
  partnerName: string
): ChartData {
  const label = PARTNER_TREND_OPTIONS.find((o) => o.key === key)?.label ?? 'Leads';
  const title = `${partnerName} — ${label} Leads`;
  const fromApi = detail?.[key];
  if (fromApi?.categories?.length && fromApi.series?.some((s) => s.data.length > 0)) {
    return { ...fromApi, title };
  }

  if (key === 'monthly_leads' && detail?.trend?.length) {
    const rows = detail.trend.filter((r) => r.month);
    return {
      chart_id: 'partner_monthly_from_trend',
      chart_type: 'line',
      title,
      categories: rows.map((r) => String(r.month)),
      series: [{ name: 'Leads', data: rows.map((r) => Number(r.leads || 0)) }],
    };
  }

  return emptyPartnerTrendChart(key, title);
}

const PARTNER_METRICS: {
  key: string;
  label: string;
  format?: 'number' | 'percent';
  leadFilter?: string;
}[] = [
  { key: 'total_leads', label: 'Total Leads' },
  { key: 'connected', label: 'Connected', leadFilter: 'connected' },
  { key: 'admissions', label: 'Admissions', leadFilter: 'admissions' },
  { key: 'offer_letters', label: 'Offer Letters', leadFilter: 'offer_letters' },
  { key: 'applications', label: 'Applications', leadFilter: 'applications' },
  { key: 'block_amount_paid', label: 'Block Amount Paid', leadFilter: 'block_amount_paid' },
  { key: 'avg_conversion', label: 'Avg Conversion', format: 'percent' },
];

function formatPartnerMetricValue(
  value: number | string | undefined,
  format: 'number' | 'percent' = 'number'
): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (format === 'percent') return formatPct(n);
  return formatNumber(n);
}

function useClashColumns(): ColumnDef<PartnerCounsellorClash>[] {
  return useMemo(
    () => [
      { accessorKey: 'prospect_id', header: 'ID', meta: { width: '9%' } },
      { accessorKey: 'partner', header: 'Partner', meta: { width: '11%' } },
      { accessorKey: 'name', header: 'Name', meta: { width: '12%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '14%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '10%' } },
      { accessorKey: 'contact_source', header: 'DP Source', meta: { width: '10%' } },
      {
        accessorKey: 'source_at_payment',
        header: 'Payment Source',
        meta: { width: '11%' },
        cell: ({ getValue }) => {
          const value = String(getValue() || '—');
          return (
            <span className="inline-block px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-300 font-medium">
              {value}
            </span>
          );
        },
      },
      { accessorKey: 'campaign_at_payment', header: 'Payment Campaign', meta: { width: '11%' } },
      { accessorKey: 'campus', header: 'Campus', meta: { width: '8%' } },
    ],
    []
  );
}

export default function PartnerPage() {
  return (
    <Suspense
      fallback={
        <div className="text-text-secondary text-sm panel p-4">Loading partner analytics…</div>
      }
    >
      <PartnerPageInner />
    </Suspense>
  );
}

function PartnerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useEffectiveFilters();
  const partnerFromUrl = searchParams.get('partner');
  const [selectedPartner, setSelectedPartner] = useState<string | null>(partnerFromUrl);
  const [partnerTrend, setPartnerTrend] =
    useState<(typeof PARTNER_TREND_OPTIONS)[number]['key']>('monthly_leads');
  const setDrillDown = useAppStore((s) => s.setDrillDown);
  const clearDrillDown = useAppStore((s) => s.clearDrillDown);
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);
  const leadColumns = useLeadColumns();
  const clashColumns = useClashColumns();
  const leadership = isLeadershipMode();

  useEffect(() => {
    if (partnerFromUrl) {
      setSelectedPartner(partnerFromUrl);
      setDrillDown({ partner: partnerFromUrl });
    }
  }, [partnerFromUrl, setDrillDown]);

  const selectPartner = (partner: string) => {
    setSelectedPartner(partner);
    setDrillDown({ partner });
    router.replace(`/partner?partner=${encodeURIComponent(partner)}`, { scroll: false });
  };

  const clearPartner = () => {
    setSelectedPartner(null);
    clearDrillDown();
    router.replace('/partner', { scroll: false });
  };

  const { data: comparison } = useFetch({
    fetcher: () => api.getPartner(filters) as Promise<ChartData>,
    deps: [JSON.stringify(filters)],
    enabled: !selectedPartner,
  });

  const { data: clashes } = useFetch({
    fetcher: () => api.getPartnerCounsellorClashes(filters),
    deps: [JSON.stringify(filters)],
    enabled: !selectedPartner,
  });

  const { data: conversionRates } = useFetch({
    fetcher: () => api.getConversionRates(filters),
    deps: [JSON.stringify(filters)],
    enabled: !selectedPartner,
  });

  const { data: detail, loading: detailLoading } = useFetch({
    fetcher: () => api.getPartner(filters, selectedPartner!) as Promise<PartnerDetail>,
    deps: [JSON.stringify(filters), selectedPartner],
    enabled: !!selectedPartner,
  });

  const clashCountByPartner = useMemo(() => {
    const m: Record<string, number> = {};
    (clashes?.by_partner ?? []).forEach(({ partner, count }) => {
      m[partner] = count;
    });
    return m;
  }, [clashes?.by_partner]);

  const seriesByName = useMemo(() => {
    const m: Record<string, number[]> = {};
    (comparison?.series ?? []).forEach((s) => {
      m[s.name] = s.data as number[];
    });
    return m;
  }, [comparison]);

  const partnerRows = useMemo(() => {
    if (!comparison?.categories) return [];
    const totals = (comparison.extra?.block_amount_total as number[] | undefined) ?? [];
    return comparison.categories.map((partner, i) => {
      const clean = seriesByName['Block Amount']?.[i] ?? 0;
      const clashes =
        seriesByName['Counsellor Clashes']?.[i] ?? clashCountByPartner[partner] ?? 0;
      return {
        partner,
        leads: seriesByName['Leads']?.[i] ?? 0,
        offer_letter: seriesByName['Offer Letter']?.[i] ?? 0,
        block_amount: totals[i] ?? clean + clashes,
        counsellor_clashes: clashes,
        admissions: seriesByName['Admissions']?.[i] ?? 0,
      };
    });
  }, [comparison, seriesByName, clashCountByPartner]);

  const columns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'leads', header: 'Leads' },
    { accessorKey: 'offer_letter', header: 'Offer Letter' },
    { accessorKey: 'block_amount', header: 'Block Amount' },
    {
      accessorKey: 'counsellor_clashes',
      header: 'Counsellor Clashes',
      cell: ({ getValue }) => {
        const count = Number(getValue() || 0);
        return (
          <span
            className={cn(
              count > 0 && 'text-amber-300 font-semibold kpi-value'
            )}
          >
            {formatNumber(count)}
          </span>
        );
      },
    },
    { accessorKey: 'admissions', header: 'Admissions' },
  ];

  const conversionColumns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'leads', header: 'Leads' },
    { accessorKey: 'connected_pct', header: 'Connected %' },
    { accessorKey: 'lead_to_block_pct', header: 'Lead → Block %' },
    { accessorKey: 'lead_to_admission_pct', header: 'Lead → Admission %' },
    { accessorKey: 'block_amount_paid', header: 'Block Paid' },
    { accessorKey: 'admissions', header: 'Admissions' },
  ];

  const blockAmountColumns: ColumnDef<Record<string, unknown>>[] = useMemo(
    () => [...leadColumns],
    [leadColumns]
  );

  const overview = detail?.overview ?? {};
  const partnerName = String(detail?.partner || overview.partner || selectedPartner || '');
  const blockLeads = detail?.block_amount_leads ?? [];
  const contactStageSummary = detail?.contact_stage_summary ?? [];
  const partnerClashes = detail?.block_counsellor_clashes;
  const clashRows = partnerClashes?.rows ?? [];
  const clashCount = partnerClashes?.total_clashes ?? 0;

  const contactStageColumns: ColumnDef<{
    contact_stage: string;
    leads: number;
    pct: number;
  }>[] = useMemo(
    () => [
      { accessorKey: 'contact_stage', header: 'Contact Stage' },
      {
        accessorKey: 'leads',
        header: 'Leads',
        meta: { align: 'right' },
        cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
      },
      {
        accessorKey: 'pct',
        header: 'Share %',
        meta: { align: 'right' },
        cell: ({ getValue }) => formatPct(Number(getValue() || 0)),
      },
    ],
    []
  );

  const contactStageChart: ChartData | null = useMemo(() => {
    if (!contactStageSummary.length) return null;
    const top = contactStageSummary.slice(0, 12);
    return {
      chart_id: 'partner_contact_stages',
      chart_type: 'donut',
      title: `Contact Stages — ${partnerName}`,
      categories: top.map((r) => r.contact_stage),
      series: [{ name: 'Leads', data: top.map((r) => r.leads) }],
    };
  }, [contactStageSummary, partnerName]);

  return (
    <div className="space-y-4">
      <PageHeader title="Partner Analytics" />

      {!selectedPartner && comparison && (
        <>
          <ChartPanel
            chart={comparison}
            height={360}
            onCategoryClick={(partner) => {
              selectPartner(partner);
            }}
          />
          <DataTable
            data={partnerRows}
            columns={columns}
            onRowClick={(row) => {
              selectPartner(String(row.partner));
            }}
          />

          <SectionHeader
            title="Conversion rates"
            subtitle="Lead → Block / Admission by partner"
          />
          <DataTable
            data={(conversionRates?.by_partner ?? []) as Record<string, unknown>[]}
            columns={conversionColumns}
            onRowClick={(row) => {
              selectPartner(String(row.partner));
            }}
            exportFilename="partner_conversion_rates.csv"
            height={280}
          />

          <SectionHeader
            title="Block Amount Counsellor Clashes"
            subtitle={
              clashes?.has_sheet
                ? 'From block payment backtracking — partner-attributed leads with Counsellor at payment'
                : 'Upload block amount paid sheet on Block Payment tab'
            }
          />

          {clashes?.has_sheet ? (
            <>
              <div className="panel grid grid-cols-2 md:grid-cols-3 gap-px bg-border max-w-xl">
                <div className="bg-surface px-4 py-3 ring-1 ring-inset ring-amber-500/50 bg-amber-500/5">
                  <div className="text-[10px] uppercase tracking-widest text-amber-300">
                    Total Counsellor Clashes
                  </div>
                  <div className="text-lg font-semibold text-amber-300 kpi-value mt-1">
                    {formatNumber(clashes.total_clashes)}
                  </div>
                </div>
                <div className="bg-surface px-4 py-3">
                  <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                    Partners Affected
                  </div>
                  <div className="text-lg font-semibold text-text kpi-value mt-1">
                    {formatNumber(clashes.by_partner.length)}
                  </div>
                </div>
              </div>
              {!leadership && (
                <DataTable
                  data={clashes.rows}
                  columns={clashColumns}
                  exportFilename="partner_counsellor_clashes.csv"
                  searchPlaceholder="Search clashes…"
                  height={360}
                />
              )}
            </>
          ) : (
            <p className="text-text-secondary text-sm panel p-4">
              Counsellor clash detection requires the block amount paid payment sheet.
            </p>
          )}
        </>
      )}

      {selectedPartner && (
        <div className="space-y-4">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={clearPartner}
          >
            ← All Partners
          </button>

          {detailLoading && !detail ? (
            <p className="text-text-secondary text-sm">Loading partner details…</p>
          ) : (
            <>
              <SectionHeader title={partnerName} subtitle="Partner performance overview" />

              <div className="panel grid grid-cols-2 md:grid-cols-4">
                {PARTNER_METRICS.map(({ key, label, format, leadFilter }) => {
                  const value = overview[key];
                  const filterKey = leadFilter ?? KPI_LEAD_FILTERS[key];
                  return (
                    <ClickableMetricBox
                      key={key}
                      label={label}
                      value={formatPartnerMetricValue(value, format)}
                      onClick={() =>
                        openExplorer(`${partnerName} · ${label}`, filterKey)
                      }
                    />
                  );
                })}
                <div
                  className={cn(
                    'px-3 py-2.5 border-r border-b border-border text-left',
                    clashCount > 0 && 'bg-amber-500/5'
                  )}
                >
                  <div className="text-[10px] text-amber-300 uppercase tracking-wide mb-1">
                    Counsellor Clashes
                  </div>
                  <div className="kpi-value text-xl font-semibold text-amber-300">
                    {formatNumber(clashCount)}
                  </div>
                  <div className="text-[10px] text-text-secondary mt-0.5">
                    Block paid · Counsellor at payment
                  </div>
                </div>
              </div>

              <div className="text-sm text-text-secondary">
                Performance Score:{' '}
                <span className="text-primary kpi-value">
                  {formatNumber(Number(detail?.performance_score ?? 0), 2)}
                </span>
              </div>

              <SectionHeader
                title="Lead volume"
                subtitle={`Daily / weekly / monthly leads for ${partnerName}`}
                action={
                  <div className="flex border border-border">
                    {PARTNER_TREND_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPartnerTrend(opt.key)}
                        className={
                          'px-3 py-1 text-xs ' +
                          (partnerTrend === opt.key
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
              <ChartPanel
                chart={resolvePartnerTrendChart(detail, partnerTrend, partnerName)}
                height={320}
              />

              <SectionHeader
                title="Contact Stage Summary"
                subtitle={`All contact stages for ${partnerName} · ${formatNumber(contactStageSummary.length)} stages`}
              />
              {contactStageSummary.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {contactStageChart && (
                    <ChartPanel chart={contactStageChart} height={300} />
                  )}
                  <DataTable
                    data={contactStageSummary}
                    columns={contactStageColumns}
                    exportFilename={`${partnerName.replace(/\s+/g, '_')}_contact_stages.csv`}
                    searchPlaceholder="Search contact stages…"
                    height={300}
                  />
                </div>
              ) : (
                <p className="text-text-secondary text-sm panel p-4">
                  No contact stage data for this partner.
                </p>
              )}

              <SectionHeader
                title="Block Amount Counsellor Clashes"
                subtitle={`${formatNumber(clashCount)} clashes from block payment backtracking for ${partnerName}`}
              />
              {partnerClashes?.has_sheet ? (
                clashCount > 0 ? (
                  leadership ? (
                    <p className="text-text-secondary text-sm panel p-4">
                      {formatNumber(clashCount)} counsellor clashes (lead-level list hidden on
                      leadership view).
                    </p>
                  ) : (
                    <DataTable
                      data={clashRows}
                      columns={clashColumns.filter((c) => {
                        const key = (c as { accessorKey?: string }).accessorKey;
                        return key !== 'partner';
                      })}
                      exportFilename={`${partnerName.replace(/\s+/g, '_')}_counsellor_clashes.csv`}
                      searchPlaceholder="Search clashes…"
                      height={320}
                    />
                  )
                ) : (
                  <p className="text-text-secondary text-sm panel p-4">
                    No counsellor payment clashes for this partner.
                  </p>
                )
              ) : (
                <p className="text-text-secondary text-sm panel p-4">
                  Upload block amount paid sheet on Block Payment Back tracking tab to detect clashes.
                </p>
              )}

              {!leadership && (
                <>
                  <SectionHeader
                    title="Block Amount Paid Leads"
                    subtitle={`${formatNumber(blockLeads.length)} leads from ${partnerName}`}
                  />
                  <DataTable
                    data={blockLeads}
                    columns={blockAmountColumns}
                    exportFilename={`${partnerName.replace(/\s+/g, '_')}_block_amount_paid.csv`}
                    searchPlaceholder="Search within block amount paid leads..."
                    height={360}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
