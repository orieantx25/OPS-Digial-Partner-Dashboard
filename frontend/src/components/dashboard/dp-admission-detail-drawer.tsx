'use client';

import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import { DpAdmissionRow } from '@/types';
import { cn, formatCurrency } from '@/lib/utils';

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

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="panel border border-border p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</p>
      <p className="text-sm mt-1 break-words">{value || '—'}</p>
    </div>
  );
}

function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-1 text-[10px] font-medium uppercase tracking-wide border',
        tone === 'warning' && 'bg-warning/15 text-warning border-warning/30',
        tone === 'success' && 'bg-success/15 text-success border-success/30',
        tone === 'neutral' && 'bg-panel text-text-secondary border-border'
      )}
    >
      {children}
    </span>
  );
}

interface DpAdmissionDetailDrawerProps {
  row: DpAdmissionRow | null;
  onClose: () => void;
}

export function DpAdmissionDetailDrawer({ row, onClose }: DpAdmissionDetailDrawerProps) {
  if (!row) return null;

  const name = row.lead_name || row.student_name || 'Admission';

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/60"
        aria-label="Close admission detail"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-xl bg-bg border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-surface/50">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-text-secondary">
              DP admission
            </div>
            <h2 className="text-lg font-semibold text-text truncate">{name}</h2>
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {row.partner || '—'} · {row.campus_code || '—'}
            </p>
          </div>
          <button type="button" className="btn-secondary p-2 shrink-0" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Pill tone="success">{row.status || 'Paid'}</Pill>
            {row.lms_status && <Pill tone="success">LMS {row.lms_status}</Pill>}
            {row.clash_at_admission && <Pill tone="warning">Clash at admission</Pill>}
            {row.clash_at_block && !row.clash_at_admission && (
              <Pill tone="warning">Clash at block</Pill>
            )}
          </div>

          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-text-secondary">Contact</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Fact label="Email" value={row.email} />
              <Fact label="Phone" value={row.phone} />
              <Fact label="Lead name" value={row.lead_name} />
              <Fact label="Student name (sheet)" value={row.student_name} />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-text-secondary">Payment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Fact label="Sheet ID" value={row.sheet_id} />
              <Fact label="Partner" value={row.partner} />
              <Fact label="Campus" value={row.campus_code} />
              <Fact label="Semester" value={row.semester} />
              <Fact label="Amount" value={formatMoney(row.amount_inr)} />
              <Fact label="Paid at" value={formatWhen(row.paid_at)} />
              <Fact label="Status" value={row.status} />
              <Fact label="Order ID" value={row.order_id} />
              <Fact label="Payment ID" value={row.payment_id} />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-text-secondary">LSQ lead</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Fact label="Lead created" value={formatWhen(row.lead_created_on)} />
              <Fact label="Source" value={row.lead_source} />
              <Fact label="Campaign" value={row.campaign} />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-text-secondary">
              Block payment sheet
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Fact label="Contact source" value={row.contact_source_sheet} />
              <Fact label="Original UTM medium" value={row.original_utm_medium} />
              <Fact label="Original UTM campaign" value={row.original_utm_campaign} />
              <Fact label="Source at payment" value={row.source_at_payment} />
              <Fact label="Campaign at payment" value={row.campaign_at_payment} />
            </div>
          </section>

          {row.journey_id && (
            <Link
              href={`/admission-journey/${row.journey_id}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Open in Admission Journey
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
