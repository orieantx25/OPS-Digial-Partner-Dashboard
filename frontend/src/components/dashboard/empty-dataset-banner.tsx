'use client';

import { Upload } from 'lucide-react';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { useUploadStore } from '@/store/upload-store';

interface EmptyDatasetBannerProps {
  totalRows?: number;
}

export function EmptyDatasetBanner({ totalRows = 0 }: EmptyDatasetBannerProps) {
  const openUpload = useUploadStore((s) => s.openUpload);
  const uploadsEnabled = canUpload();

  if (totalRows > 0) return null;

  return (
    <div className="mb-4 panel border-l-4 border-l-primary p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-text">No data yet</div>
        <div className="text-text-secondary text-sm mt-1">
          {uploadsEnabled
            ? 'Upload Excel or CSV workbooks to populate the dashboard.'
            : 'This is a view-only dashboard. Data is refreshed by an admin — check back later.'}
        </div>
      </div>
      {uploadsEnabled && (
        <button type="button" onClick={openUpload} className="btn-primary flex items-center gap-2 shrink-0">
          <Upload className="w-4 h-4" />
          Upload
        </button>
      )}
    </div>
  );
}
