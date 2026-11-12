import type { Txn } from "../api.ts";
import { fmtShort, formatMoney, slotColor } from "../format.ts";
import { Icon } from "./Icon.tsx";
import { useHidden } from "./kit.tsx";

export function txnIcon(t: Txn) {
  if (t.type === "income") return "in";
  if (t.type === "refund") return "undo";
  if (t.type === "transfer") return t.categoryIcon ?? "swap";
  return t.categoryIcon ?? "question";
}
export function txnCategory(t: Txn) {
  if (t.type === "income") return t.incomeLinked ? "Income" : "Money in";
  const base = t.categoryName ?? "No category";
  const full = t.subcategory ? `${base} / ${t.subcategory}` : base;
  return t.type === "refund" ? `Refund · ${full}` : full;
}
export function txnAmount(t: Txn) {
  const m = formatMoney(t.amountMinor, t.currency);
  return t.type === "income" || t.type === "refund" ? `+${m}` : t.type === "transfer" ? m : `−${m}`;
}
export function txnCard(t: Txn) {
  if (t.type === "transfer" && t.transferName) return `${t.accountName ?? "Account"}${t.last4 ? ` ••${t.last4}` : ""} → ${t.transferName}`;
  return t.accountName ? `${t.accountName}${t.last4 ? ` ••${t.last4}` : ""}` : t.paymentMethod ?? "No account";
}

/** One line in the feed: merchant, category, card, date and amount. */
export function TxnRow({ t, onClick, showDate = true }: { t: Txn; onClick: () => void; as?: "cell" | "note"; showDate?: boolean }) {
  if (useHidden(t.id)) return null;
  const tint = t.type === "income" || t.type === "refund" ? "var(--positive)" : slotColor(t.type === "transfer" ? 0 : t.categorySlot);
  const when = [showDate && fmtShort(t.date), t.time && `${t.time.slice(0, 5)}${t.tz ? ` ${t.tz}` : ""}`].filter(Boolean).join(" · ");
  return (
    <button className="cell txn" onClick={onClick}>
      <span className="tx-icon" style={{ ["--tint" as any]: tint }}><Icon name={txnIcon(t)} />{t.isNew && <i className="dot-new" aria-label="New" />}</span>
      <span className="grow">
        <span className="headline truncate" style={{ display: "block" }}>{t.merchant}</span>
        <span className="footnote muted truncate" style={{ display: "block" }}>{txnCategory(t)}</span>
        <span className="caption faint truncate" style={{ display: "block" }}>{txnCard(t)}{t.type === "transfer" ? " · not spending" : ""}</span>
      </span>
      <span className="tx-right">
        <span className={`tx-amount ${t.type === "income" || t.type === "refund" ? "pos" : t.type === "transfer" ? "muted" : ""}`}>{txnAmount(t)}</span>
        <span className="caption faint">{when}</span>
        {(t.needsReview || t.recurring) && <span className={`badge ${t.needsReview ? "estimate" : ""}`}>{t.needsReview ? "Review" : "Recurring"}</span>}
      </span>
      <Icon name="chevron" className="chev" />
    </button>
  );
}
