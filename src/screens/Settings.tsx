import { useState } from "react";
import { api, type Category } from "../api.ts";
import { useApp } from "../ctx.ts";
import { CURRENCIES } from "../../shared/money.ts";
import { fmtDate, formatMoney, slotColor } from "../format.ts";
import { Icon } from "../ui/Icon.tsx";
import { LogoMark } from "../ui/Logo.tsx";
import { Field, Segmented, setTheme, Sheet, toast, useLoad, useSheetClose, confirmAction } from "../ui/kit.tsx";
import { CategorySheet } from "./Plan.tsx";
import { Reveal } from "../ui/Reveal.tsx";

export function Settings() {
  const { user, setUser, accounts, categories, version, refresh, openAccount, openImport, startTour } = useApp();
  const [theme, setTheme_] = useState(localStorage.getItem("folio-theme") ?? "system");
  const [cat, setCat] = useState<Category | "new" | null>(null);
  const [sheet, setSheet] = useState<"profile" | "password" | "market" | "ai" | "fx" | "categories" | null>(null);
  const rules = useLoad(() => api("/categories"), [version]);
  const fx = useLoad(() => api("/fx"), [version]);

  function applyTheme(t: string) { setTheme_(t); setTheme(t as any); }
  async function signOut() { await api("/auth/logout", { method: "POST" }); setUser(null); }
  async function exportData() {
    const data = await api("/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `folio-export-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }
  async function deleteAccount() {
    if (!(await confirmAction({ title: "Delete your account?", message: "This permanently deletes your account and every record in it. It cannot be undone.", confirm: "Delete Account", destructive: true, requireText: "DELETE" }))) return;
    await api("/me", { method: "DELETE" }); setUser(null);
  }
  const Row = ({ icon, tint, title, value, onClick }: { icon: string; tint: string; title: string; value?: string; onClick: () => void }) => (
    <button className="cell" onClick={onClick}><span className="tx-icon" style={{ ["--tint" as any]: tint, width: 30, height: 30, borderRadius: 8 }}><Icon name={icon} style={{ width: 17, height: 17 }} /></span><span className="grow">{title}</span>{value && <span className="value subhead">{value}</span>}<Icon name="chevron" className="chev" /></button>
  );

  return (
    <div className="screen">
      <header className="screen-head"><Reveal as="h1" className="large-title" text="Settings" once="title-settings" /></header>

      <div className="list">
        <button className="cell" onClick={() => setSheet("profile")} style={{ padding: "14px 16px" }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: 22 }}>{user.name[0]?.toUpperCase()}</span>
          <span className="grow"><span className="title" style={{ fontSize: 20 }}>{user.name}</span><span className="footnote muted" style={{ display: "block" }}>{user.email} · budgets in {user.baseCurrency}</span></span>
          <Icon name="chevron" className="chev" />
        </button>
      </div>

      <section>
        <div className="section-label">Appearance</div>
        <div className="card"><Segmented label="Theme" value={theme} onChange={applyTheme} options={[{ value: "system", label: "Automatic" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></div>
      </section>

      <div className="grid-2">
        <section>
          <div className="section-label">Accounts</div>
          <div className="list">
            {accounts.map((a) => (
              <button className="cell" key={a.id} onClick={() => openAccount(a)}>
                <span className={`pay-card ${a.theme}`} style={{ width: 40, height: 26, aspectRatio: "auto", borderRadius: 6, padding: 0, flex: "none" }} />
                <span className="grow"><span className="truncate" style={{ display: "block" }}>{a.name}</span><span className="footnote muted">{a.last4 ? `•••• ${a.last4} · ` : ""}{a.balanceMinor != null ? formatMoney(a.balanceMinor, a.currency) : "Balance unavailable"}</span></span>
                <Icon name="chevron" className="chev" />
              </button>
            ))}
            <button className="cell" style={{ color: "var(--accent)" }} onClick={() => openAccount("new")}><Icon name="plus" style={{ width: 20, height: 20 }} />Add account</button>
          </div>
        </section>

        <section>
          <div className="section-label">Connections</div>
          <div className="list">
            <Row icon="trend" tint="var(--s1)" title="Market data (Alpha Vantage)" value={user.hasMarketKey ? "Connected" : "Not set"} onClick={() => setSheet("market")} />
            <Row icon="spark" tint="var(--s7)" title="AI answers (Claude)" value={user.hasAssistantKey ? "Connected" : "Off"} onClick={() => setSheet("ai")} />
            <Row icon="tray" tint="var(--s3)" title="Bank message import" value={user.hasIngestToken ? "Token active" : ""} onClick={() => openImport()} />
            <Row icon="swap" tint="var(--s4)" title="Exchange rates" value={fx.data?.rates.length ? `${fx.data.rates.length} set` : "None"} onClick={() => setSheet("fx")} />
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section>
          <div className="section-label">Organise</div>
          <div className="list">
            <Row icon="pie" tint="var(--s5)" title="Categories and budgets" value={`${categories.length}`} onClick={() => setSheet("categories")} />
            <Row icon="repeat" tint="var(--s3)" title="Learned merchants" value={`${rules.data?.rules.length ?? 0}`} onClick={() => setSheet("categories")} />
            <Row icon="spark" tint="var(--s1)" title="Replay the tour" onClick={startTour} />
          </div>
        </section>

        <div className="stack" style={{ gap: 24 }}>
          <section>
            <div className="section-label">Security and data</div>
            <div className="list">
              <Row icon="shield" tint="var(--s6)" title="Change password" onClick={() => setSheet("password")} />
              <Row icon="tray" tint="var(--s0)" title="Export my data" onClick={exportData} />
              <Row icon="out" tint="var(--s0)" title="Sign out" onClick={signOut} />
              <button className="cell" style={{ color: "var(--negative)" }} onClick={deleteAccount}>Delete account and all data</button>
            </div>
            <p className="caption faint" style={{ padding: "8px 16px 0" }}>Passwords are hashed with scrypt, API keys are encrypted at rest, and every record is tied to your account. Folio stores only the last four digits of a card.</p>
          </section>
        </div>
      </div>


      {cat && <CategorySheet category={cat} onClose={() => setCat(null)} />}
      {sheet === "profile" && <ProfileSheet onClose={() => setSheet(null)} />}
      {sheet === "password" && <PasswordSheet onClose={() => setSheet(null)} />}
      {sheet === "market" && <KeySheet field="alphaVantage" title="Market data" has={user.hasMarketKey} onClose={() => setSheet(null)}
        blurb="Folio loads share prices, news and earnings dates from Alpha Vantage using your own key. A free key allows about 25 requests a day, so prices are saved and refreshed a few times daily. Get a key at alphavantage.co." />}
      {sheet === "ai" && <KeySheet field="anthropic" title="AI answers" has={user.hasAssistantKey} onClose={() => setSheet(null)}
        blurb="Without a key, the assistant answers common questions directly from your records. With an Anthropic API key, questions it cannot answer that way are sent to Claude together with a summary of your records (totals, recent transactions, income and holdings — never passwords, card numbers or the original bank messages). Those answers are labelled AI-generated. If Claude declines a request, the API retries it once on a fallback model." />}
      {sheet === "fx" && <FxSheet data={fx.data} onClose={() => setSheet(null)} />}
      {sheet === "categories" && <CategoriesSheet rules={rules.data?.rules ?? []} onClose={() => setSheet(null)} onOpen={(c) => { setSheet(null); setTimeout(() => setCat(c), 260); }} />}
    </div>
  );
}

function ProfileSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, setUser, refresh } = useApp();
  const [name, setName] = useState(user.name), [base, setBase] = useState(user.baseCurrency), [error, setError] = useState("");
  async function save() {
    try {
      const body: any = { name, baseCurrency: base };
      if (base !== user.baseCurrency) body.monthlyBudget = null; // a budget in the old currency no longer applies
      const r = await api("/me", { method: "PATCH", body }); setUser(r.user); refresh(); toast("Saved"); sheet.dismiss();
    } catch (e: any) { setError(e.message); }
  }
  return (
    <Sheet closeRef={sheet.ref} title="Profile" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Main currency for budgets"><select className="input" value={base} onChange={(e) => setBase(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      {base !== user.baseCurrency && <p className="footnote muted">Changing the main currency clears your monthly budget; category limits keep their numbers and are read in {base}.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [error, setError] = useState("");
  async function save() { try { await api("/me/password", { body: { current, next } }); toast("Password changed. Other devices were signed out."); sheet.dismiss(); } catch (e: any) { setError(e.message); } }
  return (
    <Sheet closeRef={sheet.ref} title="Change password" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password (10 characters or more)"><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
function KeySheet({ field, title, blurb, has, onClose }: { field: string; title: string; blurb: string; has: boolean; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { setUser, refresh } = useApp();
  const [key, setKey] = useState(""), [error, setError] = useState("");
  async function save(value: string | null) { try { const r = await api("/me/keys", { method: "PUT", body: { [field]: value } }); setUser(r.user); refresh(); toast(value ? "Key saved" : "Key removed"); sheet.dismiss(); } catch (e: any) { setError(e.message); } }
  return (
    <Sheet closeRef={sheet.ref} title={title} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} disabled={!key.trim()} onClick={() => save(key)}>Save</button>}>
      <p className="subhead muted">{blurb}</p>
      <Field label={has ? "Replace API key" : "API key"}><input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={has ? "A key is saved (hidden)" : "Paste your key"} /></Field>
      <p className="caption faint">The key is encrypted on the server and never shown again or sent to your browser.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {has && <button className="btn danger block" onClick={() => save(null)}>Remove key</button>}
    </Sheet>
  );
}
function FxSheet({ data, onClose }: { data: any; onClose: () => void }) {
  const { user, refresh } = useApp();
  const [ccy, setCcy] = useState(CURRENCIES.find((c) => c !== user.baseCurrency)!), [rate, setRate] = useState(""), [error, setError] = useState("");
  async function add() { try { await api(`/fx/${ccy}`, { method: "PUT", body: { rate } }); setRate(""); refresh(); toast("Rate saved"); } catch (e: any) { setError(e.message); } }
  return (
    <Sheet title="Exchange rates" onClose={onClose}>
      <p className="subhead muted">Spending in another currency is added to your {user.baseCurrency} budget only if you set a rate here, and is then marked as an estimate. Folio does not guess rates.</p>
      <div className="list">
        {(data?.rates ?? []).map((r: any) => (
          <div className="cell" key={r.currency}><span className="grow num">1 {r.currency} = {r.rate} {user.baseCurrency}<span className="footnote muted" style={{ display: "block" }}>Set {fmtDate(r.updatedAt)}</span></span>
            <button className="icon-btn" aria-label={`Remove ${r.currency} rate`} style={{ color: "var(--negative)" }} onClick={async () => { await api(`/fx/${r.currency}`, { method: "DELETE" }); refresh(); }}><Icon name="trash" /></button></div>
        ))}
        {data?.rates.length === 0 && <div className="cell subhead muted">No rates set.</div>}
      </div>
      <div className="form-row" style={{ gridTemplateColumns: "110px 1fr auto", alignItems: "end" }}>
        <Field label="Currency"><select className="input" value={ccy} onChange={(e) => setCcy(e.target.value)}>{CURRENCIES.filter((c) => c !== user.baseCurrency).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label={`1 ${ccy} in ${user.baseCurrency}`}><input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate" /></Field>
        <button className="btn tinted" disabled={!rate} onClick={add}>Set</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

/** Categories and the merchants Folio has learned, kept out of the main Settings list. */
function CategoriesSheet({ rules, onClose, onOpen }: { rules: any[]; onClose: () => void; onOpen: (c: Category | "new") => void }) {
  const { user, categories, refresh } = useApp();
  return (
    <Sheet title="Categories" cancelLabel="Done" onClose={onClose}>
      <div className="list">
        {categories.map((c) => (
          <button className="cell" key={c.id} onClick={() => onOpen(c)}>
            <span className="tx-icon" style={{ ["--tint" as any]: slotColor(c.slot), width: 30, height: 30 }}><Icon name={c.icon} style={{ width: 17, height: 17 }} /></span>
            <span className="grow truncate">{c.name}</span>
            <span className="value subhead">{c.kind === "transfer" ? "Not spending" : c.budgetMinor != null ? formatMoney(c.budgetMinor, user.baseCurrency) : ""}</span>
            <Icon name="chevron" className="chev" />
          </button>
        ))}
        <button className="cell" onClick={() => onOpen("new")}><Icon name="plus" style={{ width: 20, height: 20 }} />Add category</button>
      </div>
      <div className="section-label" style={{ paddingTop: 8 }}>Learned merchants</div>
      <div className="list">
        {rules.map((r: any) => (
          <div className="cell" key={r.id}>
            <span className="grow"><span>{r.merchant}</span><span className="footnote muted" style={{ display: "block" }}>Always filed under {r.category}</span></span>
            <button className="icon-btn" aria-label={`Forget ${r.merchant}`} style={{ color: "var(--negative)" }} onClick={async () => { await api(`/rules/${r.id}`, { method: "DELETE" }); refresh(); toast("Rule removed"); }}><Icon name="trash" /></button>
          </div>
        ))}
        {rules.length === 0 && <div className="cell subhead muted">When you change a transaction's category, Folio remembers the merchant and lists it here.</div>}
      </div>
    </Sheet>
  );
}
