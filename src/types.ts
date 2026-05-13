export type Timeframe = '1Min' | '5Min' | '15Min' | '30Min' | '1Hour';

export type MarketSession = 'overnight' | 'premarket' | 'regular' | 'aftermarket';

export type ChartDisplayMode = 'auto' | 'candlestick' | 'line';

export type ChartResolvedMode = 'candlestick' | 'line';

export interface ApiBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  vwap: number | null;
  feed: string;
  session: MarketSession;
  sessionLabel: string;
  color: string;
  borderColor: string;
  wickColor: string;
}

export interface BarsResponse {
  symbol: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  feeds: {
    regular: string;
    overnight: string;
  };
  warnings: string[];
  bars: ApiBar[];
}
