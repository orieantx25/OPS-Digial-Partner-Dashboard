/** Local YYYY-MM-DD (avoids UTC off-by-one from toISOString). */
export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type DatePresetId = '7d' | 'mtd' | '30d' | 'month';

export const DATE_PRESETS: { id: DatePresetId; label: string }[] = [
  { id: '7d', label: 'Last 7d' },
  { id: 'mtd', label: 'MTD' },
  { id: '30d', label: 'Last 30d' },
  { id: 'month', label: 'This month' },
];

export function datePresetRange(id: DatePresetId): {
  date_from: string;
  date_to: string;
  label: string;
} {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const date_to = toYmd(today);

  if (id === '7d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { date_from: toYmd(from), date_to, label: 'Last 7d' };
  }
  if (id === '30d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { date_from: toYmd(from), date_to, label: 'Last 30d' };
  }
  if (id === 'mtd') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: toYmd(from), date_to, label: 'MTD' };
  }
  // This calendar month (1st → last day)
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    date_from: toYmd(from),
    date_to: toYmd(end),
    label: 'This month',
  };
}

export function matchDatePreset(
  date_from?: string,
  date_to?: string
): DatePresetId | null {
  if (!date_from || !date_to) return null;
  for (const { id } of DATE_PRESETS) {
    const range = datePresetRange(id);
    if (range.date_from === date_from && range.date_to === date_to) return id;
  }
  return null;
}

export function scopeChipLabel(opts: {
  date_from?: string;
  date_to?: string;
  partners?: string[];
}): string {
  const preset = matchDatePreset(opts.date_from, opts.date_to);
  let time = 'All time';
  if (preset) {
    time = DATE_PRESETS.find((p) => p.id === preset)?.label ?? preset;
  } else if (opts.date_from && opts.date_to) {
    time = `${opts.date_from} → ${opts.date_to}`;
  } else if (opts.date_from) {
    time = `From ${opts.date_from}`;
  } else if (opts.date_to) {
    time = `Until ${opts.date_to}`;
  }

  const partners =
    !opts.partners?.length
      ? 'All partners'
      : opts.partners.length === 1
        ? opts.partners[0]
        : `${opts.partners.length} partners`;

  return `${time} · ${partners}`;
}
