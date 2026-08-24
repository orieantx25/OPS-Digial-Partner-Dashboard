'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { cn, formatNumber } from '@/lib/utils';

export function AdmissionReconcilePanel({ className }: { className?: string }) {
  const { data, loading, error } = useFetch({
    fetcher: () => api.getAdmissionReconcile(),
    deps: [],
  });

  if (loading && !data) {
    return (
      <div className={cn('panel border border-border p-4 animate-pulse h-24', className)} />
    );
  }
  if (error || !data) return null;

  return (
    <section className={cn('panel border border-border p-4 space-y-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] uppercase tracking-widest text-text-secondary">
            Admission metrics reconcile
          </h3>
          <p className="text-xs text-text-secondary mt-1">
            Same definitions across DP, Campus, Journey, and funnel. Sheet metrics are unfiltered
            (all loaded rows).
          </p>
        </div>
        <span
          className={cn(
            'text-[10px] uppercase tracking-wide px-2 py-1 border',
            data.ok
              ? 'text-success border-success/40 bg-success/10'
              : 'text-amber-400 border-amber-400/40 bg-amber-400/10'
          )}
        >
          {data.ok ? 'Checks OK' : 'Mismatch'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {data.definitions.map((def) => (
          <div key={def.key} className="bg-surface/60 border border-border/60 p-2.5" title={def.definition}>
            <div className="text-[9px] uppercase tracking-widest text-text-secondary truncate">
              {def.label}
            </div>
            <div className="text-lg font-semibold mt-0.5">{formatNumber(def.value)}</div>
          </div>
        ))}
      </div>

      <ul className="space-y-1">
        {data.checks.map((check) => (
          <li
            key={check.id}
            className={cn(
              'text-xs flex flex-wrap gap-x-2 gap-y-0.5',
              check.ok ? 'text-text-secondary' : 'text-amber-400'
            )}
          >
            <span className="font-medium">{check.ok ? 'OK' : 'Check'}</span>
            <span>{check.label}</span>
            {check.detail && <span className="opacity-80">— {check.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
