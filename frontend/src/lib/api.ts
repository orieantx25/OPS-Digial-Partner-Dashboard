import {
  AlertItem,
  AdmissionsSheetStatus,
  BlankCampusRow,
  BlockPaymentBacktracking,
  BlockPaymentSheetStatus,
  CampusAdmissionsSummary,
  CampusBifurcation,
  ChartData,
  DpAdmissionsSummary,
  FilterOptions,
  FilterParams,
  KpiMetric,
  LeadRecord,
  PaginatedResponse,
  PartnerCounsellorClashes,
  PartnerDpRefunds,
  PartnerMetricTrends,
  PersonaAnalytics,
  RefundCaseRow,
  RefundSheetStatus,
  StateSummary,
  UploadJob,
} from '@/types';
import { staticApi } from '@/lib/static-api';
import { isStaticDataMode } from '@/lib/static-mode';

const API_BASE = '/api/v1';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('dp_token');
  if (!token || token === 'portal' || token === 'static') return null;
  return token;
}

function getSyncToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromEnv = process.env.NEXT_PUBLIC_SYNC_ADMIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const message =
      typeof err.detail === 'string'
        ? err.detail
        : Array.isArray(err.detail)
        ? err.detail.map((d: { msg?: string }) => d.msg).join(', ')
        : `Request failed: ${res.status}`;
    throw new Error(message || `Request failed: ${res.status}`);
  }
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return (await res.text()) as unknown as T;
  }
  return res.json();
}

export function filtersToQuery(filters: FilterParams): Record<string, unknown> {
  return { ...filters };
}

const liveApi = {
  login: (username: string, password: string) =>
    request<{ access_token: string; user: { id: string; username: string; role: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) }
    ),

  getMe: () =>
    request<{ id: string; username: string; role: string; partner_scope?: string }>('/auth/me'),

  getStats: () => request<{ total_rows: number; has_data: boolean }>('/analytics/stats'),

  getFilterOptions: () => request<FilterOptions>('/analytics/filters'),

  getExecutiveKpis: (filters: FilterParams) =>
    request<KpiMetric[]>(`/analytics/executive/kpis${buildQuery(filtersToQuery(filters))}`),

  getExecutiveCharts: (filters: FilterParams) =>
    request<Record<string, ChartData>>(
      `/analytics/executive/charts${buildQuery(filtersToQuery(filters))}`
    ),

  getFunnel: (filters: FilterParams) =>
    request<ChartData>(`/analytics/funnel${buildQuery(filtersToQuery(filters))}`),

  getPartner: (filters: FilterParams, partner?: string) =>
    request<unknown>(
      `/analytics/partner${buildQuery({ ...filtersToQuery(filters), partner })}`
    ),

  getPartnerMetricTrends: (
    filters: FilterParams,
    grain: 'daily' | 'weekly' | 'monthly' = 'weekly'
  ) =>
    request<PartnerMetricTrends>(
      `/analytics/partner/trends${buildQuery({
        ...filtersToQuery(filters),
        grain,
      })}`
    ),

  getPartnerCounsellorClashes: (filters: FilterParams) =>
    request<PartnerCounsellorClashes>(
      `/analytics/partner/counsellor-clashes${buildQuery(filtersToQuery(filters))}`
    ),

  getPartnerDpRefunds: (filters: FilterParams) =>
    request<PartnerDpRefunds>(
      `/analytics/partner/dp-refunds${buildQuery(filtersToQuery(filters))}`
    ),

  getContactability: (filters: FilterParams) =>
    request<Record<string, ChartData>>(
      `/analytics/contactability${buildQuery(filtersToQuery(filters))}`
    ),

  getAiCalling: (filters: FilterParams) =>
    request<Record<string, number>>(`/analytics/ai-calling${buildQuery(filtersToQuery(filters))}`),

  getPersona: (filters: FilterParams) =>
    request<PersonaAnalytics>(`/analytics/persona${buildQuery(filtersToQuery(filters))}`),

  getPersonaActivityStatus: () =>
    request<{
      has_data: boolean;
      row_count: number;
      source_filename: string | null;
      uploaded_at: string | null;
    }>('/persona-activity/status'),

  uploadPersonaActivitySheet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      status: string;
      row_count: number;
      source_filename: string;
      uploaded_at: string;
      message: string;
    }>('/persona-activity/upload', { method: 'POST', body: form });
  },

  getCampaign: (filters: FilterParams) =>
    request<Record<string, unknown>[]>(`/analytics/campaign${buildQuery(filtersToQuery(filters))}`),

  getGeographic: (filters: FilterParams) =>
    request<Record<string, unknown>[]>(`/analytics/geographic${buildQuery(filtersToQuery(filters))}`),

  getGeographicStates: (filters: FilterParams) =>
    request<StateSummary[]>(`/analytics/geographic/states${buildQuery(filtersToQuery(filters))}`),

  getRevenue: (filters: FilterParams) =>
    request<Record<string, unknown>>(`/analytics/revenue${buildQuery(filtersToQuery(filters))}`),

  getPredictive: (filters: FilterParams) =>
    request<Record<string, unknown>>(`/analytics/predictive${buildQuery(filtersToQuery(filters))}`),

  getCampusBifurcation: (filters: FilterParams) =>
    request<CampusBifurcation>(
      `/analytics/campus-bifurcation${buildQuery(filtersToQuery(filters))}`
    ),

  getRefundCases: (filters: FilterParams, page = 1, pageSize = 50) =>
    request<PaginatedResponse<RefundCaseRow>>(
      `/refunds/cases${buildQuery({ ...filtersToQuery(filters), page, page_size: pageSize })}`
    ),

  getRefundStatus: () => request<RefundSheetStatus>('/refunds/status'),

  uploadRefundSheet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      status: string;
      row_count: number;
      source_filename: string;
      uploaded_at: string;
      message: string;
    }>('/refunds/upload', { method: 'POST', body: form });
  },

  getAdmissionsStatus: () => request<AdmissionsSheetStatus>('/admissions/status'),

  uploadAdmissionsSheet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      status: string;
      row_count: number;
      paid_count: number;
      source_filename: string;
      uploaded_at: string;
      message: string;
    }>('/admissions/upload', { method: 'POST', body: form });
  },

  getDpAdmissions: (filters: FilterParams) =>
    request<DpAdmissionsSummary>(
      `/analytics/admissions/dp${buildQuery(filtersToQuery(filters))}`
    ),

  getCampusAdmissions: (filters: FilterParams) =>
    request<CampusAdmissionsSummary>(
      `/analytics/admissions/campus${buildQuery(filtersToQuery(filters))}`
    ),

  getBlockPaymentBacktracking: (filters: FilterParams) =>
    request<BlockPaymentBacktracking>(
      `/analytics/block-payment/backtracking${buildQuery(filtersToQuery(filters))}`
    ),

  getBlockPaymentStatus: () =>
    request<BlockPaymentSheetStatus>('/block-payment/status'),

  getBlankCampusRows: () =>
    request<{ items: BlankCampusRow[]; total: number }>('/block-payment/blank-campus'),

  uploadBlockPaymentSheet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      status: string;
      row_count: number;
      source_filename: string;
      uploaded_at: string;
      message: string;
    }>('/block-payment/upload', { method: 'POST', body: form });
  },

  uploadCampusFillSheet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{
      status: string;
      updated: number;
      unmatched: number;
      still_blank: number;
      source_filename: string;
      uploaded_at: string;
      message: string;
    }>('/block-payment/campus-fill', { method: 'POST', body: form });
  },

  getAlerts: (filters: FilterParams) =>
    request<AlertItem[]>(`/analytics/alerts${buildQuery(filtersToQuery(filters))}`),

  getCompare: (filters: FilterParams, grain: 'week' | 'month' = 'week') =>
    request<{
      grain: string;
      current_from?: string;
      current_to?: string;
      previous_from?: string;
      previous_to?: string;
      kpis: {
        key: string;
        label: string;
        current: number;
        previous: number;
        change_pct: number;
      }[];
      funnel_rates: {
        stage: string;
        current_pct: number;
        previous_pct: number;
      }[];
    }>(`/analytics/compare${buildQuery({ ...filtersToQuery(filters), grain })}`),

  getFunnelTrends: (filters: FilterParams) =>
    request<ChartData>(`/analytics/funnel/trends${buildQuery(filtersToQuery(filters))}`),

  getConversionRates: (filters: FilterParams) =>
    request<{
      by_partner: Record<string, unknown>[];
      by_campaign: Record<string, unknown>[];
    }>(`/analytics/conversion-rates${buildQuery(filtersToQuery(filters))}`),

  getCohorts: (filters: FilterParams, by: 'week' | 'month' = 'month') =>
    request<{
      by: string;
      cohorts: Record<string, unknown>[];
    }>(`/analytics/cohorts${buildQuery({ ...filtersToQuery(filters), by })}`),

  getBlockPaymentAttribution: (filters: FilterParams) =>
    request<{
      has_sheet: boolean;
      row_count: number;
      by_source_at_payment: { label: string; count: number }[];
      by_campaign_at_payment: { label: string; count: number }[];
      by_coupon: { label: string; count: number }[];
      by_college: { label: string; count: number }[];
      by_original_utm_campaign: { label: string; count: number }[];
    }>(`/analytics/block-payment/attribution${buildQuery(filtersToQuery(filters))}`),

  getAnomalies: (filters: FilterParams) =>
    request<AlertItem[]>(`/analytics/anomalies${buildQuery(filtersToQuery(filters))}`),

  getGoals: (filters: FilterParams) =>
    request<{
      partners: {
        partner: string;
        block_roi: number;
        target_blocks: number;
        progress_pct: number;
        gap_blocks: number;
        status?: string;
      }[];
      totals: { on_track: number; behind: number };
    }>(`/analytics/goals${buildQuery(filtersToQuery(filters))}`),

  search: (filters: FilterParams, page = 1, pageSize = 50) =>
    request<PaginatedResponse<LeadRecord>>(
      `/analytics/search${buildQuery({ ...filtersToQuery(filters), page, page_size: pageSize })}`
    ),

  uploadStart: (files: File[], onUploadProgress?: (pct: number) => void) =>
    new Promise<{ job_id: string; status: string }>((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onUploadProgress) {
          onUploadProgress((e.loaded / e.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Unexpected server response'));
          }
        } else {
          let msg = `Upload failed: ${xhr.status}`;
          try {
            const j = JSON.parse(xhr.responseText);
            if (typeof j.detail === 'string') msg = j.detail;
          } catch {
            /* keep default */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    }),

  getUploadStatus: (jobId: string) =>
    request<UploadJob>(`/upload/status/${jobId}`, { signal: AbortSignal.timeout(8000) }),

  getUploadHistory: () =>
    request<Record<string, unknown>[]>('/upload/history'),

  getLsqSyncConfig: () =>
    request<{
      enabled: boolean;
      api_host: string;
      requires_token: boolean;
      auto_deploy_leadership?: boolean;
    }>('/sync/config'),

  getLsqSyncLastRun: () =>
    request<{
      status: string;
      mode?: string;
      started_at?: string;
      completed_at?: string;
      leads_synced?: number;
      activities_synced?: number;
      master_total_rows?: number;
      message?: string;
      error?: string;
    }>('/sync/last-run'),

  startLsqSync: (mode: 'incremental' | 'full' = 'incremental', fromDate?: string) => {
    const syncToken = getSyncToken();
    const headers: Record<string, string> = {};
    if (syncToken) headers['X-Sync-Token'] = syncToken;
    return request<{ job_id: string; status: string; mode: string }>('/sync/leadsquared', {
      method: 'POST',
      body: JSON.stringify({ mode, from_date: fromDate ?? null }),
      headers,
    });
  },

  getLsqSyncStatus: (jobId: string) =>
    request<UploadJob>(`/sync/status/${jobId}`, { signal: AbortSignal.timeout(15000) }),

  exportCsv: (filters: FilterParams) =>
    request<string>(`/analytics/export${buildQuery({ ...filtersToQuery(filters), format: 'csv' })}`),
};

type LiveApi = typeof liveApi;

/** Live FastAPI client locally; snapshot JSON when NEXT_PUBLIC_DATA_MODE=static. */
export const api: LiveApi = new Proxy(liveApi, {
  get(target, prop, receiver) {
    if (isStaticDataMode() && typeof prop === 'string' && prop in staticApi) {
      return (staticApi as Record<string, unknown>)[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
}) as LiveApi;
