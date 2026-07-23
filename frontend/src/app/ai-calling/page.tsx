'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ClickableMetricBox, formatMetricBoxValue } from '@/components/dashboard/clickable-metric-box';
import { ChartData } from '@/types';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { AI_LEAD_FILTERS } from '@/lib/lead-filters';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { FetchingHint } from '@/components/dashboard/fetching-hint';

const AI_METRICS = [
  { key: 'calls', label: 'Calls' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'warm', label: 'Warm' },
  { key: 'high_intent', label: 'High Intent' },
  { key: 'payment_link', label: 'Payment Link' },
  { key: 'brochure', label: 'Brochure' },
  { key: 'dnp', label: 'DNP' },
  { key: 'interested', label: 'Interested' },
  { key: 'callback', label: 'Callback' },
];

const AI_EFFECTIVENESS_KEYS = [
  'qualified',
  'warm',
  'high_intent',
  'payment_link',
  'brochure',
  'interested',
  'callback',
] as const;

export default function AiCallingPage() {
  const filters = useEffectiveFilters();
  const openExplorer = useLeadExplorerStore((s) => s.openExplorer);

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getAiCalling(filters),
    deps: [JSON.stringify(filters)],
  });

  const calls = Number(data?.calls || 0);
  const positiveOutcomes = AI_EFFECTIVENESS_KEYS.reduce(
    (sum, key) => sum + Number(data?.[key] || 0),
    0
  );
  const effectiveness = calls > 0 ? (positiveOutcomes / calls * 100) : 0;

  const outcomeChart: ChartData = {
    chart_id: 'ai_outcomes',
    chart_type: 'bar',
    title: 'Call Outcomes',
    categories: AI_METRICS.filter((m) => m.key !== 'calls').map((m) => m.label),
    series: [
      {
        name: 'Count',
        data: AI_METRICS.filter((m) => m.key !== 'calls').map((m) => Number(data?.[m.key] || 0)),
      },
    ],
  };

  return (
    <div className={cn('space-y-4', isFetching && data && 'opacity-90')}>
      <PageHeader title="AI Calling Dashboard" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <ChartPanel chart={outcomeChart} height={300} />
        </div>
        <div className="col-span-12 lg:col-span-4 panel p-4 border-l-4 border-primary flex flex-col justify-center">
          <div className="text-xs text-text-secondary uppercase tracking-wide">AI Effectiveness</div>
          <div className="kpi-value text-4xl text-primary my-1">{formatPct(effectiveness)}</div>
          <div className="kpi-value text-sm text-text mt-3">{formatNumber(calls)} total calls</div>
        </div>
      </div>

      <SectionHeader title="Outcome Breakdown" />
      <div className="panel grid grid-cols-3 md:grid-cols-5">
        {AI_METRICS.map(({ key, label }) => (
          <ClickableMetricBox
            key={key}
            label={label}
            value={formatMetricBoxValue(Number(data?.[key] || 0))}
            onClick={() => openExplorer(label, AI_LEAD_FILTERS[key])}
          />
        ))}
      </div>
    </div>
  );
}
