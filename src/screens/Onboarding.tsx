import { useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../ctx.ts";
import { CURRENCIES } from "../../shared/money.ts";
import { SAMPLE_MESSAGES } from "../../shared/sms.ts";
import { Icon } from "../ui/Icon.tsx";
import { LogoLoader } from "../ui/Logo.tsx";
import { toast } from "../ui/kit.tsx";
import { WalletCard } from "../ui/WalletCard.tsx";
import { Reveal } from "../ui/Reveal.tsx";

const COMMON = ["JPY", "INR", "USD", "EUR", "GBP", "SGD"];
const STEPS = 5;

/** First-run setup: a few skippable questions that make the first Home screen useful. */
export function Onboarding() {
  const { user, setUser, accounts, refresh, openImport } = useApp();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [currency, setCurrency] = useState(user.baseCurrency);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [balances, setBalances] = useState<Record<number, string>>({});
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = user.name.split(" ")[0];
  const cards = accounts.filter((a) => a.kind === "card" || a.kind === "bank");

  const move = (to: number) => { setError(""); setDir(to > step ? "fwd" : "back"); setStep(to); };
  async function run(fn: () => Promise<void>, next: number) {
    setBusy(true); setError("");
    try { await fn(); move(next); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function finish(then?: "paste" | "example") {
    setBusy(true);
    try {
      const r = await api("/me", { method: "PATCH", body: { onboarded: true } });
      refresh();
      setUser(r.user);
      if (then) setTimeout(() => openImport(then === "example" ? SAMPLE_MESSAGES.join("\n") : undefined), 350);
      else toast("You're all set");
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  const saveCurrency = () => run(async () => {
    if (currency !== user.baseCurrency) setUser((await api("/me", { method: "PATCH", body: { baseCurrency: currency } })).user);
  }, 2);
  const saveCards = () => run(async () => {
    for (const a of cards) {
      if (removed.has(a.id)) await api(`/accounts/${a.id}`, { method: "DELETE" });
      else if (balances[a.id]?.trim()) await api(`/accounts/${a.id}`, { method: "PATCH", body: { balance: balances[a.id].trim() } });
    }
    refresh();
  }, 3);
  const saveBudget = () => run(async () => {
    if (budget.trim()) setUser((await api("/me", { method: "PATCH", body: { monthlyBudget: budget.trim() } })).user);
  }, 4);

  const screens = [
    // 0 — welcome
    <div className="ob-center" key="0">
      <LogoLoader size={92} />
      <Reveal as="h1" className="ob-title" text={`Welcome, ${first}`} />
      <p className="ob-lede">A minute of setup and Folio will be ready for your first bank message.</p>
    </div>,
    // 1 — currency
    <div key="1">
      <Reveal as="h1" className="ob-title" text={`Which currency do you budget in?`} />
      <p className="ob-lede">Spending in other currencies is kept separate unless you set an exchange rate later.</p>
      <div className="ob-grid" role="radiogroup" aria-label="Budget currency">
        {COMMON.map((c) => <button key={c} role="radio" aria-checked={currency === c} className="ob-choice" onClick={() => setCurrency(c)}>{c}</button>)}
      </div>
      {!COMMON.includes(currency) && <p className="footnote muted" style={{ marginTop: 10 }}>Selected: {currency}</p>}
      <select className="input" style={{ marginTop: 12 }} value={COMMON.includes(currency) ? "" : currency} onChange={(e) => e.target.value && setCurrency(e.target.value)} aria-label="Other currency">
        <option value="">Other currency…</option>
        {CURRENCIES.filter((c) => !COMMON.includes(c)).map((c) => <option key={c}>{c}</option>)}
      </select>
    </div>,
    // 2 — cards
    <div key="2">
      <Reveal as="h1" className="ob-title" text={`Your cards`} />
      <p className="ob-lede">Folio matches bank messages to these by their last four digits. Remove any that aren't yours.</p>
      <div className="ob-cards">
        {cards.length === 0 && <p className="subhead muted">No cards yet. You can add them in Settings.</p>}
        {cards.map((a) => (
          <div key={a.id} className={`ob-card ${removed.has(a.id) ? "off" : ""}`}>
            <WalletCard account={a} />
            <div className="row" style={{ gap: 8 }}>
              {!removed.has(a.id) && <input className="input grow num" inputMode="decimal" placeholder={`Current balance in ${a.currency} (optional)`} value={balances[a.id] ?? ""} onChange={(e) => setBalances({ ...balances, [a.id]: e.target.value })} aria-label={`Current balance for card ending ${a.last4}`} />}
              <button className="btn gray small" onClick={() => { const n = new Set(removed); n.has(a.id) ? n.delete(a.id) : n.add(a.id); setRemoved(n); }}>{removed.has(a.id) ? "Keep" : "Not mine"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    // 3 — budget
    <div key="3">
      <Reveal as="h1" className="ob-title" text={`Set a monthly budget?`} />
      <p className="ob-lede">Folio shows what's left each month and warns you as you get close. You can change it any time.</p>
      <label className="ob-amount">
        <span>{currency}</span>
        <input className="num" inputMode="decimal" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label={`Monthly budget in ${currency}`} />
      </label>
    </div>,
    // 4 — first data
    <div key="4">
      <Reveal as="h1" className="ob-title" text={`Bring in your spending`} />
      <p className="ob-lede">Paste bank SMS messages and Folio reads the amount, merchant, card and balance. Nothing is read without you pasting or sharing it.</p>
      <div className="list" style={{ marginTop: 18 }}>
        <button className="cell" disabled={busy} onClick={() => finish("paste")}><span className="tx-icon" style={{ ["--tint" as any]: "var(--s3)" }}><Icon name="tray" /></span><span className="grow"><span className="headline" style={{ display: "block" }}>Paste bank messages</span><span className="footnote muted">Copy them from Messages</span></span><Icon name="chevron" className="chev" /></button>
        <button className="cell" disabled={busy} onClick={() => finish("example")}><span className="tx-icon" style={{ ["--tint" as any]: "var(--s1)" }}><Icon name="spark" /></span><span className="grow"><span className="headline" style={{ display: "block" }}>Try with example messages</span><span className="footnote muted">See how it works first</span></span><Icon name="chevron" className="chev" /></button>
        <button className="cell" disabled={busy} onClick={() => finish()}><span className="tx-icon" style={{ ["--tint" as any]: "var(--s0)" }}><Icon name="check" /></span><span className="grow"><span className="headline" style={{ display: "block" }}>I'll do this later</span><span className="footnote muted">Go to Home</span></span><Icon name="chevron" className="chev" /></button>
      </div>
    </div>,
  ];
  const primary: [string, () => void][] = [
    ["Get started", () => move(1)], ["Continue", saveCurrency], ["Continue", saveCards], [budget.trim() ? "Set budget" : "Skip for now", saveBudget],
  ];

  return (
    <div className="onboarding">
      <header className="ob-head">
        <button className="btn plain small" style={{ visibility: step > 0 ? "visible" : "hidden" }} onClick={() => move(step - 1)} disabled={busy}><Icon name="back" />Back</button>
        <div className="ob-dots" aria-label={`Step ${step + 1} of ${STEPS}`}>{Array.from({ length: STEPS }, (_, i) => <i key={i} className={i === step ? "on" : i < step ? "done" : ""} />)}</div>
        <button className="btn plain small" style={{ visibility: step < STEPS - 1 ? "visible" : "hidden" }} onClick={() => finish()} disabled={busy}>Skip</button>
      </header>
      <main className={`ob-body ${dir}`} key={step}>{screens[step]}</main>
      <footer className="ob-foot">
        {error && <p className="error" role="alert">{error}</p>}
        {step < STEPS - 1 && <button className="btn primary block ob-cta" disabled={busy} onClick={primary[step][1]}>{busy ? "Saving…" : primary[step][0]}</button>}
      </footer>
    </div>
  );
}
