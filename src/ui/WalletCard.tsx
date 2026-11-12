import { useContext } from "react";
import type { Account } from "../api.ts";
import { Ctx } from "../ctx.ts";
import { fmtDate, formatMoney } from "../format.ts";
import { CardArt, Chip, isArtTheme } from "./CardArt.tsx";
import { Icon } from "./Icon.tsx";
import { CountUp } from "./motion.tsx";
import { LogoMark } from "./Logo.tsx";

/** Digital payment card. Shows only the last four digits; never a full number or CVV. */
export function WalletCard({ account, onClick, peek = false }: { account: Account; onClick?: () => void; peek?: boolean }) {
  const a = account;
  const holder = useContext(Ctx)?.user?.name;
  const has = a.balanceMinor != null;
  const bal = has ? formatMoney(a.balanceMinor!, a.currency) : "Balance unavailable";
  const type = a.cardType ?? (a.kind === "wallet" ? "Stored-value wallet" : a.kind === "cash" ? "Cash" : "Account");
  const updated = has && a.balanceAsOf
    ? `Updated ${fmtDate(a.balanceAsOf.slice(0, 10), { day: "numeric", month: "short" })} · ${a.balanceSource === "sms" ? "from bank message" : "entered by you"}`
    : "No balance reported yet";
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
        {peek ? <span className={`pc-peek num ${has ? "" : "none"}`}>{has ? bal : "Unavailable"}</span>
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
        {peek ? <span className={`pc-peek num ${has ? "" : "none"}`}>{has ? bal : "Unavailable"}</span> : <span className="pc-mark"><LogoMark size={22} mono /></span>}
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
        <div className="meta">{has && a.balanceAsOf ? <>Updated {fmtDate(a.balanceAsOf.slice(0, 10))}<br />{a.balanceSource === "sms" ? "from bank message" : "entered by you"}</> : <>No balance reported yet<br />updates from bank messages</>}</div>
      </div>
    </>
  );
  const label = `${a.bank ?? a.name} ${type}${a.last4 ? ` ending ${a.last4}` : ""}, ${has ? bal : "balance unavailable"}`;
  const cls = `pay-card ${a.theme} ${art ? "art" : ""} ${peek ? "peek" : ""}`;
  return onClick
    ? <button className={cls} onClick={onClick} aria-label={label}>{body}</button>
    : <div className={cls} aria-label={label}>{body}</div>;
}
