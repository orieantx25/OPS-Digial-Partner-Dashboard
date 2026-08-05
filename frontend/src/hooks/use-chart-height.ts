'use client';

import { useIsMobile } from '@/hooks/use-is-mobile';

/** Responsive chart height: mobile vs desktop (lg breakpoint). */
export function useChartHeight(desktop: number, mobile = Math.round(desktop * 0.85)): number {
  const isMobile = useIsMobile();
  return isMobile ? mobile : desktop;
}
