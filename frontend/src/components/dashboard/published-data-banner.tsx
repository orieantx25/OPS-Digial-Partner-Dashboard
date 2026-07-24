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
    <div className="mb-3 px-3 py-2 text-xs border border-border bg-surface text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
      {missing ? (
        <span>
          No published snapshot. Re-publish from local, then redeploy.
        </span>
      ) : (
        <>
          <span className="uppercase tracking-wide text-[10px] text-text-secondary shrink-0">
            Data as of
          </span>
          <span className="text-text font-medium tabular-nums">
            {publishedAt
              ? new Date(publishedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '…'}
          </span>
        </>
      )}
    </div>
  );
}
