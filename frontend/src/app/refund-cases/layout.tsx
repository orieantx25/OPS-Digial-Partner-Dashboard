'use client';

import { useEffect } from 'react';
import { RefundCasesShell } from '@/components/layout/refund-cases-shell';

export default function RefundCasesLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('refund-cases-root');
    return () => document.documentElement.classList.remove('refund-cases-root');
  }, []);

  return <RefundCasesShell>{children}</RefundCasesShell>;
}
