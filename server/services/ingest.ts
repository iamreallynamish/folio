/** Turns parsed SMS into records: duplicate checks, category learning, account and balance updates. */
import { all, get, run, insert, now, tx } from "../db.js";
import { sha256 } from "../crypto.js";
import { parseSms, normaliseSms, type ParsedSms } from "../../shared/sms.js";
import { merchantKey } from "../../shared/merchants.js";

export interface IncomingSms { text: string; date?: string }
export type ItemStatus = "new" | "duplicate" | "ignored" | "balance";
export interface PreviewItem {
  status: ItemStatus; reason?: string; parsed: ParsedSms;
  category?: string; account?: string; duplicateOfId?: number; transactionId?: number; balanceUpdated?: boolean;
}

export const smsHash = (text: string) => sha256(normaliseSms(text).toLowerCase());

export function fingerprint(t: { last4?: string | null; accountId?: number | null; amountMinor: number; currency: string; date: string; merchantKey: string; type: string }) {
  return [t.last4 ?? `acct${t.accountId ?? ""}`, t.amountMinor, t.currency, t.date, t.merchantKey, t.type].join("|");
}

/** Same fingerprint is a duplicate unless both carry different times (two coffees on one day). */
export async function findDuplicate(userId: number, fp: string, time: string | null | undefined, excludeId?: number) {
  const rows = await all<{ id: number; time: string | null }>("SELECT id, time FROM transactions WHERE user_id = ? AND fingerprint = ?", userId, fp);
  return rows.find((r) => r.id !== excludeId && (!r.time || !time || r.time === time));
}

export async function categoryByKey(userId: number, key: string): Promise<{ id: number; name: string }> {
  let c = await get<{ id: number; name: string }>("SELECT id, name FROM categories WHERE user_id = ? AND key = ?", userId, key);
  if (!c && key !== "uncategorised") return categoryByKey(userId, "uncategorised");
  if (!c) {
    const id = await insert("INSERT INTO categories(user_id,key,name,icon,slot,kind) VALUES (?,?,?,?,?,?)", userId, "uncategorised", "Uncategorised", "question", 0, "expense");
    c = { id, name: "Uncategorised" };
  }
  return c;
}

/** A correction the user made earlier beats the built-in dictionary. */
export async function resolveCategory(userId: number, key: string, fallbackKey: string) {
  const learned = await get<{ id: number; name: string }>(
    "SELECT c.id, c.name FROM merchant_rules r JOIN categories c ON c.id = r.category_id WHERE r.user_id = ? AND r.merchant_key = ?", userId, key);
  return learned ? { ...learned, learned: true } : { ...(await categoryByKey(userId, fallbackKey)), learned: false };
}

async function findAccount(userId: number, p: ParsedSms) {
  if (!p.last4) return undefined;
  const rows = await all<any>("SELECT * FROM accounts WHERE user_id = ? AND last4 = ?", userId, p.last4);
  return rows.find((r) => p.bank && r.bank === p.bank) ?? rows[0];
}
async function ensureAccount(userId: number, p: ParsedSms) {
  const found = await findAccount(userId, p);
  if (found || !p.last4) return found;
  const isCard = /card/i.test(p.instrument ?? "");
  const name = [p.bank, isCard ? p.instrument : "Account"].filter(Boolean).join(" ");
  const id = await insert("INSERT INTO accounts(user_id,kind,bank,name,card_type,last4,currency,created_at) VALUES (?,?,?,?,?,?,?,?)",
    userId, isCard ? "card" : "bank", p.bank ?? null, name, isCard ? p.instrument! : null, p.last4, p.currency ?? p.balanceCurrency ?? "JPY", now());
  return await get<any>("SELECT * FROM accounts WHERE id = ?", id);
}
export async function ensureWallet(userId: number, name: string, currency: string) {
  const w = await get<any>("SELECT * FROM accounts WHERE user_id = ? AND kind IN ('wallet','cash') AND name = ?", userId, name);
  if (w) return w;
  const id = await insert("INSERT INTO accounts(user_id,kind,name,currency,theme,created_at) VALUES (?,?,?,?,?,?)",
    userId, name === "Cash" ? "cash" : "wallet", name, currency, "mint", now());
  return await get<any>("SELECT * FROM accounts WHERE id = ?", id);
}

/** Balances come only from what the bank stated, and never move back in time. */
async function applyBalance(account: any, p: ParsedSms): Promise<boolean> {
  if (!account || p.balanceMinor == null) return false;
  const asOf = p.date ? (p.time ? `${p.date}T${p.time}` : p.date) : now().slice(0, 10);
  if (account.balance_as_of && asOf.slice(0, 10) < String(account.balance_as_of).slice(0, 10)) return false;
  await run("UPDATE accounts SET balance_minor = ?, currency = ?, balance_as_of = ?, balance_source = 'sms', balance_updated_at = ? WHERE id = ?",
    p.balanceMinor, p.balanceCurrency ?? account.currency, asOf, now(), account.id);
  return true;
}

async function evaluate(userId: number, msg: IncomingSms, batchSeen: Set<string>): Promise<PreviewItem & { hash: string; fp?: string }> {
  const p = parseSms(msg.text, msg.date ?? now().slice(0, 10));
  const hash = smsHash(msg.text);
  if (p.class !== "transaction" && p.class !== "balance") return { status: "ignored", reason: p.reason, parsed: p, hash };

  const account = await findAccount(userId, p);
  const accountLabel = account?.name ?? p.paymentMethod;
  if (batchSeen.has(hash) || await get("SELECT 1 FROM transactions WHERE user_id = ? AND sms_hash = ?", userId, hash) || await get("SELECT 1 FROM seen_sms WHERE user_id = ? AND sms_hash = ?", userId, hash))
    return { status: "duplicate", reason: "This message was already imported", parsed: p, hash, account: accountLabel };
  if (p.class === "balance") return { status: "balance", reason: p.reason, parsed: p, hash, account: accountLabel };

  const key = p.merchant?.key ?? merchantKey(p.rawMerchant ?? "");
  const fp = fingerprint({ last4: p.last4, accountId: account?.id, amountMinor: p.amountMinor!, currency: p.currency!, date: p.date!, merchantKey: key, type: p.type! });
  const dup = batchSeen.has(fp + "|" + (p.time ?? "")) ? { id: -1 } : await findDuplicate(userId, fp, p.time);
  const cat = p.type === "income" ? undefined : await resolveCategory(userId, key, p.merchant?.category ?? "uncategorised");
  const category = cat ? (p.merchant?.subcategory && !cat.learned ? `${cat.name} / ${p.merchant.subcategory}` : cat.name) : "Money in";
  if (dup) return { status: "duplicate", reason: "Matches a transaction already recorded", parsed: p, hash, fp, category, account: accountLabel, duplicateOfId: dup.id > 0 ? dup.id : undefined };
  return { status: "new", parsed: p, hash, fp, category, account: accountLabel };
}

export async function previewMessages(userId: number, msgs: IncomingSms[]): Promise<PreviewItem[]> {
  const seen = new Set<string>();
  const out: PreviewItem[] = [];
  // Sequential on purpose: each message is checked against the ones before it.
  for (const m of msgs) {
    const { hash, fp, ...item } = await evaluate(userId, m, seen);
    seen.add(hash);
    if (fp && item.status === "new") seen.add(fp + "|" + (item.parsed.time ?? ""));
    out.push(item);
  }
  return out;
}

export async function importMessages(userId: number, msgs: IncomingSms[], source: "sms" | "ingest" = "sms") {
  return await tx(async () => {
    const seen = new Set<string>();
    const items: PreviewItem[] = [];
    for (const m of msgs) {
      const { hash, fp, ...item } = await evaluate(userId, m, seen);
      seen.add(hash);
      const p = item.parsed;
      if (item.status === "balance") {
        item.balanceUpdated = await applyBalance(await ensureAccount(userId, p), p);
        await run("INSERT INTO seen_sms(user_id, sms_hash, class, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", userId, hash, "balance", now());
      } else if (item.status === "new") {
        seen.add(fp + "|" + (p.time ?? ""));
        const account = await ensureAccount(userId, p);
        const key = p.merchant?.key ?? merchantKey(p.rawMerchant ?? "");
        const cat = p.type === "income" ? undefined : await resolveCategory(userId, key, p.merchant?.category ?? "uncategorised");
        const wallet = p.type === "transfer" && p.merchant?.wallet ? await ensureWallet(userId, p.merchant.wallet, p.currency!) : undefined;
        const t = now();
        item.transactionId = await insert(
          `INSERT INTO transactions(user_id,account_id,transfer_account_id,type,amount_minor,currency,date,time,tz,date_inferred,merchant,merchant_key,
             raw_descriptor,category_id,subcategory,payment_method,source,sms_hash,fingerprint,raw_sms,needs_review,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          userId, account?.id ?? null, wallet?.id ?? null, p.type!, p.amountMinor!, p.currency!, p.date!, p.time ?? null, p.tz ?? null, p.dateInferred ? 1 : 0,
          p.merchant?.name ?? "Unknown merchant", key, p.rawMerchant ?? null, cat?.id ?? null, cat?.learned ? null : p.merchant?.subcategory ?? null,
          p.paymentMethod ?? null, source, hash, fp!, p.raw, p.needsReview && !cat?.learned ? 1 : 0, t, t);
        item.balanceUpdated = await applyBalance(account, p);
        item.account = account?.name ?? item.account;
      }
      items.push(item);
    }
    const count = (s: ItemStatus) => items.filter((i) => i.status === s).length;
    return { items, imported: count("new"), duplicates: count("duplicate"), ignored: count("ignored"), balances: count("balance") };
  });
}
