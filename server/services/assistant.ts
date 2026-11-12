/**
 * Financial assistant. Questions are first answered by a deterministic query engine over the
 * user's records ("verified"). Anything it cannot answer goes to Claude when the user has added
 * an API key; those replies are labelled AI-generated.
 */
import Anthropic from "@anthropic-ai/sdk";
import { all } from "../db.js";
import type { User } from "../auth.js";
import { decrypt } from "../crypto.js";
import { formatMoney } from "../../shared/money.js";
import { incomeSummary, monthComparison, monthSummary, recurring, shiftMonth, spending, thisMonth, today, daysInMonth } from "./summary.js";
import { portfolioView } from "../routes/portfolio.js";

export interface Answer {
  provenance: "verified" | "estimate" | "ai" | "none";
  text: string;
  facts?: { label: string; value: string }[];
  note?: string;
  suggestions?: string[];
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Period { from: string; to: string; label: string; month?: string; explicit: boolean }
function period(q: string): Period {
  const cur = thisMonth(), t = today();
  const whole = (m: string, explicit = true): Period => ({ from: `${m}-01`, to: `${m}-${daysInMonth(m)}`, label: monthLabel(m), month: m, explicit });
  if (/\btoday\b/.test(q)) return { from: t, to: t, label: "today", explicit: true };
  if (/\byesterday\b/.test(q)) { const y = iso(new Date(Date.now() - 864e5)); return { from: y, to: y, label: "yesterday", explicit: true }; }
  if (/\b(this|past) week\b|\blast 7 days\b/.test(q)) return { from: iso(new Date(Date.now() - 6 * 864e5)), to: t, label: "the last 7 days", explicit: true };
  if (/\blast month\b/.test(q)) return whole(shiftMonth(cur, -1));
  if (/\bthis year\b/.test(q)) return { from: `${t.slice(0, 4)}-01-01`, to: t, label: `${t.slice(0, 4)} so far`, explicit: true };
  if (/\b(all time|overall|ever|in total|so far)\b/.test(q)) return { from: "0000-01-01", to: "9999-12-31", label: "all recorded history", explicit: true };
  const named = q.match(new RegExp(`\\b(${MONTH_NAMES.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\b(?:\\s+(\\d{4}))?`));
  if (named) {
    const idx = MONTH_NAMES.findIndex((m) => m.startsWith(named[1].slice(0, 3)));
    let y = named[2] ? Number(named[2]) : Number(cur.slice(0, 4));
    if (!named[2] && idx + 1 > Number(cur.slice(5))) y--; // "in December" asked in November means last December
    return whole(`${y}-${String(idx + 1).padStart(2, "0")}`);
  }
  return whole(cur, /\bthis month\b/.test(q));
}
const ALL: Period = { from: "0000-01-01", to: "9999-12-31", label: "all recorded history", explicit: false };

function caveats(user: User, s: Awaited<ReturnType<typeof spending>>): { provenance: Answer["provenance"]; note?: string } {
  const notes: string[] = [];
  if (s.estimated) notes.push(`${formatMoney(s.estimated, user.base_currency)} of this was converted with exchange rates you set, so it is an estimate.`);
  if (s.unconverted.length) notes.push(`Not included: ${s.unconverted.map((u) => `${formatMoney(u.minor, u.currency)} (${u.count} in ${u.currency}, no exchange rate set)`).join(", ")}.`);
  return { provenance: s.estimated ? "estimate" : "verified", note: notes.join(" ") || undefined };
}

async function engine(user: User, question: string): Promise<Answer | null> {
  const q = question.toLowerCase();
  const base = user.base_currency, money = (n: number, c = base) => formatMoney(n, c);
  const p = period(q);

  if (/scholarship|stipend|grant/.test(q)) {
    const inc = await incomeSummary(user), list = inc.sources.filter((s) => s.kind === "scholarship");
    if (!list.length) return { provenance: "verified", text: "You have not recorded any scholarships yet. Add one under Plan → Income." };
    const facts = list.flatMap((s) => [
      { label: `${s.name} — received`, value: money(s.receivedMinor, s.currency) },
      { label: `${s.name} — outstanding`, value: money(s.outstandingMinor, s.currency) },
      ...(s.next ? [{ label: `${s.name} — next expected`, value: `${money(s.next.outstandingMinor, s.currency)} on ${s.next.expectedDate ?? "no date set"}${s.next.status === "overdue" ? " (overdue)" : ""}` }] : []),
    ]);
    const t = inc.totals.map((x) => `${money(x.scholarshipReceived, x.currency)} received and ${money(x.scholarshipOutstanding, x.currency)} still expected`).join("; ");
    return { provenance: "verified", text: `Scholarship money: ${t}. Expected payments are not counted as received.`, facts };
  }
  if (/\b(income|allowance|earn(ed|ings)?|salary|wage|family|part.?time|money in)\b/.test(q)) {
    const inc = await incomeSummary(user);
    if (!inc.sources.length) return { provenance: "verified", text: "You have not recorded any income yet. Add a source under Plan → Income." };
    return {
      provenance: "verified",
      text: inc.totals.map((x) => `In ${x.currency}: ${money(x.scholarshipReceived, x.currency)} scholarship and ${money(x.otherReceived, x.currency)} other income received; ${money(x.scholarshipOutstanding + x.otherOutstanding, x.currency)} still expected.`).join(" "),
      facts: inc.sources.map((s) => ({ label: `${s.name} (${s.kind})`, value: `${money(s.receivedMinor, s.currency)} received · ${money(s.outstandingMinor, s.currency)} outstanding` })),
      note: "Scholarships are tracked separately from other income. Refunds are not income.",
    };
  }
  if (/invest|portfolio|stock|shares?|holding|equit/.test(q)) {
    const pv = await portfolioView(user);
    if (!pv.holdings.length) return { provenance: "verified", text: "You have not added any holdings yet. Add them under Invest." };
    const pricedTotals = pv.totals.filter((t) => t.value != null);
    if (!pricedTotals.length) return { provenance: "verified", text: `You hold ${pv.holdings.length} position${pv.holdings.length > 1 ? "s" : ""} with a cost of ${pv.totals.map((t) => `${t.currency} ${t.cost.toLocaleString()}`).join(" + ")}. ${pv.notice ?? "Prices are unavailable right now, so I cannot report performance."}` };
    const n = (v: number | null, c: string) => (v == null ? "—" : `${v < 0 ? "−" : "+"}${c} ${Math.abs(v).toLocaleString()}`);
    return {
      provenance: "verified",
      text: pricedTotals.map((t) => `Your ${t.currency} holdings are worth ${t.currency} ${t.value!.toLocaleString()}: ${n(t.gain, t.currency)} (${t.gainPct ?? "—"}%) against cost, ${n(t.dayChange, t.currency)} on the latest trading day.`).join(" "),
      facts: pv.holdings.map((h) => ({ label: `${h.symbol} · ${h.quantity} @ ${h.avgPrice}`, value: h.value == null ? "Price unavailable" : `${h.currency} ${h.value.toLocaleString()} (${n(h.gain, h.currency)}, ${h.gainPct}%)` })),
      note: `Prices are Alpha Vantage daily closes${pv.holdings.find((h) => h.priceDate) ? ` as of ${pv.holdings.find((h) => h.priceDate)!.priceDate}` : ""}.${pv.notice ? " " + pv.notice : ""}`,
    };
  }
  if (/budget|on track|over ?spen|within/.test(q)) {
    const m = p.month ?? thisMonth(), s = await monthSummary(user, m);
    if (s.budget == null) return { provenance: "verified", text: `You have not set a monthly budget. In ${monthLabel(m)} you have spent ${money(s.spent)}.`, suggestions: ["Set a budget under Plan → Budget"] };
    const state = s.spent > s.budget ? `over budget by ${money(s.spent - s.budget)}` : `within budget with ${money(s.remaining!)} left`;
    return {
      provenance: s.estimatedPortion ? "estimate" : "verified",
      text: `For ${monthLabel(m)} you are ${state}: ${money(s.spent)} of ${money(s.budget)} (${s.pctUsed}%).`,
      facts: [
        { label: "Daily average", value: money(s.dailyAverage) },
        ...(s.projected != null ? [{ label: "Month-end at this pace (estimate)", value: money(s.projected) }] : []),
        ...s.categories.filter((c) => c.budget).map((c) => ({ label: `${c.name} budget`, value: `${money(c.spent)} of ${money(c.budget!)} (${c.pct}%)` })),
      ],
      note: s.alerts.map((a) => a.text).join(". ") || undefined,
    };
  }
  if (/balance|how much (is|do i have) (left )?(on|in)/.test(q)) {
    const accts = await all<any>("SELECT * FROM accounts WHERE user_id = ?", user.id);
    if (!accts.length) return { provenance: "verified", text: "You have no accounts yet." };
    return {
      provenance: "verified", text: "Here are your balances as last reported.",
      facts: accts.map((a) => ({ label: `${a.name}${a.last4 ? ` ••${a.last4}` : ""}`, value: a.balance_minor == null ? "Balance unavailable" : `${money(a.balance_minor, a.currency)} (as of ${String(a.balance_as_of).slice(0, 10)}, ${a.balance_source === "sms" ? "from bank message" : "entered by you"})` })),
      note: "Balances change only when a bank message states one or you enter one.",
    };
  }
  if (/recurring|subscription|regular payment/.test(q)) {
    const r = await recurring(user.id);
    if (!r.length) return { provenance: "estimate", text: "I have not detected any recurring payments yet. I look for the same merchant charged at least three times at a steady weekly or monthly rhythm." };
    return { provenance: "estimate", text: `I found ${r.length} likely recurring payment${r.length > 1 ? "s" : ""}.`, facts: r.map((x) => ({ label: `${x.merchant} · ${x.cadence}`, value: `${money(x.amountMinor, x.currency)} · next around ${x.nextExpected}` })), note: "Detected from patterns in your transactions; next dates are estimates." };
  }

  const range = p.explicit ? p : ALL;
  if (/biggest|largest|highest|most expensive/.test(q) && !/merchant|category|categories/.test(q)) {
    const rows = await all<any>("SELECT merchant, amount_minor, currency, date FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ? AND date <= ? ORDER BY amount_minor DESC LIMIT 5", user.id, range.from, range.to);
    if (!rows.length) return { provenance: "verified", text: `No expenses recorded for ${range.label}.` };
    return { provenance: "verified", text: `Your largest expense in ${range.label} was ${money(rows[0].amount_minor, rows[0].currency)} at ${rows[0].merchant} on ${rows[0].date}.`, facts: rows.map((r) => ({ label: `${r.merchant} · ${r.date}`, value: money(r.amount_minor, r.currency) })), note: rows.some((r) => r.currency !== rows[0].currency) ? "Ranked by face value within each currency; not converted." : undefined };
  }
  if (/merchant|shop|store|who do i|spend the most (with|at)/.test(q)) {
    const s = await spending(user, range.from, range.to);
    if (!s.merchants.length) return { provenance: "verified", text: `No spending recorded for ${range.label}.` };
    return { ...caveats(user, s), text: `In ${range.label} you spent the most with ${s.merchants[0].name} (${money(s.merchants[0].total)}).`, facts: s.merchants.slice(0, 8).map((m) => ({ label: `${m.name} · ${m.count} transaction${m.count === 1 ? "" : "s"}`, value: money(m.total) })) };
  }
  const cats = await all<{ id: number; name: string }>("SELECT id, name FROM categories WHERE user_id = ? AND kind = 'expense'", user.id);
  const cat = cats.find((c) => c.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => q.includes(w.replace(/s$/, ""))));
  if (cat && /spen[dt]|much|cost|total/.test(q)) {
    const s = await spending(user, p.from, p.to), v = s.byCategory.get(cat.id) ?? 0;
    return { ...caveats(user, s), text: `You spent ${money(v)} on ${cat.name} in ${p.label}.`, facts: s.total ? [{ label: "Share of spending", value: `${Math.round((v / s.total) * 100)}%` }] : undefined };
  }
  if (/where.*(money|spend)|breakdown|categor|goes?\b/.test(q)) {
    const s = await spending(user, range.from, range.to);
    if (!s.count) return { provenance: "verified", text: `No spending recorded for ${range.label}.` };
    const rowsC = [...s.byCategory].map(([id, v]) => ({ name: cats.find((c) => c.id === id)?.name ?? "No category", v })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    return { ...caveats(user, s), text: `In ${range.label} you spent ${money(s.total)}. Most went to ${rowsC[0].name} (${Math.round((rowsC[0].v / s.total) * 100)}%).`, facts: rowsC.map((c) => ({ label: c.name, value: `${money(c.v)} · ${Math.round((c.v / s.total) * 100)}%` })) };
  }
  if (/compare|versus|\bvs\b|trend|month.?over.?month/.test(q)) {
    const c = await monthComparison(user, thisMonth());
    return { provenance: "verified", text: "Spending by month, most recent last.", facts: c.map((m) => ({ label: monthLabel(m.month), value: `${money(m.spent)} · ${m.count} transactions` })) };
  }
  if (/spen[dt]|expens|how much/.test(q)) {
    const s = await spending(user, p.from, p.to);
    const moved = await all<{ currency: string; total: number }>("SELECT currency, SUM(amount_minor) total FROM transactions WHERE user_id = ? AND type = 'transfer' AND date >= ? AND date <= ? GROUP BY currency", user.id, p.from, p.to);
    const c = caveats(user, s);
    const extra = moved.length ? `${moved.map((m) => money(m.total, m.currency)).join(" + ")} moved to stored-value wallets or other accounts is not counted as spending.` : "";
    return { ...c, note: [c.note, extra].filter(Boolean).join(" ") || undefined, text: `You spent ${money(s.total)} in ${p.label} across ${s.count} transaction${s.count === 1 ? "" : "s"}.`, facts: s.merchants.slice(0, 3).map((m) => ({ label: m.name, value: money(m.total) })) };
  }
  return null;
}

/** A compact, factual snapshot of the user's records for Claude. No raw SMS, email or card digits. */
async function snapshot(user: User) {
  const cur = thisMonth(), strip = (s: Awaited<ReturnType<typeof monthSummary>>) => ({ month: s.month, spent: s.spent, budget: s.budget, remaining: s.remaining, pctUsed: s.pctUsed, dailyAverage: s.dailyAverage, categories: s.categories.map((c) => ({ name: c.name, spent: c.spent, budget: c.budget })), topMerchants: s.merchants, unconverted: s.unconverted, transfers: s.transfers, alerts: s.alerts.map((a) => a.text) });
  const pv = await portfolioView(user).catch(() => null);
  return {
    today: today(), baseCurrency: user.base_currency, note: "All money amounts are integers in the currency's minor unit (JPY has no decimals; most others have 2).",
    months: await Promise.all([0, -1, -2].map(async (i) => strip(await monthSummary(user, shiftMonth(cur, i))))), monthlyTotals: await monthComparison(user, cur, 12),
    accounts: await all<any>("SELECT name, kind, currency, balance_minor, balance_as_of, balance_source FROM accounts WHERE user_id = ?", user.id),
    recentTransactions: await all<any>("SELECT t.date, t.type, t.amount_minor, t.currency, t.merchant, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.user_id = ? ORDER BY t.date DESC LIMIT 150", user.id),
    recurringDetected: await recurring(user.id), income: await incomeSummary(user),
    portfolio: pv && { totals: pv.totals.map(({ history, ...t }) => t), holdings: pv.holdings, notice: pv.notice },
  };
}

const SYSTEM = `You are the assistant inside Folio, a personal finance app. Answer the user's question about their own money using only the JSON snapshot of their records below.

The snapshot is the single source of truth. If it does not contain what is needed, say what is missing rather than guessing; never invent a transaction, balance, payment, holding or price. Expected income that has not been received is not money the user has. Transfers and stored-value top-ups are not spending. Convert minor units to normal amounts with the right currency symbol when you write them.

Keep replies short and plain: lead with the answer, then at most a few supporting figures. When you go beyond the records — an interpretation, a projection, a suggestion — say so in the sentence itself, because the app labels your whole reply as AI-generated and the user needs to tell facts from opinion. This is general information, not regulated financial advice.`;

async function askClaude(user: User, apiKey: string, question: string, history: { role: "user" | "assistant"; text: string }[]): Promise<Answer> {
  const client = new Anthropic({ apiKey });
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // If the model declines a request, the API retries it on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `${SYSTEM}\n\n<records>\n${JSON.stringify(await snapshot(user))}\n</records>`,
      messages: [...history.slice(-6).map((m) => ({ role: m.role, content: m.text })), { role: "user" as const, content: question }],
    });
    if (res.stop_reason === "refusal") return { provenance: "none", text: "The assistant could not answer that question." };
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return { provenance: "ai", text: text || "The assistant returned no answer.", note: "Written by Claude from a snapshot of your records. Check important figures against the app." };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { provenance: "none", text: "Your Anthropic API key was rejected. Update it in Settings." };
    if (e instanceof Anthropic.RateLimitError) return { provenance: "none", text: "The AI service is rate-limited right now. Try again shortly." };
    if (e instanceof Anthropic.APIConnectionError) return { provenance: "none", text: "Could not reach the AI service. Check the connection and try again." };
    if (e instanceof Anthropic.APIError) return { provenance: "none", text: `The AI service returned an error (${e.status ?? "unknown"}).` };
    throw e;
  }
}

export const SUGGESTIONS = [
  "How much did I spend this month?", "Which merchants do I spend the most with?", "Where does my money go?",
  "How much scholarship money have I received?", "Am I within budget?", "How are my investments performing?",
];

export async function answer(user: User, question: string, history: { role: "user" | "assistant"; text: string }[] = [], forceAi = false): Promise<Answer> {
  const key = decrypt(user.anthropic_key_enc);
  if (!(forceAi && key)) {
    const a = await engine(user, question);
    if (a) return a;
  }
  if (key) return await askClaude(user, key, question, history);
  return {
    provenance: "none",
    text: "I can answer questions about your spending, budgets, income, scholarships, balances and investments from your records. For open-ended questions, add an Anthropic API key in Settings.",
    suggestions: SUGGESTIONS,
  };
}
