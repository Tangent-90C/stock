import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { ApiBar } from '../types';

interface BarChartProps {
  bars: ApiBar[];
  loading: boolean;
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

export function BarChart({ bars, loading }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, left: 0, top: 0, html: '' });

  const chartData = useMemo(() => {
    return bars.map<CandlestickData<UTCTimestamp>>((bar) => ({
      time: Math.floor(new Date(bar.time).getTime() / 1000) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      color: bar.color,
      borderColor: bar.borderColor,
      wickColor: bar.wickColor
    }));
  }, [bars]);

  const barsByUnixTime = useMemo(() => {
    const map = new Map<number, ApiBar>();
    for (const bar of bars) {
      map.set(Math.floor(new Date(bar.time).getTime() / 1000), bar);
    }
    return map;
  }, [bars]);

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
      }
    });

    const series = chart.addCandlestickSeries({
      upColor: '#059669',
      downColor: '#059669',
      borderVisible: true,
      wickVisible: true
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
    });
    resizeObserver.observe(container);

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !containerRef.current) {
        setTooltip((current) => ({ ...current, visible: false }));
        return;
      }

      const unixTime = Number(param.time);
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
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [barsByUnixTime]);

  useEffect(() => {
    seriesRef.current?.setData(chartData);
    if (chartData.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [chartData]);

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
    <div class="tooltip-title">${etFormatter.format(new Date(bar.time))} ET</div>
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
