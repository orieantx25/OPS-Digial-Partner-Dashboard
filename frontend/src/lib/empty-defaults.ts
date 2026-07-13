import { KpiMetric, ChartData } from '@/types';

export const EMPTY_KPIS: KpiMetric[] = [
  { key: 'total_leads', label: 'Total Leads', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'connected', label: 'Connected', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'ai_connected', label: 'AI Connected', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'ac_connected', label: 'AC Connected', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'contactability', label: 'Contactability', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'never_dialed', label: 'Leads not Touched', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'mql', label: 'MQL', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'sql', label: 'SQL', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'applications', label: 'Applications', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'test_registrations', label: 'Registrations', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'offer_letters', label: 'Offer Letters', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'block_amount_paid', label: 'Block Amount Paid', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'admissions', label: 'Admissions', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'revenue', label: 'Revenue', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'roi', label: 'ROI %', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'ai_calls', label: 'AI Calls', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'avg_dial_count', label: 'Avg Dial Count', current: 0, previous: 0, change_pct: 0, trend: [] },
  { key: 'dnp_pct', label: 'DNP %', current: 0, previous: 0, change_pct: 0, trend: [] },
];

export function emptyChart(id: string, type: string, title: string): ChartData {
  return { chart_id: id, chart_type: type, title, categories: [], series: [] };
}

export const EMPTY_EXECUTIVE_CHARTS: Record<string, ChartData> = {
  daily_leads: emptyChart('leads_daily', 'line', 'Daily Leads'),
  weekly_leads: emptyChart('leads_weekly', 'line', 'Weekly Leads'),
  monthly_leads: emptyChart('leads_monthly', 'line', 'Monthly Leads'),
  partner_comparison: emptyChart('partner_comparison', 'bar', 'Partner Comparison'),
  lead_sources: emptyChart('lead_sources', 'treemap', 'Lead Sources'),
  state_distribution: emptyChart('state_distribution', 'bar', 'State Distribution'),
  call_distribution: emptyChart('call_distribution', 'bar', 'Call Distribution'),
  funnel: {
    chart_id: 'funnel',
    chart_type: 'funnel',
    title: 'Lead Funnel',
    categories: ['Lead', 'Connected', 'MQL', 'SQL', 'Application', 'Test Registration', 'Interview', 'Offer Letter', 'Block Amount Paid', 'Admission'],
    series: [{ name: 'Count', data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
    extra: {
      conversions: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      drops: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      connected_split: { ai_connected: 0, ac_connected: 0 },
    },
  },
  heatmap: { chart_id: 'heatmap', chart_type: 'heatmap', title: 'Lead Activity Heatmap', categories: [], series: [], extra: { data: [] } },
  contactability_trend: emptyChart('contactability_trend', 'line', 'Contactability Trend'),
};
