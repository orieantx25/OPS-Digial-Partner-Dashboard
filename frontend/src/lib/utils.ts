import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Full number with Indian grouping — never abbreviated as K/M (e.g. 5,63,457). */
export function formatNumber(n: number, decimals = 0): string {
  if (decimals > 0) {
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return Math.round(n).toLocaleString('en-IN');
}

/** @deprecated Use formatNumber — kept for call-site clarity. */
export function formatInteger(n: number): string {
  return formatNumber(n);
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Plain percentage value, always two decimal places (e.g. 12.34%). */
export function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/** KPI delta badge with direction arrow, two decimal places. */
export function formatPercent(n: number): string {
  const sign = n > 0 ? '▲' : n < 0 ? '▼' : '—';
  return `${sign} ${Math.abs(n).toFixed(2)}%`;
}

export function downloadBlob(content: string, filename: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
