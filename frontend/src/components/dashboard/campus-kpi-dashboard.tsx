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
  const refundedByCampus = refund?.refunded_by_campus ?? { SSAHE: 0, ADYPU: 0 };
  const retainedByCampus = refund?.retained_by_campus ?? { SSAHE: 0, ADYPU: 0 };
  const grossTotal = data.sheet_total ?? 0;
  const activeTotal = data.adjusted_sheet_total ?? grossTotal;
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
            valueClassName: 'text-green-500',
          },
          {
            label: 'Total refund applied',
            value: refund?.total_cases ?? 0,
            sub: 'All students on refund sheet',
            valueClassName: 'text-white',
          },
          {
            label: 'Retained',
            value: refund?.retained_cases ?? 0,
            sub: 'On hold as per SST team',
            valueClassName: 'text-green-500',
          },
          {
            label: 'Refund request sent to university',
            value: refund?.refund_processed ?? 0,
            valueClassName: 'text-yellow-400',
          },
          {
            label: 'Refunded',
            value: refund?.refunded_cases ?? refund?.refund_cases ?? 0,
            valueClassName: 'text-red-500',
          },
        ]}
      />

      <KpiCategoryRow
        title="By campus"
        items={[
          {
            label: 'SSAHE students (active)',
            value: campusCount(data.adjusted_sheet_by_campus, 'SSAHE'),
            valueClassName: 'text-green-500',
          },
          {
            label: 'ADYPU students (active)',
            value: campusCount(data.adjusted_sheet_by_campus, 'ADYPU'),
            valueClassName: 'text-green-500',
          },
          {
            label: 'SSAHE refund applied',
            value: refundsAppliedByCampus.SSAHE ?? 0,
            valueClassName: 'text-white',
          },
          {
            label: 'ADYPU refund applied',
            value: refundsAppliedByCampus.ADYPU ?? 0,
            valueClassName: 'text-white',
          },
          {
            label: 'SSAHE retained',
            value: retainedByCampus.SSAHE ?? 0,
            valueClassName: 'text-green-500',
          },
          {
            label: 'ADYPU retained',
            value: retainedByCampus.ADYPU ?? 0,
            valueClassName: 'text-green-500',
          },
          {
            label: 'SSAHE sent to university',
            value: refundByCampus.SSAHE ?? 0,
            valueClassName: 'text-yellow-400',
          },
          {
            label: 'ADYPU sent to university',
            value: refundByCampus.ADYPU ?? 0,
            valueClassName: 'text-yellow-400',
          },
          {
            label: 'SSAHE refunded',
            value: refundedByCampus.SSAHE ?? 0,
            valueClassName: 'text-red-500',
          },
          {
            label: 'ADYPU refunded',
            value: refundedByCampus.ADYPU ?? 0,
            valueClassName: 'text-red-500',
          },
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
