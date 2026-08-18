'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { DataTable } from '@/components/tables/data-table';
import { ChartPanel } from '@/components/charts/chart-panel';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartData, PersonaSummary } from '@/types';
import { formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';

const SUMMARY_METRICS: { key: keyof PersonaSummary; label: string; accent?: boolean }[] = [
  { key: 'know_more_about_btech', label: 'Know More about B.Tech' },
  { key: 'other_persona', label: 'Other Persona' },
  { key: 'registration', label: 'Registration' },
  { key: 'offer_letter_sent', label: 'Offer Letter Sent' },
  {
    key: 'know_more_about_btech_last_24h',
    label: 'Know More about B.Tech (Last 24h)',
    accent: true,
  },
];

const EMPTY_CHART: ChartData = {
  chart_id: 'empty',
  chart_type: 'donut',
  title: '',
  categories: [],
  series: [{ name: 'Leads', data: [] }],
};

export default function PersonaPage() {
  const router = useRouter();
  const leadership = isLeadershipMode();
  const filters = useEffectiveFilters();

  useEffect(() => {
    if (leadership) router.replace('/digital-partner');
  }, [leadership, router]);

  const { data } = useFetch({
    fetcher: () => api.getPersona(filters),
    deps: [JSON.stringify(filters)],
    enabled: !leadership,
  });

  const columns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'persona', header: 'Persona' },
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'total', header: 'Total Leads' },
    { accessorKey: 'know_more', header: 'Know More' },
    { accessorKey: 'know_more_last_24h', header: 'Last 24h' },
    { accessorKey: 'app_started', header: 'App Started' },
    { accessorKey: 'test_registered', header: 'Registration' },
    { accessorKey: 'offer_letter', header: 'Offer Letter' },
    { accessorKey: 'fee_paid', header: 'Fee Paid' },
    { accessorKey: 'drop_off', header: 'Drop-off' },
  ];

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const charts = data?.charts;
  const activity = data?.activity_sheet;
  const total = summary?.know_more_about_btech ?? 0;
  const last24h = summary?.know_more_about_btech_last_24h ?? 0;
  const last24hShare = total > 0 ? (last24h / total) * 100 : 0;

  const matchHint = useMemo(() => {
    if (!activity?.has_data) {
      return 'Stored persona snapshot. Last 24h Interested uses the saved activity report.';
    }
    return (
      `Report rows (Know More events, last 24h): ${formatNumber(activity.report_rows)} · ` +
      `Matched leads: ${formatNumber(activity.matched_leads)} · ` +
      `Unmatched: ${formatNumber(activity.unmatched_report_rows)}`
    );
  }, [activity]);

  if (leadership) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Persona Analytics" />

      <SectionHeader title="Persona activity report (Last 24h)" />

      <div className="panel p-4 space-y-3">
        <div className="text-xs text-text-secondary">{matchHint}</div>
        {activity?.has_data && activity.source_filename && (
          <div className="text-[11px] text-text-secondary">
            Current file: {activity.source_filename}
            {activity.uploaded_at ? ` · uploaded ${activity.uploaded_at}` : ''}
          </div>
        )}
      </div>

      <SectionHeader title="Top Persona Summary" />

      <div className="panel grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
        {SUMMARY_METRICS.map(({ key, label, accent }) => (
          <div
            key={key}
            className={
              accent
                ? 'bg-surface px-4 py-3 ring-1 ring-inset ring-amber-500/40 bg-amber-500/5'
                : 'bg-surface px-4 py-3'
            }
          >
            <div
              className={
                accent
                  ? 'text-[10px] uppercase tracking-widest text-amber-300'
                  : 'text-[10px] uppercase tracking-widest text-text-secondary'
              }
            >
              {label}
            </div>
            <div
              className={
                accent
                  ? 'text-lg font-semibold text-amber-300 kpi-value mt-1'
                  : 'text-lg font-semibold text-text kpi-value mt-1'
              }
            >
              {formatNumber(
                Number(
                  summary?.[key] ??
                    (key === 'other_persona' ? summary?.know_more : undefined) ??
                    0
                )
              )}
            </div>
            {accent && total > 0 && (
              <div className="text-[10px] text-text-secondary mt-0.5">
                {last24hShare.toFixed(1)}% of overall
              </div>
            )}
          </div>
        ))}
      </div>

      <SectionHeader title="Know More about B.Tech — Visual Breakdown" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartPanel
          chart={
            charts?.partner_overall ?? {
              ...EMPTY_CHART,
              chart_type: 'bar',
              title: 'Partners — Overall',
            }
          }
          height={300}
        />
        <ChartPanel
          chart={
            charts?.partner_last_24h
              ? {
                  ...charts.partner_last_24h,
                  title: 'Partners — Know More about B.Tech (last 24 hours)',
                }
              : {
                  ...EMPTY_CHART,
                  chart_type: 'pie',
                  title: 'Partners — Know More about B.Tech (last 24 hours)',
                }
          }
          height={300}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartPanel
          chart={charts?.stage_overall ?? { ...EMPTY_CHART, chart_type: 'pie', title: 'Persona Overall' }}
          height={300}
        />
        <ChartPanel
          chart={
            charts?.stage_last_24h ?? {
              ...EMPTY_CHART,
              chart_type: 'pie',
              title: 'Persona Last 24h — Created vs Interested',
            }
          }
          height={300}
        />
      </div>

      <SectionHeader title="Partner Breakdown" />

      {data && (
        <DataTable
          data={rows}
          columns={columns}
          exportFilename="persona_analytics.csv"
        />
      )}
    </div>
  );
}
