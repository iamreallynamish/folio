import { useContext } from "react";
import type { Account } from "../api.ts";
import { Ctx } from "../ctx.ts";
import { fmtDate, formatMoney } from "../format.ts";
import { CardArt, Chip, isArtTheme } from "./CardArt.tsx";
import { Icon } from "./Icon.tsx";
import { CountUp } from "./motion.tsx";
import { LogoMark } from "./Logo.tsx";

const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const onDay = (y: number, m: number, day: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));

/** The billing cycle that contains `today`, closing on the statement day, and the payment due after it. */
export function billingCycle(statementDay: number, dueDay: number | null | undefined, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth();
  const thisClose = onDay(y, m, statementDay);
  const end = today.getDate() <= thisClose.getDate() ? thisClose : onDay(y, m + 1, statementDay);
  const start = onDay(end.getFullYear(), end.getMonth() - 1, statementDay);
  start.setDate(start.getDate() + 1);
  let due: Date | null = null;
  if (dueDay) { due = onDay(end.getFullYear(), end.getMonth(), dueDay); if (due <= end) due = onDay(end.getFullYear(), end.getMonth() + 1, dueDay); }
  return { start, end, due };
}

/** The line under a card's balance: billing cycle (credit), last top-up (prepaid), or when the balance was updated. */
export function cardLine(a: Account, today = new Date()): string {
  const has = a.balanceMinor != null;
  const prepaid = /prepaid|forex/i.test(a.cardType ?? "") || a.kind === "wallet";
  let mode = a.cardLine ?? "auto";
  if (mode === "auto") mode = a.statementDay ? "cycle" : prepaid && a.lastTopup ? "topup" : "updated";
  if (mode === "cycle") {
    if (!a.statementDay) return "Set a statement day to show the cycle";
    const c = billingCycle(a.statementDay, a.dueDay, today);
    return `Cycle ${short(c.start)} – ${short(c.end)}${c.due ? ` · Due ${short(c.due)}` : ""}`;
  }
  if (mode === "topup") return a.lastTopup ? `Last top-up ${fmtDate(a.lastTopup, { day: "numeric", month: "short" })}` : "No top-up recorded yet";
  return has && a.balanceAsOf
    ? `Updated ${fmtDate(a.balanceAsOf.slice(0, 10), { day: "numeric", month: "short" })} · ${a.balanceSource === "sms" ? "from bank message" : "entered by you"}`
    : "No balance reported yet";
}

/** Digital payment card. Shows only the last four digits; never a full number or CVV. */
export function WalletCard({ account, onClick, peek = false }: { account: Account; onClick?: () => void; peek?: boolean }) {
  const a = account;
  const holder = useContext(Ctx)?.user?.name;
  const has = a.balanceMinor != null;
  const bal = has ? formatMoney(a.balanceMinor!, a.currency) : "Balance unavailable";
  const type = a.cardType ?? (a.kind === "wallet" ? "Stored-value wallet" : a.kind === "cash" ? "Cash" : "Account");
  const updated = cardLine(a);
  // A card behind the front one shows its balance if known, otherwise just the mark (not the word "Unavailable").
  const peekMark = has ? <span className="pc-peek num">{bal}</span> : <span className="pc-mark" aria-hidden="true"><LogoMark size={20} mono /></span>;
  const art = isArtTheme(a.theme);

  const body = art ? (
    // The user's own card designs: the art sits underneath, Folio's balance hierarchy on top.
    <>
      <CardArt theme={a.theme} />
      <div className="pc-top">
        <div className="pc-brand">
          <div className="bank">{a.bank ?? a.name}</div>
          <div className="type">{type}</div>
        </div>
        {peek ? peekMark
          : a.theme === "axis-privilege" ? <span className="pc-tier">PRIVILEGE</span> : <span className="pc-mark"><LogoMark size={20} mono /></span>}
      </div>
      <div className="pc-hardware" aria-hidden="true"><Chip /><Icon name="wave" className="pc-wave" /></div>
      <div className="pc-foot">
        <div className="pc-money">
          <div className={`bal ${has ? "" : "none"}`}>{has ? <CountUp id={`card-${a.id}`} value={a.balanceMinor!} format={(v) => formatMoney(Math.round(v), a.currency)} /> : bal}</div>
          <div className="meta">{updated}</div>
        </div>
        <div className="pc-bot">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            {a.theme === "axis-privilege" && holder && <span className="pc-holder">{holder.toUpperCase()}</span>}
            {a.last4 && <span className="digits" aria-label={`Card ending ${a.last4}`}>•••• {a.last4}</span>}
            <span className="ccy">{a.currency}</span>
          </div>
          {a.theme === "icici-student" && <span className="pc-network" aria-label="Visa">VISA</span>}
        </div>
      </div>
    </>
  ) : (
    <>
      <div className="pc-top">
        <div><div className="bank">{a.bank ?? a.name}</div><div className="type">{type}</div></div>
        {peek ? peekMark : <span className="pc-mark"><LogoMark size={22} mono /></span>}
      </div>
      <div className="pc-mid">
        <div className="bal-label">Available balance</div>
        <div className={`bal ${has ? "" : "none"}`}>{has ? <CountUp id={`card-${a.id}`} value={a.balanceMinor!} format={(v) => formatMoney(Math.round(v), a.currency)} /> : bal}</div>
      </div>
      <div className="pc-bot">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="wave" className="pc-wave" />
          {a.last4 && <span className="digits" aria-label={`Card ending ${a.last4}`}>•••• {a.last4}</span>}
          <span className="ccy">{a.currency}</span>
        </div>
        <div className="meta">{updated}</div>
      </div>
    </>
  );
  const label = `${a.bank ?? a.name} ${type}${a.last4 ? ` ending ${a.last4}` : ""}, ${has ? bal : "balance unavailable"}`;
  const cls = `pay-card ${a.theme} ${art ? "art" : ""} ${peek ? "peek" : ""}`;
  return onClick
    ? <button className={cls} onClick={onClick} aria-label={label}>{body}</button>
    : <div className={cls} aria-label={label}>{body}</div>;
}
