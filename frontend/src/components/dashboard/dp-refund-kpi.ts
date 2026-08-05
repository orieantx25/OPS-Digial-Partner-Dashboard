import { DpRefundRequestsSummary, RefundCaseRow } from '@/types';
import type { KpiItem } from '@/components/dashboard/kpi-category-row';

function campusFromRow(row: RefundCaseRow): string {
  return String(row.matched_campus_code || row.campus || '').toUpperCase();
}

export function dpRefundRequestsFromCases(
  caseRows: RefundCaseRow[]
): DpRefundRequestsSummary {
  const requests = caseRows.filter((r) => r.is_digital_partner_block_paid);
  const refunded = requests.filter((r) => r.is_refund);
  const ssaheReq = requests.filter((r) => campusFromRow(r).includes('SSAHE')).length;
  const adypuReq = requests.filter((r) => campusFromRow(r).includes('ADYPU')).length;
  const ssaheRef = refunded.filter((r) => campusFromRow(r).includes('SSAHE')).length;
  const adypuRef = refunded.filter((r) => campusFromRow(r).includes('ADYPU')).length;
  return {
    total: requests.length,
    by_campus: { SSAHE: ssaheReq, ADYPU: adypuReq },
    refunded_by_campus: { SSAHE: ssaheRef, ADYPU: adypuRef },
  };
}

export function dpRefundRequestKpiItems(
  dpRequests?: DpRefundRequestsSummary | null,
  caseRows: RefundCaseRow[] = []
): KpiItem[] {
  const data =
    dpRequests?.total != null && dpRequests.total > 0
      ? dpRequests
      : caseRows.length > 0
        ? dpRefundRequestsFromCases(caseRows)
        : dpRequests ?? {
            total: 0,
            by_campus: { SSAHE: 0, ADYPU: 0 },
            refunded_by_campus: { SSAHE: 0, ADYPU: 0 },
          };

  return [
    { label: 'DP refund request — Total', value: data.total ?? 0, primary: true },
    { label: 'DP refund request — SSAHE', value: data.by_campus?.SSAHE ?? 0 },
    { label: 'DP refund request — ADYPU', value: data.by_campus?.ADYPU ?? 0 },
    { label: 'DP refunded — SSAHE', value: data.refunded_by_campus?.SSAHE ?? 0 },
    { label: 'DP refunded — ADYPU', value: data.refunded_by_campus?.ADYPU ?? 0 },
  ];
}
