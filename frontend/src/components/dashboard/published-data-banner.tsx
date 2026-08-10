'use client';

import { useEffect, useState } from 'react';
import { getSnapshotManifest, isStaticDataMode } from '@/lib/static-mode';

function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Leadership static deploy: show snapshot freshness, or warn if missing. */
export function PublishedDataBanner() {
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isStaticDataMode()) return;
    let active = true;
    getSnapshotManifest().then((m) => {
      if (!active) return;
      if (m?.published_at) {
        setPublishedAt(m.published_at);
        setMissing(false);
      } else {
        setPublishedAt(null);
        setMissing(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isStaticDataMode()) return null;

  if (missing) {
    return (
      <div className="mb-3 px-3 py-2 text-xs border border-border bg-surface text-text-secondary leading-snug">
        No published snapshot. Re-publish from local, then redeploy.
      </div>
    );
  }

  if (!publishedAt) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
      <span className="uppercase tracking-widest text-[10px]">Report updated</span>
      <span className="text-text">
        As of {formatAsOf(publishedAt)}
      </span>
    </div>
  );
}
