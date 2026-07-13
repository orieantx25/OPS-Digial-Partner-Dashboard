export interface FilterParams {
  date_from?: string;
  date_to?: string;
  week?: string;
  month?: string;
  quarter?: string;
  year?: number;
  partner?: string[];
  state?: string[];
  city?: string[];
  persona?: string[];
  lead_stage?: string[];
  contact_stage?: string[];
  ai_status?: string[];
  campaign?: string[];
  source?: string[];
  medium?: string[];
  device?: string[];
  prospect_id?: string;
  search?: string;
  lead_filter?: string;
}

export interface KpiMetric {
  key: string;
  label: string;
  current: number;
  previous: number;
  change_pct: number;
  trend: number[];
}

export interface ChartSeries {
  name: string;
  data: (number | string)[];
}

export interface ChartData {
  chart_id: string;
  chart_type: string;
  title: string;
  categories: string[];
  series: ChartSeries[];
  extra?: Record<string, unknown>;
}

export interface AlertItem {
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  metric_value?: number;
  threshold?: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface UploadReport {
  batch_id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  total_files: number;
  total_rows_read: number;
  total_rows_accepted: number;
  total_rows_rejected: number;
  duplicate_prospect_ids: string[];
  duplicate_count: number;
  file_results: FileUploadResult[];
  issues: ValidationIssue[];
  rejection_summary?: Record<string, number>;
  master_dataset_total_rows: number;
  message: string;
}

export interface FileUploadResult {
  filename: string;
  rows_read: number;
  rows_accepted: number;
  rows_rejected: number;
  issues: ValidationIssue[];
  rejection_summary?: Record<string, number>;
  success: boolean;
}

export interface ValidationIssue {
  issue_type: string;
  message: string;
  row_number?: number;
  column?: string;
  value?: string;
  prospect_id?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  role: string;
  partner_scope?: string;
}

export interface LeadRecord {
  prospect_id: string;
  name: string;
  email: string;
  phone?: string;
  partner: string;
  state: string;
  city?: string;
  lead_stage: string;
  contact_stage: string;
  funnel_stage: string;
  date: string;
  total_dialed_count: number;
  connected: boolean;
  mql: boolean;
  sql: boolean;
  application: boolean;
  admission: boolean;
  revenue?: number;
}

export interface UploadJob {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  phase: string;
  percent: number;
  rows_total: number;
  rows_processed: number;
  message: string;
  report: UploadReport | null;
  error: string | null;
}

export interface StateSummary {
  state: string;
  leads: number;
  admissions: number;
  block_amount_paid?: number;
  stages: Record<string, number>;
}

export const FUNNEL_STAGES = [
  'Lead',
  'Connected',
  'MQL',
  'SQL',
  'Application',
  'Test Registration',
  'Interview',
  'Offer Letter',
  'Block Amount Paid',
  'Admission',
] as const;

export interface FilterOptions {
  partners: string[];
  states: string[];
  cities: string[];
  personas: string[];
  lead_stages: string[];
  contact_stages: string[];
  ai_statuses: string[];
  campaigns: string[];
  sources: string[];
  mediums: string[];
  devices: string[];
  months: string[];
  years: string[];
}

export const DASHBOARD_PAGES = [
  { id: 'executive', label: 'Overview', href: '/' },
  { id: 'funnel', label: 'Lead Funnel', href: '/funnel' },
  { id: 'partner', label: 'Partner Analytics', href: '/partner' },
  { id: 'contactability', label: 'Contactability', href: '/contactability' },
  { id: 'ai-calling', label: 'AI Calling', href: '/ai-calling' },
  { id: 'persona', label: 'Persona', href: '/persona' },
  { id: 'campaign', label: 'Campaign', href: '/campaign' },
  { id: 'geographic', label: 'Geographic', href: '/geographic' },
  { id: 'revenue', label: 'ROI', href: '/revenue' },
  { id: 'predictive', label: 'Predictive', href: '/predictive' },
  { id: 'block-payment', label: 'Block Payment Back tracking', href: '/block-payment' },
  { id: 'upload', label: 'Upload Data', href: '/upload' },
] as const;

export interface PartnerCounsellorClash {
  prospect_id: string;
  partner: string;
  name?: string;
  email?: string;
  phone?: string;
  contact_source?: string;
  source_at_payment?: string;
  campaign_at_payment?: string;
  campus?: string;
  match_method?: string;
}

export interface PartnerCounsellorClashes {
  has_sheet: boolean;
  total_clashes: number;
  by_partner: { partner: string; count: number }[];
  rows: PartnerCounsellorClash[];
}

export interface PersonaSummary {
  know_more_about_btech: number;
  /** Non-blank personas that are not Know More about B.Tech (main DB). */
  other_persona: number;
  /** @deprecated alias of other_persona */
  know_more?: number;
  registration: number;
  offer_letter_sent: number;
  /** Activity-report matched Know More about B.Tech (excl. Kollege Apply). */
  know_more_about_btech_last_24h: number;
  /** Main-DB leads created in last 24h (excl. Kollege Apply). */
  created_last_24h?: number;
}

export interface PersonaActivitySheetStatus {
  has_data: boolean;
  report_rows: number;
  matched_leads: number;
  unmatched_report_rows: number;
  source_filename?: string | null;
  uploaded_at?: string | null;
}

export interface PersonaAnalytics {
  summary: PersonaSummary;
  rows: Record<string, unknown>[];
  charts: {
    partner_overall: ChartData;
    partner_last_24h: ChartData;
    stage_overall: ChartData;
    stage_last_24h: ChartData;
  };
  activity_sheet?: PersonaActivitySheetStatus;
}

export interface BlockPaymentTrackingRow {
  prospect_id: string;
  partner?: string;
  name?: string;
  email?: string;
  phone?: string;
  contact_source?: string;
  source_at_payment?: string;
  campaign_at_payment?: string;
  campus?: string;
  match_status: 'matched' | 'unmatched' | 'no_sheet';
  match_method?: string | null;
  is_clash?: boolean;
}

export interface BlockPaymentBacktracking {
  has_sheet: boolean;
  sheet_row_count: number;
  total_block_paid: number;
  matched_count: number;
  unmatched_count: number;
  counsellor_count: number;
  clash_count: number;
  clashes_by_partner: { partner: string; count: number }[];
  clash_rows: BlockPaymentTrackingRow[];
  rows: BlockPaymentTrackingRow[];
  state_summary: StateSummary[];
}

export interface BlockPaymentSheetStatus {
  has_data: boolean;
  row_count: number;
  source_filename?: string | null;
  uploaded_at?: string | null;
}
