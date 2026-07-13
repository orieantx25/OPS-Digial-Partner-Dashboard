import { create } from 'zustand';

interface UploadStore {
  isOpen: boolean;
  dataRefreshToken: number;
  openUpload: () => void;
  closeUpload: () => void;
  bumpDataRefresh: () => void;
}

export const useUploadStore = create<UploadStore>((set) => ({
  isOpen: false,
  dataRefreshToken: 0,
  openUpload: () => set({ isOpen: true }),
  closeUpload: () => set({ isOpen: false }),
  bumpDataRefresh: () =>
    set((s) => ({ dataRefreshToken: s.dataRefreshToken + 1 })),
}));
