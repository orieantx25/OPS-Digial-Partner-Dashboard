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
}

function columnMeta(col: { columnDef: { meta?: unknown } }): ColumnMeta {
  return (col.columnDef.meta as ColumnMeta | undefined) ?? {};
}

function columnWidth(col: { columnDef: { meta?: unknown } }, total: number): string {
  const meta = columnMeta(col);
  if (meta.minWidth) return `minmax(${meta.minWidth}px, 1fr)`;
  return meta.width ?? `${100 / Math.max(total, 1)}%`;
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
}: DataTableProps<T>) {
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
    estimateSize: () => 40,
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

  return (
    <div className="panel flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
          <input
            className="input-field pl-8"
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
          <button type="button" className="btn-secondary flex items-center gap-1 ml-auto" onClick={handleExport}>
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        )}
      </div>

      {/* One horizontal scroller so headers and rows move together */}
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
