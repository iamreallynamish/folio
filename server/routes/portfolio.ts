import { Router } from "express";
import { all, get, run, insert, now } from "../db.js";
import { h, bad } from "./core.js";
import { HttpError, type User } from "../auth.js";
import { decrypt } from "../crypto.js";
import { CURRENCIES } from "../../shared/money.js";
import { earnings, MarketError, news, search, series } from "../services/market.js";

export const portfolio = Router();
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface HoldingView {
  id: number; symbol: string; name: string; quantity: number; avgPrice: number; currency: string; cost: number;
  price: number | null; priceDate: string | null; previousClose: number | null; dayChange: number | null; dayChangePct: number | null;
  value: number | null; gain: number | null; gainPct: number | null; stale: boolean; error: string | null; allocationPct: number | null;
}

/** Portfolio maths. Holdings without a provider price contribute to cost only; they are never valued by guesswork. */
export async function portfolioView(user: User, force = false) {
  const key = decrypt(user.av_key_enc);
  const rows = await all<any>("SELECT * FROM holdings WHERE user_id = ? ORDER BY symbol", user.id);
  const holdings: HoldingView[] = [];
  const histories = new Map<string, { date: string; close: number }[]>();
  let notice: string | null = key ? null : rows.length ? "Add an Alpha Vantage key in Settings to load prices." : null;
  let fetchedAt: string | null = null;
  for (const r of rows) {
    const v: HoldingView = {
      id: r.id, symbol: r.symbol, name: r.name, quantity: r.quantity, avgPrice: r.avg_price, currency: r.currency, cost: round(r.quantity * r.avg_price),
      price: null, priceDate: null, previousClose: null, dayChange: null, dayChangePct: null, value: null, gain: null, gainPct: null, stale: false, error: null, allocationPct: null,
    };
    if (key) {
      try {
        const s = await series(key, r.symbol, force);
        const pts = s.data.points, last = pts[pts.length - 1], prev = pts[pts.length - 2];
        histories.set(r.symbol, pts);
        v.price = last.close; v.priceDate = last.date; v.stale = s.stale;
        if (!fetchedAt || s.fetchedAt < fetchedAt) fetchedAt = s.fetchedAt;
        if (s.stale) notice = "Some prices could not be refreshed; showing the last saved values.";
        v.value = round(r.quantity * last.close);
        v.gain = round(v.value - v.cost);
        v.gainPct = v.cost ? round((v.gain / v.cost) * 100) : null;
        if (prev) { v.previousClose = prev.close; v.dayChange = round(r.quantity * (last.close - prev.close)); v.dayChangePct = prev.close ? round(((last.close - prev.close) / prev.close) * 100) : null; }
      } catch (e) {
        v.error = e instanceof MarketError ? e.message : "Price unavailable.";
        if (e instanceof MarketError && e.code !== "not_found") notice = e.message;
      }
    }
    holdings.push(v);
  }
  // Totals are per currency: values in different currencies are not added together.
  const totals = [...new Set(holdings.map((x) => x.currency))].map((currency) => {
    const hs = holdings.filter((x) => x.currency === currency), priced = hs.filter((x) => x.value != null);
    const value = round(priced.reduce((a, x) => a + x.value!, 0)), pricedCost = round(priced.reduce((a, x) => a + x.cost, 0));
    const day = round(priced.reduce((a, x) => a + (x.dayChange ?? 0), 0));
    for (const x of priced) x.allocationPct = value ? round((x.value! / value) * 100, 1) : null;
    // Value over time for the holdings as they stand today (not a record of past trades).
    const dates = priced.length ? priced.map((x) => histories.get(x.symbol)!.map((p) => p.date)).reduce((a, b) => a.filter((d) => b.includes(d))) : [];
    const history = dates.map((date) => ({ date, value: round(priced.reduce((a, x) => a + x.quantity * histories.get(x.symbol)!.find((p) => p.date === date)!.close, 0)) }));
    return {
      currency, value: priced.length ? value : null, cost: round(hs.reduce((a, x) => a + x.cost, 0)), gain: priced.length ? round(value - pricedCost) : null,
      gainPct: priced.length && pricedCost ? round(((value - pricedCost) / pricedCost) * 100) : null,
      dayChange: priced.length ? day : null, dayChangePct: priced.length && value - day ? round((day / (value - day)) * 100) : null,
      pricedCount: priced.length, count: hs.length, history,
    };
  });
  const priced = holdings.filter((x) => x.value != null);
  const by = (f: (x: HoldingView) => number | null, dir: 1 | -1) => [...priced].filter((x) => (f(x) ?? 0) * dir > 0).sort((a, b) => dir * ((f(b) ?? 0) - (f(a) ?? 0))).slice(0, 3)
    .map((x) => ({ symbol: x.symbol, name: x.name, currency: x.currency, dayChange: x.dayChange, dayChangePct: x.dayChangePct, gain: x.gain, gainPct: x.gainPct }));
  return {
    holdings, totals, notice, hasKey: !!key, fetchedAt,
    contributors: { dayUp: by((x) => x.dayChange, 1), dayDown: by((x) => x.dayChange, -1), totalUp: by((x) => x.gain, 1), totalDown: by((x) => x.gain, -1) },
    movers: priced.filter((x) => Math.abs(x.dayChangePct ?? 0) >= 3).map((x) => ({ symbol: x.symbol, name: x.name, dayChangePct: x.dayChangePct })),
  };
}

const needKey = (user: User) => decrypt(user.av_key_enc) ?? (() => { throw new HttpError(400, "Add an Alpha Vantage key in Settings first."); })();
const marketFail = (e: unknown): never => { throw e instanceof MarketError ? new HttpError(e.code === "rate_limit" ? 429 : 502, e.message) : e; };

portfolio.get("/portfolio", h(async (req, res) => res.json(await portfolioView(req.user, req.query.refresh === "1"))));
portfolio.get("/portfolio/search", h(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1 || q.length > 40) bad("Enter a company name or ticker.");
  res.json({ results: (await search(needKey(req.user), q).catch(marketFail)).data });
}));
portfolio.get("/portfolio/news", h(async (req, res) => {
  const symbols = (await all<{ symbol: string }>("SELECT symbol FROM holdings WHERE user_id = ?", req.user.id)).map((r) => r.symbol);
  const key = decrypt(req.user.av_key_enc);
  if (!key || !symbols.length) return res.json({ news: [], earnings: [], notice: null });
  let notice: string | null = null, items: any[] = [], cal: any[] = [];
  try { const n = await news(key, symbols); items = n.data; if (n.stale) notice = "News could not be refreshed; showing saved articles."; }
  catch (e) { notice = e instanceof MarketError ? e.message : "News is unavailable right now."; }
  for (const s of symbols.slice(0, 10)) {
    try { cal.push(...(await earnings(key, s)).data); } catch (e) { if (e instanceof MarketError && e.code === "rate_limit") { notice ??= e.message; break; } }
  }
  res.json({ news: items, earnings: cal.sort((a, b) => a.reportDate.localeCompare(b.reportDate)), notice });
}));

function holdingFields(b: any, prev?: any) {
  const symbol = b.symbol !== undefined ? String(b.symbol).trim().toUpperCase() : prev?.symbol;
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol ?? "")) bad("Enter a valid ticker symbol.");
  const quantity = b.quantity !== undefined ? Number(b.quantity) : prev?.quantity;
  const avgPrice = b.avgPrice !== undefined ? Number(b.avgPrice) : prev?.avg_price;
  if (!(quantity > 0) || !isFinite(quantity)) bad("Enter a quantity greater than zero.");
  if (!(avgPrice >= 0) || !isFinite(avgPrice)) bad("Enter your average purchase price.");
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : prev?.name;
  if (!name) bad("Enter the company name.");
  const currency = b.currency !== undefined ? String(b.currency).toUpperCase() : prev?.currency;
  if (!CURRENCIES.includes(currency)) bad("Unsupported currency.");
  return { symbol, quantity, avgPrice, name, currency };
}
portfolio.post("/holdings", h(async (req, res) => {
  const f = holdingFields(req.body);
  if (await get("SELECT 1 FROM holdings WHERE user_id = ? AND symbol = ?", req.user.id, f.symbol)) bad("You already have this holding. Edit it instead.");
  await run("INSERT INTO holdings(user_id,symbol,name,quantity,avg_price,currency,created_at) VALUES (?,?,?,?,?,?,?)", req.user.id, f.symbol, f.name, f.quantity, f.avgPrice, f.currency, now());
  res.status(201).json({ ok: true });
}));
portfolio.patch("/holdings/:id", h(async (req, res) => {
  const prev = await get<any>("SELECT * FROM holdings WHERE id = ? AND user_id = ?", Number(req.params.id), req.user.id);
  if (!prev) throw new HttpError(404, "Not found.");
  const f = holdingFields(req.body, prev);
  await run("UPDATE holdings SET symbol=?, name=?, quantity=?, avg_price=?, currency=? WHERE id=?", f.symbol, f.name, f.quantity, f.avgPrice, f.currency, prev.id);
  res.json({ ok: true });
}));
portfolio.delete("/holdings/:id", h(async (req, res) => { await run("DELETE FROM holdings WHERE id = ? AND user_id = ?", Number(req.params.id), req.user.id); res.json({ ok: true }); }));
