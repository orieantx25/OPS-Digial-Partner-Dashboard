'use client';

import { useEffect, useState } from 'react';

/** Matches Tailwind `lg` (1024px). Below this we use the mobile shell. */
export const MOBILE_BREAKPOINT_PX = 1024;

export function useIsMobile(breakpointPx = MOBILE_BREAKPOINT_PX): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [breakpointPx]);

  return isMobile;
}
