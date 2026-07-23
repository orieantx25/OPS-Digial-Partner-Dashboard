'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { UploadReport } from '@/types';
import { cn } from '@/lib/utils';
import { summarizeRejections } from '@/lib/upload-utils';
import { formatNumber } from '@/lib/utils';
import { useUploadStore } from '@/store/upload-store';

type Step = 'pick' | 'uploading' | 'done' | 'error';

export function QuickUploadModal() {
  const { isOpen, closeUpload, bumpDataRefresh } = useUploadStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('pick');
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState('Starting');
  const [rows, setRows] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setStep('pick');
    setReport(null);
    setError(null);
    setDragging(false);
    setPercent(0);
    setPhase('Starting');
    setRows({ done: 0, total: 0 });
    setBusy(false);
  }, [stopPolling]);

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen, reset]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'uploading') closeUpload();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeUpload, step]);

  const pollStatus = useCallback((jobId: string) => {
    const GRACE_MS = 8 * 60 * 1000;
    let lastContact = Date.now();
    const tick = async () => {
      try {
        const job = await api.getUploadStatus(jobId);
        lastContact = Date.now();
        setBusy(false);
        setPhase(job.phase);
        setPercent(job.percent);
        setRows({ done: job.rows_processed, total: job.rows_total });
        if (job.status === 'completed') {
          setReport(job.report);
          setStep('done');
          if (job.report && job.report.total_rows_accepted > 0) bumpDataRefresh();
          return;
        }
        if (job.status === 'failed') {
          setError(job.error || job.message || 'Upload failed');
          setStep('error');
          return;
        }
        pollRef.current = setTimeout(tick, 800);
      } catch {
        if (Date.now() - lastContact > GRACE_MS) {
          setError(
            'Lost connection to the server. The upload may still be finishing in ' +
              'the background — refresh the dashboard in a minute to check.'
          );
          setStep('error');
          return;
        }
        setBusy(true);
        pollRef.current = setTimeout(tick, 2000);
      }
    };
    tick();
  }, [bumpDataRefresh]);

  const startUpload = useCallback(async (files: File[]) => {
    setStep('uploading');
    setError(null);
    setPercent(0);
    setPhase('Uploading file');
    setRows({ done: 0, total: 0 });
    try {
      const { job_id } = await api.uploadStart(files, (pct) => {
        setPhase('Uploading file');
        setPercent(pct);
      });
      setPhase('Starting');
      setPercent(0);
      pollStatus(job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setStep('error');
    }
  }, [pollStatus]);

  const uploadFiles = (incoming: FileList | File[]) => {
    const allowed = ['.xlsx', '.xls', '.csv', '.zip'];
    const files = Array.from(incoming).filter((f) =>
      allowed.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (!files.length) {
      setError('No valid files. Use Excel, CSV, or ZIP.');
      setStep('error');
      return;
    }
    startUpload(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => step !== 'uploading' && closeUpload()}
      role="dialog"
      aria-modal="true"
      aria-label="Upload data"
    >
      <div
        className="panel w-full max-w-md border border-border shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Upload Data</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Merges into MASTER_DATASET
            </p>
          </div>
          {step !== 'uploading' && (
            <button
              type="button"
              onClick={closeUpload}
              className="text-text-secondary hover:text-primary p-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4">
          {step === 'pick' && (
            <>
              <div
                className={cn(
                  'border border-dashed p-8 text-center cursor-pointer',
                  dragging ? 'border-primary bg-panel' : 'border-border hover:border-primary'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <Upload className="w-8 h-8 mx-auto text-primary mb-2" />
                <p className="text-sm text-text">Drop files here or click to browse</p>
                <p className="text-xs text-text-secondary mt-1">.xlsx · .xls · .csv · .zip</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                multiple
                accept=".xlsx,.xls,.csv,.zip"
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              />
            </>
          )}

          {step === 'uploading' && (
            <div className="py-6 space-y-3">
              <div className="flex items-center gap-2 text-text">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm font-medium">
                  {busy ? 'Server busy — processing large file' : phase}…
                </span>
              </div>
              <div className="h-2 w-full bg-surface border border-border overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary kpi-value">
                <span>{Math.round(percent)}%</span>
                {rows.total > 0 && (
                  <span>
                    {formatNumber(rows.done)} / {formatNumber(rows.total)} rows
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-secondary">
                Large files keep processing even if you keep working — this window updates live.
              </p>
            </div>
          )}

          {step === 'done' && report && (() => {
            const accepted = report.total_rows_accepted > 0;
            const rejections = summarizeRejections(report.issues, report.rejection_summary);
            return (
            <div className="space-y-3">
              <div className={cn('flex items-center gap-2', accepted ? 'text-success' : 'text-warning')}>
                {accepted ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                <span className="text-sm font-medium">
                  {accepted ? 'Upload complete' : 'No rows accepted'}
                </span>
              </div>
              <p className="text-xs text-text-secondary">{report.message}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="panel p-2">
                  <div className="text-xs text-text-secondary">Accepted</div>
                  <div className="kpi-value text-lg">{formatNumber(report.total_rows_accepted)}</div>
                </div>
                <div className="panel p-2">
                  <div className="text-xs text-text-secondary">Rejected</div>
                  <div className="kpi-value text-lg">{formatNumber(report.total_rows_rejected)}</div>
                </div>
              </div>
              {rejections.length > 0 && (
                <div className="text-xs space-y-1 border border-border p-2 max-h-28 overflow-y-auto">
                  <div className="text-text-secondary uppercase tracking-wide mb-1">Why rows failed</div>
                  {rejections.map((r) => (
                    <div key={r.label} className="flex justify-between text-text-secondary">
                      <span>{r.label}</span>
                      <span className="text-warning">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="btn-primary w-full" onClick={accepted ? closeUpload : reset}>
                {accepted ? 'Done' : 'Try again'}
              </button>
            </div>
            );
          })()}

          {step === 'error' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-danger text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
              <button type="button" className="btn-secondary w-full" onClick={reset}>
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
