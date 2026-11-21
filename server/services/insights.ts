/**
 * The two lines under Home's greeting: what changed since the last visit, and one insight chosen by
 * what the person said they care about in setup. Every figure comes from their own records; the one
 * projection ("at this pace") is worded as such. Market moves use saved closing prices only, so
 * opening the app never spends market-data requests.
 */
import { all, get } from "../db.js";
import { parseProfile, type User } from "../auth.js";
import { formatMoney } from "../../shared/money.js";
import { spending } from "./summary.js";

export interface Insight { key: string; text: string; tone: "info" | "good" | "warn"; goal: string }

const DAY = 864e5;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "earlier today", "yesterday", "Tuesday", or "12 Nov". */
export function since(iso: string, todayIso: string): string {
  const days = Math.round((Date.parse(todayIso) - Date.parse(iso.slice(0, 10))) / DAY);
  if (days <= 0) return "your last visit";
  if (days === 1) return "yesterday";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function homeInsights(u: User, ctx: {
  today: string; summary: any; fresh: any[]; income: { sources: any[] }; totalTxns: number;
}): Promise<{ change: string; more: Insight[] }> {
  const cur = u.base_currency;
  const m = (minor: number, currency = cur) => formatMoney(Math.round(minor), currency).replace(/\.00$/, "");
  const goals = parseProfile(u.profile).goals ?? [];
  const s = ctx.summary;

  // ---- line 1: what changed
  let change: string;
  const when = since(u.last_reviewed_at, ctx.today);
  const spent = ctx.fresh.filter((t) => t.currency === cur && (t.type === "expense" || t.type === "refund"));
  const spentTotal = spent.reduce((a, t) => a + (t.type === "refund" ? -1 : 1) * t.amountMinor, 0);
  const cameIn = ctx.fresh.filter((t) => t.type === "income" && t.currency === cur).reduce((a, t) => a + t.amountMinor, 0);
  if (spentTotal > 0) {
    const byMerchant = new Map<string, number>();
    for (const t of spent) if (t.type === "expense") byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + t.amountMinor);
    const top = [...byMerchant].sort((a, b) => b[1] - a[1])[0];
    const n = spent.filter((t) => t.type === "expense").length;
    change = `${m(spentTotal)} spent across ${n} purchase${n === 1 ? "" : "s"} since ${when}${top && n > 1 ? `, most at ${top[0]}` : top ? ` at ${top[0]}` : ""}.`;
    if (cameIn > 0) change = change.slice(0, -1) + `, and ${m(cameIn)} came in.`;
  } else if (cameIn > 0) change = `${m(cameIn)} came in since ${when}.`;
  else if (ctx.totalTxns === 0) change = "Nothing here yet. Import a few bank messages and Folio sorts them for you.";
  else change = `Nothing new since ${when}. You're all caught up.`;

  // ---- line 2: candidates, each tagged with the goal it serves
  const out: Insight[] = [];
  const daysLeft = Math.max(0, s.daysInMonth - s.daysElapsed);
  if (s.budget != null) {
    if (s.remaining < 0) out.push({ key: "over", goal: "budget", tone: "warn", text: `You're ${m(-s.remaining)} over your ${m(s.budget)} budget this month.` });
    else if (s.projected != null && s.daysElapsed >= 5 && s.projected > s.budget)
      out.push({ key: "pace", goal: "budget", tone: "warn", text: `At this pace you'd spend about ${m(s.projected)} this month, ${m(s.projected - s.budget)} over budget.` });
    else if (daysLeft > 0) out.push({ key: "left", goal: "budget", tone: "good", text: `${m(s.remaining)} of your budget left with ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go, about ${m(s.remaining / daysLeft)} a day.` });
    if (s.projected != null && s.daysElapsed >= 7 && s.projected < s.budget && s.spent > 0)
      out.push({ key: "spare", goal: "saving", tone: "good", text: `On this pace you'd finish the month with about ${m(s.budget - s.projected)} to spare.` });
  } else if (goals.includes("budget") || goals.includes("saving")) {
    out.push({ key: "setbudget", goal: "budget", tone: "info", text: "Set a monthly budget in Plan and Folio will show what's left as you spend." });
  }

  const topCat = [...(s.categories ?? [])].filter((c: any) => c.spent > 0).sort((a: any, b: any) => b.spent - a.spent)[0];
  if (topCat && s.spent > 0) out.push({ key: "topcat", goal: "spending", tone: "info", text: `${topCat.name} is your biggest spend this month: ${m(topCat.spent)}, ${Math.round((topCat.spent / s.spent) * 100)}% of the total.` });
  const t0 = Date.parse(ctx.today);
  const [thisWeek, lastWeek] = await Promise.all([spending(u, isoDay(t0 - 6 * DAY), ctx.today), spending(u, isoDay(t0 - 13 * DAY), isoDay(t0 - 7 * DAY))]);
  if (thisWeek.total > 0 && lastWeek.total > 0) {
    const pct = Math.round(((thisWeek.total - lastWeek.total) / lastWeek.total) * 100);
    if (Math.abs(pct) >= 10) out.push({ key: "week", goal: "spending", tone: pct < 0 ? "good" : "info",
      text: `You've spent ${Math.abs(pct)}% ${pct < 0 ? "less" : "more"} in the last 7 days than the week before (${m(thisWeek.total)} vs ${m(lastWeek.total)}).` });
  }

  for (const src of ctx.income.sources) {
    const goal = src.kind === "scholarship" ? "scholarship" : "income";
    const overdue = src.payments.find((p: any) => p.status === "overdue");
    if (overdue) { out.push({ key: `late-${src.id}`, goal, tone: "warn", text: `${src.name}: ${m(overdue.outstandingMinor, src.currency)} expected ${short(overdue.expectedDate)} hasn't arrived yet.` }); continue; }
    const next = src.payments.find((p: any) => p.outstandingMinor > 0 && p.expectedDate && p.expectedDate >= ctx.today);
    if (next) out.push({ key: `next-${src.id}`, goal, tone: "info", text: `Next from ${src.name}: ${m(next.outstandingMinor, src.currency)}, expected ${short(next.expectedDate)}.` });
  }

  // Portfolio: the latest close against the one before, from saved prices only.
  const holdings = await all<{ symbol: string; quantity: number; currency: string }>("SELECT symbol, quantity, currency FROM holdings WHERE user_id = ?", u.id);
  if (holdings.length) {
    let now = 0, before = 0, date = "", ccy = holdings[0].currency, best: { symbol: string; move: number } | null = null;
    for (const h of holdings.filter((x) => x.currency === ccy)) {
      const row = await get<{ payload: string }>("SELECT payload FROM market_cache WHERE key = ?", `series:${h.symbol}`);
      const pts = row ? (JSON.parse(row.payload).points as { date: string; close: number }[]) : [];
      if (pts.length < 2) continue;
      const a = pts[pts.length - 1], b = pts[pts.length - 2];
      now += h.quantity * a.close; before += h.quantity * b.close; date = date > a.date ? date : a.date;
      const move = h.quantity * (a.close - b.close);
      if (!best || Math.abs(move) > Math.abs(best.move)) best = { symbol: h.symbol.split(".")[0], move };
    }
    if (before > 0) {
      const pct = ((now - before) / before) * 100, diff = Math.round((now - before) * 100);
      out.push({ key: "portfolio", goal: "investing", tone: pct >= 0 ? "good" : "info",
        text: `Your portfolio ${pct >= 0 ? "rose" : "fell"} ${Math.abs(pct).toFixed(2)}% (${formatMoney(Math.abs(diff), ccy)}) at the close on ${short(date)}${best ? `, ${best.move >= 0 ? "led" : "dragged"} by ${best.symbol}` : ""}.` });
    }
  } else if (goals.includes("investing")) out.push({ key: "addholdings", goal: "investing", tone: "info", text: "Add the shares you own in Invest to see their value and daily moves." });

  // A credit card payment due within five days (from the statement and due days set on the card).
  for (const a of await all<any>("SELECT * FROM accounts WHERE user_id = ? AND statement_day IS NOT NULL AND due_day IS NOT NULL", u.id)) {
    const d = new Date(`${ctx.today}T00:00:00Z`);
    const due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), a.due_day));
    if (due.getTime() < d.getTime()) due.setUTCMonth(due.getUTCMonth() + 1);
    const inDays = Math.round((due.getTime() - d.getTime()) / DAY);
    if (inDays <= 5) out.push({ key: `due-${a.id}`, goal: "budget", tone: "warn", text: `${a.bank ?? a.name}${a.last4 ? ` ••${a.last4}` : ""} payment is due ${inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `on ${short(isoDay(due.getTime()))}`}.` });
  }
  if (!(await get("SELECT 1 FROM accounts WHERE user_id = ? AND kind IN ('card','bank')", u.id)))
    out.push({ key: "nocards", goal: "spending", tone: "info", text: "Add your cards in Settings, or import bank messages and they appear by themselves." });

  // Warnings first, then what this person said they care about (in their order), then the rest.
  const rank = (i: Insight) => (i.tone === "warn" ? 0 : 1) * 100 + (goals.includes(i.goal) ? goals.indexOf(i.goal) : 50);
  return { change, more: out.sort((a, b) => rank(a) - rank(b)) };
}
