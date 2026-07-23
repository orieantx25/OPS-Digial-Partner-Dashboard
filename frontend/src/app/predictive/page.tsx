'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartData } from '@/types';
import { cn, formatNumber, formatPct } from '@/lib/utils';

export default function PredictivePage() {
  const filters = useEffectiveFilters();

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getPredictive(filters),
    deps: [JSON.stringify(filters)],
  });

  const leadChart = (data?.lead_chart as ChartData | undefined) ?? null;
  const blockChart = (data?.block_amount_chart as ChartData | undefined) ?? null;

  const leadForecast = (data?.lead_forecast as { period: string; value: number }[] | undefined) ?? [];
  const blockForecast =
    (data?.block_amount_forecast as { period: string; value: number }[] | undefined) ?? [];

  return (
    <div className={cn('space-y-4', isFetching && data && 'opacity-90')}>
      <PageHeader title="Predictive Analytics" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}
      <SectionHeader
        title="Lead Forecast"
        subtitle="Current leads vs expected July–August · based on all previous months"
      />
      <div className="panel grid grid-cols-2 md:grid-cols-4 gap-px bg-border max-w-3xl">
        <div className="bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Avg MoM Lead Jump
          </div>
          <div className="text-lg font-semibold text-text kpi-value mt-1">
            {formatPct(Number(data?.avg_lead_jump_pct || 0))}
          </div>
          {Number(data?.lead_months_used || 0) > 0 && (
            <div className="text-[10px] text-text-secondary mt-1">
              {formatNumber(Number(data?.lead_months_used))} months used
            </div>
          )}
        </div>
        {leadForecast.map((f) => (
          <div key={f.period} className="bg-surface px-4 py-3 bg-sky-500/5 ring-1 ring-inset ring-sky-500/30">
            <div className="text-[10px] uppercase tracking-widest text-sky-300">
              Expected {f.period}
            </div>
            <div className="text-lg font-semibold text-sky-300 kpi-value mt-1">
              {formatNumber(f.value)}
            </div>
          </div>
        ))}
      </div>
      {leadChart && <ChartPanel chart={leadChart} height={340} />}

      <SectionHeader
        title="Block Amount Forecast"
        subtitle="Current block amount paid vs expected July–August · based on all previous months"
      />
      <div className="panel grid grid-cols-2 md:grid-cols-4 gap-px bg-border max-w-3xl">
        <div className="bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Avg MoM Block Jump
          </div>
          <div className="text-lg font-semibold text-text kpi-value mt-1">
            {formatPct(Number(data?.avg_block_jump_pct || 0))}
          </div>
          {Number(data?.block_months_used || 0) > 0 && (
            <div className="text-[10px] text-text-secondary mt-1">
              {formatNumber(Number(data?.block_months_used))} months used
            </div>
          )}
        </div>
        {blockForecast.map((f) => (
          <div key={f.period} className="bg-surface px-4 py-3 bg-amber-500/5 ring-1 ring-inset ring-amber-500/30">
            <div className="text-[10px] uppercase tracking-widest text-amber-300">
              Expected {f.period}
            </div>
            <div className="text-lg font-semibold text-amber-300 kpi-value mt-1">
              {formatNumber(f.value)}
            </div>
          </div>
        ))}
      </div>
      {blockChart && <ChartPanel chart={blockChart} height={340} />}

      <p className="text-[11px] text-text-secondary">
        Expected values use every previous month before July: average month-over-month jump across
        the full history, blended with a linear trend on the same months, then projected for July
        and August. Solid line = current actuals; light dashed line = expected.
      </p>
    </div>
  );
}
