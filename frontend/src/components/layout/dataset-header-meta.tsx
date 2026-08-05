'use client';

import { useEffect, useState } from 'react';
import { LeadSquaredSyncButton } from '@/components/sync/leadsquared-sync-button';
import { useDatasetStats } from '@/hooks/use-dataset-stats';
import { api } from '@/lib/api';
import {
  formatAsOfDate,
  formatSyncTime,
  parseYmd,
} from '@/lib/format-dataset-dates';
import { isStaticDataMode, type SnapshotManifest } from '@/lib/static-mode';
import { useUploadStore } from '@/store/upload-store';
import { FilterParams } from '@/types';
import { formatNumber } from '@/lib/utils';

const LSQ_SYNC_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LSQ_SYNC === 'true';

function MetaCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-text-secondary leading-none">
        {label}
      </span>
      <span className="text-sm font-semibold text-text tabular-nums leading-tight truncate">
        {value}
      </span>
      {sub ? (
        <span className="text-[10px] text-text-secondary/60 tabular-nums leading-tight">
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function DatasetHeaderMeta({
  filters,
  manifest,
  showSyncButton,
}: {
  filters: FilterParams;
  manifest: SnapshotManifest | null;
  showSyncButton: boolean;
}) {
  const staticMode = isStaticDataMode();
  const { totalRows } = useDatasetStats();
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const publishedAt = manifest?.published_at ?? null;

  useEffect(() => {
    if (staticMode) return;
    let active = true;
    api
      .getLsqSyncLastRun()
      .then((last) => {
        if (!active) return;
        const at = last?.completed_at || last?.started_at;
        setLastSyncAt(at ?? null);
      })
      .catch(() => {
        if (active) setLastSyncAt(null);
      });
    return () => {
      active = false;
    };
  }, [staticMode, dataRefreshToken]);

  const asOfDate = (() => {
    if (filters.date_to) return parseYmd(filters.date_to);
    if (publishedAt) return new Date(publishedAt);
    return new Date();
  })();

  const cycleYear = asOfDate.getFullYear();
  const syncSource = staticMode && publishedAt ? publishedAt : lastSyncAt;
  const syncTimeLabel = syncSource ? `Synced ${formatSyncTime(syncSource)}` : null;

  return (
    <div className="flex items-end gap-4 sm:gap-5 shrink-0 pr-2 border-r border-border/60">
      {showSyncButton && LSQ_SYNC_ENABLED && (
        <LeadSquaredSyncButton variant="header" syncLabel="Sync sheet" />
      )}
      <MetaCell label="Cycle" value={`${cycleYear} Cycle`} />
      <MetaCell
        label="As of"
        value={formatAsOfDate(asOfDate)}
        sub={syncTimeLabel}
      />
      <MetaCell label="Records" value={formatNumber(totalRows)} />
    </div>
  );
}
