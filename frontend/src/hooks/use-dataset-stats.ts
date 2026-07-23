'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useUploadStore } from '@/store/upload-store';

type Stats = { total_rows: number; has_data: boolean };

let sharedStats: Stats | null = null;
let sharedToken = -1;
let sharedPromise: Promise<Stats> | null = null;

function loadStats(token: number): Promise<Stats> {
  if (sharedPromise && sharedToken === token) return sharedPromise;
  sharedToken = token;
  sharedPromise = api
    .getStats()
    .then((stats) => {
      sharedStats = stats;
      return stats;
    })
    .catch(() => {
      const empty = { total_rows: 0, has_data: false };
      sharedStats = empty;
      return empty;
    });
  return sharedPromise;
}

/** Shared across AppShell + Overview so /stats is only hit once per refresh. */
export function useDatasetStats() {
  const [totalRows, setTotalRows] = useState<number>(sharedStats?.total_rows ?? 0);
  const [hasData, setHasData] = useState<boolean>(sharedStats?.has_data ?? false);
  const [loading, setLoading] = useState(!sharedStats);
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);

  useEffect(() => {
    let active = true;
    if (!sharedStats || sharedToken !== dataRefreshToken) {
      setLoading(true);
    }
    loadStats(dataRefreshToken).then((stats) => {
      if (!active) return;
      setTotalRows(stats.total_rows);
      setHasData(stats.has_data && stats.total_rows > 0);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [dataRefreshToken]);

  return { totalRows, hasData, loading };
}
