'use client';

import { CampusBifurcation, RefundCaseRow } from '@/types';
import { formatNumber } from '@/lib/utils';
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
  const removed = Math.max(0, grossTotal - activeTotal);

  return (
    <KpiDashboardStack>
      <KpiCategoryRow
        title="Overall refunds"
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
        title="Digital partner refunds"
        items={dpRefundRequestKpiItems(refund?.dp_refund_requests, caseRows)}
      />
    </KpiDashboardStack>
  );
}
