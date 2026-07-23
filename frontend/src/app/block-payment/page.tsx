'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, CheckCircle, Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { useFetch } from '@/hooks/use-fetch';
import { DataTable } from '@/components/tables/data-table';
import { IndiaMap } from '@/components/charts/india-map';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { BlockPaymentTrackingRow } from '@/types';
import { cn, formatNumber } from '@/lib/utils';

type UploadStep = 'idle' | 'uploading' | 'done' | 'error';

function formatMatchStatus(status: string): string {
  if (status === 'matched') return 'Matched';
  if (status === 'unmatched') return 'Not in sheet';
  if (status === 'no_sheet') return 'No sheet uploaded';
  return status;
}

function isCounsellorPaymentSource(value: unknown): boolean {
  return String(value ?? '').toLowerCase().includes('counsell');
}

export default function BlockPaymentPage() {
  // No global filter bar on this page — always show full reconciliation set.
  const filters = useMemo(() => ({}), []);

  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetRefresh, setSheetRefresh] = useState(0);

  const { data: sheetStatus, refetch: refetchStatus } = useFetch({
    fetcher: () => api.getBlockPaymentStatus(),
    deps: [sheetRefresh],
  });

  const { data: backtracking, loading, refetch: refetchBacktracking } = useFetch({
    fetcher: () => api.getBlockPaymentBacktracking(filters),
    deps: [JSON.stringify(filters), sheetRefresh],
  });

  const uploadFile = useCallback(async (file: File) => {
    setUploadStep('uploading');
    setUploadError(null);
    setUploadMessage(null);
    try {
      const result = await api.uploadBlockPaymentSheet(file);
      setUploadMessage(result.message);
      setUploadStep('done');
      setSheetRefresh((n) => n + 1);
      refetchStatus();
      refetchBacktracking();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
      setUploadStep('error');
    }
  }, [refetchBacktracking, refetchStatus]);

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

  const columns: ColumnDef<BlockPaymentTrackingRow>[] = useMemo(
    () => [
      { accessorKey: 'prospect_id', header: 'ID', meta: { width: '8%' } },
      { accessorKey: 'partner', header: 'Partner', meta: { width: '10%' } },
      { accessorKey: 'name', header: 'Name', meta: { width: '12%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '14%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '10%' } },
      { accessorKey: 'contact_source', header: 'DP Source', meta: { width: '10%' } },
      {
        accessorKey: 'source_at_payment',
        header: 'Payment Source',
        meta: { width: '11%' },
        cell: ({ getValue }) => {
          const value = String(getValue() || '—');
          const highlighted = isCounsellorPaymentSource(value);
          return (
            <span
              className={cn(
                highlighted && 'inline-block px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-300 font-medium'
              )}
            >
              {value}
            </span>
          );
        },
      },
      { accessorKey: 'campaign_at_payment', header: 'Payment Campaign', meta: { width: '12%' } },
      { accessorKey: 'campus', header: 'Campus', meta: { width: '8%' } },
      {
        accessorKey: 'match_status',
        header: 'Match',
        meta: { width: '9%' },
        cell: ({ getValue, row }) => {
          const status = String(getValue() || '');
          const method = row.original.match_method;
          return (
            <span
              className={cn(
                'text-xs',
                status === 'matched' ? 'text-emerald-400' : 'text-amber-400'
              )}
            >
              {formatMatchStatus(status)}
              {method ? ` · ${method}` : ''}
            </span>
          );
        },
      },
    ],
    []
  );

  const rows = backtracking?.rows ?? [];
  const clashRows = backtracking?.clash_rows ?? [];
  const matchedCount = backtracking?.matched_count ?? 0;
  const unmatchedCount = backtracking?.unmatched_count ?? 0;
  const clashCount = backtracking?.clash_count ?? 0;
  const totalBlockPaid = backtracking?.total_block_paid ?? 0;
  const uploadsEnabled = canUpload();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Block Payment Back tracking"
        totalRows={totalBlockPaid > 0 ? totalBlockPaid : undefined}
      />

      <SectionHeader
        title="Block Amount Paid Sheet"
        subtitle={uploadsEnabled ? undefined : 'View-only — sheet is refreshed by an admin'}
      />

      <div className="panel p-4 space-y-3">
        {sheetStatus?.has_data && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary border-b border-border pb-3">
            <span>
              <span className="text-text">{formatNumber(sheetStatus.row_count)}</span> rows loaded
            </span>
            {sheetStatus.source_filename && (
              <span>File: <span className="text-text">{sheetStatus.source_filename}</span></span>
            )}
            {sheetStatus.uploaded_at && (
              <span>
                Uploaded:{' '}
                <span className="text-text">
                  {new Date(sheetStatus.uploaded_at).toLocaleString()}
                </span>
              </span>
            )}
          </div>
        )}

        {uploadsEnabled && uploadStep === 'uploading' && (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading block amount paid sheet…
          </div>
        )}

        {uploadsEnabled && (uploadStep === 'done' || uploadStep === 'error') && (
          <div
            className={cn(
              'flex items-start gap-2 text-sm p-3 border',
              uploadStep === 'done'
                ? 'border-emerald-500/30 text-emerald-400'
                : 'border-red-500/30 text-red-400'
            )}
          >
            {uploadStep === 'done' ? (
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div>
              <p>{uploadStep === 'done' ? uploadMessage : uploadError}</p>
              <button
                type="button"
                className="text-xs underline mt-1 opacity-80 hover:opacity-100"
                onClick={() => {
                  setUploadStep('idle');
                  setUploadError(null);
                  setUploadMessage(null);
                }}
              >
                Upload another file
              </button>
            </div>
          </div>
        )}

        {uploadsEnabled && uploadStep === 'idle' && (
          <div
            className={cn(
              'border border-dashed rounded-sm p-8 text-center transition-colors cursor-pointer',
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
              if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
          >
            <Upload className="w-8 h-8 mx-auto text-text-secondary mb-2" />
            <p className="text-sm text-text">Drop block amount paid sheet here</p>
            <p className="text-xs text-text-secondary mt-1">
              Excel or CSV · replaces any previously uploaded sheet on this tab
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {!uploadsEnabled && !sheetStatus?.has_data && (
          <p className="text-sm text-text-secondary">
            No block payment sheet loaded yet. An admin must upload it from the local app.
          </p>
        )}
      </div>

      <SectionHeader
        title="Reconciliation"
        subtitle="Block amount paid leads from main dataset matched to payment sheet by email, then phone"
      />

      <div className="panel grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
        {[
          { label: 'Block Paid (Main)', value: totalBlockPaid, highlight: false },
          { label: 'Sheet Rows', value: sheetStatus?.row_count ?? 0, highlight: false },
          { label: 'Matched', value: matchedCount, highlight: false },
          { label: 'Not in Sheet', value: unmatchedCount, highlight: false },
          {
            label: 'Partner Clashes',
            value: clashCount,
            highlight: true,
          },
        ].map(({ label, value, highlight }) => (
          <div
            key={label}
            className={cn(
              'bg-surface px-4 py-3',
              highlight && 'ring-1 ring-inset ring-amber-500/50 bg-amber-500/5'
            )}
          >
            <div
              className={cn(
                'text-[10px] uppercase tracking-widest',
                highlight ? 'text-amber-300' : 'text-text-secondary'
              )}
            >
              {label}
            </div>
            <div
              className={cn(
                'text-lg font-semibold kpi-value mt-1',
                highlight ? 'text-amber-300' : 'text-text'
              )}
            >
              {formatNumber(value)}
            </div>
          </div>
        ))}
      </div>

      {loading && !backtracking ? (
        <p className="text-text-secondary text-sm">Loading reconciliation…</p>
      ) : !sheetStatus?.has_data ? (
        <p className="text-text-secondary text-sm panel p-4">
          {uploadsEnabled
            ? 'Upload a block amount paid sheet above to reconcile payment source, campaign, and campus against block-paid leads in the main dataset.'
            : 'Reconciliation will appear once an admin uploads a block amount paid sheet.'}
        </p>
      ) : (
        <DataTable
          data={rows as BlockPaymentTrackingRow[]}
          columns={columns}
          exportFilename="block-payment-backtracking.csv"
          searchPlaceholder="Search leads…"
          height={480}
        />
      )}

      {sheetStatus?.has_data && (
        <>
          <SectionHeader
            title="Partner Counsellor Clashes"
            subtitle="Partner-attributed block paid leads where payment source is Counsellor (from backtracking sheet)"
          />
          {clashCount > 0 ? (
            <DataTable
              data={clashRows as BlockPaymentTrackingRow[]}
              columns={columns}
              exportFilename="block-payment-clashes.csv"
              searchPlaceholder="Search clashes…"
              height={320}
            />
          ) : (
            <p className="text-text-secondary text-sm panel p-4">
              No partner counsellor clashes in the backtracking data.
            </p>
          )}
        </>
      )}

      <SectionHeader
        title="Block Amount by State"
        subtitle="India map of block amount paid leads from the main dataset"
      />
      <IndiaMap
        data={backtracking?.state_summary ?? []}
        dimension="leads"
        dimensionLabel="Block Amount Paid"
        height={520}
      />
    </div>
  );
}
