import { create } from 'zustand';

interface LeadExplorerState {
  isOpen: boolean;
  filterKey: string | null;
  filterLabel: string;
  openExplorer: (label: string, filterKey?: string | null) => void;
  closeExplorer: () => void;
}

export const useLeadExplorerStore = create<LeadExplorerState>((set) => ({
  isOpen: false,
  filterKey: null,
  filterLabel: '',
  openExplorer: (filterLabel, filterKey = null) =>
    set({ isOpen: true, filterLabel, filterKey: filterKey ?? null }),
  closeExplorer: () => set({ isOpen: false, filterKey: null, filterLabel: '' }),
}));
