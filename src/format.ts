import { formatMoney } from "../shared/money.ts";
export { formatMoney };

const parse = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00` : d);
export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => parse(d).toLocaleDateString("en-GB", opts);
export const fmtShort = (d: string) => fmtDate(d, { day: "numeric", month: "short" });
export const fmtMonth = (m: string) => parse(`${m}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
export const fmtMonthShort = (m: string) => parse(`${m}-01`).toLocaleDateString("en-GB", { month: "short" });
export function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
export function dayLabel(d: string) {
  const t = todayIso();
  if (d === t) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`) return "Yesterday";
  return fmtDate(d, { weekday: "short", day: "numeric", month: "short", year: d.slice(0, 4) === t.slice(0, 4) ? undefined : "numeric" });
}
export function relTime(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} d ago`;
  return fmtDate(iso);
}
export const shiftMonth = (m: string, by: number) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const slotColor = (slot: number | null | undefined) => `var(--s${slot ?? 0})`;
export const plain = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed = (n: number, currency: string) => `${n < 0 ? "−" : "+"}${plain(Math.abs(n), currency)}`;
export const pct = (n: number | null) => (n == null ? "—" : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(2)}%`);
