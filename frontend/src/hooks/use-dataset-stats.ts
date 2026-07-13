'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useUploadStore } from '@/store/upload-store';

export function useDatasetStats() {
  const [totalRows, setTotalRows] = useState<number>(0);
  const [hasData, setHasData] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getStats()
      .then((stats) => {
        if (!active) return;
        setTotalRows(stats.total_rows);
        setHasData(stats.has_data && stats.total_rows > 0);
      })
      .catch(() => {
        if (!active) return;
        setTotalRows(0);
        setHasData(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataRefreshToken]);

  return { totalRows, hasData, loading };
}
