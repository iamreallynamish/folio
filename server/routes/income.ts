import { Router } from "express";
import { get, run, insert, now, tx } from "../db.js";
import { h, bad } from "./core.js";
import { HttpError } from "../auth.js";
import { CURRENCIES, toMinor } from "../../shared/money.js";
import { incomeSummary } from "../services/summary.js";

export const income = Router();
const KINDS = ["scholarship", "allowance", "family", "part-time", "other"];
const RECUR = ["none", "weekly", "monthly", "quarterly", "yearly"];
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !isNaN(Date.parse(String(v)));
async function owned(table: string, id: unknown, userId: number) {
  const row = await get<any>(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, Number(id), userId);
  if (!row) throw new HttpError(404, "Not found.");
  return row;
}
function addInterval(date: string, recurrence: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  if (recurrence === "weekly") d.setUTCDate(day + 7 * n);
  else {
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[recurrence]! * n;
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
    // Clamp to the month's last day (31 Jan + 1 month = 28/29 Feb).
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return d.toISOString().slice(0, 10);
}

income.get("/income", h(async (req, res) => res.json(await incomeSummary(req.user))));

income.post("/income/sources", h(async (req, res) => {
  const b = req.body;
  const kind = KINDS.includes(b.kind) ? b.kind : bad("Choose an income type.");
  const name = String(b.name ?? "").trim().slice(0, 80) || bad("Give this income a name.");
  const currency = CURRENCIES.includes(b.currency) ? b.currency : bad("Unsupported currency.");
  const recurrence = RECUR.includes(b.recurrence) ? b.recurrence : "none";
  const amt = b.amount ? toMinor(String(b.amount), currency) : null;
  if (b.amount && !(amt! > 0)) bad("Enter an amount greater than zero.");
  const count = Math.min(60, Math.max(1, Number(b.occurrences) || 1));
  if (amt && b.firstDate && !isDate(b.firstDate)) bad("Enter a valid first payment date.");
  const id = await tx(async () => {
    const sid = await insert("INSERT INTO income_sources(user_id,kind,name,currency,recurrence,amount_minor,notes,created_at) VALUES (?,?,?,?,?,?,?,?)",
      req.user.id, kind, name, currency, recurrence, amt, String(b.notes ?? "").trim().slice(0, 300) || null, now());
    // Expected payments are a schedule only: nothing counts as received until marked so.
    if (amt && b.firstDate)
      for (let i = 0; i < (recurrence === "none" ? 1 : count); i++)
        await run("INSERT INTO income_payments(user_id,source_id,expected_date,expected_minor,updated_at) VALUES (?,?,?,?,?)",
          req.user.id, sid, recurrence === "none" ? b.firstDate : addInterval(b.firstDate, recurrence, i), amt, now());
    return sid;
  });
  res.status(201).json({ id });
}));
income.patch("/income/sources/:id", h(async (req, res) => {
  const s = await owned("income_sources", req.params.id, req.user.id);
  const b = req.body;
  await run("UPDATE income_sources SET name=?, kind=?, notes=? WHERE id=?",
    b.name !== undefined ? String(b.name).trim().slice(0, 80) || bad("Give this income a name.") : s.name,
    KINDS.includes(b.kind) ? b.kind : s.kind, b.notes !== undefined ? String(b.notes ?? "").trim().slice(0, 300) || null : s.notes, s.id);
  res.json({ ok: true });
}));
income.delete("/income/sources/:id", h(async (req, res) => {
  const s = await owned("income_sources", req.params.id, req.user.id);
  await tx(async () => {
    await run("UPDATE transactions SET income_payment_id = NULL WHERE user_id = ? AND income_payment_id IN (SELECT id FROM income_payments WHERE source_id = ?)", req.user.id, s.id);
    await run("DELETE FROM income_sources WHERE id = ?", s.id);
  });
  res.json({ ok: true });
}));

function paymentFields(b: any, currency: string, prev?: any) {
  const minor = (v: unknown, fallback: number) => {
    if (v === undefined) return fallback;
    if (v === null || v === "") return 0;
    const m = toMinor(String(v), currency);
    return m != null && m >= 0 ? m : bad("Enter a valid amount.");
  };
  const date = (v: unknown, fallback: string | null) => (v === undefined ? fallback : v ? (isDate(v) ? String(v) : bad("Enter a valid date.")) : null);
  const f = {
    expectedDate: date(b.expectedDate, prev?.expected_date ?? null), expected: minor(b.expected, prev?.expected_minor ?? 0),
    received: minor(b.received, prev?.received_minor ?? 0), receivedDate: date(b.receivedDate, prev?.received_date ?? null),
    note: b.note !== undefined ? String(b.note ?? "").trim().slice(0, 200) || null : prev?.note ?? null,
  };
  if (!f.expected && !f.received) bad("Enter an expected or a received amount.");
  if (f.received > 0 && !f.receivedDate) bad("Enter the date the money was received.");
  if (!f.received) f.receivedDate = null;
  return f;
}
income.post("/income/payments", h(async (req, res) => {
  const s = await owned("income_sources", req.body.sourceId, req.user.id);
  const f = paymentFields(req.body, s.currency);
  const id = await insert("INSERT INTO income_payments(user_id,source_id,expected_date,expected_minor,received_minor,received_date,note,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    req.user.id, s.id, f.expectedDate, f.expected, f.received, f.receivedDate, f.note, now());
  res.status(201).json({ id: Number(id) });
}));
income.patch("/income/payments/:id", h(async (req, res) => {
  const p = await owned("income_payments", req.params.id, req.user.id);
  const s = await owned("income_sources", p.source_id, req.user.id);
  const f = paymentFields(req.body, s.currency, p);
  await run("UPDATE income_payments SET expected_date=?, expected_minor=?, received_minor=?, received_date=?, note=?, updated_at=? WHERE id=?",
    f.expectedDate, f.expected, f.received, f.receivedDate, f.note, now(), p.id);
  res.json({ ok: true });
}));
income.delete("/income/payments/:id", h(async (req, res) => {
  const p = await owned("income_payments", req.params.id, req.user.id);
  await tx(async () => {
    await run("UPDATE transactions SET income_payment_id = NULL WHERE user_id = ? AND income_payment_id = ?", req.user.id, p.id);
    await run("DELETE FROM income_payments WHERE id = ?", p.id);
  });
  res.json({ ok: true });
}));
