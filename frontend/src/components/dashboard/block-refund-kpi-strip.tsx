'use client';

import { cn, formatNumber } from '@/lib/utils';

export interface BlockRefundKpiStripProps {
  activeBlock?: number;
  grossBlock?: number;
  refundsApplied?: number;
  unassignedCount?: number;
  dpRefundOverlap?: number;
  className?: string;
}

/** Shared KPI strip — active (refund-adjusted) block as primary with gross/refund context. */
export function BlockRefundKpiStrip({
  activeBlock = 0,
  grossBlock = 0,
  refundsApplied = 0,
  unassignedCount = 0,
  dpRefundOverlap,
  className = 'max-w-5xl',
}: BlockRefundKpiStripProps) {
  const removed = Math.max(0, grossBlock - activeBlock);
  const showUnassigned = unassignedCount > 0;
  const showDpOverlap = typeof dpRefundOverlap === 'number';

  return (
    <div
      className={cn(
        'panel grid grid-cols-2 gap-px bg-border md:grid-cols-4',
        showUnassigned && showDpOverlap && 'lg:grid-cols-5',
        className
      )}
    >
      <div className="bg-surface px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-text-secondary">
          Active block
        </div>
        <div className="text-lg font-semibold text-primary kpi-value mt-1">
          {formatNumber(activeBlock)}
        </div>
        {removed > 0 && (
          <div className="text-[10px] text-text-secondary mt-0.5">
            {formatNumber(removed)} removed from sheet
          </div>
        )}
      </div>
      <div className="bg-surface px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-text-secondary">
          Total block payment received
        </div>
        <div className="text-lg font-semibold text-text kpi-value mt-1">
          {formatNumber(grossBlock)}
        </div>
      </div>
      <div className="bg-surface px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-text-secondary">
          Refunds applied
        </div>
        <div className="text-lg font-semibold text-text kpi-value mt-1">
          {formatNumber(refundsApplied)}
        </div>
      </div>
      {showDpOverlap && (
        <div className="bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            DP refund overlap
          </div>
          <div className="text-lg font-semibold text-primary kpi-value mt-1">
            {formatNumber(dpRefundOverlap)}
          </div>
        </div>
      )}
      {showUnassigned && (
        <div className="bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Unassigned rows
          </div>
          <div className="text-lg font-semibold text-text kpi-value mt-1">
            {formatNumber(unassignedCount)}
          </div>
          <div className="text-[10px] text-text-secondary mt-0.5">
            Missing campus or gender
          </div>
        </div>
      )}
    </div>
  );
}
