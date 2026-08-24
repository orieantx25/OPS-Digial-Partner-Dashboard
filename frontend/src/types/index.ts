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
  lead_age_days?: number;
  device?: string;
  last_activity_date?: string;
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
  { id: 'executive', label: 'Overview', href: '/digital-partner', group: 'Pipeline' },
  { id: 'funnel', label: 'Lead Funnel', href: '/digital-partner/funnel', group: 'Pipeline' },
  { id: 'partner', label: 'Partner Analytics', href: '/digital-partner/partner', group: 'Pipeline' },
  { id: 'contactability', label: 'Contactability', href: '/digital-partner/contactability', group: 'Ops' },
  { id: 'ai-calling', label: 'AI Calling', href: '/digital-partner/ai-calling', group: 'Ops' },
  { id: 'persona', label: 'Persona', href: '/digital-partner/persona', group: 'Ops' },
  { id: 'campaign', label: 'Campaign', href: '/digital-partner/campaign', group: 'Ops' },
  { id: 'geographic', label: 'Geographic', href: '/digital-partner/geographic', group: 'Ops' },
  { id: 'block-payment', label: 'Block Payment', href: '/digital-partner/block-payment', group: 'Ops' },
  { id: 'refund', label: 'Refunds', href: '/digital-partner/refund', group: 'Ops' },
  { id: 'admissions', label: 'Admissions', href: '/digital-partner/admissions', group: 'Ops' },
  { id: 'campus', label: 'Campus', href: '/digital-partner/campus', group: 'Ops' },
  { id: 'revenue', label: 'ROI', href: '/digital-partner/revenue', group: 'Forecast' },
  { id: 'predictive', label: 'Predictive', href: '/digital-partner/predictive', group: 'Forecast' },
  { id: 'upload', label: 'Upload Data', href: '/digital-partner/upload', group: 'Ops' },
] as const;

export const NAV_GROUPS = ['Pipeline', 'Ops', 'Forecast'] as const;

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

export interface PartnerDpRefundRow {
  prospect_id?: string;
  partner?: string;
  name?: string;
  email?: string;
  phone?: string;
  final_status?: string;
  campus?: string;
  university?: string;
  utr?: string;
}

export interface PartnerDpRefunds {
  has_sheet: boolean;
  total_refunds: number;
  by_partner: { partner: string; count: number }[];
  rows: PartnerDpRefundRow[];
}

export type PartnerTrendGrain = 'daily' | 'weekly' | 'monthly';
export type PartnerTrendMetric = 'leads' | 'test_takers' | 'block_amount';

export interface PartnerMetricTrends {
  grain: PartnerTrendGrain;
  periods: string[];
  partners: string[];
  charts: {
    leads: ChartData;
    test_takers: ChartData;
    block_amount: ChartData;
  };
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
  campus_fill_filename?: string | null;
  campus_fill_uploaded_at?: string | null;
  campus_fill_updated_count?: number;
  blank_campus_count?: number;
}

export interface BlankCampusRow {
  sheet_id?: string | null;
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
  gender?: string | null;
  college_code?: string | null;
  college_name?: string | null;
}

export interface CampusGenderRow {
  gender: string;
  count: number;
}

export interface CampusBifurcationRow {
  campus_code: string;
  campus_name: string;
  block_paid: number;
  by_gender: CampusGenderRow[];
}

export interface CampusGenderChart {
  campus_code: string;
  campus_name: string;
  block_paid: number;
  gender_chart: ChartData;
}

export interface CampusShareRow {
  gender?: string;
  campus_code?: string;
  campus_name?: string;
  count: number;
  share_pct: number;
}

export interface CampusMatchedSummary {
  total: number;
  by_gender: CampusShareRow[];
  by_campus: CampusShareRow[];
}

export interface PartnerShareRow {
  partner: string;
  count: number;
  share_pct: number;
}

export interface PartnerShareByGenderRow {
  gender: string;
  partner: string;
  count: number;
  share_of_total_pct: number;
  share_within_gender_pct: number;
}

export interface PartnerShareByCampusRow {
  campus_code: string;
  campus_name: string;
  partner: string;
  count: number;
  share_of_total_pct: number;
  share_within_campus_pct: number;
}

export interface CampusBifurcation {
  has_sheet: boolean;
  total_block_paid: number;
  matched_count: number;
  sheet_total?: number;
  digital_partner_count?: number;
  digital_partner_share_pct?: number;
  by_campus: CampusBifurcationRow[];
  by_gender: CampusGenderRow[];
  sheet_by_campus?: CampusBifurcationRow[];
  sheet_by_gender?: CampusGenderRow[];
  campus_gender_charts?: CampusGenderChart[];
  sheet_campus_gender_charts?: CampusGenderChart[];
  campus_chart?: ChartData;
  gender_chart?: ChartData;
  sheet_campus_chart?: ChartData;
  sheet_gender_chart?: ChartData;
  digital_partner_share_chart?: ChartData;
  matched_summary?: CampusMatchedSummary;
  partner_share?: PartnerShareRow[];
  partner_share_by_gender?: PartnerShareByGenderRow[];
  partner_share_by_campus?: PartnerShareByCampusRow[];
  partner_gender_chart?: ChartData;
  partner_campus_chart?: ChartData;
  refund_summary?: RefundSummary;
  sheet_unassigned_count?: number;
  adjusted_sheet_total?: number;
  active_block_excluded_count?: number;
  adjusted_sheet_by_campus?: CampusBifurcationRow[];
  adjusted_sheet_by_gender?: CampusGenderRow[];
  adjusted_sheet_campus_chart?: ChartData;
  adjusted_sheet_gender_chart?: ChartData;
  adjusted_sheet_campus_gender_charts?: CampusGenderChart[];
  /** Gross block-payment sheet counts by state (sheet `state` column). */
  sheet_state_summary?: StateSummary[];
  /** Active (refund-excluded) sheet counts by state — preferred for Campus Block map. */
  adjusted_sheet_state_summary?: StateSummary[];
  dp_refund_by_campus_chart?: ChartData;
  overall_refund_by_campus_chart?: ChartData;
}

export interface DpRefundRequestsSummary {
  total: number;
  by_campus?: { SSAHE?: number; ADYPU?: number };
  refunded_by_campus?: { SSAHE?: number; ADYPU?: number };
}

export interface RefundSummary {
  total_cases: number;
  retained_cases?: number;
  refunded_cases?: number;
  refund_cases: number;
  refund_processed?: number;
  digital_partner_refund_cases: number;
  by_campus?: { SSAHE?: number; ADYPU?: number };
  refunds_applied_by_campus?: { SSAHE?: number; ADYPU?: number };
  retained_by_campus?: { SSAHE?: number; ADYPU?: number };
  refunded_by_campus?: { SSAHE?: number; ADYPU?: number };
  dp_refund_requests?: DpRefundRequestsSummary;
}

export interface RefundCaseRow {
  serial_no?: string | null;
  utr?: string | null;
  status_finance?: string | null;
  finance_remarks?: string | null;
  final_status?: string | null;
  university?: string | null;
  student_name?: string | null;
  campus?: string | null;
  mentor?: string | null;
  email?: string | null;
  provisional_id?: string | null;
  phone?: string | null;
  remarks?: string | null;
  remarks_sst?: string | null;
  admission_team_remarks?: string | null;
  remarks_11_jul?: string | null;
  remarks_13_jul?: string | null;
  remarks_16_jul?: string | null;
  calling_remarks_21_jul?: string | null;
  mail_link?: string | null;
  is_refund: boolean;
  matched_to_block_payment: boolean;
  is_digital_partner_block_paid: boolean;
  matched_campus_code?: string | null;
}

export interface RefundSheetStatus {
  has_data: boolean;
  row_count: number;
  refund_count: number;
  source_filename?: string | null;
  uploaded_at?: string | null;
  google_configured: boolean;
  public_csv_configured?: boolean;
  service_account_configured?: boolean;
}

export interface AdmissionsSheetStatus {
  has_data: boolean;
  has_payments?: boolean;
  has_lms?: boolean;
  row_count: number;
  paid_count: number;
  lms_row_count?: number;
  verified_count?: number;
  source_filename?: string | null;
  lms_source_filename?: string | null;
  uploaded_at?: string | null;
  google_configured?: boolean;
  public_csv_configured?: boolean;
  service_account_configured?: boolean;
}

export interface AdmissionsFeeStatus {
  has_lms: boolean;
  verified: number;
  partly_paid: number;
  under_review: number;
  rejected: number;
  total_rows: number;
  sem1_rows: number;
  by_status: { status: string; count: number }[];
  status_chart?: ChartData | null;
  by_campus_verified?: { campus_code: string; count: number }[];
}

export interface DpAdmissionRow {
  sheet_id?: string | null;
  email?: string | null;
  phone?: string | null;
  lead_name?: string | null;
  student_name?: string | null;
  partner?: string | null;
  campus_code?: string | null;
  semester?: string | null;
  amount_inr?: string | null;
  paid_at?: string | null;
  status?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  lead_created_on?: string | null;
  lead_source?: string | null;
  campaign?: string | null;
  source_at_payment?: string | null;
  campaign_at_payment?: string | null;
  original_utm_medium?: string | null;
  original_utm_campaign?: string | null;
  contact_source_sheet?: string | null;
  lms_status?: string | null;
  clash_at_admission?: boolean;
  clash_at_block?: boolean;
  journey_id?: string | null;
}

export interface DpAdmissionsSummary {
  has_sheet: boolean;
  total_paid: number;
  verified_sem1?: number;
  dp_matched: number;
  clash_at_admission?: number;
  by_partner: { partner: string; count: number }[];
  partner_chart?: ChartData;
  fee_status?: AdmissionsFeeStatus;
  rows: DpAdmissionRow[];
  rows_total?: number;
  rows_truncated?: boolean;
}

export interface AdmissionReconcileCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface AdmissionReconcileDefinition {
  key: string;
  label: string;
  definition: string;
  value: number;
}

export interface AdmissionReconcile {
  definitions: AdmissionReconcileDefinition[];
  checks: AdmissionReconcileCheck[];
  ok: boolean;
  sheet_paid: number;
  verified_sem1: number;
  dp_matched: number;
  journey_has_data: boolean;
  journey_total: number;
  journey_paid: number;
  journey_last_synced_at?: string | null;
  master_admissions: number;
  has_sheet: boolean;
  has_lms: boolean;
  has_master: boolean;
}

export interface CampusAdmissionRow {
  sheet_id?: string | null;
  email?: string | null;
  phone?: string | null;
  student_name?: string | null;
  campus_code?: string | null;
  semester?: string | null;
  amount_inr?: string | null;
  paid_at?: string | null;
  status?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  state?: string | null;
  gender?: string | null;
  matched_to_block: boolean;
}

export interface CampusAdmissionsSummary {
  has_sheet: boolean;
  total_paid: number;
  verified_sem1?: number;
  matched_to_block: number;
  unmatched_to_block: number;
  by_campus: {
    campus_code: string;
    campus_name: string;
    count: number;
    block_paid?: number;
  }[];
  by_gender: { gender: string; count: number }[];
  campus_chart?: ChartData;
  gender_chart?: ChartData;
  campus_gender_charts?: CampusGenderChart[];
  admission_state_summary?: StateSummary[];
  fee_status?: AdmissionsFeeStatus;
  rows: CampusAdmissionRow[];
}

export type AdmissionJourneyChannel =
  | 'digital_partner'
  | 'counsellor'
  | 'other'
  | 'unmatched_lsq';

export interface AdmissionJourneyStatus {
  has_data: boolean;
  row_count: number;
  unmatched_lsq: number;
  clash_count: number;
  clash_at_block?: number;
  clash_at_admission?: number;
  paid_count: number;
  unpaid_count?: number;
  dp_count?: number;
  counsellor_count?: number;
  other_count?: number;
  block_full_count?: number;
  block_partial_count?: number;
  campuses: string[];
  last_synced_at: string | null;
  admissions_loaded: boolean;
  lsq_configured: boolean;
  clash_cutoff: string;
  sync_job?: {
    job_id: string;
    status: string;
    percent: number;
    message?: string;
    report?: {
      synced?: number;
      total?: number;
      failed?: number;
      unmatched_lsq?: number;
    } | null;
    error?: string | null;
  } | null;
}

export interface AdmissionJourneyRow {
  journey_id: string;
  student_name?: string | null;
  email?: string | null;
  phone?: string | null;
  campus?: string | null;
  campus_code?: string | null;
  sheet_status?: string | null;
  sheet_is_paid?: boolean;
  amount_inr?: string | null;
  lsq_prospect_stage?: string | null;
  lsq_lead_stage?: string | null;
  lsq_source?: string | null;
  lsq_created_on?: string | null;
  lsq_modified_on?: string | null;
  contact_source_sheet?: string | null;
  source_at_payment?: string | null;
  campaign_at_payment?: string | null;
  original_utm_medium?: string | null;
  original_utm_campaign?: string | null;
  lms_status?: string | null;
  lsq_stage_label?: string | null;
  channel: AdmissionJourneyChannel | string;
  is_clash: boolean;
  clash_at_block?: boolean;
  clash_at_admission?: boolean;
  lsq_matched: boolean;
  block_amount_paid_sheet?: string | null;
  block_payment_status?: string | null;
  block_payment_done?: boolean;
  sem_fee_under_review?: boolean;
  sem_fee_verified?: boolean;
  refund_case?: boolean;
}

export interface AdmissionJourneyField {
  label: string;
  lsq?: string | null;
  sheet?: string | null;
  mismatch: boolean;
  empty: boolean;
}

export interface AdmissionJourneyPathStep {
  key: string;
  label: string;
  lsq?: string | null;
  sheet?: string | null;
  date?: string | null;
  mismatch: boolean;
  empty: boolean;
  fields?: AdmissionJourneyField[];
}

export interface AdmissionJourneyStageChip {
  key: string;
  label: string;
  reached: boolean;
  at?: string | null;
  detail?: string | null;
}

export interface AdmissionJourneyDetail {
  header: {
    journey_id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    campus?: string | null;
    campus_code?: string | null;
    college_code?: string | null;
    college_name?: string | null;
    sheet_paid: boolean;
    sheet_status?: string | null;
    lms_status?: string | null;
    channel: string;
    clash: boolean;
    clash_at_block?: boolean;
    clash_at_admission?: boolean;
    clash_note?: string | null;
    clash_with?: string | null;
    unmatched_lsq: boolean;
    lsq_prospect_id?: string | null;
    lsq_created_on?: string | null;
    lsq_modified_on?: string | null;
    lsq_source?: string | null;
    lsq_medium?: string | null;
    lsq_campaign?: string | null;
    lsq_prospect_stage?: string | null;
    lsq_lead_stage?: string | null;
    lsq_stage_label?: string | null;
    contact_source_sheet?: string | null;
    original_utm_medium?: string | null;
    original_utm_campaign?: string | null;
    source_at_payment?: string | null;
    campaign_at_payment?: string | null;
    amount_inr?: string | null;
    block_amount?: string | null;
    block_payment_status?: string | null;
    lms_verified_paid_inr?: string | null;
    lms_payable_inr?: string | null;
    paid_at?: string | null;
    dop?: string | null;
    lms_verified_on?: string | null;
    lms_paid_on?: string | null;
    lms_submitted_on?: string | null;
    sem_utr?: string | null;
    block_utr?: string | null;
    lms_utr?: string | null;
    sheet_created_at?: string | null;
    sheet_updated_at?: string | null;
    block_payment_done?: boolean;
    sem_fee_under_review?: boolean;
    sem_fee_verified?: boolean;
    refund_case?: boolean;
    refund_status?: string | null;
  };
  path: AdmissionJourneyPathStep[];
  stages: AdmissionJourneyStageChip[];
  events: { key: string; label: string; at: string }[];
}

export interface PipelineOverviewStep {
  key: string;
  label: string;
  reached: number;
  at_stage: number;
  conversion_from_previous_pct?: number | null;
  substages?: { label: string; count: number }[];
  lsq_labels: { label: string; count: number }[];
  source?: string;
}

export interface PipelineOverview {
  has_data: boolean;
  lsq_loaded: boolean;
  lms_loaded?: boolean;
  total_leads: number;
  admissions: number;
  last_synced_at?: string | null;
  source?: string;
  steps: PipelineOverviewStep[];
  note?: string;
  sync_job?: UploadJob | null;
}
