'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudDownload, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUploadStore } from '@/store/upload-store';

type SyncStep = 'idle' | 'syncing' | 'done' | 'error';
type ConfigState = 'loading' | 'ready' | 'disabled';

const LSQ_SYNC_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LSQ_SYNC === 'true';

export function LeadSquaredSyncButton() {
  const bumpDataRefresh = useUploadStore((s) => s.bumpDataRefresh);
  const [configState, setConfigState] = useState<ConfigState>('loading');
  const [disableReason, setDisableReason] = useState<string>(
    'Checking LeadSquared configuration…'
  );
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastFailure, setLastFailure] = useState<string | null>(null);
  const [step, setStep] = useState<SyncStep>('idle');
  const [phase, setPhase] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<SyncStep>(step);
  stepRef.current = step;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshLastRun = useCallback(async () => {
    try {
      const last = await api.getLsqSyncLastRun();
      if (last?.status === 'failed' && (last.error || last.message)) {
        setLastFailure(String(last.error || last.message));
      } else if (last?.status === 'completed') {
        setLastFailure(null);
      }
      if (last?.completed_at) {
        setLastRun(new Date(last.completed_at).toLocaleString());
      } else if (last?.started_at && last.status !== 'none') {
        setLastRun(`Last attempt: ${new Date(last.started_at).toLocaleString()}`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!LSQ_SYNC_ENABLED) {
      setConfigState('disabled');
      setDisableReason(
        'Set NEXT_PUBLIC_ENABLE_LSQ_SYNC=true in frontend/.env.local and restart the dev server'
      );
      return;
    }

    let cancelled = false;

    const loadConfig = () => {
      if (stepRef.current !== 'syncing') {
        setConfigState((prev) => (prev === 'ready' ? prev : 'loading'));
        setDisableReason('Checking LeadSquared configuration…');
      }

      api
        .getLsqSyncConfig()
        .then((cfg) => {
          if (cancelled) return;
          if (cfg.enabled) {
            setConfigState('ready');
            setDisableReason('');
            refreshLastRun();
            return;
          }
          if (stepRef.current === 'syncing') {
            setDisableReason('Backend restarted — waiting for sync config…');
            return;
          }
          setConfigState('disabled');
          setDisableReason(
            'Configure LEADSQUARED_ACCESS_KEY and LEADSQUARED_SECRET_KEY in backend/.env, set LEADSQUARED_SYNC_ENABLED=true, then restart the API'
          );
        })
        .catch(() => {
          if (cancelled) return;
          if (stepRef.current === 'syncing') {
            setDisableReason('Backend restarting — sync still running if the API comes back');
            return;
          }
          setConfigState('disabled');
          setDisableReason(
            'Backend not reachable — is uvicorn running on port 8000? Avoid --reload while Sync LSQ runs.'
          );
        });
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [refreshLastRun]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollStatus = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const job = await api.getLsqSyncStatus(jobId);
          setPhase(job.phase);
          setPercent(job.percent);
          if (job.status === 'completed') {
            setStep('done');
            setSuccessMessage(job.message || 'Sync complete');
            bumpDataRefresh();
            refreshLastRun();
            setTimeout(() => {
              setStep('idle');
              setSuccessMessage(null);
            }, 6000);
            return;
          }
          if (job.status === 'failed') {
            const msg = job.error || job.message || 'Sync failed';
            setError(msg);
            setLastFailure(msg);
            setStep('error');
            refreshLastRun();
            setTimeout(() => {
              setStep('idle');
              setError(null);
            }, 10000);
            return;
          }
          pollRef.current = setTimeout(tick, 1000);
        } catch {
          setPhase((p) => p || 'Waiting for backend…');
          pollRef.current = setTimeout(tick, 2000);
        }
      };
      tick();
    },
    [bumpDataRefresh, refreshLastRun]
  );

  const startSync = async (mode: 'incremental' | 'full' = 'incremental') => {
    if (configState !== 'ready') return;
    stopPolling();
    setStep('syncing');
    setError(null);
    setLastFailure(null);
    setPercent(0);
    setPhase(mode === 'full' ? 'Starting full sync' : 'Starting');
    try {
      const { job_id } = await api.startLsqSync(mode);
      pollStatus(job_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setError(msg);
      setLastFailure(msg);
      setStep('error');
      setTimeout(() => {
        setStep('idle');
        setError(null);
      }, 10000);
    }
  };

  if (!LSQ_SYNC_ENABLED) {
    return null;
  }

  const busy = step === 'syncing';
  const canSync = configState === 'ready' && !busy;
  const statusLine =
    busy && phase
      ? `${phase}${percent ? ` · ${Math.round(percent)}%` : ''}`
      : step === 'error' && error
        ? error
        : step === 'idle' && lastFailure && !error
          ? `Last failed: ${lastFailure}`
          : step === 'done' && successMessage
            ? successMessage
            : configState === 'disabled'
              ? disableReason
              : busy && configState !== 'ready' && disableReason
                ? disableReason
                : null;

  const statusTone =
    step === 'error' || (step === 'idle' && lastFailure)
      ? 'text-danger'
      : step === 'done'
        ? 'text-success'
        : busy && configState !== 'ready'
          ? 'text-amber-400'
          : 'text-text-secondary';

  const syncTitle =
    configState === 'ready'
      ? lastRun
        ? `Last sync: ${lastRun}`
        : 'Pull latest leads from LeadSquared'
      : disableReason;

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <label className="text-[10px] uppercase tracking-wide text-text-secondary">
        LeadSquared
      </label>
      <div
        className={cn(
          'flex h-[30px] overflow-hidden border border-border bg-surface',
          !canSync && !busy && 'opacity-50'
        )}
        title={syncTitle}
      >
        <button
          type="button"
          className={cn(
            'flex h-full items-center gap-1.5 px-2.5 text-xs text-text hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]',
            busy && 'cursor-wait opacity-90'
          )}
          onClick={() => startSync('incremental')}
          disabled={!canSync}
        >
          {busy || configState === 'loading' ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <CloudDownload className="h-3 w-3 shrink-0" />
          )}
          <span className="whitespace-nowrap">
            {busy ? `Sync ${Math.round(percent)}%` : 'Sync'}
          </span>
        </button>
        <div className="w-px self-stretch bg-border" aria-hidden />
        <button
          type="button"
          className={cn(
            'h-full px-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary hover:bg-panel hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]',
            (!canSync || busy) && 'pointer-events-none opacity-60'
          )}
          title="Full backfill from LeadSquared (use after rule changes)"
          onClick={() => startSync('full')}
          disabled={!canSync}
        >
          Full
        </button>
      </div>
      {statusLine && (
        <span className={cn('max-w-[200px] truncate text-[10px]', statusTone)} title={statusLine}>
          {statusLine}
        </span>
      )}
    </div>
  );
}
