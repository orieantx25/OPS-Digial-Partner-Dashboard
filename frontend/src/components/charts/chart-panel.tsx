'use client';

import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState } from 'react';
import { ChartData } from '@/types';
import { cn, formatNumber, formatPct } from '@/lib/utils';

const THEME = {
  backgroundColor: 'transparent',
  textStyle: { color: '#B5B5B5', fontFamily: 'IBM Plex Sans' },
  title: { textStyle: { color: '#FFFFFF', fontSize: 13, fontWeight: 600 } },
};

// upGrad red first, then distinct accents for additional series.
const SERIES_COLORS = ['#E31E24', '#4DA3FF', '#F5A623', '#2ECC71', '#B57EDC'];
const CLASH_SERIES_COLOR = '#FBBF24';
const CLASH_SERIES_NAME = 'Counsellor Clashes';
const BLOCK_SERIES_NAME = 'Block Amount';
/** Leave room for toolbox (PNG + data view) so legend text does not sit under the icons. */
const LEGEND_RIGHT_CLEAR_TOOLBOX = 72;

function seriesColor(name: string, index: number): string {
  if (name === CLASH_SERIES_NAME) return CLASH_SERIES_COLOR;
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

function maxSeriesValue(series: ChartData['series']): number {
  return Math.max(0, ...series.flatMap((s) => s.data.map((v) => Number(v) || 0)));
}

/** Reserve enough left margin for full en-IN labels (e.g. 25,00,000). */
function gridLeftForChart(series: ChartData['series']): number {
  const max = maxSeriesValue(series);
  const label = formatNumber(Math.ceil(max * 1.12 || 1));
  return Math.max(68, Math.ceil(label.length * 7.5) + 16);
}

function chartGrid(
  series: ChartData['series'],
  overrides: Record<string, unknown> = {},
  chartExtra?: ChartData['extra']
) {
  const fromExtra =
    chartExtra && typeof chartExtra.grid === 'object' && chartExtra.grid !== null
      ? (chartExtra.grid as Record<string, unknown>)
      : {};

  if (chartExtra?.compact_grid) {
    return {
      top: 28,
      bottom: 22,
      right: 20,
      ...overrides,
      ...fromExtra,
      left: fromExtra.left ?? 2,
      containLabel: true,
    };
  }

  return {
    left: gridLeftForChart(series),
    right: 16,
    top: 40,
    bottom: 32,
    containLabel: false,
    ...overrides,
    ...fromExtra,
  };
}

function valueYAxis(overrides: Record<string, unknown> = {}) {
  return {
    type: 'value',
    splitLine: { lineStyle: { color: '#2A2A2A' } },
    axisLabel: {
      color: '#B5B5B5',
      fontSize: 11,
      overflow: 'none',
      hideOverlap: false,
      formatter: (value: number) => formatNumber(Number(value)),
    },
    ...overrides,
  };
}

function axisTooltip() {
  return {
    trigger: 'axis' as const,
    backgroundColor: '#202124',
    borderColor: '#3A3A3A',
    valueFormatter: (value: number) => formatNumber(Number(value)),
  };
}

/** Zero values render as no bar (null), not a sliver on the axis. */
function barSeriesData(data: ChartData['series'][number]['data']) {
  return data.map((v) => {
    const n = Number(v) || 0;
    return n === 0 ? null : n;
  });
}

/** Visible value labels on points/bars; hover/tooltip behavior stays unchanged. */
function valuePointLabel(opts?: {
  position?: 'top' | 'right' | 'inside' | 'insideTop';
  color?: string;
  fontWeight?: 'normal' | 'bold' | 600;
  opacity?: number;
}) {
  return {
    show: true,
    position: opts?.position ?? 'top',
    distance: 4,
    color: opts?.color ?? '#D5D5D5',
    fontSize: 10,
    fontWeight: opts?.fontWeight ?? 'normal',
    opacity: opts?.opacity ?? 1,
    formatter: (p: { value?: number | null }) => {
      if (p.value == null) return '';
      const n = Number(p.value);
      if (!n || Number.isNaN(n)) return '';
      return formatNumber(n);
    },
  };
}

/** When the primary series is much larger, put secondary series on a right Y-axis. */
function useDualYAxis(series: ChartData['series']): boolean {
  if (series.length < 2) return false;
  const maxOf = (idx: number) =>
    Math.max(...series[idx].data.map((v) => Number(v) || 0), 0);
  const primaryMax = maxOf(0);
  const secondaryMax = Math.max(...series.slice(1).map((_, i) => maxOf(i + 1)), 0);
  if (primaryMax === 0 || secondaryMax === 0) return primaryMax > 0 && secondaryMax > 0;
  return primaryMax / secondaryMax >= 8;
}

function buildLineOption(
  chart: ChartData,
  base: Record<string, unknown>,
  focusedIndex: number
) {
  const multi = chart.series.length > 1;
  const mixedScale = multi && useDualYAxis(chart.series);
  const focusMax = Math.max(
    ...chart.series[focusedIndex].data.map((v) => Number(v) || 0),
    1
  );

  return {
    ...base,
    title: { show: false },
    grid: {
      ...(base.grid as object),
      top: mixedScale ? 44 : multi ? 56 : 44,
      right: 16,
      left: gridLeftForChart(chart.series),
      containLabel: false,
    },
    legend: { show: false },
    xAxis: { type: 'category', data: chart.categories, axisLine: { lineStyle: { color: '#3A3A3A' } } },
    yAxis: mixedScale
      ? valueYAxis({
          name: chart.series[focusedIndex]?.name,
          nameTextStyle: { color: SERIES_COLORS[focusedIndex % SERIES_COLORS.length], fontSize: 10 },
          max: Math.ceil(focusMax * 1.12),
          axisLine: { show: true, lineStyle: { color: '#3A3A3A' } },
        })
      : valueYAxis(),
    series: chart.series.map((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      const focused = mixedScale ? i === focusedIndex : true;
      const dimmed = mixedScale && !focused;
      return {
        name: s.name,
        type: 'line',
        yAxisIndex: 0,
        data: s.data,
        smooth: false,
        showSymbol: focused || s.data.length <= 24,
        symbolSize: focused ? 6 : 3,
        z: focused ? 3 : 1,
        areaStyle: chart.chart_type === 'area' && focused ? { opacity: 0.15 } : undefined,
        lineStyle: { color, width: focused ? 3 : 1.5, opacity: dimmed ? 0.18 : 1 },
        itemStyle: { color, opacity: dimmed ? 0.18 : 1 },
        label: valuePointLabel({
          color,
          opacity: dimmed ? 0.25 : 1,
          fontWeight: focused ? 600 : 'normal',
        }),
        labelLayout: { hideOverlap: true },
        emphasis: { disabled: dimmed },
      };
    }),
  };
}

function buildOption(chart: ChartData, focusedIndex = 0) {
  const base = {
    ...THEME,
    // Title is rendered by the panel header — keep ECharts title hidden to avoid duplicates.
    title: { show: false, text: '' },
    tooltip: axisTooltip(),
    grid: chartGrid(chart.series, {}, chart.extra),
    toolbox: {
      right: 4,
      top: 0,
      itemSize: 14,
      itemGap: 10,
      feature: {
        saveAsImage: { title: 'PNG' },
        dataView: { readOnly: true },
      },
      iconStyle: { borderColor: '#B5B5B5' },
    },
  };

  switch (chart.chart_type) {
    case 'line':
    case 'area': {
      const multi = chart.series.length > 1;
      const forecastStyle = Boolean(chart.extra?.forecast_style);
      const mixedScale = multi && !forecastStyle && useDualYAxis(chart.series);
      if (mixedScale) {
        return buildLineOption(chart, base, focusedIndex);
      }
      return {
        ...base,
        grid: chartGrid(chart.series, { top: multi ? 56 : 44 }, chart.extra),
        tooltip: forecastStyle
          ? {
              trigger: 'axis' as const,
              backgroundColor: '#202124',
              borderColor: '#3A3A3A',
              formatter: (params: unknown) => {
                const items = Array.isArray(params) ? params : [params];
                if (!items.length) return '';
                const axis =
                  String(
                    (items[0] as { axisValueLabel?: string; axisValue?: string })
                      .axisValueLabel ??
                      (items[0] as { axisValue?: string }).axisValue ??
                      ''
                  );
                const byName = new Map<string, number | null>();
                for (const raw of items) {
                  const p = raw as {
                    seriesName?: string;
                    value?: number | null;
                    data?: number | null;
                  };
                  const name = String(p.seriesName || '');
                  const v = p.value ?? p.data;
                  byName.set(
                    name,
                    v == null || Number.isNaN(Number(v)) ? null : Number(v)
                  );
                }

                const currentEntry = [...byName.entries()].find(([n]) =>
                  n.toLowerCase().startsWith('current')
                );
                const expectedEntry = [...byName.entries()].find(([n]) =>
                  n.toLowerCase().startsWith('expected')
                );
                const currentVal = currentEntry?.[1] ?? null;
                const expectedVal = expectedEntry?.[1] ?? null;

                // Baseline for +projected: this month's current, else last known current.
                let baseline = currentVal;
                if (baseline == null && expectedVal != null) {
                  const currentSeries = chart.series.find((s) =>
                    s.name.toLowerCase().startsWith('current')
                  );
                  const idx = chart.categories.indexOf(axis);
                  if (currentSeries && idx >= 0) {
                    for (let i = idx - 1; i >= 0; i -= 1) {
                      const prev = currentSeries.data[i];
                      if (prev != null && !Number.isNaN(Number(prev))) {
                        baseline = Number(prev);
                        break;
                      }
                    }
                  }
                }

                const lines = [`<div style="margin-bottom:4px">${axis}</div>`];
                if (currentVal != null) {
                  lines.push(
                    `<div>Current: <b>${formatNumber(currentVal)}</b></div>`
                  );
                } else if (baseline != null && expectedVal != null) {
                  lines.push(
                    `<div>Current: <b>${formatNumber(baseline)}</b></div>`
                  );
                }

                if (expectedVal != null) {
                  const delta =
                    baseline != null ? expectedVal - baseline : expectedVal;
                  const sign = delta > 0 ? '+' : delta < 0 ? '' : '+';
                  lines.push(
                    `<div>Projected: <b>${sign}${formatNumber(delta)}</b></div>`
                  );
                } else if (currentVal == null && baseline == null) {
                  return '';
                }

                return lines.join('');
              },
            }
          : base.tooltip,
        legend: multi
          ? {
              top: 4,
              right: LEGEND_RIGHT_CLEAR_TOOLBOX,
              icon: 'roundRect',
              itemWidth: 10,
              itemHeight: 4,
              textStyle: { color: '#B5B5B5', fontSize: 11 },
              data: chart.series.map((s) => s.name),
            }
          : undefined,
        xAxis: { type: 'category', data: chart.categories, axisLine: { lineStyle: { color: '#3A3A3A' } } },
        yAxis: valueYAxis(),
        series: chart.series.map((s, i) => {
          const isExpected = s.name.toLowerCase().startsWith('expected');
          const color = isExpected
            ? (s.name.toLowerCase().includes('block') ? '#F5A623' : '#7DD3FC')
            : SERIES_COLORS[0];
          return {
            name: s.name,
            type: 'line',
            data: s.data,
            smooth: false,
            connectNulls: isExpected,
            showSymbol: true,
            symbolSize: isExpected ? 7 : 5,
            areaStyle: chart.chart_type === 'area' && !isExpected ? { opacity: 0.12 } : undefined,
            lineStyle: {
              color,
              width: isExpected ? 2.5 : 2,
              type: isExpected ? 'dashed' : 'solid',
              opacity: isExpected ? 0.85 : 1,
            },
            itemStyle: { color },
            label: valuePointLabel({ color, fontWeight: isExpected ? 600 : 'normal' }),
            labelLayout: { hideOverlap: true },
          };
        }),
      };
    }

    case 'bar': {
      const multiBar = chart.series.length > 1;
      const horizontal = Boolean(chart.extra?.horizontal);
      const mixedScale = !horizontal && multiBar && useDualYAxis(chart.series);
      const stackNames = new Set(
        ((chart.extra?.stack_block as string[] | undefined) ?? [
          BLOCK_SERIES_NAME,
          CLASH_SERIES_NAME,
        ]).filter((name) => chart.series.some((s) => s.name === name))
      );
      const hasBlockStack =
        stackNames.has(BLOCK_SERIES_NAME) && stackNames.has(CLASH_SERIES_NAME);

      const legend = multiBar
        ? {
            top: 4,
            right: LEGEND_RIGHT_CLEAR_TOOLBOX,
            icon: 'roundRect',
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: '#B5B5B5', fontSize: 11 },
            data: chart.series.map((s) => s.name),
            selected: Object.fromEntries(chart.series.map((s) => [s.name, true])),
          }
        : undefined;

      const barSeries = chart.series.map((s, i) => {
        const color = seriesColor(s.name, i);
        const stacked = hasBlockStack && stackNames.has(s.name);
        const isClash = s.name === CLASH_SERIES_NAME;
        const isCleanBlock = s.name === BLOCK_SERIES_NAME && stacked;
        return {
          name: s.name,
          type: 'bar' as const,
          yAxisIndex: mixedScale ? (i === 0 ? 0 : 1) : 0,
          stack: stacked ? 'block_amount' : undefined,
          barGap: '10%',
          data: barSeriesData(s.data),
          itemStyle: { color },
          label: valuePointLabel({
            position: horizontal
              ? 'right'
              : isCleanBlock
                ? 'inside'
                : 'top',
            color: isClash ? CLASH_SERIES_COLOR : isCleanBlock ? '#FFFFFF' : color,
            fontWeight: isClash || isCleanBlock ? 600 : 'normal',
          }),
          labelLayout: { hideOverlap: true },
        };
      });

      if (horizontal) {
        const labelWidth = Math.min(
          220,
          Math.max(
            120,
            ...chart.categories.map((c) =>
              Math.max(...c.split('\n').map((line) => line.length * 7))
            )
          )
        );
        return {
          ...base,
          grid: {
            left: labelWidth + 16,
            right: 24,
            top: multiBar ? 56 : 36,
            bottom: 24,
            containLabel: false,
          },
          legend,
          yAxis: {
            type: 'category',
            data: chart.categories,
            inverse: true,
            axisLine: { lineStyle: { color: '#3A3A3A' } },
            axisTick: { show: false },
            axisLabel: {
              color: '#D5D5D5',
              fontSize: 11,
              lineHeight: 16,
              interval: 0,
              width: labelWidth,
              overflow: 'break',
              formatter: (value: string) => {
                const [campaign, partner] = String(value).split('\n');
                if (!partner) return campaign;
                return `{campaign|${campaign}}\n{partner|${partner}}`;
              },
              rich: {
                campaign: {
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 16,
                },
                partner: {
                  color: '#9CA3AF',
                  fontSize: 10,
                  lineHeight: 14,
                },
              },
            },
          },
          xAxis: valueYAxis({
            splitLine: { lineStyle: { color: '#2A2A2A' } },
          }),
          series: barSeries,
        };
      }

      if (mixedScale) {
        const totals = (chart.extra?.block_amount_total as number[] | undefined) ?? [];
        const secondaryMax = Math.max(
          ...chart.series.slice(1).flatMap((s) => {
            if (hasBlockStack && stackNames.has(s.name)) return [0];
            return s.data.map((v) => Number(v) || 0);
          }),
          ...totals,
          1
        );
        const multilineX = Boolean(chart.extra?.multiline_x_labels) ||
          chart.categories.some((c) => c.includes('\n'));
        return {
          ...base,
          grid: chartGrid(chart.series, {
            top: multiBar ? 56 : 44,
            right: 72,
            bottom: multilineX ? 56 : 32,
          }),
          legend,
          xAxis: {
            type: 'category',
            data: chart.categories,
            axisLabel: multilineX
              ? {
                  rotate: 0,
                  interval: 0,
                  fontSize: 10,
                  hideOverlap: false,
                  lineHeight: 14,
                  formatter: (value: string) => {
                    const [campaign, partner] = String(value).split('\n');
                    if (!partner) return campaign;
                    return `{campaign|${campaign}}\n{partner|${partner}}`;
                  },
                  rich: {
                    campaign: {
                      color: '#FFFFFF',
                      fontSize: 10,
                      fontWeight: 600,
                      lineHeight: 14,
                    },
                    partner: {
                      color: '#9CA3AF',
                      fontSize: 9,
                      lineHeight: 12,
                    },
                  },
                }
              : { rotate: 0, interval: 0, fontSize: 10, hideOverlap: false },
          },
          yAxis: [
            valueYAxis({
              name: chart.series[0]?.name,
              position: 'left',
              nameTextStyle: { color: SERIES_COLORS[0], fontSize: 10 },
            }),
            valueYAxis({
              name: 'Block / Offer / Admissions',
              position: 'right',
              max: Math.ceil(secondaryMax * 1.25),
              splitLine: { show: false },
              nameTextStyle: { color: SERIES_COLORS[1], fontSize: 10 },
            }),
          ],
          series: barSeries,
        };
      }

      const multilineX = Boolean(chart.extra?.multiline_x_labels) ||
        chart.categories.some((c) => c.includes('\n'));
      return {
        ...base,
        grid: chartGrid(chart.series, {
          top: multiBar ? 56 : 44,
          bottom: multilineX ? 56 : 32,
        }),
        legend,
        xAxis: {
          type: 'category',
          data: chart.categories,
          axisLabel: {
            rotate: 0,
            interval: 0,
            fontSize: 10,
            hideOverlap: false,
            lineHeight: 14,
            formatter: (value: string) => {
              if (!value.includes('\n')) return value;
              const [campaign, partner] = value.split('\n');
              return `{campaign|${campaign}}\n{partner|${partner}}`;
            },
            rich: {
              campaign: { color: '#FFFFFF', fontSize: 10, fontWeight: 600, lineHeight: 14 },
              partner: { color: '#9CA3AF', fontSize: 9, lineHeight: 12 },
            },
          },
        },
        yAxis: valueYAxis(),
        series: barSeries,
      };
    }

    case 'donut':
    case 'pie':
      return {
        ...THEME,
        title: { show: false, text: '' },
        color: SERIES_COLORS,
        legend: {
          bottom: 0,
          left: 'center',
          type: 'scroll',
          textStyle: { color: '#B5B5B5', fontSize: 11 },
          pageTextStyle: { color: '#B5B5B5' },
        },
        tooltip: {
          trigger: 'item',
          backgroundColor: '#202124',
          borderColor: '#3A3A3A',
          formatter: (params: { name: string; value: number; percent: number }) =>
            `${params.name}: <strong>${formatNumber(params.value)}</strong> (${params.percent.toFixed(1)}%)`,
        },
        series: [{
          type: 'pie',
          radius: chart.chart_type === 'donut' ? ['40%', '64%'] : ['0%', '64%'],
          center: ['50%', '46%'],
          minAngle: 3,
          avoidLabelOverlap: true,
          data: chart.categories.map((c, i) => ({
            name: c,
            value: chart.series[0]?.data[i],
          })),
          itemStyle: { borderWidth: 0 },
          label: {
            color: '#D5D5D5',
            fontSize: 11,
            formatter: (p: { name: string; value: number; percent: number }) =>
              `${p.name}\n${formatNumber(p.value)} · ${p.percent.toFixed(0)}%`,
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: '#3A3A3A' } },
        }],
      };

    case 'funnel': {
      const counts = (chart.series[0]?.data ?? []).map((v) => Number(v) || 0);
      const stages = chart.categories;
      const conversions = (chart.extra?.conversions as number[] | undefined) ?? [];
      const total = counts[0] || 1;
      const fmt = (n: number) => formatNumber(n);
      // Sequential red gradient: bright at the top of the funnel, deep maroon
      // at the bottom — reads as a narrowing pipeline regardless of bar widths.
      const shade = (i: number) => {
        const t = stages.length > 1 ? i / (stages.length - 1) : 0;
        const from = [227, 30, 36];
        const to = [74, 12, 16];
        const c = from.map((f, k) => Math.round(f + (to[k] - f) * t));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      };
      return {
        ...THEME,
        title: base.title,
        grid: { left: 8, right: 96, top: 40, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: '#202124',
          borderColor: '#3A3A3A',
          formatter: (params: { dataIndex: number }[]) => {
            const i = params[0].dataIndex;
            const step = conversions[i];
            const stepLine =
              i > 0 && step != null
                ? `<br/>From previous: <strong>${formatPct(Number(step))}</strong>`
                : i === 0
                ? `<br/>Baseline stage`
                : '';
            return (
              `<strong>${stages[i]}</strong><br/>` +
              `Count: <strong>${fmt(counts[i])}</strong>` +
              stepLine
            );
          },
        },
        xAxis: { type: 'value', show: false, max: total },
        yAxis: {
          type: 'category',
          data: stages,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#D5D5D5', fontSize: 11 },
        },
        series: [{
          type: 'bar',
          barWidth: '62%',
          showBackground: true,
          backgroundStyle: { color: '#1A1A1A' },
          data: counts.map((v, i) => ({ value: v, itemStyle: { color: shade(i) } })),
          label: {
            show: true,
            position: 'right',
            color: '#E5E5E5',
            fontSize: 11,
            formatter: (p: { dataIndex: number }) => {
              const i = p.dataIndex;
              if (i === 0) return fmt(counts[i]);
              const step = conversions[i];
              return step != null
                ? `${fmt(counts[i])}  ·  ${formatPct(Number(step))}`
                : fmt(counts[i]);
            },
          },
        }],
      };
    }

    case 'treemap':
      return {
        ...THEME,
        title: base.title,
        series: [{
          type: 'treemap',
          data: chart.categories.map((c, i) => ({
            name: c,
            value: chart.series[0]?.data[i],
          })),
          itemStyle: { borderColor: '#0F0F10' },
        }],
      };

    case 'heatmap':
      const heatData = (chart.extra?.data as { dow: number; hour: number; cnt: number }[]) || [];
      return {
        ...THEME,
        title: base.title,
        tooltip: { position: 'top' },
        grid: { height: '70%', top: '15%' },
        xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => `${i}:00`) },
        yAxis: { type: 'category', data: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
        visualMap: { min: 0, max: Math.max(...heatData.map((d) => d.cnt), 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#1A1A1A', '#E31E24'] } },
        series: [{
          type: 'heatmap',
          data: heatData.map((d) => [d.hour, d.dow, d.cnt]),
        }],
      };

    default:
      return base;
  }
}

interface ChartPanelProps {
  chart: ChartData;
  height?: number;
  className?: string;
}

export function ChartPanel({ chart, height = 280, className }: ChartPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const mixedScale =
    chart.chart_type === 'line' &&
    chart.series.length > 1 &&
    useDualYAxis(chart.series);

  useEffect(() => {
    setFocusedIndex(0);
  }, [chart.chart_id]);

  const option = useMemo(
    () => buildOption(chart, focusedIndex),
    [chart, focusedIndex]
  );

  const hasData =
    chart.series.some((s) => s.data.length > 0) ||
    (chart.extra?.data as unknown[] | undefined)?.length;

  return (
    <div className={`panel p-3 ${className || ''}`}>
      {!hasData ? (
        <div style={{ height }} className="flex flex-col">
          {chart.title ? (
            <div className="text-sm font-semibold text-text mb-2">{chart.title}</div>
          ) : null}
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm border border-border border-dashed">
            No data available
          </div>
        </div>
      ) : (
        <>
          {(chart.title || mixedScale) && (
          <div className="flex items-start justify-between gap-2 mb-2">
            {chart.title ? (
              <div className="text-sm font-semibold text-text shrink-0">{chart.title}</div>
            ) : (
              <div />
            )}
            {mixedScale && (
              <div className="flex flex-wrap gap-1 justify-end">
                {chart.series.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setFocusedIndex(i)}
                    className={cn(
                      'px-2 py-0.5 text-[11px] border transition-colors',
                      focusedIndex === i
                        ? 'bg-surface border-border text-text font-medium'
                        : 'border-transparent text-text-secondary hover:text-text'
                    )}
                    style={{
                      boxShadow:
                        focusedIndex === i
                          ? `inset 3px 0 0 ${SERIES_COLORS[i % SERIES_COLORS.length]}`
                          : undefined,
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {mixedScale && (
            <p className="text-[10px] text-text-secondary mb-2 -mt-1">
              Select a metric to scale the chart — other lines stay visible for context.
            </p>
          )}
          <ReactECharts
            option={option}
            style={{ height: mixedScale ? height - 48 : height }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        </>
      )}
    </div>
  );
}

interface GeoMapProps {
  data: { state: string; leads: number; admissions: number }[];
  height?: number;
}

const STATE_COORDS: Record<string, [number, number]> = {
  Maharashtra: [75.7, 19.0], Karnataka: [76.5, 12.9], 'Tamil Nadu': [78.5, 11.0],
  Delhi: [77.1, 28.6], Gujarat: [71.8, 22.3], 'West Bengal': [88.3, 22.9],
  Rajasthan: [74.2, 26.9], 'Uttar Pradesh': [80.9, 26.8], Telangana: [79.0, 17.4],
  Kerala: [76.3, 10.5], Punjab: [75.3, 31.1], Haryana: [76.1, 29.1],
  'Madhya Pradesh': [77.4, 23.3], Bihar: [85.3, 25.6], Odisha: [85.1, 20.9],
};

export function GeoMapPanel({ data, height = 400 }: GeoMapProps) {
  const stateAgg = data.reduce<Record<string, number>>((acc, d) => {
    acc[d.state] = (acc[d.state] || 0) + Number(d.leads);
    return acc;
  }, {});

  const scatterData = Object.entries(stateAgg).map(([state, leads]) => ({
    name: state,
    value: [...(STATE_COORDS[state] || [78, 22]), leads],
  }));

  const option = {
    ...THEME,
    title: { text: 'Lead Density — India', textStyle: { color: '#FFF', fontSize: 13 } },
    geo: {
      map: 'none',
      roam: true,
      center: [78, 22],
      zoom: 1.2,
      itemStyle: { areaColor: '#1A1A1A', borderColor: '#3A3A3A' },
    },
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number[] }) => `${p.name}: ${p.value[2]} leads` },
    visualMap: {
      min: 0,
      max: Math.max(...Object.values(stateAgg), 1),
      calculable: true,
      inRange: { color: ['#3A3A3A', '#E31E24'] },
      textStyle: { color: '#B5B5B5' },
    },
    series: [{
      type: 'scatter',
      coordinateSystem: 'geo',
      data: scatterData,
      symbolSize: (val: number[]) => Math.max(8, Math.sqrt(val[2]) * 2),
      itemStyle: { color: '#E31E24', opacity: 0.8 },
    }],
  };

  return (
    <div className="panel p-3">
      <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
    </div>
  );
}
