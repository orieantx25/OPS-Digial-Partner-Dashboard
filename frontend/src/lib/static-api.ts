/**
 * Static snapshot client — maps api.* calls to /data/snapshots JSON files.
 */

import type { FilterParams } from '@/types';
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

  getPartnerCounsellorClashes: (filters: FilterParams) =>
    scoped(filters, 'partner_counsellor_clashes.json'),

  getContactability: (filters: FilterParams) => scoped(filters, 'contactability.json'),

  getAiCalling: (filters: FilterParams) => scoped(filters, 'ai_calling.json'),

  getPersona: (filters: FilterParams) => scoped(filters, 'persona.json'),

  getPersonaActivityStatus: () => fetchSnapshotJson('persona_activity_status.json'),

  getCampaign: (filters: FilterParams) => scoped(filters, 'campaign.json'),

  getGeographic: (filters: FilterParams) => scoped(filters, 'geographic.json'),

  getGeographicStates: (filters: FilterParams) => scoped(filters, 'geographic_states.json'),

  getRevenue: (filters: FilterParams) => scoped(filters, 'revenue.json'),

  getPredictive: (filters: FilterParams) => scoped(filters, 'predictive.json'),

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

  getUploadStatus: async () => {
    throw new Error('Upload is not available on the leadership dashboard');
  },

  getUploadHistory: async () => [],

  exportCsv: async () => {
    throw new Error('Export is not available on the leadership dashboard');
  },
};
