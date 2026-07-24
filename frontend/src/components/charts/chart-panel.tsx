'use client';

import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState } from 'react';
import { ChartData } from '@/types';
import { cn, formatNumber, formatPct } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { isLeadershipMode } from '@/lib/static-mode';

const THEME = {
  backgroundColor: 'transparent',
  textStyle: { color: '#B5B5B5', fontFamily: 'IBM Plex Sans' },
  title: { textStyle: { color: '#FFFFFF', fontSize: 13, fontWeight: 600 } },
};

// upGrad red first, then distinct accents for additional series.
const SERIES_COLORS = [
  '#E31E24',
  '#4DA3FF',
  '#F5A623',
  '#2ECC71',
  '#B57EDC',
  '#00C2A8',
  '#F472B6',
  '#FBBF24',
];
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
function gridLeftForChart(series: ChartData['series'], compact = false): number {
  const max = maxSeriesValue(series);
  const label = formatNumber(Math.ceil(max * 1.12 || 1));
  if (compact) {
    return Math.max(44, Math.ceil(label.length * 5.5) + 10);
  }
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
  focusedIndex: number,
  isMobile = false
) {
  const multi = chart.series.length > 1;
  const mixedScale = multi && useDualYAxis(chart.series);
  const focusMax = Math.max(
    ...chart.series[focusedIndex].data.map((v) => Number(v) || 0),
    1
  );

  return {
    ...base,
    color: SERIES_COLORS,
    title: { show: false },
    grid: {
      ...(base.grid as object),
      top: mixedScale ? 44 : multi ? 56 : 44,
      right: 16,
      left: gridLeftForChart(chart.series, isMobile),
      containLabel: false,
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: chart.categories,
      axisLine: { lineStyle: { color: '#3A3A3A' } },
      axisLabel: isMobile
        ? {
            rotate: 35,
            interval: 'auto',
            fontSize: 9,
            hideOverlap: true,
            formatter: (value: string) => truncateAxisLabel(value, 8),
          }
        : undefined,
    },
    yAxis: mixedScale
      ? valueYAxis({
          name: isMobile ? '' : chart.series[focusedIndex]?.name,
          nameTextStyle: { color: SERIES_COLORS[focusedIndex % SERIES_COLORS.length], fontSize: 10 },
          max: Math.ceil(focusMax * 1.12),
          axisLine: { show: true, lineStyle: { color: '#3A3A3A' } },
        })
      : valueYAxis(),
    series: chart.series.map((s, i) => {
      const color = seriesColor(s.name, i);
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
        label: isMobile
          ? { show: false }
          : valuePointLabel({
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

function mobileBarLegend(seriesNames: string[]) {
  return {
    type: 'scroll' as const,
    orient: 'horizontal' as const,
    bottom: 0,
    left: 4,
    right: 4,
    icon: 'roundRect',
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 8,
    pageIconSize: 10,
    pageTextStyle: { color: '#B5B5B5', fontSize: 10 },
    textStyle: { color: '#B5B5B5', fontSize: 10 },
    data: seriesNames,
    selected: Object.fromEntries(seriesNames.map((n) => [n, true])),
  };
}

function truncateAxisLabel(value: string, max = 14): string {
  const text = String(value).replace(/\n/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Crowded vertical clustered bars become unreadable on phones — flip to horizontal. */
function shouldForceHorizontalOnMobile(chart: ChartData): boolean {
  if (chart.chart_type !== 'bar') return false;
  if (chart.extra?.horizontal) return false;
  const cats = chart.categories.length;
  const longLabels = chart.categories.some(
    (c) => String(c).replace(/\n/g, ' ').length > 10
  );
  return (
    cats >= 3 &&
    (longLabels || chart.series.length > 1 || useDualYAxis(chart.series))
  );
}

function buildOption(chart: ChartData, focusedIndex = 0, isMobile = false) {
  const base = {
    ...THEME,
    // Title is rendered by the panel header — keep ECharts title hidden to avoid duplicates.
    title: { show: false, text: '' },
    tooltip: axisTooltip(),
    grid: chartGrid(chart.series, {}, chart.extra),
    toolbox: isMobile
      ? { show: false }
      : {
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
        return buildLineOption(chart, base, focusedIndex, isMobile);
      }
      return {
        ...base,
        color: SERIES_COLORS,
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

                const currentEntry = Array.from(byName.entries()).find(([n]) =>
                  n.toLowerCase().startsWith('current')
                );
                const expectedEntry = Array.from(byName.entries()).find(([n]) =>
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
          const isExpected = forecastStyle && s.name.toLowerCase().startsWith('expected');
          // Forecast expected lines keep accent colors; every other series uses a unique palette color.
          const color = isExpected
            ? s.name.toLowerCase().includes('block')
              ? '#F5A623'
              : '#7DD3FC'
            : seriesColor(s.name, i);
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
            label: isMobile
              ? { show: false }
              : valuePointLabel({ color, fontWeight: isExpected ? 600 : 'normal' }),
            labelLayout: { hideOverlap: true },
          };
        }),
      };
    }

    case 'bar': {
      const multiBar = chart.series.length > 1;
      const horizontal =
        Boolean(chart.extra?.horizontal) ||
        (isMobile && shouldForceHorizontalOnMobile(chart));
      const wantsDualScale = multiBar && useDualYAxis(chart.series);
      // Dual value-axis: vertical uses yAxisIndex; horizontal uses xAxisIndex.
      const mixedScale = wantsDualScale;
      const stackNames = new Set(
        ((chart.extra?.stack_block as string[] | undefined) ?? [
          BLOCK_SERIES_NAME,
          CLASH_SERIES_NAME,
        ]).filter((name) => chart.series.some((s) => s.name === name))
      );
      const hasBlockStack =
        stackNames.has(BLOCK_SERIES_NAME) && stackNames.has(CLASH_SERIES_NAME);

      const legend = multiBar
        ? isMobile
          ? mobileBarLegend(chart.series.map((s) => s.name))
          : {
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

      const showBarLabels = !isMobile;
      const barSeries = chart.series.map((s, i) => {
        const color = seriesColor(s.name, i);
        const stacked = hasBlockStack && stackNames.has(s.name);
        const isClash = s.name === CLASH_SERIES_NAME;
        const isCleanBlock = s.name === BLOCK_SERIES_NAME && stacked;
        const dualIndex = mixedScale ? (i === 0 ? 0 : 1) : 0;
        return {
          name: s.name,
          type: 'bar' as const,
          ...(horizontal
            ? { xAxisIndex: dualIndex }
            : { yAxisIndex: dualIndex }),
          stack: stacked ? 'block_amount' : undefined,
          barGap: '10%',
          barMaxWidth: isMobile ? 18 : undefined,
          data: barSeriesData(s.data),
          itemStyle: { color },
          label: showBarLabels
            ? valuePointLabel({
                position: horizontal
                  ? 'right'
                  : isCleanBlock
                    ? 'inside'
                    : 'top',
                color: isClash ? CLASH_SERIES_COLOR : isCleanBlock ? '#FFFFFF' : color,
                fontWeight: isClash || isCleanBlock ? 600 : 'normal',
              })
            : { show: false },
          labelLayout: { hideOverlap: true },
        };
      });

      const secondaryMax = mixedScale
        ? Math.max(
            ...chart.series.slice(1).flatMap((s) => {
              if (hasBlockStack && stackNames.has(s.name)) return [0];
              return s.data.map((v) => Number(v) || 0);
            }),
            ...((chart.extra?.block_amount_total as number[] | undefined) ?? []),
            1
          )
        : 1;

      if (horizontal) {
        const labelWidth = isMobile
          ? Math.min(
              108,
              Math.max(
                72,
                ...chart.categories.map((c) =>
                  Math.min(truncateAxisLabel(c, 16).length * 6.5, 108)
                )
              )
            )
          : Math.min(
              220,
              Math.max(
                120,
                ...chart.categories.map((c) =>
                  Math.max(...c.split('\n').map((line) => line.length * 7))
                )
              )
            );
        const valueAxes = mixedScale
          ? [
              valueYAxis({
                name: isMobile ? '' : chart.series[0]?.name,
                nameTextStyle: { color: SERIES_COLORS[0], fontSize: 10 },
                axisLabel: {
                  color: '#B5B5B5',
                  fontSize: isMobile ? 9 : 11,
                  formatter: (value: number) => formatNumber(Number(value)),
                },
              }),
              valueYAxis({
                name: '',
                position: 'top',
                max: Math.ceil(secondaryMax * 1.25),
                splitLine: { show: false },
                axisLabel: {
                  color: '#B5B5B5',
                  fontSize: isMobile ? 9 : 11,
                  formatter: (value: number) => formatNumber(Number(value)),
                },
              }),
            ]
          : valueYAxis({
              splitLine: { lineStyle: { color: '#2A2A2A' } },
              axisLabel: {
                color: '#B5B5B5',
                fontSize: isMobile ? 9 : 11,
                formatter: (value: number) => formatNumber(Number(value)),
              },
            });

        return {
          ...base,
          grid: {
            left: labelWidth + (isMobile ? 8 : 16),
            right: mixedScale
              ? isMobile
                ? 40
                : 48
              : isMobile
                ? chart.categories.length > 8
                  ? 28
                  : 12
                : 24,
            top: multiBar ? (isMobile ? 12 : 56) : isMobile ? 12 : 36,
            bottom: multiBar && isMobile ? 36 : 24,
            containLabel: false,
          },
          legend,
          ...(isMobile && chart.categories.length > 8
            ? {
                dataZoom: [
                  {
                    type: 'inside',
                    yAxisIndex: 0,
                    start: 0,
                    end: Math.min(100, (8 / chart.categories.length) * 100),
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true,
                  },
                  {
                    type: 'slider',
                    yAxisIndex: 0,
                    width: 14,
                    right: 2,
                    top: multiBar ? 16 : 12,
                    bottom: multiBar ? 40 : 28,
                    start: 0,
                    end: Math.min(100, (8 / chart.categories.length) * 100),
                    borderColor: '#3A3A3A',
                    fillerColor: 'rgba(227, 30, 36, 0.25)',
                    handleStyle: { color: '#E31E24' },
                    textStyle: { color: '#B5B5B5', fontSize: 9 },
                  },
                ],
              }
            : {}),
          yAxis: {
            type: 'category',
            data: chart.categories,
            inverse: true,
            axisLine: { lineStyle: { color: '#3A3A3A' } },
            axisTick: { show: false },
            axisLabel: {
              color: '#D5D5D5',
              fontSize: isMobile ? 10 : 11,
              lineHeight: isMobile ? 13 : 16,
              interval: 0,
              width: labelWidth,
              overflow: isMobile ? 'truncate' : 'break',
              formatter: (value: string) => {
                if (isMobile) return truncateAxisLabel(value, 16);
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
          xAxis: valueAxes,
          series: barSeries,
        };
      }

      if (mixedScale) {
        const multilineX = Boolean(chart.extra?.multiline_x_labels) ||
          chart.categories.some((c) => c.includes('\n'));
        return {
          ...base,
          grid: chartGrid(chart.series, {
            top: multiBar ? (isMobile ? 12 : 56) : 44,
            right: isMobile ? 44 : 72,
            bottom: isMobile ? (multiBar ? 48 : 52) : multilineX ? 56 : 32,
          }),
          legend,
          xAxis: {
            type: 'category',
            data: chart.categories,
            axisLabel: {
              rotate: isMobile ? 35 : 0,
              interval: 0,
              fontSize: isMobile ? 9 : 10,
              hideOverlap: true,
              width: isMobile ? 56 : undefined,
              overflow: isMobile ? 'truncate' : undefined,
              lineHeight: 14,
              formatter: (value: string) => {
                if (isMobile) return truncateAxisLabel(value, 10);
                if (!value.includes('\n')) return value;
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
            },
          },
          yAxis: [
            valueYAxis({
              name: isMobile ? '' : chart.series[0]?.name,
              position: 'left',
              nameTextStyle: { color: SERIES_COLORS[0], fontSize: 10 },
              axisLabel: {
                color: '#B5B5B5',
                fontSize: isMobile ? 9 : 11,
                formatter: (value: number) => formatNumber(Number(value)),
              },
            }),
            valueYAxis({
              name: isMobile ? '' : 'Block / Offer / Admissions',
              position: 'right',
              max: Math.ceil(secondaryMax * 1.25),
              splitLine: { show: false },
              nameTextStyle: { color: SERIES_COLORS[1], fontSize: 10 },
              axisLabel: {
                color: '#B5B5B5',
                fontSize: isMobile ? 9 : 11,
                formatter: (value: number) => formatNumber(Number(value)),
              },
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
          top: multiBar ? (isMobile ? 12 : 56) : 44,
          bottom: isMobile ? (multiBar ? 48 : 52) : multilineX ? 56 : 32,
        }),
        legend,
        xAxis: {
          type: 'category',
          data: chart.categories,
          axisLabel: {
            rotate: isMobile ? 35 : 0,
            interval: 0,
            fontSize: isMobile ? 9 : 10,
            hideOverlap: true,
            width: isMobile ? 56 : undefined,
            overflow: isMobile ? 'truncate' : undefined,
            lineHeight: 14,
            formatter: (value: string) => {
              if (isMobile) return truncateAxisLabel(value, 10);
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
        yAxis: valueYAxis({
          axisLabel: {
            color: '#B5B5B5',
            fontSize: isMobile ? 9 : 11,
            formatter: (value: number) => formatNumber(Number(value)),
          },
        }),
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
  /** Fired when a category (bar/pie slice) is clicked — enables drill-down. */
  onCategoryClick?: (category: string, index: number) => void;
}

export function ChartPanel({
  chart,
  height = 280,
  className,
  onCategoryClick,
}: ChartPanelProps) {
  const isMobile = useIsMobile();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const displayChart = useMemo(() => {
    if (!isMobile) return chart;
    // Horizontal mobile bars need room for partner names —
    // compact_grid's containLabel squeezes labels into the plot.
    if (shouldForceHorizontalOnMobile(chart) || chart.extra?.horizontal) {
      return chart;
    }
    return {
      ...chart,
      extra: { ...chart.extra, compact_grid: true },
    };
  }, [chart, isMobile]);
  const forceHorizontal =
    isMobile && shouldForceHorizontalOnMobile(displayChart);
  const resolvedHeight = useMemo(() => {
    if (!isMobile) return height;
    if (forceHorizontal || displayChart.extra?.horizontal) {
      const rows = Math.max(displayChart.categories.length, 1);
      const visibleRows = Math.min(rows, 8);
      const rowH = Math.max(40, 18 + displayChart.series.length * 8);
      const seriesPad = displayChart.series.length > 1 ? 48 : 28;
      return Math.min(560, Math.max(300, visibleRows * rowH + seriesPad));
    }
    return Math.min(height, 240);
  }, [isMobile, height, forceHorizontal, displayChart]);
  const mixedScale =
    displayChart.chart_type === 'line' &&
    displayChart.series.length > 1 &&
    useDualYAxis(displayChart.series);

  useEffect(() => {
    setFocusedIndex(0);
  }, [displayChart.chart_id]);

  const option = useMemo(
    () => buildOption(displayChart, focusedIndex, isMobile),
    [displayChart, focusedIndex, isMobile]
  );

  const hasData =
    displayChart.series.some((s) => s.data.length > 0) ||
    (displayChart.extra?.data as unknown[] | undefined)?.length;

  const onEvents = useMemo(() => {
    if (!onCategoryClick) return undefined;
    return {
      click: (params: { dataIndex?: number; name?: string }) => {
        const idx =
          typeof params.dataIndex === 'number'
            ? params.dataIndex
            : displayChart.categories.findIndex((c) => String(c) === String(params.name));
        if (idx < 0) return;
        const category = String(displayChart.categories[idx] ?? params.name ?? '');
        if (category) onCategoryClick(category, idx);
      },
    };
  }, [onCategoryClick, displayChart.categories]);

  return (
    <div
      className={`panel p-3 ${className || ''} ${onCategoryClick ? 'cursor-pointer' : ''}`}
    >
      {!hasData ? (
        <div style={{ height: resolvedHeight }} className="flex flex-col">
          {displayChart.title ? (
            <div className="text-sm font-semibold text-text mb-2">{displayChart.title}</div>
          ) : null}
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm border border-border border-dashed">
            No data available
          </div>
        </div>
      ) : (
        <>
          {(displayChart.title || mixedScale) && (
          <div className="flex items-start justify-between gap-2 mb-2">
            {displayChart.title ? (
              <div className="text-sm font-semibold text-text shrink-0">{displayChart.title}</div>
            ) : (
              <div />
            )}
            {mixedScale && (
              <div className="flex flex-wrap gap-1 justify-end">
                {displayChart.series.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setFocusedIndex(i)}
                    className={cn(
                      'px-2 py-0.5 text-[11px] border transition-colors min-h-[32px]',
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
          {onCategoryClick && !isLeadershipMode() && (
            <p className="text-[10px] text-text-secondary mb-1">Click a bar or slice to explore leads</p>
          )}
          <ReactECharts
            option={option}
            style={{ height: mixedScale ? resolvedHeight - 48 : resolvedHeight }}
            opts={{ renderer: 'canvas' }}
            notMerge
            onEvents={onEvents}
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
