import {
  LayoutDashboard,
  Filter,
  Users,
  Phone,
  Bot,
  UserCircle,
  Megaphone,
  MapPin,
  IndianRupee,
  TrendingUp,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { DASHBOARD_PAGES, NAV_GROUPS } from '@/types';

export const NAV_ICONS: Record<string, LucideIcon> = {
  executive: LayoutDashboard,
  funnel: Filter,
  partner: Users,
  contactability: Phone,
  'ai-calling': Bot,
  persona: UserCircle,
  campaign: Megaphone,
  geographic: MapPin,
  revenue: IndianRupee,
  predictive: TrendingUp,
  'block-payment': Receipt,
};

export const NAV_PAGES = DASHBOARD_PAGES.filter((p) => p.id !== 'upload');

export { NAV_GROUPS };

export function pageTitleForPath(pathname: string): string {
  const page = NAV_PAGES.find(
    (p) =>
      pathname === p.href || (p.href !== '/' && pathname.startsWith(p.href))
  );
  return page?.label ?? 'Dashboard';
}

/** Primary bottom-tab routes for leadership mobile. */
export const MOBILE_BOTTOM_TABS = [
  { id: 'executive', href: '/', label: 'Overview' },
  { id: 'funnel', href: '/funnel', label: 'Funnel' },
  { id: 'partner', href: '/partner', label: 'Partners' },
] as const;
