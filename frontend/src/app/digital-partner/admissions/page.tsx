'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, CheckCircle, Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { useFetch } from '@/hooks/use-fetch';
import { useChartHeight } from '@/hooks/use-chart-height';
import { DataTable } from '@/components/tables/data-table';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { DpAdmissionRow } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';

const ChartPanel = dynamic(
  () => import('@/components/charts/chart-panel').then((m) => m.ChartPanel),
  { ssr: false, loading: () => <div className="panel h-[220px] animate-pulse" /> }
);

type UploadStep = 'idle' | 'uploading' | 'done' | 'error';

export default function AdmissionsPage() {
  const leadership = isLeadershipMode();
  const filters = useMemo(() => ({}), []);
  const chartH = useChartHeight(240, 200);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetRefresh, setSheetRefresh] = useState(0);

  const { data: sheetStatus, refetch: refetchStatus } = useFetch({
    fetcher: () => api.getAdmissionsStatus(),
    deps: [sheetRefresh],
  });

  const { data, loading, refetch } = useFetch({
    fetcher: () => api.getDpAdmissions(filters),
    deps: [sheetRefresh],
  });

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadStep('uploading');
      setUploadError(null);
      setUploadMessage(null);
      try {
        const result = await api.uploadAdmissionsSheet(file);
        setUploadMessage(result.message);
        setUploadStep('done');
        setSheetRefresh((n) => n + 1);
        refetchStatus();
        refetch();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Upload failed');
        setUploadStep('error');
      }
    },
    [refetch, refetchStatus]
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

  const rows = data?.rows ?? [];

  const columns: ColumnDef<DpAdmissionRow>[] = useMemo(
    () => [
      { accessorKey: 'sheet_id', header: 'ID', meta: { width: '8%' } },
      { accessorKey: 'email', header: 'Email', meta: { width: '16%' } },
      { accessorKey: 'phone', header: 'Phone', meta: { width: '10%' } },
      { accessorKey: 'lead_name', header: 'Lead', meta: { width: '12%' } },
      { accessorKey: 'partner', header: 'Partner', meta: { width: '14%' } },
      { accessorKey: 'campus_code', header: 'Campus', meta: { width: '10%' } },
      { accessorKey: 'amount_inr', header: 'Amount', meta: { width: '10%' } },
      { accessorKey: 'paid_at', header: 'Paid at', meta: { width: '12%' } },
      { accessorKey: 'status', header: 'Status', meta: { width: '8%' } },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Admissions" />

      {canUpload() && (
        <div className="panel p-4 space-y-3">
          <SectionHeader
            title="Admissions sheets"
            subtitle={
              sheetStatus?.public_csv_configured || sheetStatus?.google_configured
                ? 'Auto-refreshes on Sync LSQ from Fee Verification Google workbook (All Payments + LMS). Manual All Payments upload also supported.'
                : 'Upload All Payments Excel/CSV, or configure Google admissions sheet sync'
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
              Drop admissions sheet or click to upload
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
        </div>
      )}

      {(sheetStatus?.has_data || sheetStatus?.has_lms) && (
        <p className="text-xs text-text-secondary border border-border/60 bg-surface/50 px-3 py-2 rounded-sm">
          Payments: {formatNumber(sheetStatus?.row_count ?? 0)} rows ·{' '}
          {formatNumber(sheetStatus?.paid_count ?? 0)} paid ·{' '}
          {sheetStatus?.source_filename ?? 'upload'}
          {sheetStatus?.has_lms
            ? ` · LMS: ${formatNumber(sheetStatus.lms_row_count ?? 0)} · ${formatNumber(sheetStatus.verified_count ?? 0)} verified`
            : ''}{' '}
          · {sheetStatus?.uploaded_at ?? '—'}
          {sheetStatus?.google_configured || sheetStatus?.public_csv_configured
            ? ` · Sync: ${sheetStatus?.public_csv_configured ? 'Public CSV' : 'Service account'}`
            : ''}
          . Matched paid rows promote DP LSQ leads to Admission on the executive funnel.
        </p>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel h-[88px] border border-border animate-pulse" />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="panel p-4 border border-border">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Sem1 verified (LMS)
          </div>
          <div className="text-2xl font-semibold mt-1 text-green-500">
            {formatNumber(data?.verified_sem1 ?? sheetStatus?.verified_count ?? 0)}
          </div>
        </div>
        <div className="panel p-4 border border-border">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Paid on payments sheet
          </div>
          <div className="text-2xl font-semibold mt-1">
            {formatNumber(data?.total_paid ?? sheetStatus?.paid_count ?? 0)}
          </div>
        </div>
        <div className="panel p-4 border border-border">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            DP matched
          </div>
          <div className="text-2xl font-semibold mt-1">
            {formatNumber(data?.dp_matched ?? 0)}
          </div>
        </div>
        <div className="panel p-4 border border-border">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">
            Partners
          </div>
          <div className="text-2xl font-semibold mt-1">
            {formatNumber(data?.by_partner?.length ?? 0)}
          </div>
        </div>
      </div>
      )}

      {(data?.fee_status?.status_chart || data?.partner_chart) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data?.fee_status?.status_chart &&
            (data.fee_status.status_chart.categories?.length ?? 0) > 0 && (
              <section className="space-y-3 panel p-4 border border-border">
                <SectionHeader title="LMS fee status" subtitle="Semester 1" />
                <ChartPanel chart={data.fee_status.status_chart} height={chartH} />
              </section>
            )}
          {data?.partner_chart && (data.partner_chart.categories?.length ?? 0) > 0 && (
            <section className="space-y-3 panel p-4 border border-border">
              <SectionHeader
                title="By partner"
                subtitle="Paid admissions matched to DP leads"
              />
              <ChartPanel chart={data.partner_chart} height={chartH} />
            </section>
          )}
        </div>
      )}

      <SectionHeader
        title="DP admissions"
        subtitle={
          leadership
            ? `${formatNumber(data?.dp_matched ?? 0)} matched · partner totals only on leadership`
            : `${formatNumber(rows.length)} rows · email/phone match to digital-partner LSQ leads`
        }
      />

      {loading && !data ? (
        <p className="text-text-secondary text-sm">Loading...</p>
      ) : leadership ? (
        <p className="text-sm text-text-secondary border border-border/60 bg-surface/50 px-3 py-2 rounded-sm">
          Leadership view shows Sem1 LMS fee status and partner-matched admission totals.
          Student-level rows are omitted from published snapshots.
        </p>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          exportFilename="dp_admissions.csv"
          searchPlaceholder="Search email, partner, campus…"
          height="auto"
        />
      )}
    </div>
  );
}
