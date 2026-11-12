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

test("register, starter cards have no invented balance", async () => {
  assert.equal((await A("GET", "/me")).status, 401);
  assert.equal((await A("POST", "/auth/register", { email: "a@example.com", name: "A", password: "short" })).status, 400);
  assert.equal((await A("POST", "/auth/register", { email: "a@example.com", name: "A", password: "correct horse battery" })).status, 201);
  const { accounts } = (await A("GET", "/accounts")).body;
  assert.deepEqual(accounts.map((a: any) => [a.bank, a.last4, a.balanceMinor]), [["ICICI Bank", "0817", null], ["Axis Bank", "7117", null]]);
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
  await A("POST", "/sms/import", { text: "JPY 800 Axis Bank Card no. XX7117 07-10-26 12:00:00 IST KALDI COFFEE FARM" });
  const txns = (await A("GET", "/transactions?q=kaldi")).body.transactions;
  assert.equal(txns[0].categoryName, "Uncategorised");
  assert.equal(txns[0].needsReview, true);
  const food = (await A("GET", "/categories")).body.categories.find((c: any) => c.key === "groceries");
  await A("PATCH", `/transactions/${txns[0].id}`, { categoryId: food.id });
  await A("POST", "/sms/import", { text: "JPY 650 Axis Bank Card no. XX7117 09-10-26 13:00:00 IST KALDI COFFEE FARM" });
  const after = (await A("GET", "/transactions?q=kaldi")).body.transactions;
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
