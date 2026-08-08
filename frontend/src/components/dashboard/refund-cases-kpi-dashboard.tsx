'use client';

import { CampusBifurcation } from '@/types';
import { cn, formatNumber } from '@/lib/utils';

function HeroMetric({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: number | string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="panel bg-surface border border-border px-4 py-3 min-w-0">
      <p className="text-[9px] uppercase tracking-[0.18em] text-text-secondary leading-snug">
        {label}
      </p>
      <p
        className={cn(
          'text-2xl sm:text-3xl font-semibold kpi-value mt-1 tabular-nums',
          valueClassName ?? 'text-text'
        )}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
      {sub && <p className="text-[10px] text-text-secondary mt-1">{sub}</p>}
    </div>
  );
}

/** Standalone refund portal KPIs (mirrors campus-block hero layout). */
export function RefundCasesKpiDashboard({ data }: { data: CampusBifurcation }) {
  const refund = data.refund_summary;
  const refundByCampus = refund?.by_campus ?? { SSAHE: 0, ADYPU: 0 };
  const refundsAppliedByCampus = refund?.refunds_applied_by_campus ?? {
    SSAHE: 0,
    ADYPU: 0,
  };
  const refundedByCampus = refund?.refunded_by_campus ?? { SSAHE: 0, ADYPU: 0 };
  const retainedByCampus = refund?.retained_by_campus ?? { SSAHE: 0, ADYPU: 0 };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroMetric
          label="Total refund applied"
          value={refund?.total_cases ?? 0}
          sub="All students on refund sheet"
          valueClassName="text-white"
        />
        <HeroMetric
          label="Retained"
          value={refund?.retained_cases ?? 0}
          sub="On hold as per SST team"
          valueClassName="text-green-500"
        />
        <HeroMetric
          label="Refund request sent to university"
          value={refund?.refund_processed ?? 0}
          valueClassName="text-yellow-400"
        />
        <HeroMetric
          label="Refunded"
          value={refund?.refunded_cases ?? refund?.refund_cases ?? 0}
          valueClassName="text-red-500"
        />
      </div>

      <div className="panel p-4 sm:p-5 border border-border bg-panel/80">
        <p className="text-[10px] uppercase tracking-[0.2em] text-text-secondary font-medium mb-3">
          By campus
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <HeroMetric
            label="SSAHE refund applied"
            value={refundsAppliedByCampus.SSAHE ?? 0}
            valueClassName="text-white"
          />
          <HeroMetric
            label="ADYPU refund applied"
            value={refundsAppliedByCampus.ADYPU ?? 0}
            valueClassName="text-white"
          />
          <HeroMetric
            label="SSAHE retained"
            value={retainedByCampus.SSAHE ?? 0}
            valueClassName="text-green-500"
          />
          <HeroMetric
            label="ADYPU retained"
            value={retainedByCampus.ADYPU ?? 0}
            valueClassName="text-green-500"
          />
          <HeroMetric
            label="SSAHE sent to university"
            value={refundByCampus.SSAHE ?? 0}
            valueClassName="text-yellow-400"
          />
          <HeroMetric
            label="ADYPU sent to university"
            value={refundByCampus.ADYPU ?? 0}
            valueClassName="text-yellow-400"
          />
          <HeroMetric
            label="SSAHE refunded"
            value={refundedByCampus.SSAHE ?? 0}
            valueClassName="text-red-500"
          />
          <HeroMetric
            label="ADYPU refunded"
            value={refundedByCampus.ADYPU ?? 0}
            valueClassName="text-red-500"
          />
        </div>
      </div>
    </div>
  );
}
