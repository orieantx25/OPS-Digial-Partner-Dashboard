'use client';

import { useEffect } from 'react';
import { CampusBlockShell } from '@/components/layout/campus-block-shell';

export default function CampusBlockLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('campus-block-root');
    return () => document.documentElement.classList.remove('campus-block-root');
  }, []);

  return <CampusBlockShell>{children}</CampusBlockShell>;
}
