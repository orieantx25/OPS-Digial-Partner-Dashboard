/**
 * Static snapshot client — maps api.* calls to /data/snapshots JSON files.
 */

import type {
  AdmissionJourneyDetail,
  AdmissionJourneyRow,
  AdmissionJourneyStatus,
  FilterParams,
  PaginatedResponse,
  PipelineOverview,
} from '@/types';
import {
  fetchSnapshotJson,
  getSnapshotManifest,
  resolveSnapshotScope,
  type SnapshotManifest,
  type SnapshotScopeId,
} from '@/lib/static-mode';

async function scopeId(filters: FilterParams): Promise<SnapshotScopeId> {
  const manifest = await getSnapshotManifest();
  return resolveSnapshotScope(filters, manifest);
}

async function scoped<T>(filters: FilterParams, file: string): Promise<T> {
  const id = await scopeId(filters);
  return fetchSnapshotJson<T>(`${id}/${file}`);
}

async function partnerFile(
  filters: FilterParams,
  partner: string,
  manifest: SnapshotManifest | null
): Promise<string> {
  const id = resolveSnapshotScope(filters, manifest);
  const fromScope = manifest?.scopes?.[id]?.partners?.[partner];
  if (fromScope) return `${id}/${fromScope}`;

  const slug = manifest?.partner_slugs?.[partner];
  if (slug) return `${id}/partner__${slug}.json`;

  // Last resort: naive slug (may 404)
  const naive = partner.replace(/[^\w\-]+/g, '_').replace(/^_|_$/g, '') || 'partner';
  return `${id}/partner__${naive}.json`;
}

function paginateRows<T>(
  items: T[],
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  const total = items.length;
  const totalPages = pageSize ? Math.ceil(total / pageSize) : 0;
  const start = Math.max(page - 1, 0) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  };
}

function filterJourneyRows(
  items: AdmissionJourneyRow[],
  params: {
    campus?: string;
    clash?: string;
    paid?: string;
    channel?: string;
    search?: string;
  }
): AdmissionJourneyRow[] {
  let rows = items;
  const campus = params.campus?.trim().toLowerCase();
  if (campus) {
    rows = rows.filter((row) =>
      String(row.campus || row.campus_code || '').toLowerCase().includes(campus)
    );
  }
  if (
    params.clash === 'true' ||
    params.clash === '1' ||
    params.clash === 'yes' ||
    params.clash === 'any'
  ) {
    rows = rows.filter((row) => Boolean(row.is_clash));
  } else if (params.clash === 'block' || params.clash === 'clash_at_block') {
    rows = rows.filter((row) => Boolean(row.clash_at_block));
  } else if (params.clash === 'admission' || params.clash === 'clash_at_admission') {
    rows = rows.filter((row) => Boolean(row.clash_at_admission));
  } else if (params.clash === 'false' || params.clash === '0' || params.clash === 'no') {
    rows = rows.filter((row) => !row.is_clash);
  }
  if (params.paid === 'true' || params.paid === '1' || params.paid === 'yes') {
    rows = rows.filter((row) => Boolean(row.sheet_is_paid));
  } else if (params.paid === 'false' || params.paid === '0' || params.paid === 'no') {
    rows = rows.filter((row) => !row.sheet_is_paid);
  }
  if (params.channel && params.channel !== 'all') {
    rows = rows.filter((row) => row.channel === params.channel);
  }
  const search = params.search?.trim();
  if (search) {
    const needle = search.toLowerCase();
    rows = rows.filter((row) => {
      const name = String(row.student_name || '').toLowerCase();
      const email = String(row.email || '').toLowerCase();
      const phone = String(row.phone || '');
      return name.includes(needle) || email.includes(needle) || phone.includes(search);
    });
  }
  return rows;
}

export const staticApi = {
  getStats: () =>
    fetchSnapshotJson<{ total_rows: number; has_data: boolean }>('stats.json'),

  getFilterOptions: () => fetchSnapshotJson('filters.json'),

  getExecutiveKpis: (filters: FilterParams) => scoped(filters, 'executive_kpis.json'),

  getExecutiveCharts: (filters: FilterParams) => scoped(filters, 'executive_charts.json'),

  getFunnel: (filters: FilterParams) => scoped(filters, 'funnel.json'),

  getFunnelTrends: (filters: FilterParams) => scoped(filters, 'funnel_trends.json'),

  getPartner: async (filters: FilterParams, partner?: string) => {
    if (!partner) return scoped(filters, 'partner.json');
    const manifest = await getSnapshotManifest();
    const path = await partnerFile(filters, partner, manifest);
    return fetchSnapshotJson(path);
  },

  getPartnerMetricTrends: (
    filters: FilterParams,
    grain: 'daily' | 'weekly' | 'monthly' = 'weekly'
  ) => scoped(filters, `partner_trends_${grain}.json`),

  getPartnerCounsellorClashes: (filters: FilterParams) =>
    scoped(filters, 'partner_counsellor_clashes.json'),

  getPartnerDpRefunds: (filters: FilterParams) =>
    scoped(filters, 'partner_dp_refunds.json'),

  getContactability: (filters: FilterParams) => scoped(filters, 'contactability.json'),

  getAiCalling: (filters: FilterParams) => scoped(filters, 'ai_calling.json'),

  getPersona: (filters: FilterParams) => scoped(filters, 'persona.json'),

  getPersonaActivityStatus: () => fetchSnapshotJson('persona_activity_status.json'),

  getCampaign: (filters: FilterParams) => scoped(filters, 'campaign.json'),

  getGeographic: (filters: FilterParams) => scoped(filters, 'geographic.json'),

  getGeographicStates: (filters: FilterParams) => scoped(filters, 'geographic_states.json'),

  getRevenue: (filters: FilterParams) => scoped(filters, 'revenue.json'),

  getPredictive: (filters: FilterParams) => scoped(filters, 'predictive.json'),

  getCampusBifurcation: (filters: FilterParams) =>
    scoped(filters, 'campus_bifurcation.json'),

  getRefundCases: (filters: FilterParams, page = 1, pageSize = 50) =>
    scoped(filters, 'refund_cases.json'),

  getRefundStatus: () => fetchSnapshotJson('refund_status.json'),

  getAdmissionsStatus: () => fetchSnapshotJson('admissions_status.json'),

  getAdmissionJourneyStatus: () =>
    fetchSnapshotJson<AdmissionJourneyStatus>('admission_journey_status.json'),

  startAdmissionJourneySync: async () => {
    throw new Error('Sync is only available locally');
  },

  getAdmissionJourneySyncJob: async () => {
    throw new Error('Sync is only available locally');
  },

  getAdmissionJourneyStudents: async (params: {
    campus?: string;
    clash?: string;
    paid?: string;
    channel?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const items = await fetchSnapshotJson<AdmissionJourneyRow[]>(
      'admission_journey_students.json'
    );
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    return paginateRows(filterJourneyRows(items, params), page, pageSize);
  },

  getAdmissionJourneyStudent: async (id: string) => {
    const details = await fetchSnapshotJson<Record<string, AdmissionJourneyDetail>>(
      'admission_journey_details.json'
    );
    const detail = details[id];
    if (!detail) {
      throw new Error('Student journey not found');
    }
    return detail;
  },

  getPipelineOverview: async () => {
    const overview = await fetchSnapshotJson<PipelineOverview>('pipeline_overview.json');
    const { note: _note, ...rest } = overview;
    return rest;
  },

  startPipelineOverviewSync: async () => {
    throw new Error('Sync is only available locally');
  },

  getPipelineOverviewSyncJob: async () => {
    throw new Error('Sync is only available locally');
  },

  getDpAdmissions: (filters: FilterParams) => scoped(filters, 'admissions_dp.json'),

  getCampusAdmissions: (filters: FilterParams) =>
    scoped(filters, 'admissions_campus.json'),

  getBlockPaymentBacktracking: (filters: FilterParams) =>
    scoped(filters, 'block_payment_backtracking.json'),

  getBlockPaymentStatus: () => fetchSnapshotJson('block_payment_status.json'),

  getBlockPaymentAttribution: (filters: FilterParams) =>
    scoped(filters, 'block_payment_attribution.json'),

  getAlerts: (filters: FilterParams) => scoped(filters, 'alerts.json'),

  getAnomalies: (filters: FilterParams) => scoped(filters, 'anomalies.json'),

  getGoals: (filters: FilterParams) => scoped(filters, 'goals.json'),

  getCompare: (filters: FilterParams, grain: 'week' | 'month' = 'week') =>
    scoped(filters, grain === 'month' ? 'compare_month.json' : 'compare_week.json'),

  getConversionRates: (filters: FilterParams) => scoped(filters, 'conversion_rates.json'),

  getCohorts: (filters: FilterParams, by: 'week' | 'month' = 'month') =>
    scoped(filters, by === 'week' ? 'cohorts_week.json' : 'cohorts_month.json'),

  /** Micro-data intentionally unavailable in leadership snapshots. */
  search: async () => ({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
    total_pages: 0,
  }),

  login: async () => ({
    access_token: 'static',
    user: { id: 'leadership', username: 'leadership', role: 'read_only' },
  }),

  getMe: async () => ({
    id: 'leadership',
    username: 'leadership',
    role: 'read_only' as const,
  }),

  getLsqSyncConfig: async () => ({
    enabled: false,
    api_host: '',
    requires_token: false,
  }),

  getLsqSyncLastRun: async () => ({ status: 'disabled' }),

  startLsqSync: async () => {
    throw new Error('LeadSquared sync is not available on the leadership dashboard');
  },

  getLsqSyncStatus: async () => {
    throw new Error('LeadSquared sync is not available on the leadership dashboard');
  },

  uploadStart: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  uploadPersonaActivitySheet: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  uploadBlockPaymentSheet: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  getBlankCampusRows: async () => ({ items: [], total: 0 }),

  uploadCampusFillSheet: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  uploadRefundSheet: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  uploadAdmissionsSheet: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  getUploadStatus: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  getUploadHistory: async () => [],

  exportCsv: async () => {
    throw new Error('Export is not available on the leadership dashboard');
  },
};
