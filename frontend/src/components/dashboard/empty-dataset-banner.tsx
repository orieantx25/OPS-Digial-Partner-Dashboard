'use client';

import { Upload } from 'lucide-react';
import { useUploadStore } from '@/store/upload-store';

interface EmptyDatasetBannerProps {
  totalRows?: number;
}

export function EmptyDatasetBanner({ totalRows = 0 }: EmptyDatasetBannerProps) {
  const openUpload = useUploadStore((s) => s.openUpload);

  if (totalRows > 0) return null;

  return (
    <div className="mb-4 panel border-l-4 border-l-primary p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-text">No data yet</div>
        <div className="text-text-secondary text-sm mt-1">
          Upload Excel or CSV workbooks to populate the dashboard.
        </div>
      </div>
      <button type="button" onClick={openUpload} className="btn-primary flex items-center gap-2 shrink-0">
        <Upload className="w-4 h-4" />
        Upload
      </button>
    </div>
  );
}
