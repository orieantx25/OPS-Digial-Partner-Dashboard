'use client';

import { useState } from 'react';
import { ChevronDown, CloudDownload, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';
import { PipelineOverviewStep } from '@/types';

const STOP_COLORS = [
  '#E31E24',
  '#F87171',
  '#FB923C',
  '#FBBF24',
  '#A3E635',
  '#22C55E',
  '#14B8A6',
  '#38BDF8',
  '#818CF8',
  '#C084FC',
  '#F472B6',
  '#FB7185',
];

function StopLineFunnel({ steps }: { steps: PipelineOverviewStep[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleSubstages = (key: string) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="panel border border-border p-4 sm:p-6">
      <p className="text-[11px] uppercase tracking-widest text-text-secondary mb-5">
        Funnel
      </p>
      <div className="mx-auto max-w-3xl">
        {steps.map((step, index) => {
          const color = STOP_COLORS[index % STOP_COLORS.length];
          const substages = step.substages ?? [];
          const isLast = index === steps.length - 1;
          const nextConversion = steps[index + 1]?.conversion_from_previous_pct;
          const isOpen = Boolean(expanded[step.key]);
          return (
            <div key={step.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-start gap-x-3 sm:gap-x-5">
                <div className="text-right pt-0.5">
                  <p className="text-sm font-semibold leading-5">{step.label}</p>
                  {substages.length > 0 && (
                    <div className="mt-1">
                      <button
                        type="button"
                        className="inline-flex items-center justify-end gap-1 text-[11px] text-text-secondary hover:text-text-primary"
                        onClick={() => toggleSubstages(step.key)}
                        aria-expanded={isOpen}
                      >
                        <ChevronDown
                          className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                        />
                        {isOpen ? 'Hide sub-stages' : `${substages.length} sub-stages`}
                      </button>
                      {isOpen && (
                        <ul className="mt-1.5 space-y-0.5">
                          {substages.map((item) => (
                            <li
                              key={item.label}
                              className="text-[11px] text-text-secondary leading-4"
                            >
                              {item.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center self-stretch">
                  <span
                    className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#0F0F10] shadow"
                    style={{ backgroundColor: color }}
                  />
                  {!isLast && <span className="w-px flex-1 min-h-[1.5rem] bg-border" />}
                </div>
                <div className="pt-0.5">
                  <p className="text-lg font-semibold leading-5 tabular-nums">
                    {formatNumber(step.reached)}
                  </p>
                </div>
              </div>
              {!isLast && (
                <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-3 sm:gap-x-5">
                  <div />
                  <div className="flex justify-center">
                    <span className="w-px h-8 bg-border" />
                  </div>
                  <p className="text-[11px] text-text-secondary tabular-nums">
                    {nextConversion != null ? `${formatPct(nextConversion)} conversion` : '—'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PipelineOverviewPage() {
  const leadership = isLeadershipMode();
  const uploadsEnabled = canUpload();
  const { data, loading, isFetching, error, refetch } = useFetch({
    fetcher: () => api.getPipelineOverview(),
    deps: [],
  });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const steps = data?.steps ?? [];
  const ugnetAppeared =
    steps.find((step) => step.key === 'ugnet_appeared')?.reached ?? 0;

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage('Starting full CRM fetch…');
    try {
      const started = await api.startPipelineOverviewSync();
      const jobId = started.job_id;
      for (let i = 0; i < 1200; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = await api.getPipelineOverviewSyncJob(jobId);
        setSyncMessage(job.message || job.phase || 'Syncing…');
        if (job.status === 'completed') {
          setSyncMessage(job.message || 'Sync complete');
          await refetch();
          break;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || job.message || 'Sync failed');
        }
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overall pipeline overview"
        totalRows={data?.total_leads}
        action={
          uploadsEnabled && !leadership ? (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={runSync}
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              {syncing ? 'Syncing…' : 'Sync CRM pipeline'}
            </button>
          ) : undefined
        }
      />
      <FetchingHint active={isFetching && !loading} />

      {error && <p className="text-sm text-danger">{error}</p>}
      {syncError && <p className="text-sm text-danger">{syncError}</p>}
      {syncMessage && !syncError && (
        <p className="text-sm text-text-secondary">{syncMessage}</p>
      )}
      {loading && !data && <p className="text-sm text-text-secondary">Loading pipeline…</p>}

      {data?.last_synced_at && (
        <p className="text-[11px] text-text-secondary">
          Last CRM sync {data.last_synced_at.replace('T', ' ').slice(0, 19)}
        </p>
      )}

      {data && !data.has_data && (
        <div className="panel p-5 border border-border text-sm text-text-secondary">
          No pipeline data yet.
        </div>
      )}

      {data?.has_data && (
        <>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="panel p-3 border border-border">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                CRM leads
              </p>
              <p className="text-lg font-semibold mt-1">{formatNumber(data.total_leads)}</p>
            </div>
            <div className="panel p-3 border border-border">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                Admissions
              </p>
              <p className="text-lg font-semibold mt-1">{formatNumber(data.admissions)}</p>
            </div>
            <div className="panel p-3 border border-border">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                UGNET appeared → admission
              </p>
              <p className="text-lg font-semibold mt-1">
                {ugnetAppeared
                  ? formatPct((data.admissions / ugnetAppeared) * 100)
                  : '—'}
              </p>
            </div>
            <div className="panel p-3 border border-border">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">Stages</p>
              <p className="text-lg font-semibold mt-1">{formatNumber(steps.length)}</p>
            </div>
          </div>

          <StopLineFunnel steps={steps} />

          <section className="space-y-3">
            <SectionHeader title="Cumulative stage counts" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {steps.map((step, index) => (
                <div key={step.key} className="panel border border-border p-3">
                  <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                    {String(index + 1).padStart(2, '0')} · {step.label}
                  </p>
                  <p className="text-lg font-semibold mt-1">{formatNumber(step.reached)}</p>
                  <p className="text-[11px] text-text-secondary mt-1">
                    At this stage {formatNumber(step.at_stage)}
                    {step.conversion_from_previous_pct != null
                      ? ` · ${formatPct(step.conversion_from_previous_pct)} from previous`
                      : ''}
                  </p>
                  {step.lsq_labels.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {step.lsq_labels.slice(0, 4).map((item) => (
                        <li
                          key={item.label}
                          className={cn('text-[11px] text-text-secondary truncate')}
                        >
                          {item.label} · {formatNumber(item.count)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
