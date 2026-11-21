/**
 * First-run setup, one question at a time (after Duolingo's onboarding): a progress bar with Back, the
 * Folio mark as a guide whose speech bubble asks the question and reacts to the answer, big tappable
 * tiles, and one Continue button. Every answer is saved as it's given, so a reload resumes the step.
 *
 *   hello → goals → currency → money in → budget → colour → cards → bank messages → done
 *
 * The answers personalise Folio: base currency, monthly budget, accent colour (app and home-screen
 * icon), the person's own cards (nobody else's), which parts the tour covers and what Ask suggests.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type Account } from "../api.ts";
import { useApp } from "../ctx.ts";
import { ACCENTS, accentOf } from "../../shared/accents.ts";
import { CURRENCIES, toMinor } from "../../shared/money.ts";
import { formatMoney } from "../format.ts";

/** Round amounts without decimals: ₹25,000, ¥50,000. */
const whole = (minor: number, currency: string) => formatMoney(minor, currency).replace(/\.00(?!\d)/, "");
import { applyAccent } from "../ui/accent.ts";
import { Icon } from "../ui/Icon.tsx";
import { LogoMark } from "../ui/Logo.tsx";
import { toast, useLeave } from "../ui/kit.tsx";

const STEPS = ["hello", "goals", "currency", "income", "budget", "colour", "cards", "import", "done"] as const;
type Step = (typeof STEPS)[number];

const GOALS = [
  { id: "spending", icon: "pie", label: "See where my money goes", reply: "I'll sort every purchase into a category for you." },
  { id: "budget", icon: "percent", label: "Stick to a monthly budget", reply: "I'll show what's left and warn you before you go over." },
  { id: "scholarship", icon: "cap", label: "Track a scholarship or allowance", reply: "Expected and received kept apart, so you always know what's really arrived." },
  { id: "investing", icon: "trend", label: "Follow my investments", reply: "Your holdings, valued with real market prices." },
  { id: "saving", icon: "wallet", label: "Save up for something", reply: "Let's find room for it every month." },
];
const MONEY_IN = [
  { id: "scholarship", icon: "cap", label: "Scholarship", reply: "Scholarships stay separate from everything else. Only what's arrived counts." },
  { id: "allowance", icon: "heart", label: "Allowance from family", reply: "Family transfers get their own place too." },
  { id: "part-time", icon: "cup", label: "Part-time job", reply: "Nice. Your pay will show up as money in." },
  { id: "salary", icon: "card", label: "Salary", reply: "Got it. Payday will be easy to spot." },
  { id: "none", icon: "dots", label: "Nothing regular yet", reply: "No problem. You can add income any time in Plan." },
];
const MAIN_CURRENCIES: [string, string, string][] = [
  ["JPY", "¥", "Japanese yen"], ["INR", "₹", "Indian rupee"], ["USD", "$", "US dollar"],
  ["EUR", "€", "Euro"], ["GBP", "£", "British pound"], ["SGD", "S$", "Singapore dollar"],
];
const BUDGETS: Record<string, number[]> = { JPY: [30000, 50000, 80000, 120000], INR: [10000, 25000, 50000, 100000] };
const BANKS = ["ICICI Bank", "Axis Bank", "HDFC Bank", "State Bank of India", "Kotak Mahindra Bank", "IDFC FIRST Bank", "Niyo", "Wise", "Revolut", "SMBC", "MUFG", "Mizuho", "Rakuten Bank", "Sony Bank", "PayPay Bank", "Japan Post Bank"];
const CARD_KINDS = [
  { id: "Credit Card", icon: "card", label: "Credit card" },
  { id: "Debit Card", icon: "card", label: "Debit card" },
  { id: "Forex Prepaid Card", icon: "plane", label: "Prepaid or forex card" },
  { id: "bank", icon: "home", label: "Bank account" },
];

const QUESTION: Record<Step, (first: string) => string> = {
  hello: (n) => `Hi ${n}! I'm Folio. Let's make this yours. It takes about a minute.`,
  goals: () => "What would you like help with?",
  currency: () => "Which currency do you spend in most?",
  income: () => "How does money come in?",
  budget: () => "How much would you like to spend in a month?",
  colour: () => "Pick your colour. Your app icon changes with it.",
  cards: () => "Add the cards you pay with.",
  import: () => "Shall we bring in your bank messages?",
  done: (n) => `You're all set, ${n}!`,
};

export function Setup({ mode, onFinish }: { mode: "first" | "replay"; onFinish: (o: { tour: boolean; importNow: boolean }) => void }) {
  const { user, setUser, accounts, refresh } = useApp();
  const reduce = useReducedMotion();
  const first = user.name.split(" ")[0];
  const p = user.profile ?? {};
  const [step, setStep] = useState<number>(mode === "first" ? Math.min(p.setupStep ?? 0, STEPS.length - 2) : 0);
  const [dir, setDir] = useState(1);
  const [goals, setGoals] = useState<string[]>(p.goals ?? []);
  const [incomes, setIncomes] = useState<string[]>(p.incomes ?? []);
  const [currency, setCurrency] = useState(user.baseCurrency);
  const [budget, setBudget] = useState<string>(user.monthlyBudgetMinor != null ? "set" : "");
  const [budgetValue, setBudgetValue] = useState<number | null>(user.monthlyBudgetMinor);
  const [accent, setAccent] = useState(user.accent ?? "folio");
  const [importNow, setImportNow] = useState<boolean | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cards = accounts.filter((a) => a.kind === "card" || a.kind === "bank");
  const s = STEPS[step];
  const exit = useLeave();
  const finish = (o: { tour: boolean; importNow: boolean }) => exit.leave(() => onFinish(o));

  // Each step starts with its question; an answer swaps the bubble to a reply.
  useEffect(() => setReply(null), [step]);

  const save = (body: object) => api("/me", { method: "PATCH", body }).then((r) => { setUser(r.user); return r; });
  const canContinue = s === "goals" ? goals.length > 0 : s === "income" ? incomes.length > 0 : s === "budget" ? budget !== "" : s === "import" ? importNow !== null : true;

  async function next() {
    if (!canContinue || busy) return;
    setBusy(true);
    try {
      const nextStep = step + 1;
      const profile = { setupStep: nextStep };
      if (s === "goals") await save({ profile: { ...profile, goals } });
      else if (s === "currency") await save({ baseCurrency: currency, profile });
      else if (s === "income") await save({ profile: { ...profile, incomes } });
      else if (s === "budget") await save({ monthlyBudget: budget === "skip" || budgetValue == null ? null : String(fromMinorFor(budgetValue, currency)), profile });
      else if (s === "colour") await save({ accent, profile });
      else if (s === "import") await save({ profile: { ...profile, setupDone: true } });
      else if (mode === "first") await save({ profile });
      setDir(1); setStep(nextStep);
    } catch (e: any) { toast(e.message); }
    finally { setBusy(false); }
  }
  function back() { if (step > 0) { setDir(-1); setStep(step - 1); } }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && !(e.target instanceof HTMLInputElement) && s !== "done") next(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const toggle = (list: string[], set: (v: string[]) => void, id: string, exclusive?: string) => {
    const on = list.includes(id);
    let v = on ? list.filter((x) => x !== id) : [...list.filter((x) => x !== exclusive || id === exclusive), id];
    if (id === exclusive && !on) v = [id];
    set(v);
    if (!on && "vibrate" in navigator) navigator.vibrate?.(8);
    return !on;
  };

  const progress = Math.min(1, step / (STEPS.length - 1));
  const slide = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: 48 * dir }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -48 * dir } };

  return (
    <div className={`setup ${exit.leaving ? "leaving" : ""}`} role="dialog" aria-modal="true" aria-label="Set up Folio" onAnimationEnd={exit.onAnimationEnd}>
      {s !== "done" && (
        <header className="setup-top">
          <button className="icon-btn" onClick={step === 0 && mode === "replay" ? () => finish({ tour: false, importNow: false }) : back} disabled={step === 0 && mode === "first"} aria-label={step === 0 ? "Close" : "Back"}>
            <Icon name={step === 0 ? "x" : "back"} />
          </button>
          <div className="setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Setup progress">
            <motion.i initial={false} animate={{ scaleX: Math.max(0.04, progress) }} transition={{ type: "spring", visualDuration: 0.5, bounce: 0 }} />
          </div>
        </header>
      )}

      <div className="setup-body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={s} className="setup-step" {...slide} transition={{ type: "spring", visualDuration: 0.35, bounce: 0 }}>
            {s === "done" ? <Done first={first} goals={goals} currency={currency} budgetMinor={budget === "set" ? budgetValue : null} accent={accent} cards={cards} /> : (
              <>
                <Guide text={reply ?? QUESTION[s](first)} big={s === "hello"} hop={reply} />
                {s === "goals" && (
                  <Tiles label="What would you like help with?">
                    {GOALS.map((g) => <Tile key={g.id} icon={g.icon} label={g.label} on={goals.includes(g.id)} onClick={() => { if (toggle(goals, setGoals, g.id)) setReply(g.reply); }} multi />)}
                    <p className="caption faint setup-hint">Choose as many as you like.</p>
                  </Tiles>
                )}
                {s === "currency" && (
                  <Tiles label="Main currency" grid>
                    {MAIN_CURRENCIES.map(([c, sym, name]) => <Tile key={c} glyph={sym} label={name} sub={c} on={currency === c} onClick={() => { setCurrency(c); setReply(`${sym} ${name} it is!`); }} />)}
                    <label className="setup-other">
                      <span className="footnote muted">Something else</span>
                      <select className="input" value={MAIN_CURRENCIES.some(([c]) => c === currency) ? "" : currency} onChange={(e) => { if (e.target.value) { setCurrency(e.target.value); setReply(`${e.target.value} it is!`); } }}>
                        <option value="">Choose…</option>{CURRENCIES.filter((c) => !MAIN_CURRENCIES.some(([m]) => m === c)).map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                  </Tiles>
                )}
                {s === "income" && (
                  <Tiles label="How money comes in">
                    {MONEY_IN.map((m) => <Tile key={m.id} icon={m.icon} label={m.label} on={incomes.includes(m.id)} onClick={() => { if (toggle(incomes, setIncomes, m.id, "none")) setReply(m.reply); }} multi />)}
                  </Tiles>
                )}
                {s === "budget" && <Budget currency={currency} value={budgetValue} chosen={budget} onPick={(v) => { setBudget(v == null ? "skip" : "set"); setBudgetValue(v); setReply(v == null ? "You can set one any time in Plan." : `${whole(v, currency)} a month. I'll show what's left as you spend.`); }} />}
                {s === "colour" && (
                  <Tiles label="Accent colour" grid>
                    {ACCENTS.map((a) => (
                      <button key={a.key} className={`setup-tile swatch ${accent === a.key ? "on" : ""}`} aria-pressed={accent === a.key}
                        onClick={() => { setAccent(a.key); applyAccent(a.key); setReply(`${a.name}. Looking good!`); }}>
                        <span className="swatch-icon" style={{ background: "linear-gradient(135deg,#16181d,#06070a)" }}>
                          <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true">
                            <defs><linearGradient id={`sw-${a.key}`} x1="0.1" y1="1" x2="0.9" y2="0"><stop offset="0" stopColor={a.stops[0]} /><stop offset="0.5" stopColor={a.stops[1]} /><stop offset="1" stopColor={a.stops[2]} /></linearGradient></defs>
                            <path d="M46 6Q51 51 90 56Q51 61 46 96Q41 61 8 56Q41 51 46 6Z" fill={`url(#sw-${a.key})`} /><circle cx="79" cy="19" r="8" fill={`url(#sw-${a.key})`} />
                          </svg>
                        </span>
                        <span className="tile-label">{a.name}</span>
                      </button>
                    ))}
                  </Tiles>
                )}
                {s === "cards" && <Cards currency={currency} cards={cards} refresh={refresh} onAdded={(a) => setReply(`Nice. ${a.bank ?? a.name}${a.last4 ? ` ••${a.last4}` : ""} is in. Add another, or continue.`)} />}
                {s === "import" && (
                  <Tiles label="Bank messages">
                    <Tile icon="tray" label="Paste them now" sub="Copy a few bank SMS and Folio reads them" on={importNow === true} onClick={() => { setImportNow(true); setReply("Great. I'll open the importer right after this."); }} />
                    <Tile icon="calendar" label="Maybe later" sub="Import from Home whenever you like" on={importNow === false} onClick={() => { setImportNow(false); setReply("Whenever you're ready."); }} />
                  </Tiles>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="setup-foot">
        {s === "done" ? (
          <>
            <button className="setup-cta" onClick={() => finish({ tour: true, importNow: !!importNow })}>Show me around</button>
            <button className="btn plain" onClick={() => finish({ tour: false, importNow: !!importNow })}>Start using Folio</button>
          </>
        ) : (
          <button className="setup-cta" disabled={!canContinue || busy} onClick={next}>
            {s === "hello" ? "Let's go" : s === "cards" && cards.length === 0 ? "Skip for now" : "Continue"}
          </button>
        )}
      </footer>
    </div>
  );
}

const fromMinorFor = (minor: number, currency: string) => minor / 10 ** ((toMinor("1", currency) ?? 1).toString().length - 1);

/** The Folio mark as a guide, with a speech bubble. It bobs while it waits and hops when it replies. */
function Guide({ text, big, hop }: { text: string; big?: boolean; hop: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div className={`guide ${big ? "big" : ""}`}>
      <motion.div className="guide-mark" key={hop ?? "q"}
        initial={reduce ? false : { y: 0, rotate: 0, scale: 1 }}
        animate={reduce ? {} : hop ? { y: [0, -14, 0], rotate: [0, -8, 0], scale: [1, 1.08, 1] } : { y: [0, -4, 0] }}
        transition={hop ? { duration: 0.45, ease: "easeOut" } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
        <LogoMark size={big ? 96 : 56} />
      </motion.div>
      <div className="guide-bubble" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={text} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{text}</motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Tiles({ label, grid, children }: { label: string; grid?: boolean; children: React.ReactNode }) {
  return <div className={`setup-tiles ${grid ? "grid" : ""}`} role="group" aria-label={label}>{children}</div>;
}

function Tile({ icon, glyph, label, sub, on, onClick, multi }: { icon?: string; glyph?: string; label: string; sub?: string; on: boolean; onClick: () => void; multi?: boolean }) {
  return (
    <motion.button className={`setup-tile ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick} whileTap={{ scale: 0.97 }}>
      {glyph ? <span className="tile-glyph">{glyph}</span> : icon && <span className="tile-icon"><Icon name={icon} /></span>}
      <span className="tile-text"><span className="tile-label">{label}</span>{sub && <span className="tile-sub">{sub}</span>}</span>
      {multi && <span className={`tile-check ${on ? "on" : ""}`} aria-hidden="true">{on && <Icon name="check" />}</span>}
    </motion.button>
  );
}

function Budget({ currency, value, chosen, onPick }: { currency: string; value: number | null; chosen: string; onPick: (minor: number | null) => void }) {
  const unit = toMinor("1", currency) ?? 1;
  const presets = (BUDGETS[currency] ?? [500, 1000, 2000, 3500]).map((v) => v * unit);
  const [custom, setCustom] = useState(value != null && !presets.includes(value) ? String(value / unit) : "");
  return (
    <div className="setup-tiles grid" role="group" aria-label="Monthly budget">
      {presets.map((v) => <Tile key={v} glyph={whole(v, currency)} label="a month" on={chosen === "set" && value === v} onClick={() => { setCustom(""); onPick(v); }} />)}
      <label className="setup-other">
        <span className="footnote muted">Another amount</span>
        <input className="input num" inputMode="decimal" placeholder="e.g. 65000" value={custom}
          onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ""); setCustom(t); const m = toMinor(t, currency); if (m && m > 0) onPick(m); }} />
      </label>
      <Tile icon="calendar" label="I'll decide later" on={chosen === "skip"} onClick={() => { setCustom(""); onPick(null); }} />
    </div>
  );
}

function Cards({ currency, cards, refresh, onAdded }: { currency: string; cards: Account[]; refresh: () => void; onAdded: (a: Account) => void }) {
  const [f, setF] = useState({ bank: "", kind: "Credit Card", last4: "", currency });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = f.bank.trim().length > 1 && (f.kind === "bank" || /^\d{4}$/.test(f.last4));
  async function add() {
    if (!ok) return;
    setBusy(true); setError("");
    const bank = f.bank.trim(), isBank = f.kind === "bank";
    try {
      const r = await api("/accounts", { body: { kind: isBank ? "bank" : "card", bank, cardType: isBank ? null : f.kind, name: isBank ? `${bank} account` : `${bank} ${f.kind}`, last4: f.last4 || null, currency: f.currency } });
      refresh(); onAdded(r.account);
      setF({ ...f, bank: "", last4: "" });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function remove(a: Account) { await api(`/accounts/${a.id}`, { method: "DELETE" }).catch(() => {}); refresh(); }
  return (
    <div className="stack" style={{ gap: 14 }}>
      {cards.length > 0 && (
        <div className="list">
          {cards.map((a) => (
            <div className="cell" key={a.id}>
              <span className={`pay-card ${a.theme}`} style={{ width: 44, height: 28, aspectRatio: "auto", borderRadius: 6, padding: 0, flex: "none" }} />
              <span className="grow"><span className="headline truncate" style={{ display: "block" }}>{a.bank ?? a.name}</span><span className="footnote muted">{a.cardType ?? "Account"}{a.last4 ? ` · •••• ${a.last4}` : ""} · {a.currency}</span></span>
              <button className="icon-btn" aria-label={`Remove ${a.name}`} onClick={() => remove(a)}><Icon name="x" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="card stack setup-card-form" style={{ gap: 12 }}>
        <input className="input" list="setup-banks" placeholder="Bank or issuer, e.g. HDFC Bank" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} aria-label="Bank or issuer" />
        <datalist id="setup-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
        <div className="chips" role="group" aria-label="Type" style={{ margin: 0, padding: 0, flexWrap: "wrap" }}>
          {CARD_KINDS.map((k) => <button key={k.id} className="chip" aria-pressed={f.kind === k.id} onClick={() => setF({ ...f, kind: k.id })}><Icon name={k.icon} style={{ width: 14, height: 14 }} />{k.label}</button>)}
        </div>
        <div className="form-row">
          <input className="input num" inputMode="numeric" maxLength={4} placeholder={f.kind === "bank" ? "Last 4 (optional)" : "Last 4 digits"} value={f.last4}
            onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} aria-label="Last four digits" />
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} aria-label="Card currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn tinted" disabled={!ok || busy} onClick={add}><Icon name="plus" />Add {f.kind === "bank" ? "account" : "card"}</button>
        <p className="caption faint" style={{ margin: 0 }}>Only the last four digits, which is how Folio matches your bank messages. Never the full number or CVV. Cards also appear by themselves when you import messages that mention them.</p>
      </div>
    </div>
  );
}

/** The finish: the mark leaps, confetti in the accent's colours, and a summary of what was set up. */
function Done({ first, goals, currency, budgetMinor, accent, cards }: { first: string; goals: string[]; currency: string; budgetMinor: number | null; accent: string; cards: Account[] }) {
  const reduce = useReducedMotion();
  const a = accentOf(accent);
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    x: (Math.random() - 0.5) * 520, y: -(160 + Math.random() * 260), r: (Math.random() - 0.5) * 540, d: 0.9 + Math.random() * 0.8,
    c: a.stops[i % 3], w: 6 + Math.random() * 6, round: i % 4 === 0,
  })), [a.key]);
  const chips = [
    `${currency}`, budgetMinor != null ? `${whole(budgetMinor, currency)} a month` : null,
    `${cards.length} ${cards.length === 1 ? "card" : "cards"}`, `${a.name} colour`,
    ...goals.map((g) => GOALS.find((x) => x.id === g)?.label.replace(/^(See|Stick to|Track|Follow|Save up for) /, "")),
  ].filter(Boolean) as string[];
  return (
    <div className="setup-done">
      {!reduce && <div className="confetti" aria-hidden="true">{bits.map((b, i) => (
        <motion.i key={i} style={{ background: b.c, width: b.w, height: b.round ? b.w : b.w * 1.6, borderRadius: b.round ? "50%" : 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }} animate={{ x: b.x, y: [0, b.y, b.y + 520], rotate: b.r, opacity: [1, 1, 0] }}
          transition={{ duration: b.d + 1, ease: [0.2, 0.7, 0.4, 1], times: [0, 0.35, 1] }} />
      ))}</div>}
      <motion.div className="done-mark" initial={reduce ? false : { scale: 0.4, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: "spring", visualDuration: 0.5, bounce: 0.3 }}>
        <LogoMark size={112} />
      </motion.div>
      <motion.h1 className="setup-title" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        You're all set, <span className="grad">{first}</span>!
      </motion.h1>
      <motion.p className="subhead muted" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>Folio is ready, set up the way you like it.</motion.p>
      <motion.div className="setup-summary" initial="h" animate="v" variants={{ v: { transition: { staggerChildren: 0.06, delayChildren: 0.5 } } }}>
        {chips.map((c) => <motion.span key={c} className="badge" variants={{ h: { opacity: 0, y: 6, scale: 0.9 }, v: { opacity: 1, y: 0, scale: 1 } }}>{c}</motion.span>)}
      </motion.div>
    </div>
  );
}
