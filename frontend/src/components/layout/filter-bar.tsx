'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, RotateCcw, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/app-store';
import { useUploadStore } from '@/store/upload-store';
import { FilterOptions } from '@/types';

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
    // Keep menu inside the viewport.
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
    // Capture scroll from overflow-x filter row and page.
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

export function FilterBar() {
  const { filters, setFilters, resetFilters, globalSearch, setGlobalSearch, drillDown, clearDrillDown } =
    useAppStore();
  const openUpload = useUploadStore((s) => s.openUpload);
  const dataRefreshToken = useUploadStore((s) => s.dataRefreshToken);
  const [options, setOptions] = useState<FilterOptions | null>(null);

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
              label="State"
              options={options.states}
              value={filters.state || []}
              onChange={(v) => setFilters({ state: v.length ? v : undefined })}
            />
            <MultiSelect
              label="City"
              options={options.cities}
              value={filters.city || []}
              onChange={(v) => setFilters({ city: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Persona"
              options={options.personas}
              value={filters.persona || []}
              onChange={(v) => setFilters({ persona: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Lead Stage"
              options={options.lead_stages}
              value={filters.lead_stage || []}
              onChange={(v) => setFilters({ lead_stage: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Contact Stage"
              options={options.contact_stages}
              value={filters.contact_stage || []}
              onChange={(v) => setFilters({ contact_stage: v.length ? v : undefined })}
            />
            <MultiSelect
              label="AI Status"
              options={options.ai_statuses}
              value={filters.ai_status || []}
              onChange={(v) => setFilters({ ai_status: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Campaign"
              options={options.campaigns}
              value={filters.campaign || []}
              onChange={(v) => setFilters({ campaign: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Source"
              options={options.sources}
              value={filters.source || []}
              onChange={(v) => setFilters({ source: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Medium"
              options={options.mediums}
              value={filters.medium || []}
              onChange={(v) => setFilters({ medium: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Device"
              options={options.devices}
              value={filters.device || []}
              onChange={(v) => setFilters({ device: v.length ? v : undefined })}
            />
          </>
        )}
        <div className="flex flex-col gap-0.5 min-w-[160px]">
          <label className="text-[10px] uppercase tracking-wide text-text-secondary">Search Prospect ID</label>
          <input
            className="input-field text-xs"
            placeholder="ID, phone, email..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary flex items-center gap-1 text-xs" onClick={resetFilters}>
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
        <button type="button" className="btn-primary flex items-center gap-1 text-xs" onClick={openUpload}>
          <Upload className="w-3 h-3" /> Upload
        </button>
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
