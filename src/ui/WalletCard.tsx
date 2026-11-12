import type { Account } from "../api.ts";
import { fmtDate, formatMoney } from "../format.ts";
import { Icon } from "./Icon.tsx";
import { LogoMark } from "./Logo.tsx";

/** Digital payment card. Shows only the last four digits; never a full number or CVV. */
export function WalletCard({ account, onClick, peek = false }: { account: Account; onClick?: () => void; peek?: boolean }) {
  const a = account;
  const has = a.balanceMinor != null;
  const bal = has ? formatMoney(a.balanceMinor!, a.currency) : "Balance unavailable";
  const body = (
    <>
      <div className="pc-top">
        <div><div className="bank">{a.bank ?? a.name}</div><div className="type">{a.cardType ?? (a.kind === "wallet" ? "Stored-value wallet" : a.kind === "cash" ? "Cash" : "Account")}</div></div>
        {peek ? <span className={`pc-peek num ${has ? "" : "none"}`}>{has ? bal : "Unavailable"}</span> : <span className="pc-mark"><LogoMark size={22} mono /></span>}
      </div>
      <div className="pc-mid">
        <div className="bal-label">Available balance</div>
        <div className={`bal ${has ? "" : "none"}`}>{bal}</div>
      </div>
      <div className="pc-bot">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="wave" className="pc-wave" />
          {a.last4 && <span className="digits" aria-label={`Card ending ${a.last4}`}>•••• {a.last4}</span>}
          <span className="ccy">{a.currency}</span>
        </div>
        <div className="meta">{has && a.balanceAsOf ? <>Updated {fmtDate(a.balanceAsOf.slice(0, 10))}<br />{a.balanceSource === "sms" ? "from bank message" : "entered by you"}</> : <>No balance reported yet<br />updates from bank messages</>}</div>
      </div>
    </>
  );
  const label = `${a.bank ?? a.name} ${a.cardType ?? ""}${a.last4 ? ` ending ${a.last4}` : ""}, ${has ? bal : "balance unavailable"}`;
  return onClick
    ? <button className={`pay-card ${a.theme} ${peek ? "peek" : ""}`} onClick={onClick} aria-label={label}>{body}</button>
    : <div className={`pay-card ${a.theme}`} aria-label={label}>{body}</div>;
}
