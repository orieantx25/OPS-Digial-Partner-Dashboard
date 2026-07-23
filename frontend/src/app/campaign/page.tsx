'use client';

import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useEffectiveFilters } from '@/store/app-store';
import { ChartPanel } from '@/components/charts/chart-panel';
import { DataTable } from '@/components/tables/data-table';
import { PageHeader, SectionHeader } from '@/components/dashboard/section-header';
import { ChartData } from '@/types';
import { formatNumber, formatPct } from '@/lib/utils';

type CampaignRow = Record<string, unknown>;

function isKnownCampaign(value: unknown): boolean {
  const name = String(value ?? '').trim();
  if (!name) return false;
  return name.toLowerCase() !== 'unknown';
}

function aggregateTopCampaigns(rows: CampaignRow[], limit = 5) {
  const byKey = new Map<
    string,
    {
      campaign: string;
      partner: string;
      leads: number;
      applications: number;
      block_amount_paid: number;
    }
  >();

  for (const row of rows) {
    if (!isKnownCampaign(row.campaign)) continue;
    const campaign = String(row.campaign).trim();
    const partner = String(row.partner ?? '').trim() || 'Unknown';
    const key = `${campaign}||${partner}`;
    const cur = byKey.get(key) ?? {
      campaign,
      partner,
      leads: 0,
      applications: 0,
      block_amount_paid: 0,
    };
    cur.leads += Number(row.leads || 0);
    cur.applications += Number(row.applications || 0);
    cur.block_amount_paid += Number(row.block_amount_paid || 0);
    byKey.set(key, cur);
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.leads - a.leads)
    .slice(0, limit);
}

export default function CampaignPage() {
  const filters = useEffectiveFilters();

  const { data } = useFetch({
    fetcher: () => api.getCampaign(filters),
    deps: [JSON.stringify(filters)],
  });

  const rows = useMemo(
    () => ((data ?? []) as CampaignRow[]).filter((row) => isKnownCampaign(row.campaign)),
    [data]
  );

  const topCampaignChart = useMemo((): ChartData | null => {
    const top = aggregateTopCampaigns(rows);
    if (!top.length) return null;
    return {
      chart_id: 'campaign_top5',
      chart_type: 'bar',
      title: 'Top 5 Campaigns',
      // Campaign on first line, partner below — on the X-axis.
      categories: top.map((r) => `${r.campaign}\n${r.partner}`),
      series: [
        { name: 'Leads', data: top.map((r) => r.leads) },
        { name: 'Applications', data: top.map((r) => r.applications) },
        { name: 'Block Amount Paid', data: top.map((r) => r.block_amount_paid) },
      ],
      extra: {
        category_partners: top.map((r) => r.partner),
        multiline_x_labels: true,
      },
    };
  }, [rows]);

  const columns: ColumnDef<CampaignRow>[] = [
    { accessorKey: 'source', header: 'Source' },
    { accessorKey: 'medium', header: 'Medium' },
    { accessorKey: 'campaign', header: 'Campaign' },
    { accessorKey: 'partner', header: 'Partner' },
    { accessorKey: 'state', header: 'State' },
    {
      accessorKey: 'leads',
      header: 'Leads',
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'applications',
      header: 'Applications',
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'block_amount_paid',
      header: 'Block Amount Paid',
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'admissions',
      header: 'Admissions',
      cell: ({ getValue }) => formatNumber(Number(getValue() || 0)),
    },
    {
      accessorKey: 'roi',
      header: 'ROI',
      cell: ({ getValue }) => formatPct(Number(getValue() || 0)),
    },
    { accessorKey: 'cpa', header: 'CPA' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Campaign Analytics" />

      {topCampaignChart && (
        <>
          <SectionHeader
            title="Top 5 Campaigns"
            subtitle="Leads, applications, and block amount paid · campaign and partner on the X-axis"
          />
          <ChartPanel chart={topCampaignChart} height={400} />
        </>
      )}

      <SectionHeader title="Campaign Breakdown" />
      {data && (
        <DataTable
          data={rows}
          columns={columns}
          exportFilename="campaign_analytics.csv"
        />
      )}
    </div>
  );
}
