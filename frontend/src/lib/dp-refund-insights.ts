import { CampusBifurcation, ChartData } from '@/types';
import { formatNumber } from '@/lib/utils';

export type InsightItem = { text: string };

/** Build insight bullets about digital partner refunds for overview / funnel strips. */
export function dpRefundInsightItems(
  campus?: CampusBifurcation | null,
  partnerComparison?: ChartData | undefined
): InsightItem[] {
  const items: InsightItem[] = [];
  const refund = campus?.refund_summary;
  const dpRequests = refund?.dp_refund_requests;

  if (partnerComparison?.series?.some((s) => s.name === 'DP Refunds')) {
    const refundSeries =
      partnerComparison.series.find((s) => s.name === 'DP Refunds')?.data ?? [];
    const categories = partnerComparison.categories ?? [];
    const totalDpRefunds = refundSeries.reduce((sum, v) => sum + Number(v || 0), 0);

    if (totalDpRefunds > 0) {
      items.push({
        text: `${formatNumber(totalDpRefunds)} digital partner refund(s) excluded from block ROI bars.`,
      });

      const partnersWithRefunds = categories
        .map((partner, i) => ({
          partner: String(partner),
          count: Number(refundSeries[i] || 0),
        }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count || a.partner.localeCompare(b.partner));

      if (partnersWithRefunds.length > 0) {
        const top = partnersWithRefunds[0];
        items.push({
          text: `Most DP refunds: ${top.partner} (${formatNumber(top.count)}).`,
        });
        if (partnersWithRefunds.length > 1) {
          items.push({
            text: `${formatNumber(partnersWithRefunds.length)} partner(s) have DP refunds on block-paid leads.`,
          });
        }
      }
    }
  }

  if (dpRequests && (dpRequests.total ?? 0) > 0) {
    const ssaheReq = dpRequests.by_campus?.SSAHE ?? 0;
    const adypuReq = dpRequests.by_campus?.ADYPU ?? 0;
    items.push({
      text: `DP refund requests: ${formatNumber(dpRequests.total ?? 0)} (SSAHE ${formatNumber(ssaheReq)}, ADYPU ${formatNumber(adypuReq)}).`,
    });

    const ssaheRef = dpRequests.refunded_by_campus?.SSAHE ?? 0;
    const adypuRef = dpRequests.refunded_by_campus?.ADYPU ?? 0;
    const refundedTotal = ssaheRef + adypuRef;
    if (refundedTotal > 0) {
      items.push({
        text: `DP refunded — SSAHE ${formatNumber(ssaheRef)}, ADYPU ${formatNumber(adypuRef)}.`,
      });
    }
  } else if ((refund?.digital_partner_refund_cases ?? 0) > 0) {
    items.push({
      text: `${formatNumber(refund?.digital_partner_refund_cases ?? 0)} digital partner refund case(s) on the refund sheet.`,
    });
  }

  const refundsApplied = refund?.refunds_applied_by_campus;
  if (refundsApplied) {
    const ssaheApplied = refundsApplied.SSAHE ?? 0;
    const adypuApplied = refundsApplied.ADYPU ?? 0;
    const appliedTotal = ssaheApplied + adypuApplied;
    if (appliedTotal > 0) {
      items.push({
        text: `Refunds applied to block sheet — SSAHE ${formatNumber(ssaheApplied)}, ADYPU ${formatNumber(adypuApplied)}.`,
      });
    }
  }

  return items;
}
