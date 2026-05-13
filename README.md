# 美股 24 小时分段 K 线图

一个 Vite + React + TypeScript 小应用，用 Alpaca Market Data API 加载美股最近一段时间的分时 K 线，并按美东时间把每根 K 线标记为夜盘、盘前、盘中、盘后。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

在 `.env` 中填写：

```bash
ALPACA_API_KEY_ID=your_key_id
ALPACA_API_SECRET_KEY=your_secret_key
ALPACA_DATA_API_BASE_URL=https://data.alpaca.markets/v2
ALPACA_TRADING_API_BASE_URL=https://paper-api.alpaca.markets/v2
ALPACA_STOCK_FEED=iex
ALPACA_OVERNIGHT_FEED=boats
PORT=3001
SQLITE_DB_PATH=data/market-data.sqlite
```

前端地址默认是 `http://127.0.0.1:5173`，本地代理默认是 `http://127.0.0.1:3001`。

## 功能

- 默认标的 `QCOM`，默认周期 `5Min`，默认加载最近 1 个月。
- 支持 `1Min`、`5Min`、`15Min`、`30Min`、`1Hour`。
- 代理接口：`GET /api/bars?symbol=QCOM&timeframe=5Min&start=2026-04-13&end=2026-05-13`。
- 浏览器只请求本地代理，不直接持有 Alpaca API Key/Secret。
- 分段规则固定使用美东时间：
  - 夜盘：20:00-04:00 ET
  - 盘前：04:00-09:30 ET
  - 盘中：09:30-16:00 ET
  - 盘后：16:00-20:00 ET

## 数据源说明

常规扩展时段默认请求 Alpaca historical stock bars 的 `iex` feed，夜盘默认请求 `boats` feed。Paper Trading endpoint 和 Market Data endpoint 是两套 API；历史 K 线默认使用 `ALPACA_DATA_API_BASE_URL=https://data.alpaca.markets/v2`。付费订阅可把 `ALPACA_STOCK_FEED` 改成 `sip`。如果账户无对应 feed 权限，页面会显示 Alpaca 返回的 401/403/429 等错误或 warning。

## 本地缓存

后端会把历史 K 线保存到 SQLite，默认路径是 `data/market-data.sqlite`。缓存按 `symbol + timeframe + feed + time` 去重保存，重复请求相同区间不会重复插入。请求 `/api/bars` 时会先查本地缓存，只对缺失时间段请求 Alpaca，再把新结果写回数据库。

如需清空缓存，停止本地服务后删除 `data/market-data.sqlite` 及同目录下的 `market-data.sqlite-*` 文件即可。

参考文档：

- Alpaca historical bars: https://docs.alpaca.markets/us/reference/stockbars
- Alpaca 24/5 trading and overnight data: https://docs.alpaca.markets/docs/245-trading-for-trading-api
- Alpaca market data plans: https://docs.alpaca.markets/us/docs/about-market-data-api
- Lightweight Charts per-candle colors: https://tradingview.github.io/lightweight-charts/docs/3.8/api/interfaces/CandlestickData
