/**
 * Market-watch symbols from whatever the person pastes: a TradingView page link
 * (tradingview.com/symbols/NASDAQ-AAPL/ or …/chart/?symbol=NASDAQ%3AAAPL), a symbol (NSE:RELIANCE, AAPL),
 * or a TradingView embed snippet. Returns TradingView "EXCHANGE:SYMBOL" strings.
 *
 * TradingView's free embeds refuse NSE listings (exchange licensing), so NSE symbols are shown from
 * their BSE listing, which charts fine; `changed` lists those so the person is told.
 */
export const SYMBOL_RE = /^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9._!&\-]{1,30}$/;
export const MAX_WATCH = 8;

export function parseSymbols(input: string): { symbols: string[]; changed: string[] } {
  const text = input.trim();
  const found: string[] = [];
  const add = (raw: string) => { const s = decodeURIComponent(raw).trim().toUpperCase(); if (SYMBOL_RE.test(s)) found.push(s); };
  // Embed snippet: "symbols": [["NSE:APOLLO|1M"], …] or "symbol": "NASDAQ:AAPL"
  for (const m of text.matchAll(/"([A-Za-z0-9_]+:[A-Za-z0-9._!&\-]+)(?:\|[^"]*)?"/g)) add(m[1]);
  // Links
  for (const m of text.matchAll(/tradingview\.com\/symbols\/([A-Za-z0-9_]+)-([A-Za-z0-9._!&\-]+?)\/?(?=[\s/?#"]|$)/gi)) add(`${m[1]}:${m[2]}`);
  for (const m of text.matchAll(/[?&](?:tvwidgetsymbol|symbol)=([^&\s#"]+)/gi)) add(m[1]);
  // Plain symbols, separated by spaces or commas
  if (!found.length && !/[/"]/.test(text)) for (const part of text.split(/[\s,;]+/)) if (part) add(part);
  const changed: string[] = [];
  const symbols = [...new Set(found.map((s) => {
    if (s.startsWith("NSE:")) { const b = `BSE:${s.slice(4)}`; changed.push(`${s} → ${b}`); return b; }
    return s;
  }))];
  return { symbols, changed };
}
