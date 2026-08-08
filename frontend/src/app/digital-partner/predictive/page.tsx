'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartData } from '@/types';
import { cn, formatNumber, formatPct } from '@/lib/utils';

interface MtdRunRate {
  month?: string;
  days_elapsed?: number;
  days_in_month?: number;
  lead_mtd?: number;
  lead_projected?: number | null;
  block_mtd?: number;
  block_projected?: number | null;
}

export default function PredictivePage() {
  const filters = useEffectiveFilters();

  const { data, loading, isFetching } = useFetch({
    fetcher: () => api.getPredictive(filters),
    deps: [JSON.stringify(filters)],
  });

  const leadChart = (data?.lead_chart as ChartData | undefined) ?? null;
  const blockChart = (data?.block_amount_chart as ChartData | undefined) ?? null;
  const dailyChart = (data?.daily_lead_chart as ChartData | undefined) ?? null;

  const leadForecast = (data?.lead_forecast as { period: string; value: number }[] | undefined) ?? [];
  const blockForecast =
    (data?.block_amount_forecast as { period: string; value: number }[] | undefined) ?? [];

  const horizon = data?.forecast_horizon as { from?: string; to?: string } | undefined;
  const mtd = data?.mtd_run_rate as MtdRunRate | null | undefined;
  const rangeLabel =
    horizon?.from && horizon?.to
      ? `${horizon.from} → ${horizon.to}`
      : leadForecast.length
        ? leadForecast.map((f) => f.period).join(' · ')
        : 'forecast horizon';

  const monthsUsed = Math.max(
    Number(data?.lead_months_used || 0),
    Number(data?.block_months_used || 0)
  );

  return (
    <div className={cn('space-y-4', isFetching && data && 'opacity-90')}>
      <PageHeader title="Predictive Analytics" />
      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : (
        <FetchingHint active={isFetching} />
      )}

      {mtd && (
        <>
          <SectionHeader
            title="Month-to-date run rate"
            subtitle={`${mtd.month ?? horizon?.from ?? ''} · day ${mtd.days_elapsed ?? 0} of ${mtd.days_in_month ?? 0}`}
          />
          <div className="panel grid grid-cols-2 md:grid-cols-4 gap-px bg-border max-w-4xl">
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Leads MTD
              </div>
              <div className="text-lg font-semibold text-text kpi-value mt-1">
                {formatNumber(Number(mtd.lead_mtd || 0))}
              </div>
            </div>
            <div className="bg-surface px-4 py-3 bg-sky-500/5 ring-1 ring-inset ring-sky-500/30">
              <div className="text-[10px] uppercase tracking-widest text-sky-300">
                Leads projected (full month)
              </div>
              <div className="text-lg font-semibold text-sky-300 kpi-value mt-1">
                {mtd.lead_projected != null ? formatNumber(mtd.lead_projected) : '—'}
              </div>
            </div>
            <div className="bg-surface px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">
                Block paid MTD
              </div>
              <div className="text-lg font-semibold text-text kpi-value mt-1">
                {formatNumber(Number(mtd.block_mtd || 0))}
              </div>
            </div>
            <div className="bg-surface px-4 py-3 bg-amber-500/5 ring-1 ring-inset ring-amber-500/30">
              <div className="text-[10px] uppercase tracking-widest text-amber-300">
                Block projected (full month)
              </div>
              <div className="text-lg font-semibold text-amber-300 kpi-value mt-1">
                {mtd.block_projected != null ? formatNumber(mtd.block_projected) : '—'}
              </div>
            </div>
          </div>
          {dailyChart && dailyChart.categories?.length > 0 && (
            <ChartPanel chart={dailyChart} height={260} />
          )}
        </>
      )}

      <SectionHeader
        title="Lead Forecast"
        subtitle={`Current vs expected (${rangeLabel}) · based on prior monthly history`}
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
          <div
            key={f.period}
            className="bg-surface px-4 py-3 bg-sky-500/5 ring-1 ring-inset ring-sky-500/30"
          >
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
        subtitle={`Current vs expected (${rangeLabel}) · based on prior monthly history`}
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
          <div
            key={f.period}
            className="bg-surface px-4 py-3 bg-amber-500/5 ring-1 ring-inset ring-amber-500/30"
          >
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
        MTD projections use daily run-rate through the selected end date. Monthly expected values
        use average month-over-month jump across prior months
        {monthsUsed > 0 ? ` (${formatNumber(monthsUsed)} months)` : ''}, blended with a linear
        trend for {rangeLabel}. Solid line = current actuals; dashed line = expected.
      </p>
    </div>
  );
}
