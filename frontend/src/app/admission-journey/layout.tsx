'use client';

import { useEffect } from 'react';
import { AdmissionJourneyShell } from '@/components/layout/admission-journey-shell';

export default function AdmissionJourneyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.documentElement.classList.add('admission-journey-root');
    return () => document.documentElement.classList.remove('admission-journey-root');
  }, []);

  return <AdmissionJourneyShell>{children}</AdmissionJourneyShell>;
}
