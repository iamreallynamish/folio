/** Currency helpers. Amounts are stored as integers in the currency's minor unit. */

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK", "HUF", "TWD"]);
const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "JOD", "TND"]);

export const CURRENCIES = [
  "JPY", "INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD", "CNY", "KRW", "THB", "HKD", "CHF",
];

export function decimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** "4,779.00" in JPY → 4779; "12.5" in INR → 1250. Returns null when not a number. */
export function toMinor(value: string | number, currency: string): number | null {
  const s = String(value).replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const d = decimals(currency);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const padded = (frac + "000").slice(0, d);
  // Round on the first dropped digit rather than truncating.
  const roundUp = frac.length > d && Number(frac[d]) >= 5 ? 1 : 0;
  const n = Number(whole) * 10 ** d + Number(padded || 0) + roundUp;
  return s.startsWith("-") ? -n : n;
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimals(currency);
}

const SYMBOL: Record<string, string> = { JPY: "¥", INR: "₹", USD: "$", EUR: "€", GBP: "£", CNY: "CN¥", KRW: "₩" };

export function formatMoney(minor: number, currency: string, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const d = decimals(currency);
  const abs = Math.abs(minor) / 10 ** d;
  const body = opts.compact && abs >= 100000
    ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(abs)
    : abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sym = SYMBOL[currency.toUpperCase()];
  const text = sym ? `${sym}${body}` : `${currency.toUpperCase()} ${body}`;
  if (minor < 0) return `−${text}`;
  return opts.sign && minor > 0 ? `+${text}` : text;
}

/** Convert between currencies given a rate (1 unit of `from` = `rate` units of `to`). */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  return Math.round(fromMinor(minor, from) * rate * 10 ** decimals(to));
}
