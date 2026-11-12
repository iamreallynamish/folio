/**
 * Market data from Alpha Vantage, cached in the database. Prices are the provider's latest daily
 * closes; when the provider is unreachable or rate-limited the last cached value is returned
 * and marked stale. Nothing here is ever synthesised.
 */
import { get, run, insert, now } from "../db.js";

export class MarketError extends Error { constructor(message: string, public code: "no_key" | "rate_limit" | "not_found" | "network") { super(message); } }

const BASE = "https://www.alphavantage.co/query";
const HOUR = 3600e3;

async function av(key: string, params: Record<string, string>, csv = false): Promise<any> {
  const url = `${BASE}?${new URLSearchParams({ ...params, apikey: key })}`;
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw new MarketError("Could not reach the market data provider.", "network"); }
  if (!res.ok) throw new MarketError(`Market data provider returned ${res.status}.`, "network");
  const text = await res.text();
  if (csv && !text.trim().startsWith("{")) return text;
  let data: any;
  try { data = JSON.parse(text); } catch { throw new MarketError("Unexpected response from the market data provider.", "network"); }
  if (data["Error Message"]) throw new MarketError("The provider does not recognise this symbol.", "not_found");
  if (data.Note || data.Information) throw new MarketError("Market data limit reached for now. Showing the last saved prices.", "rate_limit");
  return data;
}

interface Cached<T> { data: T; fetchedAt: string; stale: boolean }
async function cached<T>(key: string, ttl: number, load: () => Promise<T>, force = false): Promise<Cached<T>> {
  const row = await get<{ payload: string; fetched_at: string }>("SELECT payload, fetched_at FROM market_cache WHERE key = ?", key);
  if (row && !force && Date.now() - Date.parse(row.fetched_at) < ttl) return { data: JSON.parse(row.payload), fetchedAt: row.fetched_at, stale: false };
  try {
    const data = await load();
    await run("INSERT INTO market_cache(key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at", key, JSON.stringify(data), now());
    return { data, fetchedAt: now(), stale: false };
  } catch (e) {
    if (row) return { data: JSON.parse(row.payload), fetchedAt: row.fetched_at, stale: true };
    throw e;
  }
}

export interface Series { symbol: string; points: { date: string; close: number }[] }
/** ~100 trading days of closes. One call gives the latest price, the day's change and history. */
export function series(key: string, symbol: string, force = false) {
  return cached<Series>(`series:${symbol}`, 6 * HOUR, async () => {
    const d = await av(key, { function: "TIME_SERIES_DAILY", symbol, outputsize: "compact" });
    const ts = d["Time Series (Daily)"];
    if (!ts) throw new MarketError("No price history for this symbol.", "not_found");
    const points = Object.entries<any>(ts).map(([date, v]) => ({ date, close: Number(v["4. close"]) })).filter((p) => isFinite(p.close)).sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) throw new MarketError("No price history for this symbol.", "not_found");
    return { symbol, points };
  }, force);
}

export interface SearchHit { symbol: string; name: string; type: string; region: string; currency: string }
export function search(key: string, q: string) {
  return cached<SearchHit[]>(`search:${q.toLowerCase()}`, 7 * 24 * HOUR, async () => {
    const d = await av(key, { function: "SYMBOL_SEARCH", keywords: q });
    return (d.bestMatches ?? []).slice(0, 8).map((m: any) => ({ symbol: m["1. symbol"], name: m["2. name"], type: m["3. type"], region: m["4. region"], currency: m["8. currency"] }));
  });
}

export interface NewsItem { title: string; url: string; source: string; publishedAt: string; summary: string; sentiment: string | null; tickers: string[] }
export function news(key: string, symbols: string[]) {
  const tickers = symbols.map((s) => s.split(".")[0]).sort();
  return cached<NewsItem[]>(`news:${tickers.join(",")}`, 3 * HOUR, async () => {
    const d = await av(key, { function: "NEWS_SENTIMENT", tickers: tickers.join(","), limit: "30", sort: "LATEST" });
    return (d.feed ?? []).slice(0, 20).map((f: any) => {
      const t = String(f.time_published ?? "");
      return {
        title: f.title, url: /^https?:\/\//.test(f.url) ? f.url : "", source: f.source, summary: f.summary,
        publishedAt: t.length >= 13 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:00Z` : "",
        sentiment: f.overall_sentiment_label ?? null,
        tickers: (f.ticker_sentiment ?? []).map((x: any) => x.ticker).filter((x: string) => tickers.includes(x)),
      };
    });
  });
}

export interface EarningsItem { symbol: string; name: string; reportDate: string; fiscalDateEnding: string; estimate: number | null; currency: string }
export function earnings(key: string, symbol: string) {
  const base = symbol.split(".")[0];
  return cached<EarningsItem[]>(`earnings:${base}`, 24 * HOUR, async () => {
    const csv = await av(key, { function: "EARNINGS_CALENDAR", symbol: base, horizon: "3month" }, true);
    if (typeof csv !== "string") return [];
    return csv.trim().split(/\r?\n/).slice(1).map((line) => {
      const [sym, name, reportDate, fiscalDateEnding, estimate, currency] = line.split(",");
      return { symbol: sym, name, reportDate, fiscalDateEnding, estimate: estimate ? Number(estimate) : null, currency };
    }).filter((e) => e.symbol && /^\d{4}-\d{2}-\d{2}$/.test(e.reportDate));
  });
}
