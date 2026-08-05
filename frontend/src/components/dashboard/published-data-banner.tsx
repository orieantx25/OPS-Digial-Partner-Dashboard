'use client';

import { useEffect, useState } from 'react';
import { getSnapshotManifest, isStaticDataMode } from '@/lib/static-mode';

/** Warn when leadership static deploy has no snapshot bundle. */
export function PublishedDataBanner() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isStaticDataMode()) return;
    let active = true;
    getSnapshotManifest().then((m) => {
      if (!active) return;
      setMissing(!m?.published_at);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isStaticDataMode() || !missing) return null;

  return (
    <div className="mb-3 px-3 py-2 text-xs border border-border bg-surface text-text-secondary leading-snug">
      No published snapshot. Re-publish from local, then redeploy.
    </div>
  );
}
