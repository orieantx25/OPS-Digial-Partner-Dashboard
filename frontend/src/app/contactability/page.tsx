'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ClickableMetricBox, formatMetricBoxValue } from '@/components/dashboard/clickable-metric-box';
import { BUCKET_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';

const BUCKETS = ['AI Bot Dialed', 'Leads not Touched', '1 Dial', '2 Dial', '3+ Dial'] as const;

/** Legacy API bucket names from before the rename. */
const LEGACY_BUCKET_ALIASES: Record<string, (typeof BUCKETS)[number]> = {
  'Never Dialed': 'Leads not Touched',
};

function normalizeBucketName(name: string): (typeof BUCKETS)[number] | string {
  return LEGACY_BUCKET_ALIASES[name] ?? name;
}

export default function ContactabilityPage() {
  const filters = useEffectiveFilters();
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);

  const { data } = useFetch({
    fetcher: () => api.getContactability(filters),
    deps: [JSON.stringify(filters)],
  });

  const bucketStats = useMemo(() => {
    const breakdown = data?.breakdown;
    if (!breakdown) return {} as Record<string, { count: number; avg: number | null }>;

    const avgDials = (breakdown.extra?.avg_dials as Record<string, number>) || {};
    const counts = (breakdown.extra?.counts as Record<string, number>) || {};
    const out: Record<string, { count: number; avg: number | null }> = {};

    breakdown.categories.forEach((cat, i) => {
      const bucket = normalizeBucketName(cat);
      const count = counts[cat] ?? counts[bucket] ?? Number(breakdown.series[0]?.data[i] ?? 0);
      const avg = avgDials[cat] ?? avgDials[bucket];
      // Average dials is only meaningful once a lead has been dialed at least once.
      const showAvg = bucket === '1 Dial' || bucket === '2 Dial' || bucket === '3+ Dial';
      const existing = out[bucket];
      out[bucket] = {
        count: (existing?.count ?? 0) + count,
        avg: showAvg && avg != null ? avg : existing?.avg ?? null,
      };
    });
    return out;
  }, [data?.breakdown]);

  return (
    <div className="space-y-4">
      <PageHeader title="Contactability" />

      <SectionHeader title="Leads by Bucket" subtitle="Count per contact bucket · avg dials shown where relevant" />
      <div className="panel grid grid-cols-2 md:grid-cols-5">
        {BUCKETS.map((bucket) => {
          const stat = bucketStats[bucket];
          return (
            <ClickableMetricBox
              key={bucket}
              label={bucket}
              value={formatMetricBoxValue(stat?.count)}
              subtext={
                stat?.avg != null ? `avg ${stat.avg.toFixed(1)} dials` : undefined
              }
              onClick={() =>
                openExplorer(bucket, BUCKET_LEAD_FILTERS[bucket])
              }
            />
          );
        })}
      </div>

      <SectionHeader title="Contactability Analytics" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data?.breakdown && <ChartPanel chart={data.breakdown} />}
        {data?.trend && <ChartPanel chart={data.trend} />}
        {data?.call_distribution && <ChartPanel chart={data.call_distribution} />}
      </div>
    </div>
  );
}
