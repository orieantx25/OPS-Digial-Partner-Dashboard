'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useAppStore, useEffectiveFilters } from '@/store/app-store';
import { IndiaMap } from '@/components/charts/india-map';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { DataTable } from '@/components/tables/data-table';
import { cn, formatNumber } from '@/lib/utils';
import { FUNNEL_STAGES, StateSummary } from '@/types';

const MAP_DIMENSIONS: { key: string; label: string }[] = [
  { key: 'leads', label: 'Total Leads' },
  { key: 'block_amount_paid', label: 'Block Amount Paid' },
  { key: 'admissions', label: 'Admissions' },
  ...FUNNEL_STAGES.filter((s) => s !== 'Block Amount Paid' && s !== 'Admission').map(
    (s) => ({ key: s, label: s })
  ),
];

type StateSort = 'block_desc' | 'leads_desc' | 'name_asc';

const SORT_OPTIONS: { key: StateSort; label: string }[] = [
  { key: 'block_desc', label: 'Block amount ↓' },
  { key: 'leads_desc', label: 'Leads ↓' },
  { key: 'name_asc', label: 'A → Z' },
];

export default function GeographicPage() {
  const filters = useEffectiveFilters();
  const setDrillDown = useAppStore((s) => s.setDrillDown);
  const [dimension, setDimension] = useState<string>('leads');
  const [stateSort, setStateSort] = useState<StateSort>('block_desc');

  const { data: stateSummary } = useFetch({
    fetcher: () => api.getGeographicStates(filters),
    deps: [JSON.stringify(filters)],
  });

  const stateBlockRows = useMemo(() => {
    const rows = (stateSummary ?? []) as StateSummary[];
    const mapped = rows.map((r) => ({
      state: r.state,
      leads: r.leads,
      block_amount_paid: r.block_amount_paid ?? 0,
      admissions: r.admissions,
      block_pct:
        r.leads > 0 ? ((r.block_amount_paid ?? 0) / r.leads) * 100 : 0,
    }));

    return [...mapped].sort((a, b) => {
      if (stateSort === 'name_asc') {
        return a.state.localeCompare(b.state, undefined, { sensitivity: 'base' });
      }
      if (stateSort === 'leads_desc') {
        return b.leads - a.leads || a.state.localeCompare(b.state);
      }
      return b.block_amount_paid - a.block_amount_paid || a.state.localeCompare(b.state);
    });
  }, [stateSummary, stateSort]);

  const stateColumns: ColumnDef<Record<string, unknown>>[] = [
    { accessorKey: 'state', header: 'State', meta: { width: '28%' } },
    {
      accessorKey: 'leads',
      header: 'Leads',
      meta: { width: '18%' },
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'block_amount_paid',
      header: 'Block Amount',
      meta: { width: '18%' },
      cell: ({ getValue }) => (
        <span className="text-amber-300 font-medium kpi-value">
          {formatNumber(Number(getValue() || 0))}
        </span>
      ),
    },
    {
      accessorKey: 'block_pct',
      header: 'Block %',
      meta: { width: '18%' },
      cell: ({ getValue }) => `${Number(getValue() || 0).toFixed(1)}%`,
    },
    {
      accessorKey: 'admissions',
      header: 'Admissions',
      meta: { width: '18%' },
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
  ];

  const activeLabel = MAP_DIMENSIONS.find((d) => d.key === dimension)?.label ?? 'Total Leads';

  return (
    <div className="space-y-4">
      <PageHeader title="Geographic Analytics" />

      <SectionHeader
        title="India — Distribution"
        subtitle={`Coloured by ${activeLabel} per state`}
        action={
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <div className="flex border border-border w-full sm:w-auto">
              {[
                { key: 'leads', label: 'Leads' },
                { key: 'block_amount_paid', label: 'Block Amount' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDimension(opt.key)}
                  className={cn(
                    'flex-1 sm:flex-none px-3 py-2 text-xs min-h-[40px]',
                    dimension === opt.key
                      ? 'bg-primary text-white'
                      : 'bg-surface text-text-secondary hover:text-text'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <select
              className="input-field w-full sm:w-auto text-xs min-h-[40px]"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            >
              {MAP_DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <IndiaMap
        data={stateSummary ?? []}
        dimension={dimension}
        dimensionLabel={activeLabel}
        height={520}
      />

      <SectionHeader
        title="Leads and block amount by state"
        subtitle="Click a row to drill down"
        action={
          <div className="flex border border-border">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStateSort(opt.key)}
                className={cn(
                  'px-3 py-1 text-xs',
                  stateSort === opt.key
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />
      <DataTable
        data={stateBlockRows as unknown as Record<string, unknown>[]}
        columns={stateColumns}
        onRowClick={(row) => setDrillDown({ state: String(row.state) })}
        exportFilename="geographic_leads_block_by_state.csv"
        searchPlaceholder="Search states…"
        height={320}
      />
    </div>
  );
}
