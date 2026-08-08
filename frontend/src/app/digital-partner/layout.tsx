import { AppShell } from '@/components/layout/app-shell';

export default function DigitalPartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
