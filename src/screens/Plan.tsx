import { useState } from "react";
import { api, type Category } from "../api.ts";
import { useApp } from "../ctx.ts";
import { CURRENCIES, fromMinor } from "../../shared/money.ts";
import { fmtDate, fmtMonth, fmtMonthShort, formatMoney, slotColor, todayIso } from "../format.ts";
import { BarChart, Donut, LineChart, type Segment } from "../ui/Charts.tsx";
import { Icon, ICON_CHOICES } from "../ui/Icon.tsx";
import { Empty, Field, MonthNav, Notice, Provenance, Ring, Segmented, Sheet, Skeleton, toast, useLoad, useSheetClose, confirmAction } from "../ui/kit.tsx";
import { Reveal } from "../ui/Reveal.tsx";
import { CountUp } from "../ui/motion.tsx";

export function Plan() {
  const [view, setView] = useState<"budget" | "income">(() => (sessionStorage.getItem("folio-plan") as any) ?? "budget");
  return (
    <div className="screen">
      <header className="screen-head">
        <Reveal as="h1" className="large-title" text="Plan" />
        <div style={{ width: 210, paddingBottom: 4 }}><Segmented label="View" value={view} onChange={(v) => { setView(v); sessionStorage.setItem("folio-plan", v); }} options={[{ value: "budget", label: "Budget" }, { value: "income", label: "Income" }]} /></div>
      </header>
      {view === "budget" ? <Budget /> : <Income />}
    </div>
  );
}

// ================================================================ budget
function Budget() {
  const { user, version, categories } = useApp();
  const now = todayIso().slice(0, 7);
  const [month, setMonth] = useState(now);
  const [active, setActive] = useState<Segment["id"] | null>(null);
  const [editBudget, setEditBudget] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const { data, error } = useLoad(() => api(`/budget?month=${month}`), [month, version]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <><Skeleton h={180} /><Skeleton h={260} /></>;
  const s = data.summary, c = s.currency, m = (n: number) => formatMoney(n, c);
  const state = s.budget == null ? "" : s.spent > s.budget ? "over" : s.pctUsed >= user.alertThreshold ? "warning" : "";

  // Donut: top categories keep their own colour; the long tail folds into "Other".
  const spentCats = s.categories.filter((x: any) => x.spent > 0);
  const top = spentCats.slice(0, 7), rest = spentCats.slice(7);
  const segments: Segment[] = [...top.map((x: any) => ({ id: x.id, label: x.name, value: x.spent, color: slotColor(x.slot) })),
    ...(rest.length ? [{ id: "other", label: `${rest.length} more`, value: rest.reduce((a: number, x: any) => a + x.spent, 0), color: "var(--s0)" }] : [])];
  const cutoff = month === now ? s.daysElapsed - 1 : undefined;

  return (
    <>
      <div className="between"><MonthNav month={month} onChange={setMonth} max={now} /><button className="btn small tinted" onClick={() => setEditBudget(true)}>{s.budget == null ? "Set budget" : "Edit budget"}</button></div>

      {s.alerts.map((a: any, i: number) => <Notice key={i} kind={a.level}>{a.text}.</Notice>)}

      <div className="card budget-hero">
        <Ring pct={s.pctUsed ?? 0} tone={state}>
          <b className="num">{s.pctUsed == null ? "—" : `${s.pctUsed}%`}</b><span className="caption muted">{s.budget == null ? "no budget" : "used"}</span>
        </Ring>
        <div className="grow">
          <div className="eyebrow">Spent in {fmtMonth(month)}</div>
          <div className="hero"><CountUp value={s.spent} format={(v) => m(Math.round(v))} /></div>
          <div className="subhead muted">{s.budget == null ? "Set a budget to see what's left." : s.remaining < 0 ? <span className="neg">{m(-s.remaining)} over {m(s.budget)}</span> : `${m(s.remaining)} left of ${m(s.budget)}`}</div>
          <div style={{ marginTop: 8 }}><Provenance kind={s.estimatedPortion ? "estimate" : "verified"} /></div>
          {s.estimatedPortion !== 0 && <p className="caption faint" style={{ marginTop: 6 }}>{m(s.estimatedPortion)} of this was converted using exchange rates you set.</p>}
        </div>
      </div>

      <div className="stat-grid four">
        <div className="stat"><span className="footnote muted">{s.remaining != null && s.remaining < 0 ? "Over by" : "Remaining"}</span><b className={s.remaining != null && s.remaining < 0 ? "neg" : ""}>{s.remaining == null ? "—" : m(Math.abs(s.remaining))}</b></div>
        <div className="stat"><span className="footnote muted">Used</span><b>{s.pctUsed == null ? "—" : `${s.pctUsed}%`}</b></div>
        <div className="stat"><span className="footnote muted">Daily average</span><b>{m(s.dailyAverage)}</b></div>
        <div className="stat"><span className="footnote muted">Month-end at this pace</span><b>{s.projected == null ? "—" : m(s.projected)}</b>{s.projected != null && <span className="caption faint">estimate</span>}</div>
      </div>

      {s.unconverted.length > 0 && <Notice>Not included above: {s.unconverted.map((u: any) => `${formatMoney(u.minor, u.currency)} across ${u.count} ${u.currency} transaction${u.count > 1 ? "s" : ""}`).join(", ")}. Set an exchange rate in Settings to include them as estimates.</Notice>}
      {s.transfers.length > 0 && <Notice>{s.transfers.map((t: any) => formatMoney(t.total, t.currency)).join(" + ")} moved to stored-value wallets or other accounts this month is not counted as spending. Journeys and purchases you record from a wallet are.</Notice>}

      <div className="grid-2">
        <section className="card stack">
          <div className="headline">Where it went</div>
          {segments.length === 0 ? <Empty icon="pie" title="No spending this month" /> : (
            <>
              <Donut segments={segments} active={active} onActive={setActive} center={(seg) => (
                <div><div className="caption muted truncate">{seg ? seg.label : "Total"}</div><div className="headline num">{m(seg ? seg.value : s.spent)}</div>{seg && <div className="caption faint">{Math.round((seg.value / s.spent) * 100)}%</div>}</div>
              )} />
              <div className="legend">
                {s.categories.map((x: any) => {
                  const cat = categories.find((k) => k.id === x.id);
                  const over = x.budget != null && x.spent > x.budget;
                  return (
                    <button key={x.id} className={`legend-row ${active === x.id ? "on" : active != null && top.some((t: any) => t.id === active) ? "dim" : ""}`}
                      onPointerEnter={() => setActive(x.id)} onPointerLeave={() => setActive(null)} onClick={() => cat && setEditCat(cat)} disabled={!cat}>
                      <span className="swatch" style={{ background: slotColor(x.slot) }} />
                      <span className="grow">
                        <span className="between"><span className="truncate">{x.name}</span><span className="num" style={{ fontWeight: 600 }}>{m(x.spent)}</span></span>
                        {x.budget != null && (
                          <>
                            <span className={`progress thin ${over ? "over" : x.pct >= user.alertThreshold ? "warning" : ""}`} style={{ display: "block", margin: "5px 0 3px" }}><i style={{ width: `${Math.min(100, x.pct)}%` }} /></span>
                            <span className="between caption faint"><span>{x.pct}% of {m(x.budget)}</span><span className={over ? "neg" : ""}>{over ? `${m(x.spent - x.budget)} over` : `${m(x.budget - x.spent)} left`}</span></span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="caption faint">Tap a category to set its budget.</p>
            </>
          )}
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card stack">
            <div className="headline">Spending through the month</div>
            <LineChart points={s.daily.map((d: any) => ({ label: fmtDate(d.date, { day: "numeric", month: "short" }), value: d.cumulative }))} cutoff={cutoff}
              format={m} reference={s.budget != null ? { value: s.budget, label: `Budget ${m(s.budget)}` } : undefined} color="var(--s1)" />
          </section>
          <section className="card stack">
            <div className="headline">Month by month</div>
            <BarChart bars={data.comparison.map((x: any) => ({ key: x.month, label: fmtMonthShort(x.month), value: x.spent, tip: `${fmtMonth(x.month)} · ${x.count} transactions` }))} format={m} selected={month} onSelect={setMonth} />
            <p className="caption faint">Tap a bar to open that month.</p>
          </section>
        </div>
      </div>

      {s.merchants.length > 0 && (
        <section>
          <div className="section-label">Top merchants</div>
          <div className="list">
            {s.merchants.map((x: any) => (
              <div className="cell" key={x.name}>
                <span className="grow"><span className="headline">{x.name}</span><span className="footnote muted" style={{ display: "block" }}>{x.count} transaction{x.count === 1 ? "" : "s"}</span></span>
                <span className="tx-amount">{m(x.total)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {data.recurring.length > 0 && (
        <section>
          <div className="between section-label"><span>Recurring payments</span><Provenance kind="estimate" /></div>
          <div className="list">
            {data.recurring.map((r: any) => (
              <div className="cell" key={r.merchantKey}>
                <span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s4)" }}><Icon name="repeat" /></span>
                <span className="grow"><span className="headline">{r.merchant}</span><span className="footnote muted" style={{ display: "block" }}>{r.cadence === "monthly" ? "Monthly" : "Weekly"} · seen {r.occurrences} times · next around {fmtDate(r.nextExpected)}</span></span>
                <span className="tx-amount">{formatMoney(r.amountMinor, r.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {editBudget && <BudgetSheet onClose={() => setEditBudget(false)} />}
      {editCat && <CategorySheet category={editCat} onClose={() => setEditCat(null)} />}
    </>
  );
}

function BudgetSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, setUser, refresh } = useApp();
  const [budget, setBudget] = useState(user.monthlyBudgetMinor != null ? String(fromMinor(user.monthlyBudgetMinor, user.baseCurrency)) : "");
  const [th, setTh] = useState(user.alertThreshold);
  const [error, setError] = useState("");
  async function save() {
    try { const r = await api("/me", { method: "PATCH", body: { monthlyBudget: budget === "" ? null : budget, alertThreshold: th } }); setUser(r.user); refresh(); toast("Budget saved"); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }
  return (
    <Sheet closeRef={sheet.ref} title="Monthly budget" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <Field label={`Fixed budget each month (${user.baseCurrency})`}><input className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" autoFocus /></Field>
      <Field label={`Warn me when I have used ${th}%`}><input type="range" min={50} max={100} step={5} value={th} onChange={(e) => setTh(Number(e.target.value))} style={{ accentColor: "var(--accent)", height: 44 }} /></Field>
      <p className="footnote muted">Alerts appear on Home and here when you approach or pass the monthly budget or any category budget.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

export function CategorySheet({ category, onClose }: { category: Category | "new"; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, refresh } = useApp();
  const c = category === "new" ? null : category;
  const [f, setF] = useState({ name: c?.name ?? "", icon: c?.icon ?? "dots", slot: c?.slot ?? 0, budget: c?.budgetMinor != null ? String(fromMinor(c.budgetMinor, user.baseCurrency)) : "" });
  const [error, setError] = useState("");
  const locked = c && ["uncategorised", "topup", "transfer"].includes(c.key ?? "");
  async function save() {
    try { await api(c ? `/categories/${c.id}` : "/categories", { method: c ? "PATCH" : "POST", body: { ...f, budget: f.budget === "" ? null : f.budget } }); refresh(); toast("Category saved"); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }
  async function remove() {
    if (!c || !(await confirmAction({ title: `Delete “${c.name}”?`, message: "Its transactions move to Uncategorised.", confirm: "Delete Category", destructive: true }))) return;
    try { await api(`/categories/${c.id}`, { method: "DELETE" }); refresh(); toast("Category deleted"); sheet.dismiss(); } catch (e: any) { setError(e.message); }
  }
  return (
    <Sheet closeRef={sheet.ref} title={c ? "Category" : "New category"} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!c} /></Field>
      {c?.kind !== "transfer" && <Field label={`Monthly limit (${user.baseCurrency})`}><input className="input num" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} placeholder="No limit" /></Field>}
      <div className="field"><span>Icon</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>{ICON_CHOICES.map((i) => <button key={i} aria-label={i} aria-pressed={f.icon === i} onClick={() => setF({ ...f, icon: i })} className="tx-icon" style={{ ["--tint" as any]: f.icon === i ? slotColor(f.slot) : "var(--fill-strong)", color: f.icon === i ? "#fff" : "var(--label)" }}><Icon name={i} /></button>)}</div>
      </div>
      <div className="field"><span>Chart colour</span>
        <div className="row" style={{ gap: 10 }}>{[1, 2, 3, 4, 5, 6, 7, 8, 0].map((n) => <button key={n} aria-label={n ? `Colour ${n}` : "Grey"} aria-pressed={f.slot === n} onClick={() => setF({ ...f, slot: n })} style={{ width: 28, height: 28, borderRadius: 14, background: slotColor(n), outline: f.slot === n ? "3px solid var(--label)" : "none", outlineOffset: 2 }} />)}</div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {c && !locked && <button className="btn danger block" onClick={remove}><Icon name="trash" />Delete category</button>}
    </Sheet>
  );
}

// ================================================================ income
const KIND: Record<string, [string, string, number]> = { scholarship: ["Scholarship", "cap", 7], allowance: ["Allowance", "wallet", 3], family: ["Family transfer", "heart", 5], "part-time": ["Part-time income", "bag", 1], other: ["Other income", "in", 0] };
const STATUS: Record<string, [string, string]> = { received: ["verified", "Received"], partial: ["estimate", "Part received"], overdue: ["over", "Overdue"], expected: ["", "Expected"] };

function Income() {
  const { version, refresh } = useApp();
  const { data, error } = useLoad(() => api("/income"), [version]);
  const [addSource, setAddSource] = useState(false);
  const [payment, setPayment] = useState<{ source: any; payment: any | null } | null>(null);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <Skeleton h={240} />;
  async function removeSource(s: any) {
    if (!(await confirmAction({ title: `Delete “${s.name}”?`, message: "Its payment schedule and received amounts are deleted too.", confirm: "Delete Income", destructive: true }))) return;
    await api(`/income/sources/${s.id}`, { method: "DELETE" }); refresh(); toast("Income source deleted");
  }
  return (
    <>
      <div className="stack" style={{ gap: 16 }} data-tour="income">
      {data.totals.map((t: any) => (
        <div className="grid-2" key={t.currency}>
          <div className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s7)", width: 30, height: 30 }}><Icon name="cap" /></span><span className="headline">Scholarships</span></div>
            <div className="between" style={{ alignItems: "flex-end" }}>
              <div><div className="footnote muted">Received</div><div className="hero" style={{ fontSize: 32, lineHeight: "38px" }}>{formatMoney(t.scholarshipReceived, t.currency)}</div></div>
              <div style={{ textAlign: "right" }}><div className="footnote muted">Still expected</div><div className="headline num">{formatMoney(t.scholarshipOutstanding, t.currency)}</div></div>
            </div>
          </div>
          <div className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s3)", width: 30, height: 30 }}><Icon name="in" /></span><span className="headline">Other income</span></div>
            <div className="between" style={{ alignItems: "flex-end" }}>
              <div><div className="footnote muted">Received</div><div className="hero" style={{ fontSize: 32, lineHeight: "38px" }}>{formatMoney(t.otherReceived, t.currency)}</div></div>
              <div style={{ textAlign: "right" }}><div className="footnote muted">Still expected</div><div className="headline num">{formatMoney(t.otherOutstanding, t.currency)}</div></div>
            </div>
          </div>
        </div>
      ))}
      {data.sources.length === 0 && (
        <div className="card"><Empty icon="cap" title="No income recorded">
          <p className="subhead">Add a scholarship, allowance, family transfer or part-time job, with the dates you expect to be paid.</p>
          <button className="btn primary small" onClick={() => setAddSource(true)}>Add income</button>
        </Empty></div>
      )}
      </div>
      {data.sources.length > 0 && <Notice>Only money marked as received is counted. Expected payments are a schedule, and refunds are never income.</Notice>}
      {data.sources.map((s: any) => {
        const [label, icon, slot] = KIND[s.kind] ?? KIND.other;
        return (
          <section key={s.id}>
            <div className="between section-label" style={{ paddingRight: 4 }}>
              <span>{label}{s.recurrence !== "none" ? ` · ${s.recurrence}` : ""}</span>
              <button className="btn plain small" style={{ minHeight: 18, color: "var(--negative)", textTransform: "none" }} onClick={() => removeSource(s)}>Delete</button>
            </div>
            <div className="list">
              <div className="cell">
                <span className="tx-icon" style={{ ["--tint" as any]: slotColor(slot) }}><Icon name={icon} /></span>
                <span className="grow"><span className="headline">{s.name}</span><span className="footnote muted" style={{ display: "block" }}>{formatMoney(s.receivedMinor, s.currency)} received · {formatMoney(s.outstandingMinor, s.currency)} outstanding</span>
                  {s.receivedMinor + s.outstandingMinor > 0 && <span className="progress thin" style={{ display: "block", marginTop: 8 }} aria-label="Share received"><i style={{ width: `${(s.receivedMinor / (s.receivedMinor + s.outstandingMinor)) * 100}%`, background: slotColor(slot) }} /></span>}</span>
              </div>
              {s.payments.map((p: any) => {
                const [cls, text] = STATUS[p.status];
                return (
                  <button className="cell" key={p.id} onClick={() => setPayment({ source: s, payment: p })}>
                    <span className="grow">
                      <span className="row" style={{ gap: 8 }}><span>{p.expectedDate ? fmtDate(p.expectedDate) : p.receivedDate ? fmtDate(p.receivedDate) : "No date"}</span><span className={`badge ${cls}`}>{text}</span></span>
                      <span className="footnote muted" style={{ display: "block" }}>
                        {p.receivedMinor > 0 ? `Received ${formatMoney(p.receivedMinor, s.currency)} on ${fmtDate(p.receivedDate)}` : `Expected ${formatMoney(p.expectedMinor, s.currency)}`}
                        {p.receivedMinor > 0 && p.outstandingMinor > 0 ? ` · ${formatMoney(p.outstandingMinor, s.currency)} outstanding` : ""}{p.note ? ` · ${p.note}` : ""}
                      </span>
                    </span>
                    <span className="tx-amount" style={{ color: p.receivedMinor > 0 ? "var(--positive)" : "var(--label-2)" }}>{formatMoney(p.receivedMinor > 0 ? p.receivedMinor : p.expectedMinor, s.currency)}</span>
                    <Icon name="chevron" className="chev" />
                  </button>
                );
              })}
              <button className="cell" style={{ color: "var(--accent)" }} onClick={() => setPayment({ source: s, payment: null })}><Icon name="plus" style={{ width: 20, height: 20 }} />Add payment</button>
            </div>
          </section>
        );
      })}
      {data.sources.length > 0 && <button className="btn tinted block" onClick={() => setAddSource(true)}><Icon name="plus" />Add income source</button>}
      {addSource && <SourceSheet onClose={() => setAddSource(false)} />}
      {payment && <PaymentSheet {...payment} onClose={() => setPayment(null)} />}
    </>
  );
}

function SourceSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, refresh } = useApp();
  const [f, setF] = useState({ kind: "scholarship", name: "", currency: user.baseCurrency, recurrence: "monthly", amount: "", firstDate: "", occurrences: "12" });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try { await api("/income/sources", { body: f }); refresh(); toast("Income added"); sheet.dismiss(); } catch (e: any) { setError(e.message); }
  }
  return (
    <Sheet closeRef={sheet.ref} title="New income" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Add</button>}>
      <Field label="Type"><select className="input" value={f.kind} onChange={set("kind")}>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Name"><input className="input" value={f.name} onChange={set("name")} placeholder={f.kind === "scholarship" ? "Name of the scholarship" : "e.g. Monthly allowance"} autoFocus /></Field>
      <div className="form-row" style={{ gridTemplateColumns: "1fr 110px" }}>
        <Field label="Amount per payment"><input className="input num" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="Optional" /></Field>
        <Field label="Currency"><select className="input" value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <div className="form-row">
        <Field label="Repeats"><select className="input" value={f.recurrence} onChange={set("recurrence")}><option value="none">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></Field>
        <Field label="First expected date"><input className="input" type="date" value={f.firstDate} onChange={set("firstDate")} /></Field>
      </div>
      {f.recurrence !== "none" && <Field label="Number of payments to schedule"><input className="input num" inputMode="numeric" value={f.occurrences} onChange={set("occurrences")} /></Field>}
      <p className="footnote muted">With an amount and a first date, Folio lists the payments you expect. None of them count as received until you mark them.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

function PaymentSheet({ source, payment, onClose }: { source: any; payment: any | null; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { refresh } = useApp();
  const amt = (n: number) => (n ? String(fromMinor(n, source.currency)) : "");
  const [f, setF] = useState({ expectedDate: payment?.expectedDate ?? "", expected: amt(payment?.expectedMinor ?? 0), received: amt(payment?.receivedMinor ?? 0), receivedDate: payment?.receivedDate ?? "", note: payment?.note ?? "" });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save(body: any = f) {
    try { await api(payment ? `/income/payments/${payment.id}` : "/income/payments", { method: payment ? "PATCH" : "POST", body: { ...body, sourceId: source.id } }); refresh(); toast("Saved"); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }
  async function remove() { await api(`/income/payments/${payment.id}`, { method: "DELETE" }); refresh(); toast("Payment deleted"); sheet.dismiss(); }
  return (
    <Sheet closeRef={sheet.ref} title={source.name} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={() => save()}>Save</button>}>
      <div className="form-row">
        <Field label={`Expected (${source.currency})`}><input className="input num" inputMode="decimal" value={f.expected} onChange={set("expected")} placeholder="0" /></Field>
        <Field label="Expected date"><input className="input" type="date" value={f.expectedDate} onChange={set("expectedDate")} /></Field>
      </div>
      <div className="form-row">
        <Field label={`Received (${source.currency})`}><input className="input num" inputMode="decimal" value={f.received} onChange={set("received")} placeholder="Nothing yet" /></Field>
        <Field label="Received date"><input className="input" type="date" value={f.receivedDate} onChange={set("receivedDate")} /></Field>
      </div>
      {payment && payment.outstandingMinor > 0 && <button className="btn tinted block" onClick={() => save({ ...f, received: f.expected, receivedDate: f.receivedDate || todayIso() })}><Icon name="check" />Mark full amount received{f.receivedDate ? "" : " today"}</button>}
      <Field label="Note"><input className="input" value={f.note} onChange={set("note")} placeholder="Optional" /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      {payment && <button className="btn danger block" onClick={remove}><Icon name="trash" />Delete payment</button>}
    </Sheet>
  );
}
