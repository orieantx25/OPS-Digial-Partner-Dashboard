'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilterParams } from '@/types';
import { useUploadStore } from '@/store/upload-store';

interface UseFetchOptions<T> {
  fetcher: () => Promise<T>;
  deps?: unknown[];
  enabled?: boolean;
}

export function useFetch<T>({ fetcher, deps = [], enabled = true }: UseFetchOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, dataRefreshToken, ...deps]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useFilterKey(filters: FilterParams): string {
  return JSON.stringify(filters);
}
