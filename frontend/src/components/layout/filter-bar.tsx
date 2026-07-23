'use client';

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, RotateCcw, Upload } from 'lucide-react';
import { LeadSquaredSyncButton } from '@/components/sync/leadsquared-sync-button';
import { canUpload } from '@/hooks/use-auth-bootstrap';
import { api } from '@/lib/api';
import {
  DATE_PRESETS,
  DatePresetId,
  datePresetRange,
  matchDatePreset,
  scopeChipLabel,
} from '@/lib/date-presets';
import {
  getSnapshotManifest,
  isLeadershipMode,
  isStaticDataMode,
  type SnapshotManifest,
  type SnapshotScopeId,
} from '@/lib/static-mode';
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
  const [manifest, setManifest] = useState<SnapshotManifest | null>(null);
  const leadership = isLeadershipMode();
  const staticMode = isStaticDataMode();

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

  useEffect(() => {
    if (!staticMode) return;
    let active = true;
    getSnapshotManifest().then((m) => {
      if (active) setManifest(m);
    });
    return () => {
      active = false;
    };
  }, [staticMode]);

  const activePresetFromManifest = (): SnapshotScopeId | 'all' | null => {
    if (!filters.date_from && !filters.date_to) return 'all';
    if (!manifest?.scopes) return null;
    for (const id of ['7d', 'mtd', '30d', 'month'] as SnapshotScopeId[]) {
      const s = manifest.scopes[id];
      if (!s) continue;
      if (
        (s.date_from || undefined) === filters.date_from &&
        (s.date_to || undefined) === filters.date_to
      ) {
        return id;
      }
    }
    return null;
  };

  const activePreset = staticMode
    ? activePresetFromManifest()
    : matchDatePreset(filters.date_from, filters.date_to);

  const applyPreset = (id: DatePresetId) => {
    if (staticMode && manifest?.scopes?.[id]) {
      const s = manifest.scopes[id];
      setFilters(
        dateRangePatch(s.date_from || undefined, s.date_to || undefined)
      );
      return;
    }
    const range = datePresetRange(id);
    setFilters(dateRangePatch(range.date_from, range.date_to));
  };

  const applyAllTime = () => {
    setFilters(dateRangePatch(undefined, undefined));
  };

  const scopeLabel = scopeChipLabel({
    date_from: filters.date_from,
    date_to: filters.date_to,
    partners: drillDown.partner ? [drillDown.partner] : filters.partner,
  });

  return (
    <div className="sticky top-0 z-30 bg-bg border-b border-border">
      <div className="flex items-end gap-3 px-4 py-2 overflow-x-auto">
        {!leadership && (
          <>
            <div className="flex flex-col gap-0.5 min-w-[120px]">
              <label className="text-[10px] uppercase tracking-wide text-text-secondary">
                Date From
              </label>
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
              <label className="text-[10px] uppercase tracking-wide text-text-secondary">
                Date To
              </label>
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
          </>
        )}
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide text-text-secondary">Preset</label>
          <div className="flex border border-border h-[30px]">
            <button
              type="button"
              onClick={applyAllTime}
              className={
                'px-2 text-[11px] whitespace-nowrap ' +
                (activePreset === 'all' || (!filters.date_from && !filters.date_to)
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:text-text')
              }
            >
              All time
            </button>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={
                  'px-2 text-[11px] whitespace-nowrap ' +
                  (activePreset === p.id
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {!leadership && options && (
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
          {!leadership && <LeadSquaredSyncButton />}
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
      <div className="flex flex-wrap items-center gap-2 px-4 py-1 bg-surface border-t border-border text-xs">
        <span className="text-text-secondary">Scope:</span>
        <span className="text-text font-medium">{scopeLabel}</span>
        {(drillDown.partner || drillDown.state || drillDown.city) && (
          <>
            <span className="text-border">|</span>
            <span className="text-text-secondary">Drill-down:</span>
            {drillDown.partner && <span className="text-primary">{drillDown.partner}</span>}
            {drillDown.state && <span>→ {drillDown.state}</span>}
            {drillDown.city && <span>→ {drillDown.city}</span>}
            <button
              type="button"
              onClick={clearDrillDown}
              className="ml-1 text-text-secondary hover:text-primary"
              aria-label="Clear drill-down"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
