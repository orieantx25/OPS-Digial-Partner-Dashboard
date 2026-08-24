'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarClock,
  CreditCard,
  GitBranch,
  IndianRupee,
  Megaphone,
  Radio,
  RefreshCw,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import {
  AdmissionJourneyField,
  AdmissionJourneyPathStep,
  AdmissionJourneyStageChip,
} from '@/types';
import { cn, formatCurrency } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

const CHANNEL_LABEL: Record<string, string> = {
  digital_partner: 'Digital Partner',
  counsellor: 'Counsellor',
  other: 'Other',
  unmatched_lsq: 'Unmatched in LSQ',
};

const STEP_ICONS: Record<string, LucideIcon> = {
  created: CalendarClock,
  contact_source: Radio,
  original_utm: Megaphone,
  utm_activity: Activity,
  lsq_stage: GitBranch,
  payment_source: CreditCard,
  amounts: IndianRupee,
  recent_utm: RefreshCw,
  campus: Building2,
};

function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(value?: string | null): string {
  if (!value) return '—';
  const n = Number(String(value).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n)) return value;
  return formatCurrency(n);
}

function displayValue(label: string, value?: string | null): string {
  if (!value) return '—';
  if (/amount|payable|verified paid/i.test(label)) return formatMoney(value);
  if (/created on|paid at|verified on|paid on|^dop$|modified|submitted|updated|created at/i.test(label))
    return formatWhen(value);
  return value;
}

function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'warning' | 'muted' | 'success' | 'danger';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-1 text-[10px] font-medium uppercase tracking-wide border',
        tone === 'primary' && 'bg-primary/15 text-primary border-primary/30',
        tone === 'warning' && 'bg-warning/15 text-warning border-warning/30',
        tone === 'success' && 'bg-success/15 text-success border-success/30',
        tone === 'danger' && 'bg-danger/15 text-danger border-danger/30',
        tone === 'muted' && 'bg-border/40 text-text-secondary border-border',
        tone === 'neutral' && 'bg-panel text-text-secondary border-border'
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="panel border border-border p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</p>
      <p className="text-sm mt-1 break-words">{value || '—'}</p>
    </div>
  );
}

function StatusBox({
  label,
  value,
  tone,
  active = true,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'panel border p-3 min-w-0',
        active && tone === 'success' && 'border-success/50 bg-success/10',
        active && tone === 'warning' && 'border-warning/50 bg-warning/10',
        active && tone === 'danger' && 'border-danger/50 bg-danger/10',
        (!active || tone === 'muted') && 'border-border opacity-50'
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</p>
      <p className={cn('text-sm font-medium mt-1', (!active || tone === 'muted') && 'text-text-secondary')}>
        {value}
      </p>
    </div>
  );
}

function paymentStatus(header: {
  block_payment_done?: boolean;
  block_payment_status?: string | null;
  sem_fee_under_review?: boolean;
  sem_fee_verified?: boolean;
}): { value: string; tone: 'success' | 'warning' | 'muted' } {
  if (header.sem_fee_verified) {
    return { value: 'Sem fee paid verified', tone: 'success' };
  }
  if (header.sem_fee_under_review) {
    return { value: 'Sem fee paid — under review', tone: 'warning' };
  }
  const blockStatus = String(header.block_payment_status || '').toLowerCase();
  if (blockStatus.includes('partial')) {
    return { value: 'Block payment - Partial', tone: 'warning' };
  }
  if (blockStatus.includes('full') || header.block_payment_done) {
    return { value: 'Block payment done', tone: 'success' };
  }
  return { value: 'Not started', tone: 'muted' };
}

function EventStrip({ events }: { events: { key: string; label: string; at: string }[] }) {
  if (!events.length) return null;
  return (
    <div className="panel border border-border p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-widest text-text-secondary mb-4">
        Timeline of dates
      </p>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
        {events.map((event, index) => (
          <li key={`${event.key}-${event.at}`} className="flex gap-3 min-w-0">
            <span className="text-[10px] text-text-secondary tabular-nums w-5 shrink-0 pt-0.5">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium">{event.label}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">{formatWhen(event.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageRail({ stages }: { stages: AdmissionJourneyStageChip[] }) {
  return (
    <div className="panel border border-border p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-widest text-text-secondary mb-4">
        Funnel progress
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        {stages.map((chip, index) => (
          <div key={chip.key} className="relative">
            {index < stages.length - 1 && (
              <div
                className={cn(
                  'hidden sm:block absolute top-3 left-[calc(50%+18px)] right-[-12px] h-px',
                  chip.reached && stages[index + 1]?.reached ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
            <div className="flex sm:flex-col sm:items-center gap-3 sm:gap-2 sm:text-center">
              <div
                className={cn(
                  'h-6 w-6 rounded-full border flex items-center justify-center text-[10px] shrink-0 z-10',
                  chip.reached
                    ? 'bg-primary border-primary text-white'
                    : 'bg-surface border-border text-text-secondary'
                )}
              >
                {index + 1}
              </div>
              <div className="min-w-0">
                <p className={cn('text-xs font-medium', !chip.reached && 'text-text-secondary')}>
                  {chip.label}
                </p>
                <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                  {chip.reached ? chip.detail || 'Reached' : 'Not reached'}
                </p>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {chip.at ? formatWhen(chip.at) : '—'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldCompare({ field }: { field: AdmissionJourneyField }) {
  const showLsq = field.lsq != null;
  const showSheet = field.sheet != null || !showLsq;
  return (
    <div
      className={cn(
        'grid gap-3 py-2.5 border-b border-border/60 last:border-0',
        showLsq && showSheet ? 'sm:grid-cols-[140px_1fr_1fr]' : 'sm:grid-cols-[140px_1fr]'
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-text-secondary pt-0.5">
        {field.label}
      </p>
      {showLsq && showSheet ? (
        <>
          <p className={cn('text-sm', field.empty && 'text-text-secondary')}>
            <span className="text-[10px] uppercase tracking-wide text-text-secondary mr-2">
              LSQ
            </span>
            {displayValue(field.label, field.lsq)}
          </p>
          <p className={cn('text-sm', field.empty && 'text-text-secondary')}>
            <span className="text-[10px] uppercase tracking-wide text-text-secondary mr-2">
              Sheet
            </span>
            {displayValue(field.label, field.sheet)}
            {field.mismatch && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-warning">
                mismatch
              </span>
            )}
          </p>
        </>
      ) : (
        <p className={cn('text-sm', field.empty && 'text-text-secondary')}>
          {displayValue(field.label, field.lsq || field.sheet)}
        </p>
      )}
    </div>
  );
}

function TimelineStep({
  step,
  index,
  last,
}: {
  step: AdmissionJourneyPathStep;
  index: number;
  last: boolean;
}) {
  const Icon = STEP_ICONS[step.key] || Radio;
  const fields = step.fields?.length
    ? step.fields
    : [
        {
          label: 'Value',
          lsq: step.lsq,
          sheet: step.sheet,
          mismatch: step.mismatch,
          empty: step.empty,
        },
      ];

  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-4">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'h-7 w-7 rounded-full border flex items-center justify-center shrink-0',
            step.mismatch
              ? 'border-warning bg-warning/15 text-warning'
              : step.empty
                ? 'border-border bg-surface text-text-secondary'
                : 'border-primary bg-primary/15 text-primary'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!last && <div className="w-px flex-1 bg-border mt-1 min-h-[24px]" />}
      </div>
      <div
        className={cn(
          'panel border p-4 mb-4',
          step.mismatch && 'border-warning/50',
          step.empty && 'opacity-70'
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-text-secondary">
              Step {index + 1}
            </p>
            <h3 className="text-sm font-semibold mt-0.5">{step.label}</h3>
          </div>
          <div className="flex items-center gap-2">
            {step.date && (
              <span className="text-[11px] text-text-secondary">{formatWhen(step.date)}</span>
            )}
            {step.mismatch && <Pill tone="warning">Mismatch</Pill>}
            {step.empty && <Pill tone="muted">No data</Pill>}
          </div>
        </div>
        <div>
          {fields.map((field) => (
            <FieldCompare key={field.label} field={field} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdmissionJourneyDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params?.id;
  const backQuery = searchParams.toString();
  const backHref = backQuery ? `/admission-journey?${backQuery}` : '/admission-journey';

  const { data, loading, error } = useFetch({
    fetcher: () => api.getAdmissionJourneyStudent(id),
    deps: [id],
    enabled: Boolean(id),
  });

  const header = data?.header;
  const pay = header ? paymentStatus(header) : null;
  const channelTone =
    header?.channel === 'counsellor'
      ? 'warning'
      : header?.channel === 'digital_partner'
        ? 'primary'
        : header?.unmatched_lsq
          ? 'muted'
          : 'neutral';

  return (
    <div className="space-y-5 max-w-5xl">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All students
      </Link>

      {loading && <p className="text-sm text-text-secondary">Loading journey…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {header && (
        <>
          <section className="panel border border-border p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-text-secondary mb-1">
                  <User className="h-4 w-4" />
                  <p className="text-[10px] uppercase tracking-widest">Student</p>
                </div>
                <h1 className="text-xl font-semibold tracking-tight">{header.name || '—'}</h1>
                <p className="text-sm text-text-secondary mt-1">
                  {header.campus || 'Campus not recorded'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill tone={channelTone}>
                  {CHANNEL_LABEL[header.channel] || header.channel}
                </Pill>
                <Pill tone={header.sheet_paid ? 'success' : 'muted'}>
                  Sheet {header.sheet_paid ? header.sheet_status || 'Paid' : header.sheet_status || 'Unpaid'}
                </Pill>
                {header.lms_status && (
                  <Pill tone={header.lms_status.toLowerCase() === 'verified' ? 'success' : 'neutral'}>
                    LMS {header.lms_status}
                  </Pill>
                )}
                {header.unmatched_lsq && <Pill tone="muted">Unmatched in LSQ</Pill>}
                {String(header.block_payment_status || '')
                  .toLowerCase()
                  .includes('partial') && <Pill tone="warning">Block payment - Partial</Pill>}
                {(String(header.block_payment_status || '')
                  .toLowerCase()
                  .includes('full') ||
                  (header.block_payment_done &&
                    !String(header.block_payment_status || '')
                      .toLowerCase()
                      .includes('partial'))) && (
                  <Pill tone="success">Block payment done</Pill>
                )}
                {header.clash && <Pill tone="warning">{header.clash_note?.split('. ')[0] || 'Clash'}</Pill>}
                {header.clash_at_block && <Pill tone="warning">Clash at block amount</Pill>}
                {header.clash_at_admission && (
                  <Pill tone="warning">Clash at admission (sem fee)</Pill>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
              <StatusBox
                label="Status"
                value={pay?.value || 'Not started'}
                tone={pay?.tone || 'muted'}
              />
              <StatusBox
                label="Refund case"
                value={header.refund_case ? 'Yes' : 'No'}
                tone="danger"
                active={Boolean(header.refund_case)}
              />
              <StatusBox
                label="Clash at"
                value={header.clash_with || 'No'}
                tone="warning"
                active={Boolean(header.clash)}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <Fact
                label="Email"
                value={header.email}
              />
              <Fact label="Phone" value={header.phone} />
              <Fact label="LSQ created" value={header.lsq_created_on ? formatWhen(header.lsq_created_on) : undefined} />
              <Fact
                label="Last LSQ activity"
                value={header.lsq_modified_on ? formatWhen(header.lsq_modified_on) : undefined}
              />
              <Fact label="Prospect ID" value={header.lsq_prospect_id} />
              <Fact label="LSQ source" value={header.lsq_source} />
              <Fact label="Contact source (sheet)" value={header.contact_source_sheet} />
              <Fact label="Original UTM medium" value={header.original_utm_medium} />
              <Fact label="Original UTM campaign" value={header.original_utm_campaign || header.lsq_campaign} />
              <Fact label="Test payment source" value={header.source_at_payment} />
              <Fact label="Payment campaign" value={header.campaign_at_payment} />
              <Fact
                label="LSQ stage"
                value={
                  header.lsq_stage_label ||
                  [header.lsq_lead_stage, header.lsq_prospect_stage].filter(Boolean).join(' · ') ||
                  undefined
                }
              />
              <Fact
                label="College"
                value={[header.college_code, header.college_name].filter(Boolean).join(' · ') || header.campus_code}
              />
            </div>
          </section>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="panel border border-border p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">Semester amount</p>
              <p className="text-lg font-semibold kpi-value mt-1">{formatMoney(header.amount_inr)}</p>
              <p className="text-[11px] text-text-secondary mt-1">
                {header.sheet_status || '—'}
                {header.paid_at ? ` · ${formatWhen(header.paid_at)}` : header.dop ? ` · DOP ${formatWhen(header.dop)}` : ''}
              </p>
              {header.sem_utr && (
                <p className="text-[10px] text-text-secondary mt-0.5 truncate" title={header.sem_utr}>
                  UTR: {header.sem_utr}
                </p>
              )}
            </div>
            <div
              className={cn(
                'panel border p-3',
                String(header.block_payment_status || '')
                  .toLowerCase()
                  .includes('partial')
                  ? 'border-amber-400/50 bg-amber-400/5'
                  : 'border-border'
              )}
            >
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">Block amount</p>
              <p className="text-lg font-semibold kpi-value mt-1">{formatMoney(header.block_amount)}</p>
              <p
                className={cn(
                  'text-[11px] mt-1',
                  String(header.block_payment_status || '')
                    .toLowerCase()
                    .includes('partial')
                    ? 'text-amber-400 font-medium'
                    : String(header.block_payment_status || '')
                          .toLowerCase()
                          .includes('full')
                      ? 'text-success'
                      : 'text-text-secondary'
                )}
              >
                {header.block_payment_status || '—'}
              </p>
              {(header.source_at_payment || header.campaign_at_payment) && (
                <p className="text-[10px] text-text-secondary mt-0.5 truncate">
                  {header.source_at_payment || 'No payment source'}
                  {header.campaign_at_payment ? ` · ${header.campaign_at_payment}` : ''}
                </p>
              )}
              {header.block_utr && (
                <p className="text-[10px] text-text-secondary mt-0.5 truncate" title={header.block_utr}>
                  UTR: {header.block_utr}
                </p>
              )}
            </div>
            <div className="panel border border-border p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">LMS verified</p>
              <p className="text-lg font-semibold kpi-value mt-1">
                {formatMoney(header.lms_verified_paid_inr)}
              </p>
              <p className="text-[11px] text-text-secondary mt-1">
                {header.lms_verified_on ? formatWhen(header.lms_verified_on) : header.lms_status || 'No LMS row'}
              </p>
              {header.lms_utr && (
                <p className="text-[10px] text-text-secondary mt-0.5 truncate" title={header.lms_utr}>
                  UTR: {header.lms_utr}
                </p>
              )}
            </div>
            <div className="panel border border-border p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">LMS payable</p>
              <p className="text-lg font-semibold kpi-value mt-1">{formatMoney(header.lms_payable_inr)}</p>
              <p className="text-[11px] text-text-secondary mt-1">{header.lms_status || '—'}</p>
            </div>
          </div>

          <EventStrip events={data?.events ?? []} />

          <StageRail stages={data?.stages ?? []} />

          <section>
            <div className="mb-4">
              <h2 className="text-[11px] uppercase tracking-widest text-text-secondary">
                Contact source to campus
              </h2>
              <p className="text-xs text-text-secondary mt-1">
                LSQ values on the left, sheet values on the right. Empty steps stay visible.
              </p>
            </div>
            <div>
              {(data?.path ?? []).map((step, index, list) => (
                <TimelineStep
                  key={step.key}
                  step={step}
                  index={index}
                  last={index === list.length - 1}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
