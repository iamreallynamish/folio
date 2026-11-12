/** Budget and spending maths. Everything here is derived from stored records only. */
import { all, get } from "../db.js";
import type { User } from "../auth.js";
import { convertMinor } from "../../shared/money.js";

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const thisMonth = () => today().slice(0, 7);
export const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
export function shiftMonth(month: string, by: number) {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function rates(user: User): Promise<Record<string, number>> {
  const out: Record<string, number> = { [user.base_currency]: 1 };
  for (const r of await all<{ from_ccy: string; rate: number }>("SELECT from_ccy, rate FROM fx_rates WHERE user_id = ? AND to_ccy = ?", user.id, user.base_currency)) out[r.from_ccy] = r.rate;
  return out;
}

interface Row { id: number; type: string; amount_minor: number; currency: string; date: string; merchant: string; merchant_key: string; category_id: number | null }

/**
 * Spending for a date range in the base currency. Refunds reduce spending; transfers and money-in
 * are excluded. Amounts in another currency are converted only with a user-set rate (an estimate).
 */
export async function spending(user: User, from: string, to: string) {
  const fx = await rates(user);
  const rows = await all<Row>(
    "SELECT id,type,amount_minor,currency,date,merchant,merchant_key,category_id FROM transactions WHERE user_id = ? AND date >= ? AND date <= ? AND type IN ('expense','refund')",
    user.id, from, to);
  let total = 0, estimated = 0, count = 0;
  const byCategory = new Map<number | null, number>();
  const byDay = new Map<string, number>();
  const byMerchant = new Map<string, { name: string; total: number; count: number }>();
  const unconverted = new Map<string, { minor: number; count: number }>();
  for (const r of rows) {
    const sign = r.type === "refund" ? -1 : 1;
    const rate = fx[r.currency];
    if (rate == null) {
      const u = unconverted.get(r.currency) ?? { minor: 0, count: 0 };
      u.minor += sign * r.amount_minor; u.count++;
      unconverted.set(r.currency, u);
      continue;
    }
    const v = sign * (r.currency === user.base_currency ? r.amount_minor : convertMinor(r.amount_minor, r.currency, user.base_currency, rate));
    if (r.currency !== user.base_currency) estimated += v;
    total += v; count++;
    byCategory.set(r.category_id, (byCategory.get(r.category_id) ?? 0) + v);
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + v);
    const m = byMerchant.get(r.merchant_key) ?? { name: r.merchant, total: 0, count: 0 };
    m.total += v; if (r.type === "expense") m.count++;
    byMerchant.set(r.merchant_key, m);
  }
  return {
    total, estimated, count, byCategory, byDay,
    merchants: [...byMerchant.values()].filter((m) => m.total > 0).sort((a, b) => b.total - a.total),
    unconverted: [...unconverted].map(([currency, v]) => ({ currency, ...v })),
  };
}

export async function monthSummary(user: User, month: string) {
  const dim = daysInMonth(month);
  const s = await spending(user, `${month}-01`, `${month}-${String(dim).padStart(2, "0")}`);
  const cur = thisMonth();
  const elapsed = month < cur ? dim : month === cur ? Number(today().slice(8)) : 0;
  const budget = user.monthly_budget_minor;
  const cats = await all<any>("SELECT id,name,icon,slot,kind,budget_minor FROM categories WHERE user_id = ? AND kind = 'expense'", user.id);
  const categories = cats
    .map((c) => {
      const spent = s.byCategory.get(c.id) ?? 0;
      return { id: c.id, name: c.name, icon: c.icon, slot: c.slot, spent, budget: c.budget_minor as number | null, pct: c.budget_minor ? Math.round((spent / c.budget_minor) * 100) : null };
    })
    .filter((c) => c.spent !== 0 || c.budget != null)
    .sort((a, b) => b.spent - a.spent);
  const orphan = s.byCategory.get(null);
  if (orphan) categories.push({ id: 0, name: "No category", icon: "question", slot: 0, spent: orphan, budget: null, pct: null });

  const transfers = await all<{ currency: string; total: number; n: number }>(
    "SELECT currency, SUM(amount_minor) total, COUNT(*) n FROM transactions WHERE user_id = ? AND type = 'transfer' AND date LIKE ? GROUP BY currency", user.id, `${month}-%`);

  const th = user.alert_threshold;
  const alerts: { level: "warning" | "over"; scope: string; text: string }[] = [];
  const check = (scope: string, spent: number, limit: number | null) => {
    if (!limit) return;
    const pct = Math.round((spent / limit) * 100);
    if (spent > limit) alerts.push({ level: "over", scope, text: `${scope} is over budget (${pct}% used)` });
    else if (pct >= th) alerts.push({ level: "warning", scope, text: `${scope} has used ${pct}% of its budget` });
  };
  check("Monthly budget", s.total, budget);
  for (const c of categories) check(c.name, c.spent, c.budget);

  const daily: { date: string; spent: number; cumulative: number }[] = [];
  let run = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const v = s.byDay.get(date) ?? 0;
    run += v;
    daily.push({ date, spent: v, cumulative: run });
  }

  return {
    month, currency: user.base_currency, spent: s.total, count: s.count, estimatedPortion: s.estimated,
    budget, remaining: budget != null ? budget - s.total : null, pctUsed: budget ? Math.round((s.total / budget) * 100) : null,
    daysElapsed: elapsed, daysInMonth: dim, dailyAverage: elapsed ? Math.round(s.total / elapsed) : 0,
    /** Straight-line projection for the current month — an estimate, labelled as such in the UI. */
    projected: month === cur && elapsed ? Math.round((s.total / elapsed) * dim) : null,
    categories, merchants: s.merchants.slice(0, 8), daily, unconverted: s.unconverted, transfers, alerts,
  };
}

export async function monthComparison(user: User, endMonth: string, n = 6) {
  return Promise.all(Array.from({ length: n }, async (_, i) => {
    const m = shiftMonth(endMonth, i - n + 1);
    const s = await spending(user, `${m}-01`, `${m}-31`);
    return { month: m, spent: s.total, count: s.count };
  }));
}

/** Merchants charged at a steady monthly or weekly rhythm (3+ times, similar amounts). An inference. */
export async function recurring(userId: number) {
  const rows = await all<{ merchant: string; merchant_key: string; date: string; amount_minor: number; currency: string }>(
    "SELECT merchant, merchant_key, date, amount_minor, currency FROM transactions WHERE user_id = ? AND type = 'expense' ORDER BY date", userId);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.merchant_key + "|" + r.currency, [...(groups.get(r.merchant_key + "|" + r.currency) ?? []), r]);
  const out: { merchant: string; merchantKey: string; cadence: "monthly" | "weekly"; amountMinor: number; currency: string; lastDate: string; nextExpected: string; occurrences: number }[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const gaps = g.slice(1).map((r, i) => (Date.parse(r.date) - Date.parse(g[i].date)) / 864e5);
    const cadence = gaps.every((x) => x >= 26 && x <= 35) ? "monthly" : gaps.every((x) => x >= 6 && x <= 8) ? "weekly" : null;
    if (!cadence) continue;
    const sorted = g.map((r) => r.amount_minor).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (!sorted.every((a) => Math.abs(a - median) <= median * 0.1)) continue;
    const last = g[g.length - 1];
    const next = new Date(Date.parse(last.date) + (cadence === "monthly" ? 30 : 7) * 864e5).toISOString().slice(0, 10);
    out.push({ merchant: last.merchant, merchantKey: last.merchant_key, cadence, amountMinor: median, currency: last.currency, lastDate: last.date, nextExpected: next, occurrences: g.length });
  }
  return out;
}

export async function incomeSummary(user: User) {
  const sources = await all<any>("SELECT * FROM income_sources WHERE user_id = ? ORDER BY kind = 'scholarship' DESC, name", user.id);
  const payments = await all<any>("SELECT * FROM income_payments WHERE user_id = ? ORDER BY COALESCE(expected_date, received_date)", user.id);
  const t = today();
  const list = sources.map((s) => {
    const ps = payments.filter((p) => p.source_id === s.id).map((p) => ({
      id: p.id, expectedDate: p.expected_date, expectedMinor: p.expected_minor, receivedMinor: p.received_minor, receivedDate: p.received_date, note: p.note,
      outstandingMinor: Math.max(0, p.expected_minor - p.received_minor),
      status: p.received_minor >= p.expected_minor && p.received_minor > 0 ? "received" : p.received_minor > 0 ? "partial" : p.expected_date && p.expected_date < t ? "overdue" : "expected",
    }));
    const sum = (f: (p: (typeof ps)[number]) => number) => ps.reduce((a, p) => a + f(p), 0);
    return {
      id: s.id, kind: s.kind, name: s.name, currency: s.currency, recurrence: s.recurrence, amountMinor: s.amount_minor, notes: s.notes, payments: ps,
      expectedMinor: sum((p) => p.expectedMinor), receivedMinor: sum((p) => p.receivedMinor), outstandingMinor: sum((p) => p.outstandingMinor),
      next: ps.find((p) => p.outstandingMinor > 0) ?? null,
    };
  });
  // Totals are kept per currency and per kind: scholarship money never mixes with other income.
  const totals: Record<string, { currency: string; scholarshipReceived: number; scholarshipOutstanding: number; otherReceived: number; otherOutstanding: number }> = {};
  for (const s of list) {
    const k = (totals[s.currency] ??= { currency: s.currency, scholarshipReceived: 0, scholarshipOutstanding: 0, otherReceived: 0, otherOutstanding: 0 });
    if (s.kind === "scholarship") { k.scholarshipReceived += s.receivedMinor; k.scholarshipOutstanding += s.outstandingMinor; }
    else { k.otherReceived += s.receivedMinor; k.otherOutstanding += s.outstandingMinor; }
  }
  return { sources: list, totals: Object.values(totals) };
}

export async function userRow(id: number) { return (await get<User>("SELECT * FROM users WHERE id = ?", id))!; }
