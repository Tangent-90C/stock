import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
  type WhitespaceData
} from 'lightweight-charts';
import type { ApiBar, ChartDisplayMode, ChartResolvedMode, ChartTimeZoneMode, MarketSession } from '../types';

interface BarChartProps {
  bars: ApiBar[];
  loading: boolean;
  displayMode: ChartDisplayMode;
  timeZoneMode: ChartTimeZoneMode;
  skipNonTradingDays: boolean;
  showSkippedGapLines: boolean;
  onResolvedModeChange: (mode: ChartResolvedMode) => void;
}

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  html: string;
}

const etFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const localTooltipFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const easternAxisFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const localAxisFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const densityThresholdPx = 6;
const sessionDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

interface LineSegment {
  session: MarketSession;
  sessionKey: string;
  data: Array<LineData<UTCTimestamp>>;
}

export function BarChart({ bars, loading, displayMode, timeZoneMode, skipNonTradingDays, showSkippedGapLines, onResolvedModeChange }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const timeAnchorSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const skippedGapSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineSeriesRef = useRef<Array<ISeriesApi<'Line'>>>([]);
  const displayModeRef = useRef(displayMode);
  const timeZoneModeRef = useRef<ChartTimeZoneMode>('local');
  const barsLengthRef = useRef(bars.length);
  const resolvedModeRef = useRef<ChartResolvedMode>('candlestick');
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, left: 0, top: 0, html: '' });

  const candlestickData = useMemo(() => {
    return bars.map<CandlestickData<UTCTimestamp>>((bar) => ({
      time: getChartTime(bar.time, timeZoneMode) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      color: bar.color,
      borderColor: bar.borderColor,
      wickColor: bar.wickColor
    }));
  }, [bars, timeZoneMode]);

  const timeAnchorData = useMemo(() => {
    return buildTimeAnchorData(bars, timeZoneMode, skipNonTradingDays);
  }, [bars, timeZoneMode, skipNonTradingDays]);

  const skippedGapMarkers = useMemo(() => {
    return skipNonTradingDays && showSkippedGapLines ? buildSkippedGapMarkers(bars, timeZoneMode) : [];
  }, [bars, timeZoneMode, skipNonTradingDays, showSkippedGapLines]);

  const lineSegments = useMemo(() => {
    const segments: LineSegment[] = [];
    let currentSegment: LineSegment | null = null;
    let previousTime: UTCTimestamp | null = null;
    const maxGapSeconds = inferMaxSegmentGapSeconds(bars);

    for (const bar of bars) {
      const time = getChartTime(bar.time, timeZoneMode) as UTCTimestamp;
      const sessionKey = getSessionInstanceKey(bar);
      const hasLargeGap = previousTime !== null && time - previousTime > maxGapSeconds;

      if (!currentSegment || currentSegment.session !== bar.session || currentSegment.sessionKey !== sessionKey || hasLargeGap) {
        currentSegment = {
          session: bar.session,
          sessionKey,
          data: []
        };
        segments.push(currentSegment);
      }

      currentSegment.data.push({ time, value: bar.close });
      previousTime = time;
    }

    return segments.filter((segment) => segment.data.length > 1);
  }, [bars, timeZoneMode]);

  const barsByUnixTime = useMemo(() => {
    const map = new Map<number, ApiBar>();
    for (const bar of bars) {
      map.set(getChartTime(bar.time, timeZoneMode), bar);
    }
    return map;
  }, [bars, timeZoneMode]);

  useEffect(() => {
    displayModeRef.current = displayMode;
    updateResolvedModeFromRange(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
  }, [displayMode]);

  useEffect(() => {
    timeZoneModeRef.current = timeZoneMode;
    chartRef.current?.applyOptions({ localization: { timeFormatter: (time: Time) => formatAxisTime(time, timeZoneMode) } });
  }, [timeZoneMode]);

  useEffect(() => {
    barsLengthRef.current = bars.length;
    updateResolvedModeFromRange(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
  }, [bars.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#334155',
        fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
      },
      grid: {
        vertLines: { color: '#eef2f7' },
        horzLines: { color: '#eef2f7' }
      },
      crosshair: {
        mode: CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: '#d8dee8'
      },
      timeScale: {
        borderColor: '#d8dee8',
        timeVisible: true,
        secondsVisible: false
      },
      localization: {
        timeFormatter: (time: Time) => formatAxisTime(time, timeZoneModeRef.current)
      }
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#059669',
      downColor: '#059669',
      borderVisible: true,
      wickVisible: true
    });
    const timeAnchorSeries = chart.addLineSeries({
      color: 'rgba(0, 0, 0, 0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: true
    });
    const skippedGapSeries = chart.addHistogramSeries({
      color: 'rgba(23, 32, 51, 0.28)',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
      priceScaleId: ''
    });
    skippedGapSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0,
        bottom: 0
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    timeAnchorSeriesRef.current = timeAnchorSeries;
    skippedGapSeriesRef.current = skippedGapSeries;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
      updateResolvedModeFromRange(chart.timeScale().getVisibleLogicalRange());
    });
    resizeObserver.observe(container);

    const handleVisibleRangeChange = (range: LogicalRange | null) => {
      updateResolvedModeFromRange(range);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !containerRef.current) {
        setTooltip((current) => ({ ...current, visible: false }));
        return;
      }

      const unixTime = normalizeCrosshairTime(param.time);
      const bar = barsByUnixTime.get(unixTime);
      if (!bar) {
        setTooltip((current) => ({ ...current, visible: false }));
        return;
      }

      const tooltipWidth = tooltipRef.current?.offsetWidth || 220;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 126;
      const left = Math.min(param.point.x + 16, container.clientWidth - tooltipWidth - 12);
      const top = Math.min(param.point.y + 16, container.clientHeight - tooltipHeight - 12);

      setTooltip({
        visible: true,
        left: Math.max(12, left),
        top: Math.max(12, top),
        html: renderTooltip(bar)
      });
    });

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      timeAnchorSeriesRef.current = null;
      skippedGapSeriesRef.current = null;
      lineSeriesRef.current = [];
    };
  }, [barsByUnixTime, onResolvedModeChange]);

  useEffect(() => {
    const chart = chartRef.current;
    candleSeriesRef.current?.setData(candlestickData);
    timeAnchorSeriesRef.current?.setData(timeAnchorData);
    skippedGapSeriesRef.current?.setData(skippedGapMarkers);

    if (chart) {
      for (const series of lineSeriesRef.current) {
        chart.removeSeries(series);
      }

      lineSeriesRef.current = lineSegments.map((segment) => {
        const series = chart.addLineSeries({
          color: getSessionColor(segment.session),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: resolvedModeRef.current === 'line'
        });
        series.setData(segment.data);
        return series;
      });
    }

    if (candlestickData.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
    updateResolvedModeFromRange(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
  }, [candlestickData, lineSegments, timeAnchorData, skippedGapMarkers]);

  function updateResolvedModeFromRange(range: LogicalRange | null) {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    let nextMode: ChartResolvedMode = 'candlestick';
    if (displayModeRef.current === 'line') {
      nextMode = 'line';
    } else if (displayModeRef.current === 'candlestick') {
      nextMode = 'candlestick';
    } else {
      const visibleBarCount = range ? Math.max(1, range.to - range.from + 1) : Math.max(1, barsLengthRef.current);
      const pixelsPerBar = container.clientWidth / visibleBarCount;
      nextMode = pixelsPerBar < densityThresholdPx ? 'line' : 'candlestick';
    }

    applySeriesVisibility(nextMode);
    if (resolvedModeRef.current !== nextMode) {
      resolvedModeRef.current = nextMode;
      onResolvedModeChange(nextMode);
    }
  }

  function applySeriesVisibility(mode: ChartResolvedMode) {
    candleSeriesRef.current?.applyOptions({ visible: mode === 'candlestick' });
    for (const series of lineSeriesRef.current) {
      series.applyOptions({ visible: mode === 'line' });
    }
  }

  return (
    <div className="chart-frame">
      <div ref={containerRef} className="chart-container" />
      <div
        ref={tooltipRef}
        className={`tooltip ${tooltip.visible ? 'visible' : ''}`}
        style={{ left: tooltip.left, top: tooltip.top }}
        dangerouslySetInnerHTML={{ __html: tooltip.html }}
      />
      {!bars.length && !loading ? (
        <div className="empty-state">
          <strong>没有可显示的数据</strong>
          <span>检查 API Key、订阅权限、日期范围或该标的在所选时段是否有成交。</span>
        </div>
      ) : null}
      {loading ? <div className="loading-state">正在加载 K 线...</div> : null}
    </div>
  );
}

function normalizeCrosshairTime(time: Time) {
  if (typeof time === 'number') {
    return time;
  }

  if (typeof time === 'string') {
    return Math.floor(new Date(`${time}T00:00:00Z`).getTime() / 1000);
  }

  return Math.floor(
    new Date(`${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}T00:00:00Z`).getTime() / 1000
  );
}

function getChartTime(isoTime: string, mode: ChartTimeZoneMode) {
  const date = new Date(isoTime);
  if (mode === 'local') {
    return Math.floor(date.getTime() / 1000);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00';
  return Math.floor(
    Date.UTC(
      Number(value('year')),
      Number(value('month')) - 1,
      Number(value('day')),
      Number(value('hour')),
      Number(value('minute')),
      Number(value('second'))
    ) / 1000
  );
}

function formatAxisTime(time: Time, mode: ChartTimeZoneMode) {
  const date = new Date(normalizeCrosshairTime(time) * 1000);
  return mode === 'eastern' ? easternAxisFormatter.format(date) : localAxisFormatter.format(date);
}

function buildTimeAnchorData(bars: ApiBar[], mode: ChartTimeZoneMode, skipNonTradingDays: boolean): Array<WhitespaceData<UTCTimestamp>> {
  if (bars.length === 0) {
    return [];
  }

  const stepSeconds = inferSmallestGapSeconds(bars);
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    return bars.map((bar) => ({ time: getChartTime(bar.time, mode) as UTCTimestamp }));
  }

  const start = getChartTime(bars[0].time, mode);
  const end = getChartTime(bars[bars.length - 1].time, mode);
  const anchors: Array<WhitespaceData<UTCTimestamp>> = [];
  const maxAnchors = 50000;

  if (!skipNonTradingDays) {
    for (let time = start; time <= end && anchors.length < maxAnchors; time += stepSeconds) {
      anchors.push({ time: time as UTCTimestamp });
    }
    return anchors;
  }

  let segmentStart = getChartTime(bars[0].time, mode);
  let previousTime = segmentStart;
  const maxGapSeconds = stepSeconds * 3;

  for (let index = 1; index < bars.length; index += 1) {
    const currentTime = getChartTime(bars[index].time, mode);
    if (currentTime - previousTime > maxGapSeconds) {
      pushAnchorRange(anchors, segmentStart, previousTime, stepSeconds, maxAnchors);
      segmentStart = currentTime;
    }
    previousTime = currentTime;
  }

  pushAnchorRange(anchors, segmentStart, previousTime, stepSeconds, maxAnchors);
  return anchors;
}

function pushAnchorRange(anchors: Array<WhitespaceData<UTCTimestamp>>, start: number, end: number, stepSeconds: number, maxAnchors: number) {
  for (let time = start; time <= end && anchors.length < maxAnchors; time += stepSeconds) {
    anchors.push({ time: time as UTCTimestamp });
  }
}

function buildSkippedGapMarkers(bars: ApiBar[], mode: ChartTimeZoneMode): Array<HistogramData<UTCTimestamp>> {
  const markers: Array<HistogramData<UTCTimestamp>> = [];
  const nonTradingGapSeconds = 18 * 60 * 60;

  for (let index = 1; index < bars.length; index += 1) {
    const previousTime = new Date(bars[index - 1].time).getTime();
    const currentTime = new Date(bars[index].time).getTime();
    const gapSeconds = (currentTime - previousTime) / 1000;

    if (gapSeconds >= nonTradingGapSeconds) {
      markers.push({
        time: getChartTime(bars[index].time, mode) as UTCTimestamp,
        value: 1,
        color: 'rgba(23, 32, 51, 0.32)'
      });
    }
  }

  return markers;
}

function inferSmallestGapSeconds(bars: ApiBar[]) {
  let smallestGap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < bars.length; index += 1) {
    const previousTime = new Date(bars[index - 1].time).getTime();
    const currentTime = new Date(bars[index].time).getTime();
    const gapSeconds = (currentTime - previousTime) / 1000;
    if (gapSeconds > 0 && gapSeconds < smallestGap) {
      smallestGap = gapSeconds;
    }
  }

  return smallestGap;
}

function getSessionColor(session: MarketSession) {
  switch (session) {
    case 'overnight':
      return '#4f46e5';
    case 'premarket':
      return '#d97706';
    case 'regular':
      return '#059669';
    case 'aftermarket':
      return '#dc2626';
  }
}

function getSessionInstanceKey(bar: ApiBar) {
  const parts = sessionDateFormatter.formatToParts(new Date(bar.time));
  const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const sessionDate =
    bar.session === 'overnight' && hour < 4
      ? new Date(Date.UTC(year, month - 1, day - 1))
      : new Date(Date.UTC(year, month - 1, day));
  const dateKey = sessionDate.toISOString().slice(0, 10);

  return `${bar.session}:${dateKey}`;
}

function inferMaxSegmentGapSeconds(bars: ApiBar[]) {
  const smallestGap = inferSmallestGapSeconds(bars);
  if (!Number.isFinite(smallestGap)) {
    return Number.POSITIVE_INFINITY;
  }

  return smallestGap * 3;
}

function renderTooltip(bar: ApiBar) {
  const rows = [
    ['时段', `${bar.sessionLabel} · ${bar.feed}`],
    ['开', formatNumber(bar.open)],
    ['高', formatNumber(bar.high)],
    ['低', formatNumber(bar.low)],
    ['收', formatNumber(bar.close)],
    ['量', formatVolume(bar.volume)]
  ];

  return `
    <div class="tooltip-title">${etFormatter.format(new Date(bar.time))} ET / 本机 ${localTooltipFormatter.format(new Date(bar.time))}</div>
    ${rows.map(([label, value]) => `<div class="tooltip-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}
  `;
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
}

function formatVolume(value: number) {
  return value.toLocaleString('en-US');
}
