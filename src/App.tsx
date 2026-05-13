import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart } from './components/BarChart';
import type { BarsResponse, ChartDisplayMode, ChartResolvedMode, ChartTimeZoneMode, LoadProgress, Timeframe } from './types';

const timeframes: Timeframe[] = ['1Min', '5Min', '15Min', '30Min', '1Hour'];
const chartModes: Array<{ value: ChartDisplayMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'candlestick', label: 'K线' },
  { value: 'line', label: '线图' }
];
const resolvedModeLabel: Record<ChartResolvedMode, string> = {
  candlestick: 'K线',
  line: '线图'
};
const timeZoneModes: Array<{ value: ChartTimeZoneMode; label: string }> = [
  { value: 'local', label: '本机时区' },
  { value: 'eastern', label: '美股时区' }
];

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultStart() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return toDateInputValue(date);
}

function getDefaultEnd() {
  return toDateInputValue(new Date());
}

export default function App() {
  const [symbol, setSymbol] = useState('QCOM');
  const [submittedSymbol, setSubmittedSymbol] = useState('QCOM');
  const [timeframe, setTimeframe] = useState<Timeframe>('5Min');
  const [start, setStart] = useState(getDefaultStart);
  const [end, setEnd] = useState(getDefaultEnd);
  const [data, setData] = useState<BarsResponse | null>(null);
  const [status, setStatus] = useState('等待加载');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [chartMode, setChartMode] = useState<ChartDisplayMode>('auto');
  const [resolvedChartMode, setResolvedChartMode] = useState<ChartResolvedMode>('candlestick');
  const [timeZoneMode, setTimeZoneMode] = useState<ChartTimeZoneMode>('local');
  const [skipNonTradingDays, setSkipNonTradingDays] = useState(true);
  const [showSkippedGapLines, setShowSkippedGapLines] = useState(true);
  const [progress, setProgress] = useState<LoadProgress | null>(null);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({
      symbol: submittedSymbol,
      timeframe,
      start,
      end
    });
    return `/api/bars?${params.toString()}`;
  }, [submittedSymbol, timeframe, start, end]);

  const loadBars = useCallback(() => {
    setLoading(true);
    setError('');
    setStatus('正在检查缓存');

    const eventSource = new EventSource(requestUrl.replace('/api/bars?', '/api/bars/stream?'));

    eventSource.addEventListener('progress', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as LoadProgress;
      setProgress(payload);
      setStatus(payload.message || '正在加载 K 线');
    });

    eventSource.addEventListener('complete', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as BarsResponse;
      setData(payload);
      setProgress(payload.progress || null);
      setStatus(payload.bars?.length ? `已加载 ${payload.bars.length.toLocaleString()} 根 K 线` : '没有返回 K 线数据');
      setLoading(false);
      eventSource.close();
    });

    eventSource.addEventListener('server-error', (event) => {
      const messageEvent = event as MessageEvent;
      let message = '加载数据失败';
      if (messageEvent.data) {
        const payload = JSON.parse(messageEvent.data) as { message?: string };
        message = payload.message || message;
      }
      setData(null);
      setError(message);
      setStatus('加载失败');
      setLoading(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setError((current) => current || '加载数据连接中断。');
      setStatus('加载失败');
      setLoading(false);
      eventSource.close();
    };

    return eventSource;
  }, [requestUrl]);

  useEffect(() => {
    const eventSource = loadBars();
    return () => eventSource.close();
  }, [loadBars]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedSymbol(symbol.trim().toUpperCase() || 'QCOM');
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">24H</span>
          <div>
            <h1>美股分段 K 线</h1>
            <p>夜盘、盘前、盘中、盘后连续展示</p>
          </div>
        </div>

        <form className="controls" onSubmit={handleSubmit}>
          <label>
            <span>股票代码</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              maxLength={10}
              spellCheck={false}
              aria-label="股票代码"
            />
          </label>

          <label>
            <span>周期</span>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)} aria-label="K 线周期">
              {timeframes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label>
            <span>开始</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} aria-label="开始日期" />
          </label>

          <label>
            <span>结束</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} aria-label="结束日期" />
          </label>

          <label>
            <span>显示</span>
            <select value={chartMode} onChange={(event) => setChartMode(event.target.value as ChartDisplayMode)} aria-label="图表显示模式">
              {chartModes.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>时区</span>
            <select value={timeZoneMode} onChange={(event) => setTimeZoneMode(event.target.value as ChartTimeZoneMode)} aria-label="时间轴时区">
              {timeZoneModes.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="checkbox-control">
            <span>跳过</span>
            <input
              type="checkbox"
              checked={skipNonTradingDays}
              onChange={(event) => setSkipNonTradingDays(event.target.checked)}
              aria-label="跳过非交易日"
            />
            <em>非交易日</em>
          </label>

          <label className="checkbox-control">
            <span>标记</span>
            <input
              type="checkbox"
              checked={showSkippedGapLines}
              onChange={(event) => setShowSkippedGapLines(event.target.checked)}
              disabled={!skipNonTradingDays}
              aria-label="显示跳过非交易日竖线"
            />
            <em>竖线</em>
          </label>

          <button type="submit" disabled={loading}>
            {loading ? '加载中' : '刷新'}
          </button>
        </form>
      </header>

      <section className="status-row" aria-live="polite">
        <div className="source-status">
          <strong>{data?.symbol || submittedSymbol}</strong>
          <span>{status}</span>
          <span>显示：{chartMode === 'auto' ? `自动 / ${resolvedModeLabel[resolvedChartMode]}` : resolvedModeLabel[resolvedChartMode]}</span>
          <span>时区：{timeZoneMode === 'local' ? '本机' : '美股'}</span>
          <span>{skipNonTradingDays ? '已跳过非交易日空档' : '保留自然时间空档'}</span>
          {data ? <span>常规 feed: {data.feeds.regular} / 夜盘 feed: {data.feeds.overnight}</span> : null}
        </div>
        <div className="legend" aria-label="时段颜色图例">
          <span><i className="overnight" />夜盘 20:00-04:00 ET</span>
          <span><i className="premarket" />盘前 04:00-09:30 ET</span>
          <span><i className="regular" />盘中 09:30-16:00 ET</span>
          <span><i className="aftermarket" />盘后 16:00-20:00 ET</span>
          {skipNonTradingDays && showSkippedGapLines ? <span><i className="skipped-gap" />跳过非交易日</span> : null}
        </div>
      </section>

      {error ? <div className="message error">{error}</div> : null}
      {data?.warnings?.length ? <div className="message warning">{data.warnings.join('；')}</div> : null}
      {resolvedChartMode === 'line' ? (
        <div className="message info">线图在盘前、盘后、夜盘出现断开，通常表示该时段没有连续成交 K 线；系统不会跨缺口硬连价格。</div>
      ) : null}
      {progress ? <ProgressPanel progress={progress} /> : null}

      <section className="chart-area">
        <BarChart
          bars={data?.bars || []}
          loading={loading}
          displayMode={chartMode}
          timeZoneMode={timeZoneMode}
          skipNonTradingDays={skipNonTradingDays}
          showSkippedGapLines={showSkippedGapLines}
          onResolvedModeChange={setResolvedChartMode}
        />
      </section>
    </main>
  );
}

function ProgressPanel({ progress }: { progress: LoadProgress }) {
  const completedEstimate = Math.min(progress.totalEstimate, progress.cachedEstimate + progress.fetchedEstimate);
  const percent = progress.totalEstimate > 0 ? Math.min(100, Math.round((completedEstimate / progress.totalEstimate) * 100)) : 0;

  return (
    <section className="progress-panel" aria-live="polite">
      <div className="progress-text">
        需覆盖约 {formatCount(progress.totalEstimate)} 个时间槽｜
        已缓存覆盖约 {formatCount(progress.cachedEstimate)} 个｜
        已请求覆盖约 {formatCount(progress.fetchedEstimate)} 个｜
        实际获取 {formatCount(progress.fetchedBars)} 根｜
        最终显示 {formatCount(progress.finalBars)} 根
      </div>
      <div className="progress-track" aria-label={`加载进度 ${percent}%`}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

function formatCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString();
}
