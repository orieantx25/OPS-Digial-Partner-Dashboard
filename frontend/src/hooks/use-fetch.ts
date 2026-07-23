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
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setIsFetching(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const isInitial = dataRef.current == null;
    if (isInitial) setLoading(true);
    setIsFetching(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      if (requestId !== requestIdRef.current) return;
      setData(result);
      dataRef.current = result;
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setIsFetching(false);
      }
    }
  }, [enabled, dataRefreshToken, ...deps]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, isFetching, error, refetch };
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
