'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { StateSummary } from '@/types';
import { formatNumber } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-is-mobile';

// Official LGD 2024 boundaries (36 states & UTs incl. Ladakh, post-2019 J&K split).
const MAP_NAME = 'india-lgd-2024';
const GEOJSON_URL = '/india-states.geojson?v=2024';

// Data state names that differ from GeoJSON NAME_1. Key = normalized data name.
const NAME_ALIASES: Record<string, string> = {
  orissa: 'odisha',
  uttaranchal: 'uttarakhand',
  pondicherry: 'puducherry',
  'nct of delhi': 'delhi',
  'delhi ncr': 'delhi',
  'jammu & kashmir': 'jammu and kashmir',
  'andaman and nicobar islands': 'andaman and nicobar',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  andhra_pradesh: 'andhra pradesh',
  himachal_pradesh: 'himachal pradesh',
  madhya_pradesh: 'madhya pradesh',
  uttar_pradesh: 'uttar pradesh',
  west_bengal: 'west bengal',
};

function normalizeStateInput(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/_/g, ' ');
  // Strip trailing pin/postal codes accidentally stored in state field.
  s = s.replace(/\s+\d{5,6}$/, '');
  return NAME_ALIASES[s] ?? s;
}

let mapRegistered = false;

interface IndiaMapProps {
  data: StateSummary[];
  dimension: string; // 'leads' | 'admissions' | a funnel stage label
  dimensionLabel: string;
  height?: number;
  topLabels?: number;
  title?: string;
}

export function IndiaMap({
  data,
  dimension,
  dimensionLabel,
  height = 480,
  topLabels = 5,
  title,
}: IndiaMapProps) {
  const isMobile = useIsMobile();
  const resolvedHeight = isMobile ? Math.min(height, 280) : height;
  const [geo, setGeo] = useState<{ features: { properties: { NAME_1: string } }[] } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(GEOJSON_URL)
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        if (!mapRegistered) {
          echarts.registerMap(MAP_NAME, json);
          mapRegistered = true;
        }
        setGeo(json);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const canonicalByLower = useMemo(() => {
    const m: Record<string, string> = {};
    if (geo) {
      for (const f of geo.features) {
        const n = f.properties?.NAME_1;
        if (n) m[n.toLowerCase()] = n;
      }
    }
    return m;
  }, [geo]);

  const { seriesData, max, minPositive } = useMemo(() => {
    type Item = {
      name: string;
      value: number;
      label?: { show: boolean; formatter: string; color: string; fontSize: number; fontWeight: string };
    };

    const valueByRegion: Record<string, number> = {};
    for (const s of data) {
      const region = canonicalByLower[normalizeStateInput(s.state)];
      if (!region) continue;
      const value =
        dimension === 'leads'
          ? s.leads
          : dimension === 'admissions'
          ? s.admissions
          : dimension === 'block_amount_paid'
          ? s.block_amount_paid || s.stages?.['Block Amount Paid'] || 0
          : s.stages?.[dimension] || 0;
      valueByRegion[region] = (valueByRegion[region] || 0) + value;
    }

    const out: Item[] = [];
    let mx = 1;
    let minPos = Infinity;
    if (geo) {
      for (const f of geo.features) {
        const region = f.properties?.NAME_1;
        if (!region) continue;
        const value = valueByRegion[region] ?? 0;
        if (value > mx) mx = value;
        if (value > 0 && value < minPos) minPos = value;
        out.push({ name: region, value });
      }
    } else {
      for (const [region, value] of Object.entries(valueByRegion)) {
        if (value > mx) mx = value;
        if (value > 0 && value < minPos) minPos = value;
        out.push({ name: region, value });
      }
    }

    [...out]
      .sort((a, b) => b.value - a.value)
      .slice(0, topLabels)
      .forEach((item) => {
        if (item.value <= 0) return;
        item.label = {
          show: true,
          formatter: formatNumber(item.value),
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 'bold',
        };
      });

    return {
      seriesData: out,
      max: mx,
      minPositive: Number.isFinite(minPos) ? minPos : 1,
    };
  }, [data, canonicalByLower, dimension, topLabels, geo]);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#202124',
      borderColor: '#3A3A3A',
      textStyle: { color: '#FFF' },
      formatter: (p: { name: string; value?: number }) =>
        `<strong>${p.name}</strong><br/>${dimensionLabel}: ${
          formatNumber(Number.isFinite(p.value) ? p.value! : 0)
        }`,
    },
    visualMap: {
      min: minPositive,
      max,
      left: 8,
      bottom: 8,
      calculable: true,
      inRange: { color: ['#FFDADA', '#FFAAAA', '#F06666', '#D93030', '#8B1010'] },
      outOfRange: { color: '#1A1A1A' },
      textStyle: { color: '#B5B5B5' },
    },
    series: [
      {
        type: 'map',
        map: MAP_NAME,
        nameProperty: 'NAME_1',
        roam: true,
        scaleLimit: { min: 1, max: 6 },
        itemStyle: { areaColor: '#1A1A1A', borderColor: '#3A3A3A', borderWidth: 0.5 },
        emphasis: {
          itemStyle: { areaColor: '#E31E24' },
          label: { show: true, color: '#FFF' },
        },
        select: { itemStyle: { areaColor: '#E31E24' }, label: { color: '#FFF' } },
        label: { show: false },
        data: seriesData,
      },
    ],
  };

  return (
    <div className="panel p-3">
      {title && <div className="text-sm font-semibold text-text mb-2">{title}</div>}
      {!geo ? (
        <div
          style={{ height: resolvedHeight }}
          className="flex items-center justify-center text-text-secondary text-sm"
        >
          Loading map…
        </div>
      ) : (
        <>
          <ReactECharts
            key={dimension}
            option={option}
            style={{ height: resolvedHeight }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        </>
      )}
    </div>
  );
}
