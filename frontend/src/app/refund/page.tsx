'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, CheckCircle, Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { useFetch } from '@/hooks/use-fetch';
import { DataTable } from '@/components/tables/data-table';
import { RefundKpiRows } from '@/components/dashboard/refund-kpi-rows';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { RefundCaseRow } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';

type UploadStep = 'idle' | 'uploading' | 'done' | 'error';

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        active ? 'bg-primary/15 text-primary' : 'bg-border text-text-secondary'
      )}
    >
      {label}
    </span>
  );
}

export default function RefundPage() {
  const leadership = isLeadershipMode();
  const filters = useMemo(() => ({}), []);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetRefresh, setSheetRefresh] = useState(0);

  const { data: sheetStatus, refetch: refetchStatus } = useFetch({
    fetcher: () => api.getRefundStatus(),
    deps: [sheetRefresh],
  });

  const { data: campus, refetch: refetchCampus } = useFetch({
    fetcher: () => api.getCampusBifurcation(filters),
    deps: [sheetRefresh],
  });

  const { data: cases, loading, refetch: refetchCases } = useFetch({
    fetcher: () => api.getRefundCases(filters, 1, 500),
    deps: [JSON.stringify(filters), sheetRefresh],
  });

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadStep('uploading');
      setUploadError(null);
      setUploadMessage(null);
      try {
        const result = await api.uploadRefundSheet(file);
        setUploadMessage(result.message);
        setUploadStep('done');
        setSheetRefresh((n) => n + 1);
        refetchStatus();
        refetchCases();
        refetchCampus();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Upload failed');
        setUploadStep('error');
      }
    },
    [refetchCases, refetchCampus, refetchStatus]
  );

  const handleFiles = (incoming: FileList | File[]) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const file = Array.from(incoming).find((f) =>
      allowed.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (!file) {
      setUploadError('Use an Excel (.xlsx, .xls) or CSV file.');
      setUploadStep('error');
      return;
    }
    uploadFile(file);
  };

  const rows = cases?.items ?? [];

  const columns: ColumnDef<RefundCaseRow>[] = useMemo(
    () => [
      { accessorKey: 'serial_no', header: 'S No.', meta: { width: '6%' } },
      { accessorKey: 'student_name', header: 'Student', meta: { width: '12%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '12%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '9%' } },
      { accessorKey: 'campus', header: 'Campus', meta: { width: '10%' } },
      {
        accessorKey: 'status_finance',
        header: 'Finance Status',
        meta: { width: '10%' },
      },
      {
        accessorKey: 'final_status',
        header: 'Final Status',
        meta: { width: '10%' },
        cell: ({ row }) => (
          <StatusBadge
            active={row.original.is_refund}
            label={String(row.original.final_status || '—')}
          />
        ),
      },
      {
        id: 'flags',
        header: 'Flags',
        meta: { width: '14%' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.matched_to_block_payment && (
              <StatusBadge active label="Block sheet" />
            )}
            {row.original.is_digital_partner_block_paid && (
              <StatusBadge active label="DP block paid" />
            )}
          </div>
        ),
      },
      {
        accessorKey: 'matched_campus_code',
        header: 'Matched campus',
        meta: { width: '8%' },
      },
      { accessorKey: 'utr', header: 'UTR', meta: { width: '9%' } },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Refund Cases" />

      {canUpload() && (
        <div className="panel p-4 space-y-3">
          <SectionHeader
            title="Refund sheet"
            subtitle={
              sheetStatus?.public_csv_configured
                ? 'Auto-refreshes on Sync LSQ from public Google Sheet CSV'
                : sheetStatus?.google_configured
                  ? 'Auto-refreshes on Sync LSQ from Google Sheets'
                  : 'Upload Excel/CSV or configure Google Sheet sync'
            }
          />
          <div
            className={cn(
              'border border-dashed rounded-md p-6 text-center cursor-pointer transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            {uploadStep === 'uploading' ? (
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            ) : (
              <Upload className="mx-auto h-8 w-8 text-text-secondary" />
            )}
            <p className="mt-2 text-sm text-text-secondary">
              Drop refund tracking sheet or click to upload
            </p>
          </div>
          {uploadMessage && (
            <p className="text-sm text-primary flex items-center gap-1">
              <CheckCircle className="h-4 w-4" />
              {uploadMessage}
            </p>
          )}
          {uploadError && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {uploadError}
            </p>
          )}
          {sheetStatus?.has_data && (
            <p className="text-xs text-text-secondary">
              {formatNumber(sheetStatus.row_count)} cases ·{' '}
              {sheetStatus.source_filename ?? 'upload'} · {sheetStatus.uploaded_at ?? '—'} ·
              Sync:{' '}
              {sheetStatus.public_csv_configured
                ? 'Public CSV'
                : sheetStatus.service_account_configured
                  ? 'Service account'
                  : sheetStatus.google_configured
                    ? 'Configured'
                    : 'Not configured'}
            </p>
          )}
        </div>
      )}

      <SectionHeader
        title="Refund cases"
        subtitle={`${formatNumber(sheetStatus?.row_count ?? cases?.total ?? 0)} total cases in sheet`}
      />

      <RefundKpiRows campus={campus} caseRows={rows} />

      {leadership && sheetStatus?.has_data && (
        <p className="text-xs text-text-secondary panel p-3">
          Snapshot: {formatNumber(sheetStatus.row_count)} cases ·{' '}
          {sheetStatus.source_filename ?? 'refund sheet'} · updated{' '}
          {sheetStatus.uploaded_at ?? '—'}. Open the ops dashboard for the searchable case
          list.
        </p>
      )}

      {!leadership && loading && !cases ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : !leadership ? (
        <DataTable
          data={rows}
          columns={columns}
          exportFilename="refund_cases.csv"
          searchPlaceholder="Search student, email, UTR, status…"
          height="auto"
        />
      ) : null}
    </div>
  );
}
