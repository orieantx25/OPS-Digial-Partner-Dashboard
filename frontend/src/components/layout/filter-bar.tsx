'use client';

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, RotateCcw, Upload } from 'lucide-react';
import { LeadSquaredSyncButton } from '@/components/sync/leadsquared-sync-button';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/app-store';
import { useUploadStore } from '@/store/upload-store';
import { FilterOptions, FilterParams } from '@/types';

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPos = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    let left = rect.left;
    left = Math.min(left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    setMenuPos({
      top: rect.bottom + 4,
      left,
      width,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onReposition = () => updateMenuPos();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const summary =
    value.length === 0
      ? 'All'
      : value.length === 1
        ? value[0]
        : `${value.length} selected`;

  const menu =
    open &&
    menuPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        className="fixed z-[200] max-h-52 overflow-y-auto bg-panel border border-border shadow-lg"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-xs text-text-secondary">No options</div>
        ) : (
          options.map((o) => (
            <label
              key={o}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface cursor-pointer border-b border-border/30 last:border-0"
            >
              <input
                type="checkbox"
                className="accent-primary shrink-0"
                checked={value.includes(o)}
                onChange={() => toggle(o)}
              />
              <span className="truncate">{o}</span>
            </label>
          ))
        )}
      </div>,
      document.body
    );

  return (
    <div ref={rootRef} className="relative flex flex-col gap-0.5 min-w-[140px]">
      <label className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</label>
      <button
        ref={buttonRef}
        type="button"
        className="input-field text-xs text-left flex items-center justify-between gap-1"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="truncate text-text">{summary}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-text-secondary transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {menu}
    </div>
  );
}

/** Date range takes precedence — drop month/year/week so filters do not conflict. */
function dateRangePatch(from?: string, to?: string) {
  let date_from = from || undefined;
  let date_to = to || undefined;
  if (date_from && date_to && date_from > date_to) {
    [date_from, date_to] = [date_to, date_from];
  }
  return {
    date_from,
    date_to,
    month: undefined,
    year: undefined,
    week: undefined,
    quarter: undefined,
  };
}

/** Filters removed from the bar must not keep applying silently. */
const CLEARED_FILTER_KEYS: Partial<FilterParams> = {
  state: undefined,
  city: undefined,
  lead_stage: undefined,
  ai_status: undefined,
  campaign: undefined,
  source: undefined,
  medium: undefined,
  device: undefined,
  search: undefined,
};

export function FilterBar() {
  const filters = useAppStore((s) => s.filters);
  const setFiltersStore = useAppStore((s) => s.setFilters);
  const resetFiltersStore = useAppStore((s) => s.resetFilters);
  const setGlobalSearch = useAppStore((s) => s.setGlobalSearch);
  const drillDown = useAppStore((s) => s.drillDown);
  const clearDrillDownStore = useAppStore((s) => s.clearDrillDown);
  const openUpload = useUploadStore((s) => s.openUpload);
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);
  const [options, setOptions] = useState<FilterOptions | null>(null);

  const setFilters = useCallback(
    (patch: Partial<FilterParams>) => {
      startTransition(() => setFiltersStore(patch));
    },
    [setFiltersStore]
  );
  const resetFilters = useCallback(() => {
    startTransition(() => resetFiltersStore());
  }, [resetFiltersStore]);
  const clearDrillDown = useCallback(() => {
    startTransition(() => clearDrillDownStore());
  }, [clearDrillDownStore]);

  useEffect(() => {
    // Drop dimensions no longer exposed in the filter bar.
    setFiltersStore(CLEARED_FILTER_KEYS);
    setGlobalSearch('');
  }, [setFiltersStore, setGlobalSearch]);

  useEffect(() => {
    let active = true;
    api
      .getFilterOptions()
      .then((opts) => {
        if (active) setOptions(opts);
      })
      .catch(() => {
        if (active) setOptions(null);
      });
    return () => {
      active = false;
    };
  }, [dataRefreshToken]);

  return (
    <div className="sticky top-0 z-30 bg-bg border-b border-border">
      <div className="flex items-end gap-3 px-4 py-2 overflow-x-auto">
        <div className="flex flex-col gap-0.5 min-w-[120px]">
          <label className="text-[10px] uppercase tracking-wide text-text-secondary">Date From</label>
          <input
            type="date"
            className="input-field text-xs"
            value={filters.date_from || ''}
            max={filters.date_to || undefined}
            onChange={(e) =>
              setFilters(dateRangePatch(e.target.value || undefined, filters.date_to))
            }
          />
        </div>
        <div className="flex flex-col gap-0.5 min-w-[120px]">
          <label className="text-[10px] uppercase tracking-wide text-text-secondary">Date To</label>
          <input
            type="date"
            className="input-field text-xs"
            value={filters.date_to || ''}
            min={filters.date_from || undefined}
            onChange={(e) =>
              setFilters(dateRangePatch(filters.date_from, e.target.value || undefined))
            }
          />
        </div>
        {options && (
          <>
            <MultiSelect
              label="Partner"
              options={options.partners}
              value={filters.partner || []}
              onChange={(v) => setFilters({ partner: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Persona"
              options={options.personas}
              value={filters.persona || []}
              onChange={(v) => setFilters({ persona: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Contact Stage"
              options={options.contact_stages}
              value={filters.contact_stage || []}
              onChange={(v) => setFilters({ contact_stage: v.length ? v : undefined })}
            />
          </>
        )}

        <div className="ml-auto flex items-end gap-2 shrink-0 pl-2 border-l border-border/60">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-text-secondary opacity-0 select-none">
              Actions
            </label>
            <button
              type="button"
              className="btn-secondary flex h-[30px] items-center gap-1 px-3 text-xs"
              onClick={resetFilters}
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <LeadSquaredSyncButton />
          {canUpload() && (
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] uppercase tracking-wide text-text-secondary opacity-0 select-none">
                Upload
              </label>
              <button
                type="button"
                className="btn-primary flex h-[30px] items-center gap-1 px-3 text-xs"
                onClick={openUpload}
              >
                <Upload className="w-3 h-3" /> Upload
              </button>
            </div>
          )}
        </div>
      </div>
      {(drillDown.partner || drillDown.state || drillDown.city) && (
        <div className="flex items-center gap-2 px-4 py-1 bg-surface border-t border-border text-xs">
          <span className="text-text-secondary">Drill-down:</span>
          {drillDown.partner && <span className="text-primary">{drillDown.partner}</span>}
          {drillDown.state && <span>→ {drillDown.state}</span>}
          {drillDown.city && <span>→ {drillDown.city}</span>}
          <button type="button" onClick={clearDrillDown} className="ml-2 text-text-secondary hover:text-primary">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
