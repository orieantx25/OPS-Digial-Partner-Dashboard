'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { cn, downloadBlob, formatNumber } from '@/lib/utils';
import { isLeadershipMode } from '@/lib/static-mode';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface ColumnMeta {
  width?: string;
  minWidth?: number;
}

interface DataTableProps<T extends object> {
  data: T[];
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  exportFilename?: string;
  searchPlaceholder?: string;
  height?: number;
  onSearchChange?: (term: string) => void;
  searchValue?: string;
  totalCount?: number;
  /** Force classic table even on mobile. Default: cards on mobile. */
  variant?: 'auto' | 'table' | 'cards';
}

function columnMeta(col: { columnDef: { meta?: unknown } }): ColumnMeta {
  return (col.columnDef.meta as ColumnMeta | undefined) ?? {};
}

function columnWidth(col: { columnDef: { meta?: unknown } }, total: number): string {
  const meta = columnMeta(col);
  if (meta.minWidth) return `minmax(${meta.minWidth}px, 1fr)`;
  return meta.width ?? `${100 / Math.max(total, 1)}%`;
}

function headerLabel(col: ColumnDef<object>): string {
  if (typeof col.header === 'string') return col.header;
  const id = 'accessorKey' in col && col.accessorKey != null ? String(col.accessorKey) : col.id;
  return id ?? '';
}

export function DataTable<T extends object>({
  data,
  columns,
  onRowClick,
  exportFilename = 'export.csv',
  searchPlaceholder = 'Search...',
  height = 400,
  onSearchChange,
  searchValue,
  totalCount,
  variant = 'auto',
}: DataTableProps<T>) {
  const isMobile = useIsMobile();
  const useCards =
    variant === 'cards' || (variant === 'auto' && isMobile);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const parentRef = useRef<HTMLDivElement>(null);

  const serverSearch = typeof onSearchChange === 'function';
  const inputValue = serverSearch ? searchValue ?? '' : globalFilter;
  const handleSearchInput = useCallback(
    (v: string) => {
      if (serverSearch) onSearchChange!(v);
      else setGlobalFilter(v);
    },
    [serverSearch, onSearchChange]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: serverSearch ? '' : globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (useCards ? 88 : 40),
    overscan: 10,
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const gridTemplateColumns = useMemo(
    () => visibleColumns.map((col) => columnWidth(col, visibleColumns.length)).join(' '),
    [visibleColumns]
  );
  const tableMinWidth = useMemo(() => {
    const mins = visibleColumns.map((col) => columnMeta(col).minWidth ?? 96);
    return Math.max(640, mins.reduce((sum, n) => sum + n, 0));
  }, [visibleColumns]);

  const handleExport = useCallback(() => {
    const visibleCols = table.getVisibleFlatColumns();
    const headers = visibleCols.map((c) => c.id).join(',');
    const body = rows
      .map((row) =>
        visibleCols.map((col) => JSON.stringify(row.getValue(col.id) ?? '')).join(',')
      )
      .join('\n');
    downloadBlob(`${headers}\n${body}`, exportFilename);
  }, [rows, table, exportFilename]);

  const resolvedHeight = useCards ? Math.min(height, 420) : height;

  return (
    <div className="panel flex flex-col">
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-border">
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
          <input
            className="input-field pl-8 min-h-[40px]"
            placeholder={searchPlaceholder}
            value={inputValue}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>
        {typeof totalCount === 'number' && (
          <span className="text-xs text-text-secondary tabular-nums">
            {formatNumber(totalCount)} matches
          </span>
        )}
        {!isLeadershipMode() && (
          <button
            type="button"
            className="btn-secondary flex items-center gap-1 ml-auto min-h-[40px]"
            onClick={handleExport}
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        )}
      </div>

      {useCards ? (
        <div ref={parentRef} style={{ height: resolvedHeight, overflowY: 'auto' }} className="p-2 space-y-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-text-secondary text-sm">No data</div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const cells = row.getVisibleCells();
                const primary = cells[0];
                const rest = cells.slice(1, 4);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={cn(
                      'w-full text-left panel bg-surface border border-border p-3 space-y-2',
                      onRowClick && 'active:border-primary'
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    <div className="text-sm font-medium text-text truncate">
                      {primary
                        ? flexRender(primary.column.columnDef.cell, primary.getContext())
                        : '—'}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {rest.map((cell) => (
                        <div key={cell.id} className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-text-secondary truncate">
                            {headerLabel(cell.column.columnDef as ColumnDef<object>)}
                          </div>
                          <div className="text-sm text-text-secondary truncate">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: tableMinWidth }}>
            <div
              className="grid border-b border-border bg-panel sticky top-0 z-10"
              style={{ gridTemplateColumns }}
            >
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <div
                  key={header.id}
                  role="columnheader"
                  className="text-left px-3 py-2 text-text-secondary font-medium text-[11px] uppercase tracking-wide cursor-pointer select-none leading-tight"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                </div>
              ))}
            </div>

            <div ref={parentRef} style={{ height, overflowY: 'auto', overflowX: 'hidden' }}>
              {rows.length === 0 ? (
                <div className="p-8 text-center text-text-secondary text-sm">No data</div>
              ) : (
                <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    return (
                      <div
                        key={row.id}
                        role="row"
                        className={cn(
                          'grid border-b border-border/50 hover:bg-surface items-center',
                          onRowClick && 'cursor-pointer'
                        )}
                        style={{
                          gridTemplateColumns,
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        onClick={() => onRowClick?.(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            role="cell"
                            className="px-3 py-2 text-sm text-text-secondary truncate min-w-0"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function useLeadColumns(): ColumnDef<Record<string, unknown>>[] {
  return useMemo(
    () => [
      { accessorKey: 'prospect_id', header: 'Prospect ID', meta: { minWidth: 110 } },
      { accessorKey: 'name', header: 'Name', meta: { minWidth: 120 } },
      { accessorKey: 'email', header: 'Email', meta: { minWidth: 160 } },
      { accessorKey: 'phone', header: 'Phone', meta: { minWidth: 110 } },
      { accessorKey: 'partner', header: 'Partner', meta: { minWidth: 120 } },
      { accessorKey: 'state', header: 'State', meta: { minWidth: 100 } },
      { accessorKey: 'city', header: 'City', meta: { minWidth: 100 } },
      { accessorKey: 'funnel_stage', header: 'Stage', meta: { minWidth: 110 } },
      { accessorKey: 'contact_stage', header: 'Contact', meta: { minWidth: 120 } },
      { accessorKey: 'date', header: 'Date', meta: { minWidth: 100 } },
      { accessorKey: 'lead_age_days', header: 'Age (days)', meta: { minWidth: 90 } },
      { accessorKey: 'device', header: 'Device', meta: { minWidth: 90 } },
      { accessorKey: 'last_activity_date', header: 'Last activity', meta: { minWidth: 110 } },
    ],
    []
  );
}
