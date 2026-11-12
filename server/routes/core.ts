import { Router, type Request, type Response, type NextFunction } from "express";
import { all, get, run, insert, now, tx } from "../db.js";
import { HttpError, publicUser, type User } from "../auth.js";
import { encrypt, randomToken, sha256 } from "../crypto.js";
import { CURRENCIES, convertMinor, toMinor } from "../../shared/money.js";
import { identifyMerchant, merchantKey } from "../../shared/merchants.js";
import { messagesFromFile, splitMessages } from "../../shared/sms.js";
import { categoryByKey, ensureWallet, fingerprint, findDuplicate, importMessages, previewMessages, resolveCategory, type IncomingSms } from "../services/ingest.js";
import { incomeSummary, monthComparison, monthSummary, rates, recurring, thisMonth, today, userRow } from "../services/summary.js";

export const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve().then(() => fn(req, res)).catch(next);
export const bad = (msg: string): never => { throw new HttpError(400, msg); };
const ccy = (v: unknown) => (CURRENCIES.includes(String(v)) ? String(v) : bad("Unsupported currency."));
const dateOk = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(Date.parse(String(v))) ? String(v) : bad("Enter a valid date."));
const monthOf = (v: unknown) => (/^\d{4}-\d{2}$/.test(String(v ?? "")) ? String(v) : thisMonth());
const amount = (v: unknown, currency: string) => {
  const m = toMinor(String(v ?? ""), currency);
  return m != null && m > 0 ? m : bad("Enter an amount greater than zero.");
};
/** Row must belong to the signed-in user; anything else is reported as missing. */
async function owned<T = any>(table: string, id: unknown, userId: number): Promise<T> {
  const row = await get<T>(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, Number(id), userId);
  if (!row) throw new HttpError(404, "Not found.");
  return row;
}

export const core = Router();

// ---------- profile and settings ----------
core.get("/me", h(async (req, res) => res.json({ user: publicUser(req.user) })));
core.patch("/me", h(async (req, res) => {
  const u = req.user, b = req.body;
  const base = b.baseCurrency !== undefined ? ccy(b.baseCurrency) : u.base_currency;
  let budget = u.monthly_budget_minor;
  if (b.monthlyBudget !== undefined) budget = b.monthlyBudget === null || b.monthlyBudget === "" ? null : amount(b.monthlyBudget, base);
  const th = b.alertThreshold !== undefined ? Math.min(100, Math.max(50, Math.round(Number(b.alertThreshold)) || 80)) : u.alert_threshold;
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) || bad("Enter your name.") : u.name;
  await run("UPDATE users SET name=?, base_currency=?, monthly_budget_minor=?, alert_threshold=? WHERE id=?", name, base, budget, th, u.id);
  // onboarded:false asks for the first-run setup again the next time the app opens.
  if (b.onboarded === false) await run("UPDATE users SET onboarded_at=NULL, tour_step=0 WHERE id=?", u.id);
  if (b.onboarded === true && !u.onboarded_at) await run("UPDATE users SET onboarded_at=? WHERE id=?", now(), u.id);
  // Guided-tour progress, so a reload resumes at the same step.
  if (b.tourStep !== undefined) await run("UPDATE users SET tour_step=? WHERE id=?", Math.max(0, Math.min(10, Math.trunc(Number(b.tourStep)) || 0)), u.id);
  res.json({ user: publicUser(await userRow(u.id)) });
}));
core.put("/me/keys", h(async (req, res) => {
  for (const [field, col] of [["alphaVantage", "av_key_enc"], ["anthropic", "anthropic_key_enc"]] as const) {
    const v = req.body[field];
    if (v === undefined) continue;
    const key = v === null ? null : String(v).trim();
    if (key !== null && (key.length < 8 || key.length > 300)) bad("That key does not look right.");
    await run(`UPDATE users SET ${col} = ? WHERE id = ?`, key ? encrypt(key) : null, req.user.id);
  }
  res.json({ user: publicUser(await userRow(req.user.id)) });
}));
core.post("/me/ingest-token", h(async (req, res) => {
  const token = `folio_${randomToken(24)}`;
  await run("UPDATE users SET ingest_token_hash = ? WHERE id = ?", sha256(token), req.user.id);
  res.json({ token }); // shown once; only its hash is stored
}));
core.delete("/me/ingest-token", h(async (req, res) => { await run("UPDATE users SET ingest_token_hash = NULL WHERE id = ?", req.user.id); res.json({ ok: true }); }));
core.delete("/me", h(async (req, res) => {
  await run("DELETE FROM users WHERE id = ?", req.user.id); // cascades to every table
  res.setHeader("Set-Cookie", "folio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
}));
core.get("/export", h(async (req, res) => {
  const id = req.user.id;
  const t = (name: string, cols = "*") => all(`SELECT ${cols} FROM ${name} WHERE user_id = ?`, id);
  res.setHeader("Content-Disposition", `attachment; filename="folio-export-${today()}.json"`);
  res.json({
    exportedAt: now(), user: publicUser(req.user), accounts: await t("accounts"), categories: await t("categories"), merchantRules: await t("merchant_rules"),
    transactions: await t("transactions"), fxRates: await t("fx_rates"), incomeSources: await t("income_sources"), incomePayments: await t("income_payments"), holdings: await t("holdings"),
  });
}));
core.post("/review", h(async (req, res) => {
  await run("UPDATE users SET last_reviewed_at = ? WHERE id = ?", now(), req.user.id);
  res.json({ user: publicUser(await userRow(req.user.id)) });
}));

// ---------- accounts ----------
const THEMES = ["icici-student", "axis-privilege", "graphite", "ember", "plum", "ocean", "mint", "sand"];
const accountOut = (a: any) => ({
  id: a.id, kind: a.kind, bank: a.bank, name: a.name, cardType: a.card_type, last4: a.last4, currency: a.currency,
  balanceMinor: a.balance_minor, balanceAsOf: a.balance_as_of, balanceSource: a.balance_source, theme: a.theme,
});
export const listAccounts = async (userId: number) => (await all("SELECT * FROM accounts WHERE user_id = ? ORDER BY kind != 'card', id", userId)).map(accountOut);
core.get("/accounts", h(async (req, res) => res.json({ accounts: await listAccounts(req.user.id) })));
function accountFields(b: any, prev?: any) {
  const kind = b.kind ?? prev?.kind ?? "card";
  if (!["card", "bank", "wallet", "cash"].includes(kind)) bad("Unknown account type.");
  const last4 = b.last4 !== undefined ? String(b.last4 ?? "").trim() || null : prev?.last4 ?? null;
  // Only the last four digits are ever accepted or stored.
  if (last4 && !/^\d{4}$/.test(last4)) bad("Enter only the last four digits of the card.");
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) : prev?.name;
  if (!name) bad("Give the account a name.");
  return {
    kind, last4, name, bank: b.bank !== undefined ? String(b.bank ?? "").trim().slice(0, 40) || null : prev?.bank ?? null,
    cardType: b.cardType !== undefined ? String(b.cardType ?? "").trim().slice(0, 40) || null : prev?.card_type ?? null,
    currency: b.currency !== undefined ? ccy(b.currency) : prev?.currency ?? "JPY",
    theme: THEMES.includes(b.theme) ? b.theme : prev?.theme ?? "graphite",
  };
}
core.post("/accounts", h(async (req, res) => {
  const f = accountFields(req.body);
  const id = await insert("INSERT INTO accounts(user_id,kind,bank,name,card_type,last4,currency,theme,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    req.user.id, f.kind, f.bank, f.name, f.cardType, f.last4, f.currency, f.theme, now());
  await setBalance(id, req.body.balance, f.currency);
  res.status(201).json({ account: accountOut(await get("SELECT * FROM accounts WHERE id = ?", id)) });
}));
async function setBalance(id: number, value: unknown, currency: string) {
  if (value === undefined) return;
  if (value === null || value === "") await run("UPDATE accounts SET balance_minor=NULL, balance_as_of=NULL, balance_source=NULL, balance_updated_at=? WHERE id=?", now(), id);
  else {
    const m = toMinor(String(value), currency);
    if (m == null) bad("Enter a valid balance.");
    await run("UPDATE accounts SET balance_minor=?, balance_as_of=?, balance_source='manual', balance_updated_at=? WHERE id=?", m, now(), now(), id);
  }
}
core.patch("/accounts/:id", h(async (req, res) => {
  const a = await owned("accounts", req.params.id, req.user.id);
  const f = accountFields(req.body, a);
  await run("UPDATE accounts SET kind=?, bank=?, name=?, card_type=?, last4=?, currency=?, theme=? WHERE id=?", f.kind, f.bank, f.name, f.cardType, f.last4, f.currency, f.theme, a.id);
  await setBalance(a.id, req.body.balance, f.currency);
  res.json({ account: accountOut(await get("SELECT * FROM accounts WHERE id = ?", a.id)) });
}));
core.delete("/accounts/:id", h(async (req, res) => {
  const a = await owned("accounts", req.params.id, req.user.id);
  await run("DELETE FROM accounts WHERE id = ?", a.id);
  res.json({ ok: true });
}));

// ---------- categories and learned rules ----------
const catOut = (c: any) => ({ id: c.id, key: c.key, name: c.name, icon: c.icon, slot: c.slot, kind: c.kind, budgetMinor: c.budget_minor });
export const listCategories = async (userId: number) => (await all("SELECT * FROM categories WHERE user_id = ? ORDER BY kind, name", userId)).map(catOut);
core.get("/categories", h(async (req, res) => res.json({
  categories: await listCategories(req.user.id),
  rules: await all("SELECT r.id, r.merchant, r.merchant_key AS \"merchantKey\", c.name AS category FROM merchant_rules r JOIN categories c ON c.id = r.category_id WHERE r.user_id = ? ORDER BY r.merchant", req.user.id),
})));
async function catFields(req: Request, prev?: any) {
  const b = req.body;
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 50) : prev?.name;
  if (!name) bad("Give the category a name.");
  const clash = await get<{ id: number }>("SELECT id FROM categories WHERE user_id = ? AND lower(name) = lower(?)", req.user.id, name);
  if (clash && clash.id !== prev?.id) bad("A category with this name already exists.");
  let budget = prev?.budget_minor ?? null;
  if (b.budget !== undefined) budget = b.budget === null || b.budget === "" ? null : amount(b.budget, req.user.base_currency);
  return { name, budget, icon: b.icon !== undefined ? String(b.icon).slice(0, 20) : prev?.icon ?? "dots", slot: b.slot !== undefined ? Math.min(8, Math.max(0, Number(b.slot) | 0)) : prev?.slot ?? 0 };
}
core.post("/categories", h(async (req, res) => {
  const f = await catFields(req);
  const id = await insert("INSERT INTO categories(user_id,name,icon,slot,kind,budget_minor) VALUES (?,?,?,?,'expense',?)", req.user.id, f.name, f.icon, f.slot, f.budget);
  res.status(201).json({ category: catOut(await get("SELECT * FROM categories WHERE id = ?", Number(id))) });
}));
core.patch("/categories/:id", h(async (req, res) => {
  const c = await owned("categories", req.params.id, req.user.id);
  const f = await catFields(req, c);
  await run("UPDATE categories SET name=?, icon=?, slot=?, budget_minor=? WHERE id=?", f.name, f.icon, f.slot, f.budget, c.id);
  res.json({ category: catOut(await get("SELECT * FROM categories WHERE id = ?", c.id)) });
}));
core.delete("/categories/:id", h(async (req, res) => {
  const c = await owned("categories", req.params.id, req.user.id);
  if (["uncategorised", "topup", "transfer", "cash"].includes(c.key)) bad("This category is needed by Folio and cannot be deleted.");
  const fallback = await get<{ id: number }>("SELECT id FROM categories WHERE user_id = ? AND key = 'uncategorised'", req.user.id);
  await tx(async () => {
    await run("UPDATE transactions SET category_id = ?, needs_review = 1 WHERE user_id = ? AND category_id = ?", fallback?.id ?? null, req.user.id, c.id);
    await run("DELETE FROM categories WHERE id = ?", c.id);
  });
  res.json({ ok: true });
}));
core.delete("/rules/:id", h(async (req, res) => { await run("DELETE FROM merchant_rules WHERE id = ? AND user_id = ?", Number(req.params.id), req.user.id); res.json({ ok: true }); }));

// ---------- exchange rates (user-set; conversions using them are estimates) ----------
core.get("/fx", h(async (req, res) => res.json({
  base: req.user.base_currency,
  rates: await all("SELECT from_ccy AS currency, rate, updated_at AS \"updatedAt\" FROM fx_rates WHERE user_id = ? AND to_ccy = ?", req.user.id, req.user.base_currency),
})));
core.put("/fx/:currency", h(async (req, res) => {
  const from = ccy(req.params.currency);
  const rate = Number(req.body.rate);
  if (from === req.user.base_currency) bad("That is already your base currency.");
  if (!(rate > 0) || !isFinite(rate)) bad("Enter a rate greater than zero.");
  await run("INSERT INTO fx_rates(user_id,from_ccy,to_ccy,rate,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,from_ccy,to_ccy) DO UPDATE SET rate=excluded.rate, updated_at=excluded.updated_at",
    req.user.id, from, req.user.base_currency, rate, now());
  res.json({ ok: true });
}));
core.delete("/fx/:currency", h(async (req, res) => { await run("DELETE FROM fx_rates WHERE user_id = ? AND from_ccy = ? AND to_ccy = ?", req.user.id, req.params.currency, req.user.base_currency); res.json({ ok: true }); }));

// ---------- transactions ----------
const TXN_SELECT = `
  SELECT t.*, c.key AS category_key, c.name AS category_name, c.icon AS category_icon, c.slot AS category_slot,
         a.name AS account_name, a.last4 AS account_last4, w.name AS transfer_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts w ON w.id = t.transfer_account_id`;
export function txnOut(t: any, user: User, recurringKeys: Set<string>) {
  return {
    id: t.id, type: t.type, amountMinor: t.amount_minor, currency: t.currency, date: t.date, time: t.time, tz: t.tz, dateInferred: !!t.date_inferred,
    merchant: t.merchant, rawDescriptor: t.raw_descriptor, categoryId: t.category_id, categoryKey: t.category_key, categoryName: t.category_name, categoryIcon: t.category_icon,
    categorySlot: t.category_slot, subcategory: t.subcategory, accountId: t.account_id, accountName: t.account_name, last4: t.account_last4,
    transferAccountId: t.transfer_account_id, transferName: t.transfer_name, paymentMethod: t.payment_method, note: t.note, source: t.source,
    needsReview: !!t.needs_review, createdAt: t.created_at, isNew: t.created_at > user.last_reviewed_at, recurring: recurringKeys.has(t.merchant_key),
    rawSms: t.raw_sms, incomeLinked: !!t.income_payment_id,
  };
}
export async function queryTransactions(user: User, q: Record<string, unknown>, limit = 500) {
  const where = ["t.user_id = ?"], p: (string | number)[] = [user.id];
  const add = (sql: string, v: string | number) => { where.push(sql); p.push(v); };
  if (q.q) { const s = `%${String(q.q).trim()}%`; where.push("(t.merchant ILIKE ? OR t.raw_descriptor ILIKE ? OR t.note ILIKE ? OR c.name ILIKE ? OR t.subcategory ILIKE ?)"); p.push(s, s, s, s, s); }
  if (q.type) add("t.type = ?", String(q.type));
  if (q.category) add("t.category_id = ?", Number(q.category));
  if (q.account) { where.push("(t.account_id = ? OR t.transfer_account_id = ?)"); p.push(Number(q.account), Number(q.account)); }
  if (q.from) add("t.date >= ?", String(q.from));
  if (q.to) add("t.date <= ?", String(q.to));
  if (q.month) add("t.date LIKE ?", `${q.month}-%`);
  if (q.review === "1") where.push("t.needs_review = 1");
  if (q.newOnly === "1") add("t.created_at > ?", user.last_reviewed_at);
  const keys = new Set((await recurring(user.id)).map((r) => r.merchantKey));
  return (await all(`${TXN_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.id DESC LIMIT ${Number(limit)}`, ...p)).map((t) => txnOut(t, user, keys));
}
core.get("/transactions", h(async (req, res) => res.json({ transactions: await queryTransactions(req.user, req.query as any) })));

async function txnFields(req: Request, prev?: any) {
  const b = req.body, uid = req.user.id;
  // A cash withdrawal moves money from the card into the Cash wallet; it is not spending.
  let cash = b.cashWithdrawal === true;
  if (cash) { b.type = "transfer"; if (!b.merchant && !prev?.merchant) b.merchant = "Cash withdrawal"; }
  let type = b.type ?? prev?.type ?? "expense";
  if (!["expense", "income", "refund", "transfer"].includes(type)) bad("Unknown transaction type.");
  const currency = b.currency !== undefined ? ccy(b.currency) : prev?.currency ?? req.user.base_currency;
  const amountMinor = b.amount !== undefined ? amount(b.amount, currency) : prev?.amount_minor ?? bad("Enter an amount.");
  const date = b.date !== undefined ? dateOk(b.date) : prev?.date ?? today();
  const time = b.time !== undefined ? (b.time ? (/^\d{2}:\d{2}(:\d{2})?$/.test(b.time) ? String(b.time).padEnd(8, ":00").slice(0, 8) : bad("Enter a valid time.")) : null) : prev?.time ?? null;
  const merchantRaw = b.merchant !== undefined ? String(b.merchant).trim().slice(0, 80) : prev?.merchant;
  if (!merchantRaw) bad("Enter a merchant or description.");
  const ident = identifyMerchant(merchantRaw);
  // A new "expense" at an ATM ("Seven Bank ATM") is a withdrawal, as it would be from a bank message.
  if (!prev && !cash && type === "expense" && ident.wallet === "Cash" && b.categoryId === undefined) { cash = true; type = "transfer"; }
  const key = b.merchant !== undefined ? ident.key || merchantKey(merchantRaw) : prev.merchant_key;
  const accountId = b.accountId !== undefined ? (b.accountId ? (await owned("accounts", b.accountId, uid)).id : null) : prev?.account_id ?? null;
  const transferId = type === "transfer" ? (b.transferAccountId !== undefined ? (b.transferAccountId ? (await owned("accounts", b.transferAccountId, uid)).id : null) : prev?.transfer_account_id ?? null) : null;
  let categoryId: number | null = prev?.category_id ?? null, subcategory: string | null = prev?.subcategory ?? null;
  if (b.categoryId !== undefined) { categoryId = b.categoryId ? (await owned("categories", b.categoryId, uid)).id : null; if (categoryId !== prev?.category_id) subcategory = null; }
  else if (!prev) {
    if (type === "income") categoryId = null;
    else { const c = await resolveCategory(uid, key, type === "transfer" ? (ident.kind === "topup" ? "topup" : "transfer") : ident.category); categoryId = c.id; subcategory = c.learned ? null : ident.subcategory ?? null; }
  }
  if (b.subcategory !== undefined) subcategory = String(b.subcategory ?? "").trim().slice(0, 50) || null;
  let toId = transferId;
  if (cash) {
    categoryId = (await categoryByKey(uid, "cash")).id; subcategory = null;
    toId = (await ensureWallet(uid, "Cash", currency)).id;
  }
  const last4 = accountId ? (await get<{ last4: string | null }>("SELECT last4 FROM accounts WHERE id = ?", accountId))?.last4 : null;
  return {
    type, currency, amountMinor, date, time, merchant: b.merchant !== undefined && ident.known ? ident.name : merchantRaw, key, accountId, transferId: toId, categoryId, subcategory,
    note: b.note !== undefined ? String(b.note ?? "").trim().slice(0, 300) || null : prev?.note ?? null,
    fp: fingerprint({ last4, accountId, amountMinor, currency, date, merchantKey: key, type }),
  };
}
const oneTxn = async (id: number, user: User) => txnOut(await get(`${TXN_SELECT} WHERE t.id = ?`, id), user, new Set());

core.post("/transactions", h(async (req, res) => {
  const f = await txnFields(req);
  const dup = await findDuplicate(req.user.id, f.fp, f.time);
  if (dup && !req.body.force) return res.status(409).json({ error: "This looks like a transaction you already have.", duplicateOfId: dup.id });
  const t = now();
  const id = await insert(
    `INSERT INTO transactions(user_id,account_id,transfer_account_id,type,amount_minor,currency,date,time,merchant,merchant_key,category_id,subcategory,note,source,fingerprint,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?)`,
    req.user.id, f.accountId, f.transferId, f.type, f.amountMinor, f.currency, f.date, f.time, f.merchant, f.key, f.categoryId, f.subcategory, f.note, f.fp, t, t);
  res.status(201).json({ transaction: await oneTxn(id, req.user) });
}));

core.patch("/transactions/:id", h(async (req, res) => {
  const prev = await owned("transactions", req.params.id, req.user.id);
  const f = await txnFields(req, prev);
  let learned = 0;
  await tx(async () => {
    await run(`UPDATE transactions SET account_id=?, transfer_account_id=?, type=?, amount_minor=?, currency=?, date=?, time=?, merchant=?, merchant_key=?, category_id=?, subcategory=?, note=?, fingerprint=?, needs_review=0, updated_at=? WHERE id=?`,
      f.accountId, f.transferId, f.type, f.amountMinor, f.currency, f.date, f.time, f.merchant, f.key, f.categoryId, f.subcategory, f.note, f.fp, now(), prev.id);
    // Learn from a category correction so the same merchant is filed correctly next time.
    // A one-off cash withdrawal says nothing about the merchant (an ATM inside a 7-Eleven), so it is never learned.
    if (f.categoryId && f.categoryId !== prev.category_id && req.body.learn !== false && !req.body.cashWithdrawal && f.key && f.type !== "income") {
      await run("INSERT INTO merchant_rules(user_id,merchant_key,merchant,category_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,merchant_key) DO UPDATE SET category_id=excluded.category_id, merchant=excluded.merchant",
        req.user.id, f.key, f.merchant, f.categoryId, now());
      if (req.body.applyToAll !== false)
        learned = (await run("UPDATE transactions SET category_id=?, subcategory=NULL, needs_review=0, updated_at=? WHERE user_id=? AND merchant_key=? AND id != ? AND type = ?",
          f.categoryId, now(), req.user.id, f.key, prev.id, f.type)).changes;
    }
  });
  res.json({ transaction: await oneTxn(prev.id, req.user), alsoUpdated: learned });
}));
core.delete("/transactions/:id", h(async (req, res) => {
  const t = await owned("transactions", req.params.id, req.user.id);
  await tx(async () => {
    if (t.income_payment_id) await run("DELETE FROM income_payments WHERE id = ? AND user_id = ?", t.income_payment_id, req.user.id);
    // Remember the message so re-importing the same SMS does not bring the transaction back.
    if (t.sms_hash) await run("INSERT INTO seen_sms(user_id, sms_hash, class, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", req.user.id, t.sms_hash, "deleted", now());
    await run("DELETE FROM transactions WHERE id = ?", t.id);
  });
  res.json({ ok: true });
}));
/** Record a money-in transaction as received income from one of the user's sources. */
core.post("/transactions/:id/link-income", h(async (req, res) => {
  const t = await owned("transactions", req.params.id, req.user.id);
  if (t.type !== "income") bad("Only money-in transactions can be recorded as income.");
  if (t.income_payment_id) bad("This transaction is already recorded as income.");
  const s = await owned("income_sources", req.body.sourceId, req.user.id);
  if (s.currency !== t.currency) bad(`This source is in ${s.currency}; the transaction is in ${t.currency}.`);
  await tx(async () => {
    const pid = await insert("INSERT INTO income_payments(user_id,source_id,expected_date,expected_minor,received_minor,received_date,note,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      req.user.id, s.id, t.date, t.amount_minor, t.amount_minor, t.date, "From bank message", now());
    await run("UPDATE transactions SET income_payment_id = ?, needs_review = 0 WHERE id = ?", pid, t.id);
  });
  res.json({ ok: true });
}));

// ---------- SMS import ----------
function incoming(body: any): IncomingSms[] {
  let msgs: IncomingSms[] = [];
  if (typeof body.file?.content === "string") msgs = messagesFromFile(String(body.file.name ?? ""), body.file.content);
  else if (Array.isArray(body.messages)) msgs = body.messages.map((m: any) => (typeof m === "string" ? { text: m } : { text: String(m.text ?? m.body ?? ""), date: m.date }));
  else if (typeof body.text === "string") msgs = splitMessages(body.text).map((text) => ({ text }));
  msgs = msgs.filter((m) => m.text.trim()).map((m) => ({ text: m.text.slice(0, 1000), date: /^\d{4}-\d{2}-\d{2}/.test(String(m.date ?? "")) ? String(m.date).slice(0, 10) : undefined }));
  if (!msgs.length) bad("No messages found.");
  if (msgs.length > 2000) bad("Import up to 2,000 messages at a time.");
  return msgs;
}
core.post("/sms/preview", h(async (req, res) => res.json({ items: await previewMessages(req.user.id, incoming(req.body)) })));
core.post("/sms/import", h(async (req, res) => res.json(await importMessages(req.user.id, incoming(req.body)))));
export const ingestBody = incoming;

// ---------- home and budget ----------
core.get("/budget", h(async (req, res) => {
  const month = monthOf(req.query.month);
  res.json({ summary: await monthSummary(req.user, month), comparison: await monthComparison(req.user, month), recurring: await recurring(req.user.id) });
}));
core.get("/home", h(async (req, res) => {
  const u = req.user;
  const fresh = await queryTransactions(u, { newOnly: "1" }, 100);
  const totals = new Map<string, { currency: string; spentMinor: number; inMinor: number; movedMinor: number }>();
  for (const t of fresh) {
    const k = totals.get(t.currency) ?? { currency: t.currency, spentMinor: 0, inMinor: 0, movedMinor: 0 };
    if (t.type === "expense") k.spentMinor += t.amountMinor;
    else if (t.type === "refund") k.spentMinor -= t.amountMinor;
    else if (t.type === "income") k.inMinor += t.amountMinor;
    else k.movedMinor += t.amountMinor;
    totals.set(t.currency, k);
  }
  const summary = await monthSummary(u, thisMonth());
  const changes: { kind: string; text: string }[] = [];
  for (const a of await all<any>("SELECT * FROM accounts WHERE user_id = ? AND balance_updated_at > ? AND balance_minor IS NOT NULL", u.id, u.last_reviewed_at))
    changes.push({ kind: "balance", text: `${a.name}${a.last4 ? ` ••${a.last4}` : ""} balance updated|${a.balance_minor}|${a.currency}` });
  for (const al of summary.alerts) changes.push({ kind: al.level, text: al.text });
  const income = await incomeSummary(u);
  for (const s of income.sources) for (const p of s.payments) if (p.status === "overdue") changes.push({ kind: "overdue", text: `${s.name}: payment expected ${p.expectedDate} not yet received|${p.outstandingMinor}|${s.currency}` });
  const review = (await get<{ n: number }>("SELECT COUNT(*) n FROM transactions WHERE user_id = ? AND needs_review = 1", u.id))!.n;
  // Last seven days of spending, split by category colour, for the weekly activity tile.
  const fx = await rates(u), dayMs = 864e5, t0 = new Date(`${today()}T00:00:00Z`).getTime();
  const week = Array.from({ length: 7 }, (_, i) => ({ date: new Date(t0 - (6 - i) * dayMs).toISOString().slice(0, 10), total: 0, parts: [] as { slot: number; value: number }[] }));
  for (const r of await all<any>("SELECT t.date, t.type, t.amount_minor, t.currency, COALESCE(c.slot, 0) slot FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.type IN ('expense','refund')", u.id, week[0].date, week[6].date)) {
    const d = week.find((w) => w.date === r.date), rate = fx[r.currency];
    if (!d || rate == null) continue;
    const v = (r.type === "refund" ? -1 : 1) * (r.currency === u.base_currency ? r.amount_minor : convertMinor(r.amount_minor, r.currency, u.base_currency, rate));
    d.total += v;
    const part = d.parts.find((x) => x.slot === r.slot);
    if (part) part.value += v; else d.parts.push({ slot: r.slot, value: v });
  }
  res.json({
    user: publicUser(u), accounts: await listAccounts(u.id), summary, week,
    sinceLastVisit: { since: u.last_reviewed_at, count: fresh.length, totals: [...totals.values()], transactions: fresh, changes },
    recent: await queryTransactions(u, {}, 8), needsReview: review, incomeTotals: income.totals,
  });
}));
