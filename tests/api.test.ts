import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { SAMPLE_MESSAGES } from "../shared/sms.ts";

process.env.FOLIO_DB = ":memory:";
process.env.FOLIO_SECRET = "test-secret";

let server: Server, base = "";
before(async () => {
  const { app } = await import("../server/app.ts");
  await new Promise<void>((r) => { server = app.listen(0, r); });
  base = `http://localhost:${(server.address() as any).port}/api`;
});
after(() => server.close());

function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Folio": "1", Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: (await res.json()) as any };
  };
}
const A = client(), B = client();

test("register: a new account starts with no cards", async () => {
  assert.equal((await A("GET", "/me")).status, 401);
  assert.equal((await A("POST", "/auth/register", { email: "a@example.com", name: "A", password: "short" })).status, 400);
  assert.equal((await A("POST", "/auth/register", { email: "a@example.com", name: "A", password: "correct horse battery" })).status, 201);
  // Nobody starts with someone else's cards: a new account has none until the person adds theirs.
  const { accounts } = (await A("GET", "/accounts")).body;
  assert.deepEqual(accounts, []);
});

test("importing the four sample messages", async () => {
  const pre = (await A("POST", "/sms/preview", { text: SAMPLE_MESSAGES.join("\n") })).body.items;
  assert.deepEqual(pre.map((i: any) => i.status), ["new", "new", "new", "new"]);
  assert.deepEqual(pre.map((i: any) => i.category), ["Shopping / Home & Furniture", "Transportation / Ride", "Groceries / Convenience Store", "Stored-value top-up"]);
  const r = (await A("POST", "/sms/import", { text: SAMPLE_MESSAGES.join("\n") })).body;
  assert.equal(r.imported, 4);

  const { accounts } = (await A("GET", "/accounts")).body;
  const icici = accounts.find((a: any) => a.last4 === "0817"), axis = accounts.find((a: any) => a.last4 === "7117");
  assert.equal(icici.balanceMinor, 63756);
  assert.equal(icici.currency, "JPY");
  assert.equal(icici.balanceSource, "sms");
  assert.equal(axis.balanceMinor, null, "Axis balance stays unknown");
  assert.ok(accounts.find((a: any) => a.kind === "wallet" && a.name === "Mobile Suica"));

  const s = (await A("GET", "/budget?month=2026-10")).body.summary;
  assert.equal(s.spent, 4779 + 500 + 421, "top-up is not spending");
  assert.deepEqual(s.transfers, [{ currency: "JPY", total: 4000, n: 1 }]);
});

test("duplicates are not recorded twice", async () => {
  const again = (await A("POST", "/sms/import", { text: SAMPLE_MESSAGES.join("\n") })).body;
  assert.equal(again.imported, 0);
  assert.equal(again.duplicates, 4);
  // Same purchase reported with different wording (no time) is still a duplicate.
  const reworded = (await A("POST", "/sms/import", { text: "JPY 421.00 spent on Axis Bank Card XX7117 at FAMILYMART on 04-Oct-2026." })).body;
  assert.equal(reworded.duplicates, 1);
  // Same merchant and amount at a different time on the same day is a separate purchase.
  const second = (await A("POST", "/sms/import", { text: "JPY 421 Axis Bank Card no. XX7117 04-10-26 21:15:00 IST FAMILYMART" })).body;
  assert.equal(second.imported, 1);
  const manual = await A("POST", "/transactions", { type: "expense", amount: "500", currency: "JPY", date: "2026-10-03", merchant: "Uber", accountId: 2 });
  assert.equal(manual.status, 409);
  assert.equal((await A("GET", "/transactions")).body.transactions.length, 5);
});

test("Suica journeys count once, as transport", async () => {
  const suica = (await A("GET", "/accounts")).body.accounts.find((a: any) => a.name === "Mobile Suica");
  const j = await A("POST", "/transactions", { type: "expense", amount: "210", currency: "JPY", date: "2026-10-06", merchant: "JR East", accountId: suica.id });
  assert.equal(j.status, 201);
  assert.equal(j.body.transaction.categoryName, "Transportation");
  const s = (await A("GET", "/budget?month=2026-10")).body.summary;
  assert.equal(s.spent, 4779 + 500 + 421 + 421 + 210);
  assert.equal(s.categories.find((c: any) => c.name === "Transportation").spent, 710);
});

test("older balance does not overwrite a newer one; balance notices update", async () => {
  await A("POST", "/sms/import", { text: "JPY 100.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at LAWSON on 01-Oct-2026. Current available balance on your Forex Prepaid Card is JPY 99,999.00." });
  let icici = (await A("GET", "/accounts")).body.accounts.find((a: any) => a.last4 === "0817");
  assert.equal(icici.balanceMinor, 63756);
  const r = (await A("POST", "/sms/import", { text: "Available balance on your ICICI Bank Forex Prepaid Card XX0817 is JPY 60,000.00 as on 06-Oct-2026." })).body;
  assert.equal(r.imported, 0);
  assert.equal(r.balances, 1);
  icici = (await A("GET", "/accounts")).body.accounts.find((a: any) => a.last4 === "0817");
  assert.equal(icici.balanceMinor, 60000);
});

test("category corrections are learned", async () => {
  await A("POST", "/sms/import", { text: "JPY 800 Axis Bank Card no. XX7117 07-10-26 12:00:00 IST TANAKA SHOTEN" });
  const txns = (await A("GET", "/transactions?q=tanaka")).body.transactions;
  assert.equal(txns[0].categoryName, "Uncategorised");
  assert.equal(txns[0].needsReview, true);
  const food = (await A("GET", "/categories")).body.categories.find((c: any) => c.key === "groceries");
  await A("PATCH", `/transactions/${txns[0].id}`, { categoryId: food.id });
  await A("POST", "/sms/import", { text: "JPY 650 Axis Bank Card no. XX7117 09-10-26 13:00:00 IST TANAKA SHOTEN" });
  const after = (await A("GET", "/transactions?q=tanaka")).body.transactions;
  assert.deepEqual(after.map((t: any) => [t.categoryName, t.needsReview]), [["Groceries / Convenience Store", false], ["Groceries / Convenience Store", false]]);
});

test("since last visit resets after review", async () => {
  let h = (await A("GET", "/home")).body;
  assert.equal(h.sinceLastVisit.count, 9);
  assert.equal(h.sinceLastVisit.totals[0].spentMinor, 4779 + 500 + 421 + 421 + 210 + 100 + 800 + 650);
  await A("POST", "/review");
  h = (await A("GET", "/home")).body;
  assert.equal(h.sinceLastVisit.count, 0);
});

test("refunds reduce spending; other currencies need a rate", async () => {
  await A("POST", "/sms/import", { text: "Refund of JPY 421 has been credited to your Axis Bank Card XX7117 from FAMILYMART on 10-10-26." });
  await A("POST", "/sms/import", { text: "INR 1,000.00 spent on Axis Bank Card XX7117 at AMAZON on 11-Oct-2026." });
  let s = (await A("GET", "/budget?month=2026-10")).body.summary;
  const base = 4779 + 500 + 421 + 421 + 210 + 100 + 800 + 650 - 421;
  assert.equal(s.spent, base);
  assert.deepEqual(s.unconverted, [{ currency: "INR", minor: 100000, count: 1 }]);
  await A("PUT", "/fx/INR", { rate: 1.8 });
  s = (await A("GET", "/budget?month=2026-10")).body.summary;
  assert.equal(s.spent, base + 1800);
  assert.equal(s.estimatedPortion, 1800);
});

test("budget alerts", async () => {
  await A("PATCH", "/me", { monthlyBudget: "10000" });
  const s = (await A("GET", "/budget?month=2026-10")).body.summary;
  assert.equal(s.budget, 10000);
  assert.equal(s.alerts[0].level, "warning");
  assert.equal(s.remaining, 10000 - s.spent);
});

test("scholarship: expected money is not received money", async () => {
  await A("POST", "/income/sources", { kind: "scholarship", name: "Test Scholarship", currency: "JPY", recurrence: "monthly", amount: "117000", firstDate: "2026-10-25", occurrences: 3 });
  let inc = (await A("GET", "/income")).body;
  assert.equal(inc.totals[0].scholarshipReceived, 0);
  assert.equal(inc.totals[0].scholarshipOutstanding, 351000);
  assert.deepEqual(inc.sources[0].payments.map((p: any) => p.expectedDate), ["2026-10-25", "2026-11-25", "2026-12-25"]);
  await A("PATCH", `/income/payments/${inc.sources[0].payments[0].id}`, { received: "117000", receivedDate: "2026-10-26" });
  await A("POST", "/income/sources", { kind: "family", name: "Family", currency: "JPY" });
  inc = (await A("GET", "/income")).body;
  assert.equal(inc.totals[0].scholarshipReceived, 117000);
  assert.equal(inc.totals[0].scholarshipOutstanding, 234000);
  assert.equal(inc.totals[0].otherReceived, 0);
  const a = (await A("POST", "/assistant", { question: "How much scholarship money have I received?" })).body.answer;
  assert.equal(a.provenance, "verified");
  assert.match(a.text, /¥117,000 received and ¥234,000 still expected/);
});

test("assistant answers from records", async () => {
  const ask = async (q: string) => (await A("POST", "/assistant", { question: q })).body.answer;
  assert.match((await ask("How much did I spend in October?")).text, /You spent ¥9,260 in October 2026/);
  assert.equal((await ask("How much did I spend in October?")).provenance, "estimate");
  assert.match((await ask("Which merchants do I spend the most with?")).text, /Nitori/);
  assert.match((await ask("Am I within budget for October?")).text, /within budget/);
  assert.match((await ask("How are my investments performing?")).text, /not added any holdings/);
  assert.equal((await ask("Tell me a joke")).provenance, "none");
});

test("users cannot see or change each other's data; CSRF header required", async () => {
  await B("POST", "/auth/register", { email: "b@example.com", name: "B", password: "another long password" });
  assert.equal((await B("GET", "/transactions")).body.transactions.length, 0);
  const aTxn = (await A("GET", "/transactions")).body.transactions[0];
  assert.equal((await B("PATCH", `/transactions/${aTxn.id}`, { note: "x" })).status, 404);
  assert.equal((await B("DELETE", `/transactions/${aTxn.id}`)).status, 404);
  assert.equal((await B("PATCH", "/accounts/1", { name: "x" })).status, 404);
  assert.equal((await B("POST", "/transactions", { amount: "1", currency: "JPY", merchant: "x", accountId: 1 })).status, 404);
  assert.equal((await A("POST", "/review", undefined, { "X-Folio": "" })).status, 403);
  assert.equal((await A("POST", "/accounts", { name: "Card", last4: "4111111111111111" })).status, 400, "full card numbers are rejected");
});

test("ingest endpoint with personal token", async () => {
  const { token } = (await A("POST", "/me/ingest-token")).body;
  const res = await fetch(base + "/ingest/sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: "JPY 300 Axis Bank Card no. XX7117 12-10-26 09:00:00 IST STARBUCKS" }) });
  assert.deepEqual(await res.json(), { imported: 1, duplicates: 0, ignored: 0, balances: 0 });
  const bad = await fetch(base + "/ingest/sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer nope" }, body: "{}" });
  assert.equal(bad.status, 401);
});

test("first-run tour progress is saved and finishing marks the account onboarded", async () => {
  const C = client();
  const r = await C("POST", "/auth/register", { email: `tour${Date.now()}@example.com`, name: "Tour", password: "a long test password" });
  assert.equal(r.body.user.onboarded, false);
  assert.equal(r.body.user.tourStep, 0);
  assert.equal((await C("PATCH", "/me", { tourStep: 3 })).body.user.tourStep, 3);
  assert.equal((await C("GET", "/me")).body.user.tourStep, 3, "a reload resumes at the saved step");
  const done = (await C("PATCH", "/me", { onboarded: true, tourStep: 0 })).body.user;
  assert.equal(done.onboarded, true);
  assert.equal(done.tourStep, 0);
  assert.equal((await C("PATCH", "/me", { tourStep: 99 })).body.user.tourStep, 10, "out-of-range steps are clamped");
  const again = (await C("PATCH", "/me", { onboarded: false })).body.user;
  assert.equal(again.onboarded, false, "setup can be asked for again");
  assert.equal(again.tourStep, 0, "and starts from the welcome");
});

const D = client(); // shared by the tests below (sign-ups are rate-limited)
test("same-day identical purchases with different balances are both kept; re-pasting adds nothing", async () => {
  assert.equal((await D("POST", "/auth/register", { email: "same-day@example.com", name: "S", password: "correct horse battery" })).status, 201);
  const a = "JPY 302.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at SEVEN-ELEVEN on 27-Oct-2026 . Current available balance on your Forex Prepaid Card is JPY 85,889.00 0.";
  const b = "JPY 302.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at SEVEN-ELEVEN on 27-Oct-2026 . Current available balance on your Forex Prepaid Card is JPY 85,587.00 0.";
  const first = (await D("POST", "/sms/import", { text: `${a}\n\n${b}` })).body;
  assert.equal(first.imported, 2, "two messages, two balances: two purchases");
  const again = (await D("POST", "/sms/import", { text: `${a}\n\n${b}` })).body;
  assert.equal(again.imported, 0);
  assert.equal(again.duplicates, 2);
});

test("an Axis 'using … Credit Card' alert pasted with its line break imports as one purchase", async () => {
  const r = (await D("POST", "/sms/import", { text: "JPY 339 using Axis Bank Credit Card no. XX7117 on 31-10-26 21:02:52 IST at \nSEVEN-ELEVE." })).body;
  assert.equal(r.imported, 1);
  const t = (await D("GET", "/transactions")).body.transactions[0];
  assert.equal(t.merchant, "7-Eleven");
  assert.equal(t.amountMinor, 339);
});

test("earlier imports left uncategorised are re-read on the next import", async () => {
  const { run, get } = await import("../server/db.ts");
  // Recreate how the old parser stored an ICICI 7-Eleven purchase: merchant "Seven", uncategorised, needs review.
  const t = (await D("GET", "/transactions")).body.transactions.find((x: any) => x.merchant === "7-Eleven" && x.amountMinor === 302);
  const unc = await get<{ id: number }>("SELECT id FROM categories WHERE user_id = (SELECT user_id FROM transactions WHERE id = ?) AND key = 'uncategorised'", t.id);
  await run("UPDATE transactions SET merchant = 'Seven', merchant_key = 'SEVEN', category_id = ?, needs_review = 1 WHERE id = ?", unc!.id, t.id);
  const r = (await D("POST", "/sms/import", { text: "JPY 402.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at FAMILYMART on 28-Oct-2026 . Current available balance on your Forex Prepaid Card is JPY 79,734.00 0." })).body;
  assert.equal(r.imported, 1);
  assert.equal(r.recategorised, 1);
  const fixed = (await D("GET", "/transactions")).body.transactions.find((x: any) => x.id === t.id);
  assert.equal(fixed.merchant, "7-Eleven");
  assert.equal(fixed.needsReview, false);
  assert.match(fixed.categoryName, /^Groceries/);
});

test("cash withdrawals: chosen by hand or converted, never counted as spending, never learned", async () => {
  const spent = async () => (await D("GET", "/budget?month=2026-11")).body.summary.spent;
  const before = await spent();
  const axis = (await D("GET", "/accounts")).body.accounts.find((a: any) => a.last4 === "7117");
  // Chosen by hand
  const w = await D("POST", "/transactions", { cashWithdrawal: true, amount: "10000", currency: "JPY", date: "2026-11-03", accountId: axis.id });
  assert.equal(w.status, 201);
  assert.equal(w.body.transaction.type, "transfer");
  assert.equal(w.body.transaction.categoryKey, "cash");
  assert.equal(w.body.transaction.categoryName, "Cash withdrawal");
  assert.equal(w.body.transaction.transferName, "Cash");
  assert.equal(w.body.transaction.merchant, "Cash withdrawal");
  assert.equal(await spent(), before, "a withdrawal is not spending");
  // Converted from a purchase (e.g. an ATM inside a 7-Eleven recorded as 7-Eleven)
  const p = await D("POST", "/transactions", { type: "expense", amount: "5000", currency: "JPY", date: "2026-11-04", merchant: "7-Eleven", accountId: axis.id });
  assert.equal(await spent(), before + 5000);
  const c = await D("PATCH", `/transactions/${p.body.transaction.id}`, { cashWithdrawal: true });
  assert.equal(c.body.transaction.categoryKey, "cash");
  assert.equal(await spent(), before, "converting removes it from spending");
  // …and 7-Eleven purchases are still groceries afterwards.
  const next = await D("POST", "/transactions", { type: "expense", amount: "300", currency: "JPY", date: "2026-11-05", merchant: "7-Eleven", accountId: axis.id });
  assert.match(next.body.transaction.categoryName, /^Groceries/);
  // An imported ATM message lands in the same place.
  const imp = (await D("POST", "/sms/import", { text: "JPY 20000 using Axis Bank Credit Card no. XX7117 on 06-11-26 11:00:00 IST at SEVEN BANK ATM." })).body;
  assert.equal(imp.items[0].category, "Cash withdrawal");
  assert.equal(await spent(), before + 300);
});

test("a purchase typed in at an ATM is recorded as a withdrawal", async () => {
  const r = await D("POST", "/transactions", { type: "expense", amount: "3000", currency: "JPY", date: "2026-11-07", merchant: "Seven Bank ATM" });
  assert.equal(r.body.transaction.type, "transfer");
  assert.equal(r.body.transaction.categoryKey, "cash");
});

test("card line settings: billing cycle days and last top-up (set, or from money added)", async () => {
  const accts = (await D("GET", "/accounts")).body.accounts;
  const axis = accts.find((a: any) => a.last4 === "7117"), icici = accts.find((a: any) => a.last4 === "0817");
  const a = (await D("PATCH", `/accounts/${axis.id}`, { cardLine: "cycle", statementDay: 15, dueDay: 5 })).body.account;
  assert.deepEqual([a.cardLine, a.statementDay, a.dueDay], ["cycle", 15, 5]);
  assert.equal((await D("PATCH", `/accounts/${axis.id}`, { statementDay: 32 })).status, 400);
  const i = (await D("PATCH", `/accounts/${icici.id}`, { cardLine: "topup", lastTopup: "2026-10-20" })).body.account;
  assert.equal(i.lastTopup, "2026-10-20");
  // Money transferred onto the card later moves the date forward by itself.
  await D("POST", "/transactions", { type: "transfer", amount: "50000", currency: "JPY", date: "2026-11-08", merchant: "Forex reload", transferAccountId: icici.id });
  const after = (await D("GET", "/accounts")).body.accounts.find((x: any) => x.id === icici.id);
  assert.equal(after.lastTopup, "2026-11-08");
});


test("setup: accent, answers, watchlist and card looks are personal", async () => {
  const E = D; // sign-ups are rate-limited; the shared test account has never been through setup
  let u = (await E("GET", "/me")).body.user;
  assert.equal(u.accent, "folio");
  assert.deepEqual(u.marketSymbols, [], "no one else's stocks");
  assert.equal(u.profile.setupDone, undefined);
  u = (await E("PATCH", "/me", { accent: "violet", profile: { goals: ["budget", "investing", "nonsense"], incomes: ["scholarship"], setupStep: 3 } })).body.user;
  assert.equal(u.accent, "violet");
  assert.deepEqual(u.profile.goals, ["budget", "investing"], "unknown answers are dropped");
  assert.equal(u.profile.setupStep, 3);
  assert.equal((await E("PATCH", "/me", { accent: "chartreuse" })).status, 400);
  u = (await E("PATCH", "/me", { profile: { setupDone: true } })).body.user;
  assert.deepEqual([u.profile.goals, u.profile.setupDone], [["budget", "investing"], true], "answers merge");
  u = (await E("PATCH", "/me", { marketSymbols: ["NASDAQ:AAPL", "bse:tcs"] })).body.user;
  assert.deepEqual(u.marketSymbols, ["NASDAQ:AAPL", "BSE:TCS"]);
  assert.equal((await E("PATCH", "/me", { marketSymbols: ["<script>"] })).status, 400);
  // Their own cards: matching art where Folio has it, otherwise colours in turn.
  const c1 = (await E("POST", "/accounts", { kind: "card", bank: "ICICI Bank", cardType: "Forex Prepaid Card", name: "ICICI forex", last4: "1234", currency: "JPY" })).body.account;
  const c2 = (await E("POST", "/accounts", { kind: "card", bank: "HDFC Bank", cardType: "Credit Card", name: "HDFC credit", last4: "5678", currency: "INR" })).body.account;
  assert.equal(c1.theme, "icici-student");
  assert.notEqual(c2.theme, "icici-student");
  // Asking for setup again resets its progress.
  u = (await E("PATCH", "/me", { onboarded: false })).body.user;
  assert.deepEqual([u.profile.setupDone, u.profile.setupStep], [false, 0]);
});

test("home insights: what changed, plus insights from the person's own records", async () => {
  await D("PATCH", "/me", { monthlyBudget: "60000", profile: { goals: ["budget", "scholarship"] } });
  const ins = (await D("GET", "/home")).body.insights;
  assert.equal(typeof ins.change, "string");
  assert.ok(ins.change.length > 10);
  assert.ok(Array.isArray(ins.more) && ins.more.length > 0);
  for (const i of ins.more) assert.ok(["info", "good", "warn"].includes(i.tone));
  // Warnings come first; nothing is invented (every insight refers to something recorded or a suggestion).
  const firstOk = ins.more.findIndex((i: any) => i.tone !== "warn");
  assert.ok(firstOk === -1 || ins.more.slice(firstOk).every((i: any) => i.tone !== "warn"));
});

test("notifications: subscribe, preferences, alerts sent once, dead devices forgotten", async () => {
  const { setPushSender, dailyChecks, budgetCheck } = await import("../server/services/notify.ts");
  const { get, run } = await import("../server/db.ts");
  const sent: { endpoint: string; body: any }[] = [];
  let gone = new Set<string>();
  setPushSender(async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, body: JSON.parse(payload) });
  });
  try {
    const key = (await D("GET", "/push/key")).body.publicKey;
    assert.match(key, /^[A-Za-z0-9_-]{80,}$/, "server signing key, generated once");
    assert.equal((await D("GET", "/push/key")).body.publicKey, key);
    assert.equal((await D("POST", "/push/subscribe", { subscription: { endpoint: "nope" } })).status, 400);
    const sub = { endpoint: "https://push.example.com/device-a", keys: { p256dh: "BAAA", auth: "xyz" } };
    assert.equal((await D("POST", "/push/subscribe", { subscription: sub })).body.devices, 1);
    const me = (await D("GET", "/me")).body.user;
    assert.deepEqual(me.notify, { budget: true, scholarship: true, card: true, transactions: true, daily: false });
    // Test notification reaches the device.
    assert.equal((await D("POST", "/push/test", {})).status, 200);
    assert.equal(sent.at(-1)!.body.title, "Notifications are on");
    // Budget: set a tiny budget so this month's spending is over it → one alert, never repeated.
    await D("PATCH", "/me", { monthlyBudget: "1" });
    await D("POST", "/transactions", { type: "expense", amount: "500", currency: "JPY", date: new Date().toISOString().slice(0, 10), merchant: "Lawson" });
    const u = await get<any>("SELECT * FROM users WHERE email = 'same-day@example.com'");
    await budgetCheck(u); await budgetCheck(u);
    const over = sent.filter((s) => s.body.title === "Over budget");
    assert.equal(over.length, 1, "sent once, not again");
    assert.equal(over[0].body.url, "/#plan");
    // Preferences: daily summary is off by default, on when chosen; sent once per day.
    let n = sent.length;
    await dailyChecks(u, "2026-11-21");
    assert.ok(!sent.slice(n).some((s) => s.body.title === "Your day in Folio"));
    await D("PATCH", "/me", { notify: { daily: true } });
    const u2 = await get<any>("SELECT * FROM users WHERE email = 'same-day@example.com'");
    n = sent.length;
    await dailyChecks(u2, "2026-11-21"); await dailyChecks(u2, "2026-11-21");
    assert.equal(sent.slice(n).filter((s) => s.body.title === "Your day in Folio").length, 1);
    // Card due: due day set on a card → alert inside three days.
    const card = (await D("GET", "/accounts")).body.accounts.find((a: any) => a.kind === "card");
    await D("PATCH", `/accounts/${card.id}`, { statementDay: 10, dueDay: 23 });
    n = sent.length;
    await dailyChecks(u2, "2026-11-21");
    assert.ok(sent.slice(n).some((s) => /payment due/.test(s.body.title)), "card due in two days");
    // A device that has gone away is removed.
    gone = new Set([sub.endpoint]);
    await D("POST", "/push/test", {});
    assert.equal((await get<{ n: number }>("SELECT COUNT(*) n FROM push_subs WHERE endpoint = ?", sub.endpoint))!.n, 0);
    await run("UPDATE users SET monthly_budget_minor = NULL WHERE email = 'same-day@example.com'");
  } finally { setPushSender(null); }
});

test("daily notification run: open without CRON_SECRET, required with it", async () => {
  const r = await fetch(base + "/cron/notify");
  assert.equal(r.status, 200);
  process.env.CRON_SECRET = "s3cret";
  try {
    assert.equal((await fetch(base + "/cron/notify")).status, 401);
    assert.equal((await fetch(base + "/cron/notify", { headers: { Authorization: "Bearer s3cret" } })).status, 200);
  } finally { delete process.env.CRON_SECRET; }
});
