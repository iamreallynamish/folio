/**
 * Bank SMS understanding. Pure functions, no I/O: classify a message, then extract
 * amount, currency, date, time, merchant, payment instrument, last four digits,
 * direction and any stated balance.
 */
import { toMinor } from "./money.js";
import { identifyMerchant, type MerchantMatch } from "./merchants.js";

export type SmsClass = "transaction" | "balance" | "otp" | "promo" | "failed" | "reminder" | "unknown";
export type TxnType = "expense" | "income" | "refund" | "transfer";

export interface ParsedSms {
  raw: string;
  class: SmsClass;
  /** Why a message was ignored, in plain words. */
  reason?: string;
  type?: TxnType;
  amountMinor?: number;
  currency?: string;
  date?: string; // YYYY-MM-DD as stated by the bank
  time?: string; // HH:MM:SS as stated by the bank
  tz?: string; // e.g. IST — the zone the bank stamped, not converted
  dateInferred?: boolean;
  bank?: string;
  instrument?: string; // "Forex Prepaid Card", "Card", "UPI", "Account"…
  last4?: string;
  paymentMethod?: string;
  rawMerchant?: string;
  merchant?: MerchantMatch;
  balanceMinor?: number;
  balanceCurrency?: string;
  /** 0–1: how many of the expected fields were found. */
  confidence?: number;
  needsReview?: boolean;
}

const CCY_WORD = "INR|JPY|USD|EUR|GBP|SGD|AED|AUD|CAD|CNY|KRW|THB|HKD|CHF|MYR|IDR|VND|NZD";
const SYMBOLS: Record<string, string> = { "₹": "INR", "¥": "JPY", "$": "USD", "€": "EUR", "£": "GBP" };
const AMOUNT_RE = new RegExp(
  `(?:\\b(${CCY_WORD}|Rs\\.?|INR\\.)|([₹¥$€£]))\\s*([0-9][0-9,]*(?:\\.[0-9]{1,3})?)|\\b([0-9][0-9,]*(?:\\.[0-9]{1,3})?)\\s*(${CCY_WORD})\\b`,
  "gi",
);

const BANKS: [RegExp, string][] = [
  [/\bicici\b/i, "ICICI Bank"], [/\baxis\b/i, "Axis Bank"], [/\bhdfc\b/i, "HDFC Bank"],
  [/\b(sbi|state bank)\b/i, "State Bank of India"], [/\bkotak\b/i, "Kotak Mahindra Bank"],
  [/\bidfc\b/i, "IDFC FIRST Bank"], [/\byes bank\b/i, "YES Bank"], [/\bindusind\b/i, "IndusInd Bank"],
  [/\bhsbc\b/i, "HSBC"], [/\bciti\b/i, "Citi"], [/\b(amex|american express)\b/i, "American Express"],
  [/\bniyo\b/i, "Niyo"], [/\bwise\b/i, "Wise"], [/\brevolut\b/i, "Revolut"], [/\bpnb\b/i, "Punjab National Bank"],
  [/\b(bob|bank of baroda)\b/i, "Bank of Baroda"], [/\bcanara\b/i, "Canara Bank"], [/\bfederal bank\b/i, "Federal Bank"],
  [/\brbl\b/i, "RBL Bank"], [/\bsmbc\b/i, "SMBC"], [/\bmufg\b/i, "MUFG"], [/\bmizuho\b/i, "Mizuho"],
];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Indian and Japanese bank alerts are day-first; ISO dates are also accepted. */
export function findDate(text: string): { date: string; index: number } | null {
  let m = text.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]+(\d{4}|\d{2})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const d = validDate(year4(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    if (d) return { date: d, index: m.index! };
  }
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return { date: d, index: m.index! };
  }
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    const d = validDate(year4(m[3]), Number(m[2]), Number(m[1]));
    if (d) return { date: d, index: m.index! };
  }
  return null;
}

function findTime(text: string): { time: string; tz?: string } | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(IST|JST|UTC|GMT|SGT|HKT)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return { time: `${pad(h)}:${m[2]}:${m[3] ?? "00"}`, tz: m[5]?.toUpperCase() };
}

interface Amount { minor: number; currency: string; index: number; end: number }
function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const word = m[1] ?? m[5];
    const currency = m[2] ? SYMBOLS[m[2]] : /^(rs|inr)/i.test(word) ? "INR" : word.toUpperCase();
    const num = m[3] ?? m[4];
    // Skip things that only look like amounts: bare 4-digit card tails are handled elsewhere.
    const minor = toMinor(num.replace(/,$/, ""), currency);
    if (minor === null) continue;
    out.push({ minor, currency, index: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const OTP_RE = /\b(otp|one[\s-]?time\s*pass(word|code)|verification code|security code|passcode)\b|\bdo not share\b.*\b(code|otp)\b/i;
const FAILED_RE = /\b(declined|failed|unsuccessful|could not be processed|not processed|was not completed|has been blocked|is blocked)\b/i;
const REMINDER_RE = /\b(is due|due on|due date|payment due|will be (auto[\s-]?)?(debited|deducted|charged)|minimum (amount )?due|bill (of|for).*generated|statement (is|for).*(ready|generated)|requested)\b/i;
const PROMO_RE = /\b(offer|cashback up to|discount|pre[\s-]?approved|apply now|limited period|t&c|t & c|click here|upgrade (now|to)|win|voucher|reward points? (worth|of)|emi (at|starting)|loan (of|up ?to)|get up ?to|congratulations|exclusive)\b|https?:\/\/|\bbit\.ly\b/i;
const DEBIT_RE = /\b(debited|spent|purchase|paid|payment of|withdrawn|withdrawal|has been made|txn of|transaction of|charged|deducted|used (for|at)|sent|transacted)\b|\busing\s+(?:your\s+)?[\w\s.]{0,40}?\bcard\b/i;
const CREDIT_RE = /\b(credited|received|deposited|refund(ed)?|reversal|reversed|cashback (of|credited))\b/i;
const REFUND_RE = /\b(refund(ed)?|reversal|reversed|chargeback)\b/i;
const BALANCE_RE = /\b(avl\.?|avbl\.?|available|current|closing|total|net)?\s*\bbal(ance)?\b/i;
/** Axis-style compact alert: "JPY 500 Axis Bank Card no. XX7117 03-10-26 17:03:00 IST UBER *TRIP". */
const COMPACT_RE = /card\s*no\.?\s*[Xx*]*\d{4}\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[A-Z]{3})?\s+(.+)$/i;

function findLast4(text: string): string | undefined {
  const m = text.match(/(?:[Xx*]{1,}[-\s]?|ending(?:\s+(?:in|with))?\s+|card\s*no\.?\s*)(\d{4})\b/);
  return m?.[1];
}

function findInstrument(text: string): string | undefined {
  if (/forex\s+prepaid\s+card/i.test(text)) return "Forex Prepaid Card";
  if (/credit\s+card/i.test(text)) return "Credit Card";
  if (/debit\s+card/i.test(text)) return "Debit Card";
  if (/prepaid\s+card/i.test(text)) return "Prepaid Card";
  if (/\bcard\b/i.test(text)) return "Card";
  if (/\b(upi|vpa)\b/i.test(text)) return "UPI";
  if (/\b(neft|imps|rtgs)\b/i.test(text)) return "Bank transfer";
  if (/\b(a\/c|acct?|account)\b/i.test(text)) return "Account";
  return undefined;
}

const STOP = String.raw`(?=\s+on\s+\d|\s+dated\b|\s+at\s+\d|\s*[;(]|\.(?:\s|$)|\s+\.|\s+via\b|\s+using\b|\s+ref\b|\s+upi\b|\s+avl\b|\s+avbl\b|\s+available\b|\s+bal\b|\s+txn\b|\s+-\s+|$)`;
function cleanMerchant(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").replace(/^[\s:,-]+|[\s:,.-]+$/g, "").trim();
  if (!t || t.length > 60) return undefined;
  if (/^(your|ur|a\/c|acct?|account|card|bank|the bank|\d+$)/i.test(t)) return undefined;
  // "transacted at POS": the bank named the terminal, not the shop.
  if (/^(pos|pos txn|pos terminal|merchant|online|e-?com(merce)?)$/i.test(t)) return undefined;
  return t;
}

function findMerchant(text: string, isCredit: boolean): string | undefined {
  const compact = text.match(COMPACT_RE);
  if (compact) return cleanMerchant(compact[1].replace(/\b(avl|avbl|available)\b.*$/i, ""));
  const tries: RegExp[] = [
    new RegExp(String.raw`\bat\s+(?!\d)(.+?)${STOP}`, "i"),
    new RegExp(String.raw`\binfo[:\s-]+(.+?)(?=[.;]|$)`, "i"),
    isCredit
      ? new RegExp(String.raw`\b(?:from|by)\s+(?:vpa\s+)?(?!a\/c|acct|account|your|ur)(.+?)${STOP}`, "i")
      : new RegExp(String.raw`\b(?:to|towards|for)\s+(?:vpa\s+)?(?!a\/c|acct|account|your|ur)(.+?)${STOP}`, "i"),
  ];
  for (const re of tries) {
    const m = cleanMerchant(text.match(re)?.[1]);
    if (m) return m;
  }
  return undefined;
}

export function normaliseSms(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * @param fallbackDate date the message was received (YYYY-MM-DD), used only when the
 *   message states no date; the result is then flagged `dateInferred`.
 */
export function parseSms(input: string, fallbackDate?: string): ParsedSms {
  const raw = normaliseSms(input);
  const out: ParsedSms = { raw, class: "unknown" };
  if (!raw) return { ...out, reason: "Empty message" };

  if (OTP_RE.test(raw)) return { ...out, class: "otp", reason: "One-time passcode" };

  const amounts = findAmounts(raw);
  const balMatch = raw.match(BALANCE_RE);
  const balIndex = balMatch ? balMatch.index! : -1;
  const txnAmount = amounts.find((a) => balIndex < 0 || a.index < balIndex);
  const balAmount = balIndex >= 0 ? amounts.find((a) => a.index > balIndex) : undefined;

  const bank = BANKS.find(([re]) => re.test(raw))?.[1];
  const last4 = findLast4(raw);
  const instrument = findInstrument(raw);
  const compact = COMPACT_RE.test(raw);
  const hasDebit = DEBIT_RE.test(raw);
  const hasCredit = CREDIT_RE.test(raw);

  if (FAILED_RE.test(raw)) return { ...out, class: "failed", reason: "Declined or failed transaction" };

  const looksLikeTxn = !!txnAmount && (hasDebit || hasCredit || compact);
  if (!looksLikeTxn) {
    if (balAmount && (last4 || bank) && !PROMO_RE.test(raw)) {
      return {
        ...out, class: "balance", reason: "Balance notification — no transaction",
        bank, last4, instrument, balanceMinor: balAmount.minor, balanceCurrency: balAmount.currency,
        date: findDate(raw)?.date,
      };
    }
    if (REMINDER_RE.test(raw)) return { ...out, class: "reminder", reason: "Reminder or upcoming payment" };
    if (PROMO_RE.test(raw)) return { ...out, class: "promo", reason: "Promotional message" };
    return { ...out, reason: "No transaction found" };
  }
  if (REMINDER_RE.test(raw) && !/\b(debited|credited|spent|has been made)\b/i.test(raw)) {
    return { ...out, class: "reminder", reason: "Reminder or upcoming payment" };
  }

  // "debited from your a/c … credited to X" is a debit; credit only when no debit wording.
  const isCredit = hasCredit && !/\bdebited\b/i.test(raw) && !(hasDebit && !REFUND_RE.test(raw) && !/\bcredited\b/i.test(raw));
  const rawMerchant = findMerchant(raw, isCredit);
  let merchant = rawMerchant ? identifyMerchant(rawMerchant) : undefined;
  // "withdrawn at ATM", "cash withdrawal of …": cash taken out, whatever the terminal is called.
  if (!isCredit && (/\b(cash\s+withdrawal|withdrawn|withdrawal|atm\s+wdl|cash\s+wdl)\b/i.test(raw) || /\bATM\b/.test(raw)) && merchant?.wallet !== "Cash")
    merchant = identifyMerchant("CASH WITHDRAWAL");

  let type: TxnType = isCredit ? (REFUND_RE.test(raw) ? "refund" : "income") : "expense";
  if (!isCredit && merchant && merchant.kind !== "expense") type = "transfer";
  if (!isCredit && /\b(self|own)\s+(a\/c|account|transfer)\b/i.test(raw)) type = "transfer";

  const d = findDate(raw);
  const t = findTime(raw);
  const date = d?.date ?? fallbackDate;

  const found = [txnAmount, date && !(!d), merchant, last4, bank].filter(Boolean).length;
  const paymentMethod = [bank, instrument, last4 ? `••${last4}` : undefined].filter(Boolean).join(" ") || undefined;

  return {
    raw, class: "transaction", type,
    amountMinor: txnAmount!.minor, currency: txnAmount!.currency,
    date, time: t?.time, tz: t?.tz, dateInferred: !d,
    bank, instrument, last4, paymentMethod,
    rawMerchant, merchant,
    balanceMinor: balAmount?.minor, balanceCurrency: balAmount?.currency,
    confidence: found / 5,
    needsReview: !merchant || !merchant.known || !d,
  };
}

/**
 * Split pasted text into messages. Blank lines separate messages; without them, each line that states an
 * amount starts a new message and lines without one continue the message above. Axis puts the merchant on
 * its own line ("… 21:02:52 IST at" / "SEVEN-ELEVE."), which must stay with its message.
 */
export function splitMessages(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  if (/\n\s*\n/.test(t)) return t.split(/\n\s*\n+/).map(normaliseSms).filter(Boolean);
  const out: string[] = [];
  for (const line of t.split("\n")) {
    if (!line.trim()) continue;
    if (out.length && findAmounts(line).length === 0) out[out.length - 1] += " " + line;
    else out.push(line);
  }
  return out.map(normaliseSms).filter(Boolean);
}

/** Read messages from an "SMS Backup & Restore" XML export, a JSON array or plain text. */
export function messagesFromFile(name: string, content: string): { text: string; date?: string }[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xml") || /^\s*<\?xml|<smses/.test(content)) {
    const out: { text: string; date?: string }[] = [];
    for (const m of content.matchAll(/<sms\b[^>]*>/g)) {
      const body = m[0].match(/\bbody="([^"]*)"/)?.[1];
      const ms = m[0].match(/\bdate="(\d+)"/)?.[1];
      if (!body) continue;
      const text = body.replace(/&#10;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      out.push({ text, date: ms ? new Date(Number(ms)).toISOString().slice(0, 10) : undefined });
    }
    return out;
  }
  if (lower.endsWith(".json") || /^\s*[[{]/.test(content)) {
    try {
      const data = JSON.parse(content);
      const arr: unknown[] = Array.isArray(data) ? data : data.messages ?? [];
      return arr
        .map((x) => (typeof x === "string" ? { text: x } : { text: String((x as any).body ?? (x as any).text ?? ""), date: (x as any).date }))
        .filter((x) => x.text);
    } catch { /* fall through to plain text */ }
  }
  return splitMessages(content).map((text) => ({ text }));
}

export const SAMPLE_MESSAGES = [
  "JPY 4,779.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at NITORI on 03-Oct-2026. Current available balance on your Forex Prepaid Card is JPY 63,756.00.",
  "JPY 500 Axis Bank Card no. XX7117 03-10-26 17:03:00 IST UBER *TRIP",
  "JPY 421 Axis Bank Card no. XX7117 04-10-26 17:02:40 IST FAMILYMART",
  "JPY 4000 Axis Bank Card no. XX7117 05-10-26 20:06:37 IST MOBILE SUICA",
];
