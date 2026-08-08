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
  Building2,
  Receipt,
  Undo2,
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
  refund: Undo2,
  campus: Building2,
};

export const NAV_PAGES = DASHBOARD_PAGES.filter((p) => p.id !== 'upload');

export { NAV_GROUPS };

export function pageTitleForPath(pathname: string): string {
  const page = NAV_PAGES.find(
    (p) =>
      pathname === p.href ||
      (p.href !== '/digital-partner' && pathname.startsWith(p.href))
  );
  return page?.label ?? 'Dashboard';
}

/** Primary bottom-tab routes for leadership mobile. */
export const MOBILE_BOTTOM_TABS = [
  { id: 'executive', href: '/digital-partner', label: 'Overview' },
  { id: 'funnel', href: '/digital-partner/funnel', label: 'Funnel' },
  { id: 'partner', href: '/digital-partner/partner', label: 'Partners' },
] as const;

/** Quick links for block payment, refunds, and ROI (mobile drawer). */
export const MOBILE_INSIGHT_LINKS = [
  { id: 'campus', href: '/digital-partner/campus', label: 'Campus & block KPIs' },
  { id: 'refund', href: '/digital-partner/refund', label: 'Refund cases & KPIs' },
  { id: 'revenue', href: '/digital-partner/revenue', label: 'ROI (DP refunds)' },
] as const;
