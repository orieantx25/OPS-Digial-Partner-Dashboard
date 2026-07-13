'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, CheckCircle, Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { DataTable } from '@/components/tables/data-table';
import { ChartPanel } from '@/components/charts/chart-panel';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartData, PersonaSummary } from '@/types';
import { cn, formatNumber } from '@/lib/utils';
import { canUpload, loginUser } from '@/hooks/use-auth-bootstrap';

const SUMMARY_METRICS: { key: keyof PersonaSummary; label: string; accent?: boolean }[] = [
  { key: 'know_more_about_btech', label: 'Know More about B.Tech' },
  { key: 'other_persona', label: 'Other Persona' },
  { key: 'registration', label: 'Registration' },
  { key: 'offer_letter_sent', label: 'Offer Letter Sent' },
  {
    key: 'know_more_about_btech_last_24h',
    label: 'Know More about B.Tech (Last 24h)',
    accent: true,
  },
];

const EMPTY_CHART: ChartData = {
  chart_id: 'empty',
  chart_type: 'donut',
  title: '',
  categories: [],
  series: [{ name: 'Leads', data: [] }],
};

type UploadStep = 'idle' | 'uploading' | 'done' | 'error' | 'login';

export default function PersonaPage() {
  const filters = useEffectiveFilters();
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [username, setUsername] = useState('ops');
  const [password, setPassword] = useState('ops123');
  const [loginLoading, setLoginLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, refetch } = useFetch({
    fetcher: () => api.getPersona(filters),
    deps: [JSON.stringify(filters), sheetRefresh],
  });

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadStep('uploading');
      setUploadError(null);
      setUploadMessage(null);
      try {
        const result = await api.uploadPersonaActivitySheet(file);
        setUploadMessage(result.message);
        setUploadStep('done');
        setSheetRefresh((n) => n + 1);
        refetch();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        if (msg.toLowerCase().includes('write access') || msg.includes('403')) {
          setPendingFile(file);
          setUploadStep('login');
          setUploadError('Sign in with an Operations or Admin account to upload.');
        } else {
          setUploadError(msg);
          setUploadStep('error');
        }
      }
    },
    [refetch]
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
    if (!canUpload()) {
      setPendingFile(file);
      setUploadStep('login');
      return;
    }
    uploadFile(file);
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setUploadError(null);
    const ok = await loginUser(username, password);
    setLoginLoading(false);
    if (!ok) {
      setUploadError('Invalid username or password');
      return;
    }
    if (pendingFile) {
      const file = pendingFile;
      setPendingFile(null);
      uploadFile(file);
    } else {
      setUploadStep('idle');
    }
  };

  const columns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'persona', header: 'Persona' },
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'total', header: 'Total Leads' },
    { accessorKey: 'know_more', header: 'Know More' },
    { accessorKey: 'know_more_last_24h', header: 'Last 24h' },
    { accessorKey: 'app_started', header: 'App Started' },
    { accessorKey: 'test_registered', header: 'Registration' },
    { accessorKey: 'offer_letter', header: 'Offer Letter' },
    { accessorKey: 'fee_paid', header: 'Fee Paid' },
    { accessorKey: 'drop_off', header: 'Drop-off' },
  ];

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const charts = data?.charts;
  const activity = data?.activity_sheet;
  const total = summary?.know_more_about_btech ?? 0;
  const last24h = summary?.know_more_about_btech_last_24h ?? 0;
  const last24hShare = total > 0 ? (last24h / total) * 100 : 0;

  const matchHint = useMemo(() => {
    if (!activity?.has_data) {
      return (
        'Upload the persona activity report to fill Know More about B.Tech (Last 24h) and the ' +
        'Created vs Interested chart. Created counts use main-dataset leads from the last 24 hours ' +
        '(excl. Kollege Apply).'
      );
    }
    return (
      `Report rows: ${formatNumber(activity.report_rows)} · ` +
      `Matched Know More about B.Tech: ${formatNumber(activity.matched_leads)} · ` +
      `Unmatched: ${formatNumber(activity.unmatched_report_rows)}`
    );
  }, [activity]);

  return (
    <div className="space-y-4">
      <PageHeader title="Persona Analytics" />

      <SectionHeader
        title="Persona activity report (Last 24h)"
        subtitle="Headers: Prospect Id, Email Address, Phone Number, Contact Name, Activity Id, Activity Date, Activity Modified On, Notes"
      />

      <div className="panel p-4 space-y-3">
        <div
          className={cn(
            'border border-dashed rounded-md px-4 py-6 text-center transition-colors cursor-pointer',
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-text-secondary/60'
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
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
          <Upload className="w-5 h-5 mx-auto text-text-secondary mb-2" />
          <div className="text-sm text-text">
            Drop persona activity report here, or click to browse
          </div>
          <div className="text-[11px] text-text-secondary mt-1">
            Excel or CSV · matched to main dataset by Prospect Id / Email
          </div>
        </div>

        {uploadStep === 'uploading' && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
          </div>
        )}
        {uploadStep === 'done' && uploadMessage && (
          <div className="flex items-start gap-2 text-sm text-emerald-400">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{uploadMessage}</span>
          </div>
        )}
        {(uploadStep === 'error' || uploadError) && uploadStep !== 'login' && (
          <div className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
        {uploadStep === 'login' && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] uppercase text-text-secondary">Username</label>
              <input
                className="block mt-0.5 bg-surface border border-border rounded px-2 py-1 text-sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-secondary">Password</label>
              <input
                type="password"
                className="block mt-0.5 bg-surface border border-border rounded px-2 py-1 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary text-sm px-3 py-1.5"
              disabled={loginLoading}
              onClick={handleLogin}
            >
              {loginLoading ? 'Signing in…' : 'Sign in & upload'}
            </button>
            {uploadError && <span className="text-sm text-danger w-full">{uploadError}</span>}
          </div>
        )}

        <div className="text-xs text-text-secondary">{matchHint}</div>
        {activity?.has_data && activity.source_filename && (
          <div className="text-[11px] text-text-secondary">
            Current file: {activity.source_filename}
            {activity.uploaded_at ? ` · uploaded ${activity.uploaded_at}` : ''}
          </div>
        )}
      </div>

      <SectionHeader
        title="Top Persona Summary"
        subtitle="Know More about B.Tech metrics · Other Persona = non-blank personas excluding Know More about B.Tech"
      />

      <div className="panel grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
        {SUMMARY_METRICS.map(({ key, label, accent }) => (
          <div
            key={key}
            className={
              accent
                ? 'bg-surface px-4 py-3 ring-1 ring-inset ring-amber-500/40 bg-amber-500/5'
                : 'bg-surface px-4 py-3'
            }
          >
            <div
              className={
                accent
                  ? 'text-[10px] uppercase tracking-widest text-amber-300'
                  : 'text-[10px] uppercase tracking-widest text-text-secondary'
              }
            >
              {label}
            </div>
            <div
              className={
                accent
                  ? 'text-lg font-semibold text-amber-300 kpi-value mt-1'
                  : 'text-lg font-semibold text-text kpi-value mt-1'
              }
            >
              {formatNumber(
                Number(
                  summary?.[key] ??
                    (key === 'other_persona' ? summary?.know_more : undefined) ??
                    0
                )
              )}
            </div>
            {accent && total > 0 && (
              <div className="text-[10px] text-text-secondary mt-0.5">
                {last24hShare.toFixed(1)}% of overall
              </div>
            )}
          </div>
        ))}
      </div>

      <SectionHeader
        title="Know More about B.Tech — Visual Breakdown"
        subtitle="Overall mix · Last 24h compares Created (main DB) vs Interested (activity report Know More about B.Tech)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartPanel
          chart={
            charts?.partner_overall ?? {
              ...EMPTY_CHART,
              chart_type: 'bar',
              title: 'Partners — Overall',
            }
          }
          height={300}
        />
        <ChartPanel
          chart={
            charts?.partner_last_24h
              ? {
                  ...charts.partner_last_24h,
                  title: 'Partners — Activity Know More about B.Tech (last 24 hours)',
                }
              : {
                  ...EMPTY_CHART,
                  chart_type: 'pie',
                  title: 'Partners — Activity Know More about B.Tech (last 24 hours)',
                }
          }
          height={300}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartPanel
          chart={charts?.stage_overall ?? { ...EMPTY_CHART, chart_type: 'pie', title: 'Persona Overall' }}
          height={300}
        />
        <ChartPanel
          chart={
            charts?.stage_last_24h ?? {
              ...EMPTY_CHART,
              chart_type: 'pie',
              title: 'Persona Last 24h — Created vs Interested',
            }
          }
          height={300}
        />
      </div>

      <p className="text-[11px] text-text-secondary -mt-1">
        Persona Overall buckets (add to 100%): Offer Letter Sent → Registration → Know More Only →{' '}
        <span className="text-text">Other B.Tech (no Know More / Reg / Offer)</span>
        . Last 24h pie: Created = leads created in last 48h window (excl. Kollege Apply; labeled Last 24h); Interested =
        Know More about B.Tech matched from the persona activity report.
      </p>

      <SectionHeader title="Partner Breakdown" subtitle="By partner for Know More about B.Tech" />

      {data && (
        <DataTable
          data={rows}
          columns={columns}
          exportFilename="persona_analytics.csv"
        />
      )}
    </div>
  );
}
