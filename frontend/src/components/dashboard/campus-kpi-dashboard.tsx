'use client';

import { CampusBifurcation } from '@/types';
import { formatNumber } from '@/lib/utils';
import { dpRefundRequestKpiItems } from '@/components/dashboard/dp-refund-kpi';
import {
  KpiCategoryRow,
  KpiDashboardStack,
} from '@/components/dashboard/kpi-category-row';

function campusCount(
  rows: CampusBifurcation['adjusted_sheet_by_campus'] | CampusBifurcation['by_campus'],
  code: string
): number {
  return rows?.find((c) => c.campus_code === code)?.block_paid ?? 0;
}

export function CampusKpiDashboard({ data }: { data: CampusBifurcation }) {
  const refund = data.refund_summary;
  const refundByCampus = refund?.by_campus ?? { SSAHE: 0, ADYPU: 0 };
  const refundsAppliedByCampus = refund?.refunds_applied_by_campus ?? {
    SSAHE: 0,
    ADYPU: 0,
  };
  const grossTotal = data.sheet_total ?? 0;
  const activeTotal = data.adjusted_sheet_total ?? grossTotal;
  const removed = Math.max(0, grossTotal - activeTotal);
  const totalDpBlock =
    data.digital_partner_count ?? data.matched_count ?? data.total_block_paid ?? 0;

  return (
    <KpiDashboardStack>
      <KpiCategoryRow
        title="Overall"
        items={[
          { label: 'Total block payment received', value: grossTotal },
          {
            label: 'Active block',
            value: activeTotal,
            sub: removed > 0 ? `${formatNumber(removed)} removed from sheet` : undefined,
            primary: true,
          },
          { label: 'Total refunds applied', value: refund?.total_cases ?? 0 },
          {
            label: 'Refund processed',
            value: refund?.refund_processed ?? refund?.refund_cases ?? 0,
          },
        ]}
      />

      <KpiCategoryRow
        title="By campus"
        items={[
          {
            label: 'SSAHE students (active)',
            value: campusCount(data.adjusted_sheet_by_campus, 'SSAHE'),
            primary: true,
          },
          {
            label: 'ADYPU students (active)',
            value: campusCount(data.adjusted_sheet_by_campus, 'ADYPU'),
            primary: true,
          },
          {
            label: 'SSAHE refunds applied',
            value: refundsAppliedByCampus.SSAHE ?? 0,
          },
          {
            label: 'ADYPU refunds applied',
            value: refundsAppliedByCampus.ADYPU ?? 0,
          },
          { label: 'SSAHE refund cases', value: refundByCampus.SSAHE ?? 0 },
          { label: 'ADYPU refund cases', value: refundByCampus.ADYPU ?? 0 },
        ]}
      />

      <KpiCategoryRow
        title="Digital partners"
        items={[
          { label: 'Total block from DP', value: totalDpBlock, primary: true },
          {
            label: 'Share of Block Amount',
            value: `${formatNumber(data.digital_partner_share_pct ?? 0)}%`,
          },
          { label: 'DP block — SSAHE', value: campusCount(data.by_campus, 'SSAHE') },
          { label: 'DP block — ADYPU', value: campusCount(data.by_campus, 'ADYPU') },
        ]}
      />

      <KpiCategoryRow
        title="Digital partner refunds"
        items={dpRefundRequestKpiItems(refund?.dp_refund_requests)}
      />
    </KpiDashboardStack>
  );
}
