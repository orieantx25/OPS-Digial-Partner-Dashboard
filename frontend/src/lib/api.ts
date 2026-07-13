import {
  AlertItem,
  BlockPaymentBacktracking,
  BlockPaymentSheetStatus,
  ChartData,
  FilterOptions,
  FilterParams,
  KpiMetric,
  LeadRecord,
  PaginatedResponse,
  PartnerCounsellorClashes,
  PersonaAnalytics,
  PersonaSummary,
  StateSummary,
  UploadJob,
} from '@/types';

const API_BASE = '/api/v1';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('dp_token');
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

export const api = {
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

  getPartnerCounsellorClashes: (filters: FilterParams) =>
    request<PartnerCounsellorClashes>(
      `/analytics/partner/counsellor-clashes${buildQuery(filtersToQuery(filters))}`
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

  getBlockPaymentBacktracking: (filters: FilterParams) =>
    request<BlockPaymentBacktracking>(
      `/analytics/block-payment/backtracking${buildQuery(filtersToQuery(filters))}`
    ),

  getBlockPaymentStatus: () =>
    request<BlockPaymentSheetStatus>('/block-payment/status'),

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

  getAlerts: (filters: FilterParams) =>
    request<AlertItem[]>(`/analytics/alerts${buildQuery(filtersToQuery(filters))}`),

  search: (filters: FilterParams, page = 1, pageSize = 50) =>
    request<PaginatedResponse<LeadRecord>>(
      `/analytics/search${buildQuery({ ...filtersToQuery(filters), page, page_size: pageSize })}`
    ),

  /**
   * Starts a background upload. Resolves with a job_id once the file bytes have
   * been received by the server. `onUploadProgress` reports network upload % (0-100).
   */
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

  exportCsv: (filters: FilterParams) =>
    request<string>(`/analytics/export${buildQuery({ ...filtersToQuery(filters), format: 'csv' })}`),
};
