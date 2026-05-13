import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const marketDataBaseUrl = trimTrailingSlash(process.env.ALPACA_DATA_API_BASE_URL || 'https://data.alpaca.markets/v2');
const tradingBaseUrl = trimTrailingSlash(process.env.ALPACA_TRADING_API_BASE_URL || 'https://paper-api.alpaca.markets/v2');
const alpacaBarsUrl = `${marketDataBaseUrl}/stocks/bars`;
const dbPath = path.resolve(process.env.SQLITE_DB_PATH || 'data/market-data.sqlite');
const supportedTimeframes = new Set(['1Min', '5Min', '15Min', '30Min', '1Hour']);
const timeframeMinutes = {
  '1Min': 1,
  '5Min': 5,
  '15Min': 15,
  '30Min': 30,
  '1Hour': 60
};
const sessionMeta = {
  overnight: { label: '夜盘', color: '#4f46e5' },
  premarket: { label: '盘前', color: '#d97706' },
  regular: { label: '盘中', color: '#059669' },
  aftermarket: { label: '盘后', color: '#dc2626' }
};
const db = initDatabase(dbPath);

app.use(cors());

app.get('/api/status', (_req, res) => {
  const hasKey = Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
  res.json({
    ok: hasKey,
    dataEndpoint: marketDataBaseUrl,
    tradingEndpoint: tradingBaseUrl,
    cache: {
      ok: true,
      path: dbPath
    },
    regularFeed: process.env.ALPACA_STOCK_FEED || 'iex',
    overnightFeed: process.env.ALPACA_OVERNIGHT_FEED || 'boats'
  });
});

app.get('/api/bars', async (req, res) => {
  const symbol = String(req.query.symbol || 'QCOM').trim().toUpperCase();
  const timeframe = String(req.query.timeframe || '5Min');
  const { start, end } = getDateRange(req.query.start, req.query.end);

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
    res.status(400).json({ message: '股票代码格式不正确。' });
    return;
  }

  if (!supportedTimeframes.has(timeframe)) {
    res.status(400).json({ message: '不支持的 K 线周期。' });
    return;
  }

  if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) {
    res.status(503).json({
      message: '缺少 Alpaca API Key。请复制 .env.example 为 .env，并填写 ALPACA_API_KEY_ID 和 ALPACA_API_SECRET_KEY。'
    });
    return;
  }

  const regularFeed = normalizeFeed(process.env.ALPACA_STOCK_FEED, 'iex');
  const overnightFeed = normalizeFeed(process.env.ALPACA_OVERNIGHT_FEED, 'boats');
  const feeds = [...new Set([regularFeed, overnightFeed])];
  const coverage = feeds.map((feed) => ({
    feed,
    ranges: getMissingRanges({ symbol, timeframe, feed, start, end })
  }));
  const results = await Promise.all(
    coverage.map(async ({ feed, ranges }) => {
      if (ranges.length === 0) {
        return { feed, bars: [], fetchedRanges: [], fromCacheOnly: true, error: null };
      }

      const rangeResults = await Promise.all(
        ranges.map((range) => fetchBarsFeed({ symbol, timeframe, start: range.start, end: range.end, feed }))
      );
      const errorResult = rangeResults.find((result) => result.error);
      const bars = rangeResults.flatMap((result) => result.bars);

      if (bars.length > 0) {
        upsertBars({ symbol, timeframe, bars });
      }

      if (!errorResult) {
        for (const range of ranges) {
          addCoverageRange({ symbol, timeframe, feed, start: range.start, end: range.end });
        }
      }

      return {
        feed,
        bars,
        fetchedRanges: ranges,
        fromCacheOnly: false,
        error: errorResult?.error || null
      };
    })
  );
  const successes = results.filter((result) => !result.error);
  const failures = results.filter((result) => result.error);
  const cachedBars = feeds.flatMap((feed) => getCachedBars({ symbol, timeframe, feed, start, end }));

  if (successes.length === 0 && cachedBars.length === 0) {
    const firstError = failures[0]?.error;
    res.status(firstError?.status || 502).json({
      message: firstError?.message || 'Alpaca 数据请求失败。',
      details: failures.map((failure) => ({ feed: failure.feed, ...failure.error }))
    });
    return;
  }

  const bars = mergeBars(cachedBars, overnightFeed);

  res.json({
    symbol,
    timeframe,
    start,
    end,
    feeds: { regular: regularFeed, overnight: overnightFeed },
    warnings: failures.map((failure) => `${failure.feed}: ${failure.error.message}`),
    cache: {
      path: dbPath,
      feeds,
      fetchedRanges: results.flatMap((result) => result.fetchedRanges.map((range) => ({ feed: result.feed, ...range }))),
      hitOnly: results.every((result) => result.fromCacheOnly)
    },
    bars
  });
});

app.listen(port, () => {
  console.log(`Alpaca proxy listening on http://127.0.0.1:${port}`);
});

function getDateRange(startQuery, endQuery) {
  const end = parseDateQuery(endQuery) || new Date();
  const start = parseDateQuery(startQuery) || new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function initDatabase(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS bars (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      feed TEXT NOT NULL,
      time TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      trade_count INTEGER NOT NULL,
      vwap REAL,
      session TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, timeframe, feed, time)
    );
    CREATE INDEX IF NOT EXISTS idx_bars_lookup ON bars (symbol, timeframe, feed, time);
    CREATE TABLE IF NOT EXISTS fetch_ranges (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      feed TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, timeframe, feed, start, end)
    );
    CREATE INDEX IF NOT EXISTS idx_fetch_ranges_lookup ON fetch_ranges (symbol, timeframe, feed, start, end);
  `);
  return database;
}

function getCachedBars({ symbol, timeframe, feed, start, end }) {
  const rows = db
    .prepare(
      `SELECT time, open, high, low, close, volume, trade_count AS tradeCount, vwap, feed, session
       FROM bars
       WHERE symbol = ? AND timeframe = ? AND feed = ? AND time >= ? AND time <= ?
       ORDER BY time ASC`
    )
    .all(symbol, timeframe, feed, start, end);

  return rows.map(hydrateCachedBar);
}

function upsertBars({ symbol, timeframe, bars }) {
  if (bars.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO bars (
      symbol, timeframe, feed, time, open, high, low, close, volume, trade_count, vwap, session
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, timeframe, feed, time) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      trade_count = excluded.trade_count,
      vwap = excluded.vwap,
      session = excluded.session,
      updated_at = datetime('now')`
  );

  db.exec('BEGIN');
  try {
    for (const bar of bars) {
      insert.run(
        symbol,
        timeframe,
        bar.feed,
        bar.time,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.tradeCount,
        bar.vwap,
        bar.session
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function addCoverageRange({ symbol, timeframe, feed, start, end }) {
  db.prepare(
    `INSERT OR IGNORE INTO fetch_ranges (symbol, timeframe, feed, start, end)
     VALUES (?, ?, ?, ?, ?)`
  ).run(symbol, timeframe, feed, start, end);
}

function getMissingRanges({ symbol, timeframe, feed, start, end }) {
  const coveredRows = db
    .prepare(
      `SELECT start, end
       FROM fetch_ranges
       WHERE symbol = ? AND timeframe = ? AND feed = ? AND end >= ? AND start <= ?
       ORDER BY start ASC`
    )
    .all(symbol, timeframe, feed, start, end);
  return subtractRanges({ start, end }, coveredRows, timeframe);
}

function subtractRanges(target, coveredRows, timeframe) {
  const targetStart = new Date(target.start).getTime();
  const targetEnd = new Date(target.end).getTime();
  const stepMs = timeframeMinutes[timeframe] * 60 * 1000;
  const missing = [];
  let cursor = targetStart;

  for (const row of coveredRows) {
    const coveredStart = Math.max(new Date(row.start).getTime(), targetStart);
    const coveredEnd = Math.min(new Date(row.end).getTime(), targetEnd);
    if (Number.isNaN(coveredStart) || Number.isNaN(coveredEnd) || coveredEnd < cursor) {
      continue;
    }

    if (coveredStart > cursor) {
      missing.push({ start: new Date(cursor).toISOString(), end: new Date(coveredStart - stepMs).toISOString() });
    }
    cursor = Math.max(cursor, coveredEnd + stepMs);
  }

  if (cursor <= targetEnd) {
    missing.push({ start: new Date(cursor).toISOString(), end: new Date(targetEnd).toISOString() });
  }

  return missing.filter((range) => new Date(range.start).getTime() <= new Date(range.end).getTime());
}

function hydrateCachedBar(row) {
  const meta = sessionMeta[row.session] || sessionMeta[classifyEasternSession(row.time)];
  return {
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: Number(row.volume || 0),
    tradeCount: Number(row.tradeCount || 0),
    vwap: isFiniteNumber(row.vwap) ? row.vwap : null,
    feed: row.feed,
    session: row.session,
    sessionLabel: meta.label,
    color: meta.color,
    borderColor: meta.color,
    wickColor: meta.color
  };
}

function parseDateQuery(value) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFeed(value, fallback) {
  const feed = String(value || fallback).trim().toLowerCase();
  return feed || fallback;
}

async function fetchBarsFeed({ symbol, timeframe, start, end, feed }) {
  const bars = [];
  let pageToken = undefined;

  try {
    do {
      const url = new URL(alpacaBarsUrl);
      url.searchParams.set('symbols', symbol);
      url.searchParams.set('timeframe', timeframe);
      url.searchParams.set('start', start);
      url.searchParams.set('end', end);
      url.searchParams.set('feed', feed);
      url.searchParams.set('adjustment', 'raw');
      url.searchParams.set('limit', '10000');
      url.searchParams.set('sort', 'asc');
      if (pageToken) {
        url.searchParams.set('page_token', pageToken);
      }

      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID,
          'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET_KEY
        }
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          feed,
          bars: [],
          error: {
            status: response.status,
            message: payload?.message || payload?.error || `Alpaca 返回 ${response.status}`
          }
        };
      }

      bars.push(...normalizeAlpacaBars(payload?.bars?.[symbol] || [], feed));
      pageToken = payload?.next_page_token;
    } while (pageToken);

    return { feed, bars, error: null };
  } catch (error) {
    return {
      feed,
      bars: [],
      error: {
        status: 502,
        message: error instanceof Error ? error.message : '无法连接 Alpaca Market Data API'
      }
    };
  }
}

function normalizeAlpacaBars(rawBars, feed) {
  return rawBars
    .filter((bar) => bar?.t && isFiniteNumber(bar.o) && isFiniteNumber(bar.h) && isFiniteNumber(bar.l) && isFiniteNumber(bar.c))
    .map((bar) => {
      const session = classifyEasternSession(bar.t);
      const meta = sessionMeta[session];
      return {
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: Number(bar.v || 0),
        tradeCount: Number(bar.n || 0),
        vwap: isFiniteNumber(bar.vw) ? bar.vw : null,
        feed,
        session,
        sessionLabel: meta.label,
        color: meta.color,
        borderColor: meta.color,
        wickColor: meta.color
      };
    });
}

function mergeBars(bars, overnightFeed) {
  const byTime = new Map();

  for (const bar of bars) {
    const existing = byTime.get(bar.time);
    if (!existing) {
      byTime.set(bar.time, bar);
      continue;
    }

    const preferIncomingNight = bar.session === 'overnight' && bar.feed === overnightFeed;
    const preferIncomingRegular = existing.feed === overnightFeed && bar.feed !== overnightFeed;
    if (preferIncomingNight || preferIncomingRegular) {
      byTime.set(bar.time, bar);
    }
  }

  return [...byTime.values()].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function classifyEasternSession(isoTime) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(isoTime));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes >= 20 * 60 || totalMinutes < 4 * 60) return 'overnight';
  if (totalMinutes < 9 * 60 + 30) return 'premarket';
  if (totalMinutes < 16 * 60) return 'regular';
  return 'aftermarket';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}
