'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch, useDebouncedValue } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { useLeadExplorerStore } from '@/store/lead-explorer-store';
import { DataTable, useLeadColumns } from '@/components/tables/data-table';
import { formatNumber } from '@/lib/utils';
import { FilterParams } from '@/types';

export function LeadExplorerDrawer() {
  const { isOpen, filterKey, filterLabel, closeExplorer } = useLeadExplorerStore();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const columns = useLeadColumns();
  const baseFilters = useEffectiveFilters();

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen, filterKey]);

  const filters = useMemo((): FilterParams => {
    return {
      ...baseFilters,
      search: debouncedSearch || baseFilters.search,
      ...(filterKey ? { lead_filter: filterKey } : {}),
    };
  }, [baseFilters, filterKey, debouncedSearch]);

  const { data, loading } = useFetch({
    fetcher: () => api.search(filters, 1, 100),
    deps: [JSON.stringify(filters)],
    enabled: isOpen,
  });

  if (!isOpen) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/60"
        aria-label="Close Lead Explorer"
        onClick={closeExplorer}
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-5xl bg-bg border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-surface/50">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-text-secondary">Lead Explorer</div>
            <h2 className="text-lg font-semibold text-text">{filterLabel}</h2>
            {data && (
              <p className="text-xs text-text-secondary mt-0.5">
                {formatNumber(data.total)} matching leads
              </p>
            )}
          </div>
          <button type="button" className="btn-secondary p-2" onClick={closeExplorer} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-hidden">
          {loading && !data ? (
            <div className="h-full flex items-center justify-center text-text-secondary text-sm">
              Loading leads…
            </div>
          ) : (
            <DataTable
              data={(data?.items ?? []) as unknown as Record<string, unknown>[]}
              columns={columns}
              exportFilename={`leads-${filterKey || 'all'}.csv`}
              searchPlaceholder="Search ID, name, email, phone, partner, state..."
              searchValue={search}
              onSearchChange={setSearch}
              totalCount={data?.total}
              height={typeof window !== 'undefined' ? window.innerHeight - 160 : 600}
            />
          )}
        </div>
      </aside>
    </>
  );
}
