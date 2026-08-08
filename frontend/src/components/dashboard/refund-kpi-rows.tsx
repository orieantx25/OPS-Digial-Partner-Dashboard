'use client';

import { CampusBifurcation, RefundCaseRow } from '@/types';
import { dpRefundRequestKpiItems } from '@/components/dashboard/dp-refund-kpi';
import {
  KpiCategoryRow,
  KpiDashboardStack,
} from '@/components/dashboard/kpi-category-row';

export function RefundKpiRows({
  campus,
  caseRows = [],
}: {
  campus?: CampusBifurcation | null;
  caseRows?: RefundCaseRow[];
}) {
  const refund = campus?.refund_summary;
  const grossTotal = campus?.sheet_total ?? 0;
  const activeTotal = campus?.adjusted_sheet_total ?? grossTotal;

  return (
    <KpiDashboardStack>
      <KpiCategoryRow
        title="Overall refunds"
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
        title="Digital partner refunds"
        items={dpRefundRequestKpiItems(refund?.dp_refund_requests, caseRows)}
      />
    </KpiDashboardStack>
  );
}
