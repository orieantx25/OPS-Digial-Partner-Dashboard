'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { CloudDownload, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch, useDebouncedValue } from '@/hooks/use-fetch';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { DataTable } from '@/components/tables/data-table';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { FetchingHint } from '@/components/dashboard/fetching-hint';
import { AdmissionJourneyRow } from '@/types';
import { cn, downloadBlob, formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';
import { useUploadStore } from '@/store/upload-store';

const CHANNEL_LABEL: Record<string, string> = {
  digital_partner: 'Digital Partner',
  counsellor: 'Counsellor',
  other: 'Other',
  unmatched_lsq: 'Unmatched in LSQ',
};

const CHANNEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'digital_partner', label: 'DP' },
  { value: 'counsellor', label: 'Counsellor' },
  { value: 'other', label: 'Other' },
  { value: 'unmatched_lsq', label: 'Unmatched' },
] as const;

const PAID_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Sem fee paid' },
  { value: 'false', label: 'Sem fee not paid' },
] as const;

const CLASH_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Any clash' },
  { value: 'block', label: 'At block amount' },
  { value: 'admission', label: 'At admission (sem fee)' },
  { value: 'false', label: 'No clash' },
] as const;

const BLOCK_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'full', label: 'Full (≥ ₹50k)' },
  { value: 'partial', label: 'Partial' },
] as const;

function formatCreated(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function FilterPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] uppercase tracking-widest text-text-secondary shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value || 'all'}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                'text-[11px] px-2 py-1 border',
                active
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-surface text-text-secondary border-border hover:text-text'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatTab({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    'panel p-3 border text-left w-full',
    onClick && 'cursor-pointer hover:border-primary/50',
    active ? 'border-primary bg-primary/10' : 'border-border'
  );
  const body = (
    <>
      <p className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</p>
      <p className="text-lg font-semibold mt-1">{formatNumber(value)}</p>
      {hint ? <p className="text-[10px] text-text-secondary mt-1 leading-snug">{hint}</p> : null}
    </>
  );
  if (!onClick) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

function MetricGroup({
  title,
  definition,
  children,
}: {
  title: string;
  definition: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[11px] uppercase tracking-widest text-text-secondary">{title}</h3>
        <p className="text-xs text-text-secondary mt-0.5">{definition}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
    </section>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const label = CHANNEL_LABEL[channel] || channel || '—';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        channel === 'digital_partner' && 'bg-primary/15 text-primary',
        channel === 'counsellor' && 'bg-warning/15 text-warning',
        channel === 'unmatched_lsq' && 'bg-border text-text-secondary',
        channel === 'other' && 'bg-panel text-text-secondary border border-border'
      )}
    >
      {label}
    </span>
  );
}

export default function AdmissionJourneyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadership = isLeadershipMode();
  const uploadsEnabled = canUpload();
  const bumpDataRefresh = useUploadStore((s) => s.bumpDataRefresh);

  const channel = searchParams.get('channel') || 'all';
  const campus = searchParams.get('campus') || '';
  const clash = searchParams.get('clash') || '';
  const paid = searchParams.get('paid') || '';
  const blockStatus = searchParams.get('block_status') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: status, refetch: refetchStatus } = useFetch({
    fetcher: () => api.getAdmissionJourneyStatus(),
    deps: [],
  });

  const { data, loading, isFetching, error } = useFetch({
    fetcher: () =>
      api.getAdmissionJourneyStudents({
        channel,
        campus: campus || undefined,
        clash: clash || undefined,
        paid: paid || undefined,
        blockStatus: blockStatus || undefined,
        search: debouncedSearch || undefined,
        page,
        pageSize: 50,
      }),
    deps: [channel, campus, clash, paid, blockStatus, debouncedSearch, page],
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;
  const listQuery = searchParams.toString();

  const patchFilters = (next: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      const text = String(value);
      if (!text || text === 'all' || (key === 'page' && text === '1')) {
        params.delete(key);
      } else {
        params.set(key, text);
      }
    });
    const qs = params.toString();
    router.push(qs ? `/admission-journey?${qs}` : '/admission-journey');
  };

  const applyTab = (tab: string) => {
    const params = new URLSearchParams();
    if (campus) params.set('campus', campus);
    if (tab === 'students') {
      // all
    } else if (tab === 'paid') {
      params.set('paid', 'true');
    } else if (tab === 'unpaid') {
      params.set('paid', 'false');
    } else if (tab === 'dp') {
      params.set('channel', 'digital_partner');
    } else if (tab === 'counsellor') {
      params.set('channel', 'counsellor');
    } else if (tab === 'other') {
      params.set('channel', 'other');
    } else if (tab === 'unmatched') {
      params.set('channel', 'unmatched_lsq');
    } else if (tab === 'clash') {
      params.set('clash', 'true');
    } else if (tab === 'clash_block') {
      params.set('clash', 'block');
    } else if (tab === 'clash_admission') {
      params.set('clash', 'admission');
    } else if (tab === 'block_full') {
      params.set('block_status', 'full');
    } else if (tab === 'block_partial') {
      params.set('block_status', 'partial');
    }
    const qs = params.toString();
    router.push(qs ? `/admission-journey?${qs}` : '/admission-journey');
  };

  const listTitle =
    blockStatus === 'full'
      ? 'Block amount · Full'
      : blockStatus === 'partial'
        ? 'Block amount · Partial'
        : clash === 'block'
      ? 'Clash at block amount'
      : clash === 'admission'
        ? 'Clash at admission (sem fee)'
        : clash === 'true'
          ? 'All clashes'
          : channel === 'unmatched_lsq'
            ? 'Unmatched in LSQ'
            : channel === 'digital_partner'
              ? 'Digital Partner'
              : channel === 'counsellor'
                ? 'Counsellor'
                : channel === 'other'
                  ? 'Other'
                  : paid === 'true'
                    ? 'Admission · Sem fee paid'
                    : paid === 'false'
                      ? 'Admission · Sem fee not paid'
                      : 'All admissions students';

  const exportStudents = async () => {
    const csv = await api.exportAdmissionJourneyStudents({
      channel: channel === 'all' ? undefined : channel,
      campus: campus || undefined,
      clash: clash || undefined,
      paid: paid || undefined,
      blockStatus: blockStatus || undefined,
      search: debouncedSearch || undefined,
    });
    downloadBlob(csv, 'admission_journey.csv');
  };

  const columns: ColumnDef<AdmissionJourneyRow>[] = useMemo(
    () => [
      { accessorKey: 'student_name', header: 'Name', meta: { minWidth: 140 } },
      { accessorKey: 'email', header: 'Email', meta: { minWidth: 180 } },
      {
        accessorKey: 'campus',
        header: 'Campus',
        meta: { minWidth: 90 },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'lsq_created_on',
        header: 'Created',
        meta: { minWidth: 100 },
        cell: ({ getValue }) => formatCreated(String(getValue() || '') || null),
      },
      {
        accessorKey: 'sheet_status',
        header: 'Sem fee (admission)',
        meta: { minWidth: 120 },
        cell: ({ row }) =>
          row.original.sheet_is_paid
            ? row.original.sheet_status || 'Paid'
            : row.original.sheet_status || 'Unpaid',
      },
      {
        accessorKey: 'block_payment_status',
        header: 'Block amount',
        meta: { minWidth: 110 },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'lsq_source',
        header: 'Contact source',
        meta: { minWidth: 130 },
        cell: ({ row }) =>
          String(row.original.lsq_source || row.original.contact_source_sheet || '—'),
      },
      {
        accessorKey: 'original_utm_campaign',
        header: 'Orig. campaign',
        meta: { minWidth: 140 },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'lsq_prospect_stage',
        header: 'LSQ stage',
        meta: { minWidth: 140 },
        cell: ({ row }) =>
          String(
            row.original.lsq_stage_label ||
              row.original.lsq_lead_stage ||
              row.original.lsq_prospect_stage ||
              '—'
          ),
      },
      {
        accessorKey: 'source_at_payment',
        header: 'Test payment source',
        meta: { minWidth: 140 },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'campaign_at_payment',
        header: 'Pay campaign',
        meta: { minWidth: 140 },
        cell: ({ getValue }) => String(getValue() || '—'),
      },
      {
        accessorKey: 'lms_status',
        header: 'Status',
        meta: { minWidth: 170 },
        cell: ({ row }) => {
          const blockStatus = String(row.original.block_payment_status || '').toLowerCase();
          const blockLabel = blockStatus.includes('partial')
            ? 'Block payment - Partial'
            : blockStatus.includes('full') || row.original.block_payment_done
              ? 'Block payment done'
              : null;
          const parts = [
            blockLabel,
            row.original.sem_fee_verified
              ? 'Sem verified'
              : row.original.sem_fee_under_review
                ? 'Sem under review'
                : null,
            row.original.refund_case ? 'Refund' : null,
          ].filter(Boolean);
          if (!parts.length) {
            return String(row.original.lms_status || '—');
          }
          return (
            <span className="text-[10px] uppercase tracking-wide text-text-secondary">
              {parts.map((part, idx) => {
                const isPartial = part === 'Block payment - Partial';
                const isFull = part === 'Block payment done';
                return (
                  <span key={part}>
                    {idx > 0 ? ' · ' : null}
                    <span
                      className={cn(
                        isPartial && 'text-amber-400',
                        isFull && 'text-success'
                      )}
                    >
                      {part}
                    </span>
                  </span>
                );
              })}
            </span>
          );
        },
      },
      {
        accessorKey: 'channel',
        header: 'Channel',
        meta: { minWidth: 130 },
        cell: ({ getValue }) => <ChannelBadge channel={String(getValue() || '')} />,
      },
      {
        accessorKey: 'is_clash',
        header: 'Clash',
        meta: { minWidth: 120 },
        cell: ({ row }) => {
          if (!row.original.is_clash) return '—';
          const parts = [
            row.original.clash_at_block ? 'Block amount' : null,
            row.original.clash_at_admission ? 'Admission' : null,
          ].filter(Boolean);
          return (
            <span className="text-[10px] uppercase tracking-wide text-warning">
              {parts.length ? parts.join(' · ') : 'Clash'}
            </span>
          );
        },
      },
    ],
    []
  );

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage('Starting lookup…');
    const maxPolls = 900; // 15 minutes at 1s
    const maxTransientErrors = 30;
    let transientErrors = 0;
    let finished = false;
    try {
      const started = await api.startAdmissionJourneySync();
      const jobId = started.job_id;
      if (started.status === 'already_running') {
        setSyncMessage('Resuming in-progress sync…');
      }
      for (let i = 0; i < maxPolls; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const job = await api.getAdmissionJourneySyncJob(jobId);
          transientErrors = 0;
          const pct = job.percent ? ` · ${Math.round(Number(job.percent))}%` : '';
          setSyncMessage(`${job.message || job.phase || 'Syncing…'}${pct}`);
          if (job.status === 'completed') {
            setSyncMessage(job.message || 'Sync complete');
            bumpDataRefresh();
            await refetchStatus();
            finished = true;
            break;
          }
          if (job.status === 'failed') {
            throw new Error(job.error || job.message || 'Sync failed');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/not found|404/i.test(msg)) {
            throw new Error('Sync job lost (backend may have restarted). Try Sync again.');
          }
          transientErrors += 1;
          setSyncMessage('Waiting for backend…');
          if (transientErrors >= maxTransientErrors) {
            throw new Error('Lost connection to sync job. Try Sync again.');
          }
        }
      }
      if (!finished) {
        throw new Error('Sync timed out after 15 minutes. Try Sync again.');
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
        title="Admission journey"
        totalRows={status?.row_count}
        action={
          uploadsEnabled && !leadership ? (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={runSync}
              disabled={syncing || !status?.admissions_loaded}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              {syncing ? 'Syncing…' : 'Sync & deploy'}
            </button>
          ) : undefined
        }
      />

      <FetchingHint active={isFetching && !loading} />

      <div className="panel border border-border p-3 sm:p-4 space-y-1.5 text-xs text-text-secondary">
        <p>
          <span className="text-text font-medium">Block</span> = block amount payment (earlier).{' '}
          <span className="text-text font-medium">Admission</span> = semester fee on All Payments
          (later).
        </p>
        <p>
          Clash at block / admission means a counsellor or influencer payment source on a DP-origin
          lead at that stage. A student can have both.
        </p>
      </div>

      <div className="space-y-5">
        <MetricGroup
          title="Universe & channel"
          definition="All Payments students in this journey store after sync."
        >
          <StatTab
            label="All students"
            value={status?.row_count ?? 0}
            active={channel === 'all' && !clash && !paid && !blockStatus}
            onClick={() => applyTab('students')}
          />
          <StatTab
            label="Digital partner"
            value={status?.dp_count ?? 0}
            active={channel === 'digital_partner'}
            onClick={() => applyTab('dp')}
          />
          <StatTab
            label="Counsellor"
            value={status?.counsellor_count ?? 0}
            active={channel === 'counsellor'}
            onClick={() => applyTab('counsellor')}
          />
          <StatTab
            label="Other source"
            value={status?.other_count ?? 0}
            active={channel === 'other'}
            onClick={() => applyTab('other')}
          />
          <StatTab
            label="Unmatched in LSQ"
            value={status?.unmatched_lsq ?? 0}
            active={channel === 'unmatched_lsq'}
            onClick={() => applyTab('unmatched')}
          />
        </MetricGroup>

        <MetricGroup
          title="Block amount"
          definition="Block payment status from sheet (or ≥ ₹50,000 = Full). Not semester fee."
        >
          <StatTab
            label="Block full"
            hint="Block amount done"
            value={status?.block_full_count ?? 0}
            active={blockStatus === 'full'}
            onClick={() => applyTab('block_full')}
          />
          <StatTab
            label="Block partial"
            hint="Block amount · Partial"
            value={status?.block_partial_count ?? 0}
            active={blockStatus === 'partial'}
            onClick={() => applyTab('block_partial')}
          />
          <StatTab
            label="Clash at block"
            hint="Clash when block amount paid"
            value={status?.clash_at_block ?? 0}
            active={clash === 'block'}
            onClick={() => applyTab('clash_block')}
          />
        </MetricGroup>

        <MetricGroup
          title="Admission (semester fee)"
          definition="Sem fee paid = All Payments is_paid. This is admission in this journey — not block amount."
        >
          <StatTab
            label="Sem fee paid"
            hint="Admission"
            value={status?.paid_count ?? 0}
            active={paid === 'true'}
            onClick={() => applyTab('paid')}
          />
          <StatTab
            label="Sem fee not paid"
            hint="Still in journey · unpaid"
            value={status?.unpaid_count ?? 0}
            active={paid === 'false'}
            onClick={() => applyTab('unpaid')}
          />
          <StatTab
            label="Clash at admission"
            hint="Clash when sem fee paid"
            value={status?.clash_at_admission ?? 0}
            active={clash === 'admission'}
            onClick={() => applyTab('clash_admission')}
          />
          <StatTab
            label="All clashes"
            hint="Block and/or admission"
            value={status?.clash_count ?? 0}
            active={clash === 'true'}
            onClick={() => applyTab('clash')}
          />
        </MetricGroup>
      </div>

      {(syncMessage || syncError || status?.last_synced_at) && (
        <p className={cn('text-xs', syncError ? 'text-danger' : 'text-text-secondary')}>
          {syncError ||
            syncMessage ||
            (status?.last_synced_at
              ? `Last journey sync ${new Date(status.last_synced_at).toLocaleString()}`
              : null)}
        </p>
      )}

      {!status?.admissions_loaded && (
        <div className="panel p-5 border border-border text-sm text-text-secondary">
          No admissions data yet.
        </div>
      )}

      {status?.admissions_loaded && !status.has_data && (
        <div className="panel p-5 border border-border text-sm text-text-secondary">
          No journeys yet.
        </div>
      )}

      {status?.has_data && (
        <section className="space-y-3 panel p-4 sm:p-5 border border-border">
          <SectionHeader title={listTitle} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <FilterPills
              label="Channel"
              value={channel}
              options={CHANNEL_OPTIONS}
              onChange={(next) => patchFilters({ channel: next, page: 1 })}
            />
            <FilterPills
              label="Sem fee (admission)"
              value={paid}
              options={PAID_OPTIONS}
              onChange={(next) => patchFilters({ paid: next, page: 1 })}
            />
            <FilterPills
              label="Clash"
              value={clash}
              options={CLASH_OPTIONS}
              onChange={(next) => patchFilters({ clash: next, page: 1 })}
            />
            <FilterPills
              label="Block amount"
              value={blockStatus}
              options={BLOCK_STATUS_OPTIONS}
              onChange={(next) => patchFilters({ block_status: next, page: 1 })}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-text-secondary">
                Campus
              </span>
              <select
                className="bg-surface border border-border text-xs py-1 px-2 w-auto min-w-[8rem] text-text focus:border-primary focus:outline-none"
                value={campus}
                onChange={(e) => patchFilters({ campus: e.target.value, page: 1 })}
              >
                <option value="">All campuses</option>
                {(status?.campuses ?? []).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          {loading && !data ? (
            <p className="text-text-secondary text-sm">Loading students…</p>
          ) : (
            <>
              <DataTable
                data={rows}
                columns={columns}
                onRowClick={(row) => {
                  const params = new URLSearchParams(listQuery);
                  if (search) params.set('q', search);
                  const qs = params.toString();
                  router.push(`/admission-journey/${row.journey_id}${qs ? `?${qs}` : ''}`);
                }}
                exportFilename="admission_journey.csv"
                onExport={exportStudents}
                searchPlaceholder="Search name, email, phone"
                searchValue={search}
                onSearchChange={(term) => {
                  setSearch(term);
                }}
                totalCount={total}
                height={480}
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 text-xs text-text-secondary">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page <= 1}
                    onClick={() => patchFilters({ page: Math.max(1, page - 1) })}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page >= totalPages}
                    onClick={() => patchFilters({ page: page + 1 })}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
