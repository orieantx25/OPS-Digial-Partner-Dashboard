import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PortalAuthProvider } from '@/components/auth/portal-auth-provider';

export const metadata: Metadata = {
  title: 'uGSOT Report Hub',
  description: 'Analytics and operations reports for upGrad School of Technology',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F0F10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PortalAuthProvider>{children}</PortalAuthProvider>
      </body>
    </html>
  );
}
