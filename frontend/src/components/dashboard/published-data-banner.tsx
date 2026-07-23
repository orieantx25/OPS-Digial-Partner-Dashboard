'use client';

import { useEffect, useState } from 'react';
import { getSnapshotManifest, isStaticDataMode } from '@/lib/static-mode';

export function PublishedDataBanner() {
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isStaticDataMode()) return;
    let active = true;
    getSnapshotManifest().then((m) => {
      if (!active) return;
      if (!m?.published_at) {
        setMissing(true);
        return;
      }
      setPublishedAt(m.published_at);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isStaticDataMode()) return null;

  return (
    <div className="mb-3 px-3 py-2 text-xs border border-border bg-surface text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1">
      {missing ? (
        <span>
          No published snapshot found. Run{' '}
          <code className="text-text">python backend/scripts/publish_snapshots.py</code> locally,
          then redeploy.
        </span>
      ) : (
        <>
          <span className="uppercase tracking-wide text-[10px] text-text-secondary">Data as of</span>
          <span className="text-text font-medium tabular-nums">
            {publishedAt
              ? new Date(publishedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '…'}
          </span>
          <span className="text-border">·</span>
          <span>Refresh by publishing from local and redeploying</span>
        </>
      )}
    </div>
  );
}
