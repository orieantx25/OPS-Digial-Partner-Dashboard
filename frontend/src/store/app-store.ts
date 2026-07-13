import { create } from 'zustand';
import { useMemo } from 'react';
import { FilterParams, UserInfo } from '@/types';

interface AppState {
  user: UserInfo | null;
  token: string | null;
  filters: FilterParams;
  drillDown: { partner?: string; state?: string; city?: string };
  globalSearch: string;
  setUser: (user: UserInfo | null, token?: string | null) => void;
  setFilters: (filters: Partial<FilterParams>) => void;
  resetFilters: () => void;
  setDrillDown: (drill: Partial<AppState['drillDown']>) => void;
  clearDrillDown: () => void;
  setGlobalSearch: (search: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  filters: {},
  drillDown: {},
  globalSearch: '',
  setUser: (user, token) => {
    if (token) localStorage.setItem('dp_token', token);
    if (token === null) localStorage.removeItem('dp_token');
    set({ user, token: token ?? null });
  },
  setFilters: (filters) =>
    set((s) => {
      const next = { ...s.filters, ...filters };
      // Drop cleared keys so stale undefined values do not linger.
      for (const [key, value] of Object.entries(filters)) {
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        ) {
          delete next[key as keyof FilterParams];
        }
      }
      return { filters: next };
    }),
  resetFilters: () => set({ filters: {}, globalSearch: '', drillDown: {} }),
  setDrillDown: (drill) =>
    set((s) => ({ drillDown: { ...s.drillDown, ...drill } })),
  clearDrillDown: () => set({ drillDown: {} }),
  setGlobalSearch: (globalSearch) => set({ globalSearch }),
}));

export function getEffectiveFilters(): FilterParams {
  const { filters, drillDown, globalSearch } = useAppStore.getState();
  const hasDateRange = Boolean(filters.date_from || filters.date_to);
  return {
    ...filters,
    ...(hasDateRange
      ? { month: undefined, year: undefined, week: undefined, quarter: undefined }
      : {}),
    partner: drillDown.partner ? [drillDown.partner] : filters.partner,
    state: drillDown.state ? [drillDown.state] : filters.state,
    city: drillDown.city ? [drillDown.city] : filters.city,
    search: globalSearch || filters.search,
  };
}

/** Subscribe to store so dashboards refetch when the top filter bar changes. */
export function useEffectiveFilters(): FilterParams {
  const filters = useAppStore((s) => s.filters);
  const drillDown = useAppStore((s) => s.drillDown);
  const globalSearch = useAppStore((s) => s.globalSearch);
  return useMemo(
    () => getEffectiveFilters(),
    [filters, drillDown, globalSearch]
  );
}
