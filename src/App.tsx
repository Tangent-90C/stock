import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart } from './components/BarChart';
import type { BarsResponse, Timeframe } from './types';

const timeframes: Timeframe[] = ['1Min', '5Min', '15Min', '30Min', '1Hour'];

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

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({
      symbol: submittedSymbol,
      timeframe,
      start,
      end
    });
    return `/api/bars?${params.toString()}`;
  }, [submittedSymbol, timeframe, start, end]);

  const loadBars = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setStatus('正在请求 Alpaca');

    try {
      const response = await fetch(requestUrl, { signal });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.message || `请求失败：${response.status}`);
      }

      setData(payload);
      setStatus(payload.bars?.length ? `已加载 ${payload.bars.length.toLocaleString()} 根 K 线` : '没有返回 K 线数据');
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setData(null);
      setError(loadError instanceof Error ? loadError.message : '加载数据失败');
      setStatus('加载失败');
    } finally {
      setLoading(false);
    }
  }, [requestUrl]);

  useEffect(() => {
    const controller = new AbortController();
    loadBars(controller.signal);
    return () => controller.abort();
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

          <button type="submit" disabled={loading}>
            {loading ? '加载中' : '刷新'}
          </button>
        </form>
      </header>

      <section className="status-row" aria-live="polite">
        <div className="source-status">
          <strong>{data?.symbol || submittedSymbol}</strong>
          <span>{status}</span>
          {data ? <span>常规 feed: {data.feeds.regular} / 夜盘 feed: {data.feeds.overnight}</span> : null}
        </div>
        <div className="legend" aria-label="时段颜色图例">
          <span><i className="overnight" />夜盘 20:00-04:00 ET</span>
          <span><i className="premarket" />盘前 04:00-09:30 ET</span>
          <span><i className="regular" />盘中 09:30-16:00 ET</span>
          <span><i className="aftermarket" />盘后 16:00-20:00 ET</span>
        </div>
      </section>

      {error ? <div className="message error">{error}</div> : null}
      {data?.warnings?.length ? <div className="message warning">{data.warnings.join('；')}</div> : null}

      <section className="chart-area">
        <BarChart bars={data?.bars || []} loading={loading} />
      </section>
    </main>
  );
}
