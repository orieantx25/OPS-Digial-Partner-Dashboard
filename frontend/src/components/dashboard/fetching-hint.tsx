'use client';

import { cn } from '@/lib/utils';

/** Thin indicator while refetching — does not blank the page. */
export function FetchingHint({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <p className={cn('text-text-secondary text-xs animate-pulse', className)}>
      Updating…
    </p>
  );
}
