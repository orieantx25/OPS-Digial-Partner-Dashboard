/** Header labels for cycle / as-of / sync timestamps. */

export function formatAsOfDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatSyncTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { timeStyle: 'short' });
}

export function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00`);
}
