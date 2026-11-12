import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Account, type Txn } from "../api.ts";
import { useApp } from "../ctx.ts";
import { CURRENCIES, decimals, fromMinor } from "../../shared/money.ts";
import { SAMPLE_MESSAGES } from "../../shared/sms.ts";
import { fmtDate, formatMoney, slotColor, todayIso } from "../format.ts";
import { txnAmount, txnCard, txnCategory, txnIcon } from "../ui/TxnRow.tsx";
import { Field, Notice, Segmented, Sheet, toast, useLoad, useSheetClose, confirmAction, hideRow } from "../ui/kit.tsx";
import { Icon } from "../ui/Icon.tsx";
import { WalletCard } from "../ui/WalletCard.tsx";

const TYPES = [{ value: "expense", label: "Expense" }, { value: "refund", label: "Refund" }, { value: "income", label: "Money in" }, { value: "transfer", label: "Transfer" }] as const;

// ---------------------------------------------------------------- transaction
export function TxnSheet({ txn, onClose }: { txn: Txn | "new"; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, accounts, categories, refresh } = useApp();
  const t = txn === "new" ? null : txn;
  // Existing: details first. New: amount keypad first, then details.
  const [mode, setMode] = useState<"view" | "amount" | "edit">(t ? "view" : "amount");
  const [f, setF] = useState({
    type: t?.type ?? "expense", amount: t ? String(fromMinor(t.amountMinor, t.currency)) : "", currency: t?.currency ?? user.baseCurrency,
    merchant: t?.merchant ?? "", date: t?.date ?? todayIso(), time: t?.time?.slice(0, 5) ?? "", categoryId: t?.categoryId ? String(t.categoryId) : "",
    accountId: t?.accountId ? String(t.accountId) : accounts.length === 1 ? String(accounts[0].id) : "", transferAccountId: t?.transferAccountId ? String(t.transferAccountId) : "", note: t?.note ?? "",
  });
  const [learn, setLearn] = useState(true);
  const [error, setError] = useState("");
  const [dup, setDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const sources = useLoad(() => (t?.type === "income" && !t.incomeLinked ? api("/income") : Promise.resolve({ sources: [] })), [t?.id]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const cats = categories.filter((c) => (f.type === "transfer" ? c.kind === "transfer" : c.kind === "expense"));
  const categoryChanged = !!t && f.categoryId !== "" && Number(f.categoryId) !== t.categoryId && f.type !== "income";
  const dec = decimals(f.currency);
  const amountOk = Number(f.amount) > 0;
  // Typed amount with thousands separators, keeping a trailing decimal point while typing.
  const [whole, frac] = (f.amount || "0").split(".");
  const shown = formatMoney(0, f.currency).replace(/[\d.,]+/, "") + Number(whole || 0).toLocaleString("en-US") + (frac !== undefined ? `.${frac}` : "");

  function key(k: string) {
    setF((p) => {
      let a = p.amount;
      if (k === "del") a = a.slice(0, -1);
      else if (k === ".") { if (dec && !a.includes(".")) a = (a || "0") + "."; }
      else if (a.includes(".") ? a.split(".")[1].length < dec : a.replace(/^0+/, "").length < 10) a = a === "0" ? k : a + k;
      return { ...p, amount: a };
    });
  }
  async function save(force = false) {
    setBusy(true); setError(""); setDup(false);
    const body: any = { type: f.type, amount: f.amount, currency: f.currency, merchant: f.merchant, date: f.date, time: f.time || null, note: f.note, accountId: f.accountId ? Number(f.accountId) : null };
    if (f.type === "transfer") body.transferAccountId = f.transferAccountId ? Number(f.transferAccountId) : null;
    // Leave the category to Folio on a new entry unless the user picked one.
    if (f.type !== "income" && (t || f.categoryId)) body.categoryId = f.categoryId ? Number(f.categoryId) : null;
    if (categoryChanged) body.learn = learn;
    if (force) body.force = true;
    try {
      const r = await api(t ? `/transactions/${t.id}` : "/transactions", { method: t ? "PATCH" : "POST", body });
      toast(t ? (r.alsoUpdated ? `Saved. ${r.alsoUpdated} more from ${f.merchant} updated.` : "Saved") : `Added to ${r.transaction.categoryName ?? "your activity"}`);
      refresh(); sheet.dismiss();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setDup(true);
      setError(e.message);
    } finally { setBusy(false); }
  }
  async function recategorise(id: number) {
    try {
      const r = await api(`/transactions/${t!.id}`, { method: "PATCH", body: { categoryId: id } });
      toast(r.alsoUpdated ? `Moved, with ${r.alsoUpdated} more from ${t!.merchant}` : `Moved. Folio will remember ${t!.merchant}.`);
      refresh(); sheet.dismiss();
    } catch (e: any) { setError(e.message); }
  }
  /** Deleting is undoable for five seconds, so it needs no confirmation (alerts.md: no alerts for undoable actions). */
  function remove() {
    if (!t) return;
    const id = t.id;
    hideRow(id, true);
    sheet.dismiss();
    const timer = setTimeout(async () => {
      try { await api(`/transactions/${id}`, { method: "DELETE" }); refresh(); }
      catch (e: any) { toast(e.message); }
      finally { hideRow(id, false); }
    }, 5000);
    toast(`Deleted ${t.merchant}`, { label: "Undo", onClick: () => { clearTimeout(timer); hideRow(id, false); } }, 5000);
  }
  async function linkIncome() {
    try { await api(`/transactions/${t!.id}/link-income`, { body: { sourceId: Number(sourceId) } }); toast("Recorded as income"); refresh(); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }

  // ---------- details (read) ----------
  if (t && mode === "view") {
    const tint = t.type === "income" || t.type === "refund" ? "var(--positive)" : slotColor(t.type === "transfer" ? 0 : t.categorySlot);
    const status = { expense: "Spent", refund: "Refunded", income: t.incomeLinked ? "Income received" : "Money in", transfer: "Moved · not counted as spending" }[t.type];
    const rows: [string, string | null][] = [
      ["Status", status], ["Where", t.merchant], ["Date", `${fmtDate(t.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}${t.dateInferred ? " (assumed)" : ""}`],
      ["Time", t.time ? `${t.time.slice(0, 5)}${t.tz ? ` ${t.tz}` : ""}` : null], [t.type === "transfer" ? "Route" : "Paid with", txnCard(t)],
      ["Category", t.type === "income" ? null : txnCategory(t)], ["Card", t.last4 ? `•••• ${t.last4}` : null], ["Amount", `${formatMoney(t.amountMinor, t.currency)} ${t.currency}`], ["Shown by bank as", t.rawDescriptor && t.rawDescriptor !== t.merchant ? t.rawDescriptor : null],
      ["Repeats", t.recurring ? "Looks recurring (estimate)" : null], ["Note", t.note], ["Source", t.source === "manual" ? "Entered by you" : "Bank message"],
    ];
    return (
      <Sheet closeRef={sheet.ref} title="Details" cancelLabel="Done" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 600 }} onClick={() => setMode("edit")}>Edit</button>}>
        <div className="detail-hero">
          <span className="tx-icon xl" style={{ ["--tint" as any]: tint }}><Icon name={txnIcon(t)} /></span>
          <div className="headline">{t.merchant}</div>
          <div className={`amount-xl ${t.type === "income" || t.type === "refund" ? "pos" : ""}`}>{txnAmount(t)}</div>
          <div className="footnote muted">{txnCategory(t)}</div>
          {t.needsReview && <span className="badge estimate">Needs review</span>}
        </div>
        <div className="list rows">
          {rows.filter(([, v]) => v).map(([k, v]) => <div className="cell" key={k}><span className="muted">{k}</span><span className="value">{v}</span></div>)}
        </div>
        {t.type !== "income" && t.type !== "transfer" && (
          <div>
            <div className="footnote muted" style={{ padding: "0 4px 8px" }}>Wrong category? Pick one and Folio remembers it for {t.merchant}.</div>
            <div className="chips">{cats.filter((c) => c.id !== t.categoryId).map((c) => <button key={c.id} className="chip" onClick={() => recategorise(c.id)}><Icon name={c.icon} style={{ width: 14, height: 14, color: slotColor(c.slot) }} />{c.name}</button>)}</div>
          </div>
        )}
        {t.type === "income" && !t.incomeLinked && (sources.data?.sources.length ?? 0) > 0 && (
          <div className="card stack">
            <span className="footnote muted">This money is not counted as income until you say where it came from.</span>
            <div className="row">
              <select className="input grow" value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Income source">
                <option value="">Choose a source</option>
                {sources.data!.sources.filter((x: any) => x.currency === t.currency).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button className="btn primary" disabled={!sourceId} onClick={linkIncome}>Record</button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {t.rawSms && <details className="card footnote muted"><summary style={{ cursor: "pointer" }}>Original bank message</summary><p style={{ marginTop: 8, overflowWrap: "anywhere" }}>{t.rawSms}</p></details>}
        <div className="duo"><button className="btn gray" onClick={() => setMode("edit")}><Icon name="pencil" />Edit</button><button className="btn gray" style={{ color: "var(--negative)" }} onClick={remove}><Icon name="trash" />Delete</button></div>
      </Sheet>
    );
  }

  // ---------- new: amount keypad ----------
  if (mode === "amount") {
    const acct = accounts.find((a) => String(a.id) === f.accountId);
    const go = (type: "expense" | "income" | "transfer") => { setF({ ...f, type, categoryId: "" }); setMode("edit"); };
    return (
      <Sheet closeRef={sheet.ref} title="New transaction" onClose={onClose}>
        <div className="keypad-amount">
          <div className="amount-xl" aria-live="polite">{shown}</div>
          <div className="row" style={{ justifyContent: "center", gap: 8 }}>
            <select className="pill-select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value, amount: "" })} aria-label="Currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            <select className="pill-select" value={f.accountId} onChange={set("accountId")} aria-label="Account">
              <option value="">No account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ••${a.last4}` : ""}</option>)}
            </select>
          </div>
          {acct && <div className="caption faint">{acct.balanceMinor != null ? `Balance ${formatMoney(acct.balanceMinor, acct.currency)}` : "Balance unavailable"}</div>}
        </div>
        <div className="keypad" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
            <button key={k} onClick={() => key(k)} aria-label={k === "del" ? "Delete" : k} disabled={k === "." && !dec}>{k === "del" ? <Icon name="back" /> : k}</button>
          ))}
        </div>
        <div className="duo"><button className="btn gray" disabled={!amountOk} onClick={() => go("income")}>Money in</button><button className="btn primary" disabled={!amountOk} onClick={() => go("expense")}>Spent</button></div>
        <button className="btn plain small" disabled={!amountOk} onClick={() => go("transfer")}>Transfer or top-up instead</button>
      </Sheet>
    );
  }

  // ---------- edit / finish new ----------
  return (
    <Sheet closeRef={sheet.ref} title={t ? "Edit transaction" : "Details"} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} disabled={busy} onClick={() => save()}>{t ? "Save" : "Add"}</button>}>
      <button className="detail-hero" onClick={() => !t && setMode("amount")} disabled={!!t} aria-label="Change amount">
        <div className="amount-xl">{shown}</div>
        <div className="footnote muted">{TYPES.find((x) => x.value === f.type)?.label}{!t ? " · tap to change amount" : ""}</div>
      </button>
      <Segmented label="Type" value={f.type} onChange={(type) => setF({ ...f, type, categoryId: "" })} options={TYPES as any} />
      <div className="list rows">
        {t && <label className="cell"><span>Amount</span><span className="row" style={{ gap: 6 }}><input className="num" inputMode="decimal" value={f.amount} onChange={set("amount")} aria-label="Amount" /><select value={f.currency} onChange={set("currency")} aria-label="Currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></span></label>}
        <label className="cell"><span>{f.type === "income" ? "From" : f.type === "transfer" ? "Description" : "Merchant"}</span><input value={f.merchant} onChange={set("merchant")} placeholder={f.type === "transfer" ? "Mobile Suica top-up" : "Starbucks"} autoFocus={!t} /></label>
        <label className="cell"><span>Date</span><input type="date" value={f.date} onChange={set("date")} /></label>
        <label className="cell"><span>Time{t?.tz ? ` (${t.tz})` : ""}</span><input type="time" value={f.time} onChange={set("time")} /></label>
      </div>
      {t?.dateInferred && <Notice>The bank message had no date, so the day it was imported was used. Check it.</Notice>}
      <div className="list rows">
        {f.type !== "income" && (
          <label className="cell"><span>Category</span>
            <select value={f.categoryId} onChange={set("categoryId")}><option value="">{t ? "No category" : "Automatic"}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        <label className="cell"><span>{f.type === "transfer" ? "From" : f.type === "income" || f.type === "refund" ? "Into" : "Paid with"}</span>
          <select value={f.accountId} onChange={set("accountId")}><option value="">Not specified</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ••${a.last4}` : ""}</option>)}</select>
        </label>
        {f.type === "transfer" && (
          <label className="cell"><span>To</span>
            <select value={f.transferAccountId} onChange={set("transferAccountId")}><option value="">Not specified</option>{accounts.filter((a) => String(a.id) !== f.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
        )}
        <label className="cell"><span>Note</span><input value={f.note} onChange={set("note")} placeholder="Optional" /></label>
      </div>
      {f.type === "transfer" && <p className="caption faint" style={{ padding: "0 4px", marginTop: -8 }}>Transfers and top-ups move money and are not counted as spending. Record what you spend from the wallet as separate expenses.</p>}
      {categoryChanged && (
        <label className="row footnote" style={{ gap: 10, padding: "0 4px" }}>
          <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--accent)" }} />
          <span>Always file <b>{f.merchant}</b> here, including past transactions</span>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {dup && <button className="btn gray block" onClick={() => save(true)}>Add anyway</button>}
      <button className="btn primary block" disabled={busy} onClick={() => save()}>{t ? "Save changes" : "Add transaction"}</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- SMS import
const STATUS: Record<string, [string, string]> = { new: ["verified", "New"], duplicate: ["", "Duplicate"], ignored: ["", "Ignored"], balance: ["estimate", "Balance only"] };

export function ImportSheet({ initialText, onClose }: { initialText?: string; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { refresh, user, setUser } = useApp();
  const [mode, setMode] = useState<"paste" | "file" | "auto">("paste");
  const [text, setText] = useState(initialText ?? "");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const payload = mode === "file" ? (file ? { file } : null) : text.trim() ? { text } : null;

  // Live preview: nothing is saved until Import is pressed.
  useEffect(() => {
    clearTimeout(timer.current);
    if (mode === "auto") return;
    if (!payload) { setItems(null); setError(""); return; }
    timer.current = setTimeout(() => api("/sms/preview", { body: payload }).then((r) => { setItems(r.items); setError(""); }).catch((e) => { setItems(null); setError(e.message); }), 350);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, file, mode]);

  const fresh = items?.filter((i) => i.status === "new").length ?? 0, balances = items?.filter((i) => i.status === "balance").length ?? 0;
  async function run() {
    setBusy(true);
    try {
      const r = await api("/sms/import", { body: payload });
      toast(`${r.imported} added${r.duplicates ? ` · ${r.duplicates} duplicate${r.duplicates > 1 ? "s" : ""} skipped` : ""}${r.ignored ? ` · ${r.ignored} ignored` : ""}`);
      refresh(); sheet.dismiss();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function makeToken() { const r = await api("/me/ingest-token", { method: "POST" }); setToken(r.token); setUser({ ...user, hasIngestToken: true }); }
  async function revoke() { await api("/me/ingest-token", { method: "DELETE" }); setToken(""); setUser({ ...user, hasIngestToken: false }); toast("Token revoked"); }
  const endpoint = `${location.origin}/api/ingest/sms`;

  return (
    <Sheet closeRef={sheet.ref} title="Import bank messages" onClose={onClose}>
      <Segmented label="Import method" value={mode} onChange={setMode} options={[{ value: "paste", label: "Paste" }, { value: "file", label: "File" }, { value: "auto", label: "Automatic" }]} />
      {mode === "paste" && (
        <>
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste one or more bank SMS messages, one per line." aria-label="Bank messages" autoFocus />
          <div className="between">
            <span className="caption faint">Only what you paste is read.</span>
            <button className="btn plain small" onClick={() => setText(SAMPLE_MESSAGES.join("\n"))}>Use example messages</button>
          </div>
        </>
      )}
      {mode === "file" && (
        <>
          <label className="btn gray block" style={{ cursor: "pointer" }}>
            <Icon name="tray" />{file ? file.name : "Choose a file"}
            <input type="file" className="sr" accept=".txt,.csv,.json,.xml,text/plain,application/json,text/xml" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setFile({ name: fl.name, content: await fl.text() }); }} />
          </label>
          <p className="caption faint">Plain text (one message per line), a JSON list, or an XML export from an Android SMS backup app.</p>
        </>
      )}
      {mode === "auto" && (
        <div className="stack">
          <Notice>A website cannot read your text messages — browsers on iPhone and Android do not allow it. These are the ways to get messages into Folio without pasting each one.</Notice>
          <div className="list">
            <div className="cell" style={{ alignItems: "flex-start" }}><span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s1)" }}><Icon name="up" /></span><div><div className="headline">Share from Messages (Android)</div><div className="footnote muted">Install Folio to your home screen from Chrome, then select a message, tap Share and choose Folio. It opens here ready to import.</div></div></div>
            <div className="cell" style={{ alignItems: "flex-start" }}><span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s7)" }}><Icon name="bolt" /></span><div><div className="headline">Shortcuts automation (iPhone)</div><div className="footnote muted">In Shortcuts, create an automation “When I get a message” filtered to your bank's sender, with the action “Get contents of URL”: POST to the address below, header <b>Authorization: Bearer your-token</b>, JSON body <b>text</b> = Shortcut Input.</div></div></div>
            <div className="cell" style={{ alignItems: "flex-start" }}><span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s3)" }}><Icon name="repeat" /></span><div><div className="headline">SMS forwarder app (Android)</div><div className="footnote muted">Apps that forward SMS to a webhook can post to the same address. They hold the SMS permission on your phone; Folio only receives what they send.</div></div></div>
          </div>
          <div className="card stack">
            <span className="footnote muted">Your personal address</span>
            <code className="footnote" style={{ overflowWrap: "anywhere" }}>POST {endpoint}</code>
            {token
              ? <><code className="footnote" style={{ overflowWrap: "anywhere", padding: 10, borderRadius: 10, background: "var(--fill)" }}>{token}</code><span className="caption faint">Copy this token now. It is shown once and only a fingerprint of it is stored.</span></>
              : <span className="footnote">{user.hasIngestToken ? "A token is active. Create a new one if you have lost it; the old one stops working." : "No token yet."}</span>}
            <div className="row">
              <button className="btn tinted small" onClick={makeToken}>{user.hasIngestToken ? "Replace token" : "Create token"}</button>
              {user.hasIngestToken && <button className="btn danger small" onClick={revoke}>Revoke</button>}
            </div>
          </div>
          <p className="caption faint">A native Android app could request the READ_SMS permission directly; iOS offers no such permission to any app.</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {mode !== "auto" && items && (
        <>
          <div className="section-label" style={{ paddingBottom: 0 }}>{items.length} message{items.length === 1 ? "" : "s"} · {fresh} new</div>
          <div className="list">
            {items.map((it, i) => {
              const p = it.parsed, [cls, label] = STATUS[it.status];
              return (
                <div className="cell" key={i} style={{ alignItems: "flex-start", opacity: it.status === "new" || it.status === "balance" ? 1 : 0.6 }}>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="headline truncate">{p.merchant?.name ?? (p.class === "balance" ? "Balance notification" : p.class === "transaction" ? "Unknown merchant" : "Not a transaction")}</span>
                      <span className={`badge ${cls}`}>{label}</span>
                    </div>
                    {p.class === "transaction" && <div className="footnote muted">{it.category}{it.account ? ` · ${it.account}` : ""}</div>}
                    <div className="caption faint">
                      {it.reason ?? [p.date && fmtDate(p.date), p.time && `${p.time.slice(0, 5)}${p.tz ? ` ${p.tz}` : ""}`, p.type === "transfer" && "top-up, not spending"].filter(Boolean).join(" · ")}
                      {p.balanceMinor != null && it.status !== "duplicate" && ` · balance ${formatMoney(p.balanceMinor, p.balanceCurrency)}`}
                    </div>
                  </div>
                  {p.amountMinor != null && <span className="tx-amount">{formatMoney(p.amountMinor, p.currency)}</span>}
                </div>
              );
            })}
          </div>
          <button className="btn primary block" disabled={busy || (!fresh && !balances)} onClick={run}>
            {fresh ? `Import ${fresh} transaction${fresh === 1 ? "" : "s"}` : balances ? "Update balance" : "Nothing new to import"}
          </button>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- account
const THEMES = ["icici-student", "axis-privilege", "ember", "plum", "graphite", "ocean", "mint", "sand"];
export function AccountSheet({ account, onClose }: { account: Account | "new"; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { refresh, user } = useApp();
  const a = account === "new" ? null : account;
  const [f, setF] = useState({
    kind: a?.kind ?? "card", bank: a?.bank ?? "", name: a?.name ?? "", cardType: a?.cardType ?? "", last4: a?.last4 ?? "", currency: a?.currency ?? user.baseCurrency,
    theme: a?.theme ?? "graphite", balance: a?.balanceMinor != null ? String(fromMinor(a.balanceMinor, a.currency)) : "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const originalBalance = a?.balanceMinor != null ? String(fromMinor(a.balanceMinor, a.currency)) : "";
  async function save() {
    const body: any = { ...f, name: f.name || [f.bank, f.cardType].filter(Boolean).join(" ") };
    if (f.balance === originalBalance) delete body.balance; else body.balance = f.balance === "" ? null : f.balance;
    try { await api(a ? `/accounts/${a.id}` : "/accounts", { method: a ? "PATCH" : "POST", body }); toast("Saved"); refresh(); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }
  async function remove() {
    if (!a || !(await confirmAction({ title: `Remove ${a.name}?`, message: "Its transactions are kept but will no longer be linked to this account.", confirm: "Remove Account", destructive: true }))) return;
    await api(`/accounts/${a.id}`, { method: "DELETE" }); toast("Account removed"); refresh(); sheet.dismiss();
  }
  const preview: Account = { id: 0, kind: f.kind, bank: f.bank || null, name: f.name || "Account", cardType: f.cardType || null, last4: /^\d{4}$/.test(f.last4) ? f.last4 : null, currency: f.currency, theme: f.theme,
    balanceMinor: f.balance === originalBalance ? a?.balanceMinor ?? null : null, balanceAsOf: a?.balanceAsOf ?? null, balanceSource: a?.balanceSource ?? null };
  return (
    <Sheet closeRef={sheet.ref} title={a ? "Account" : "New account"} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <div style={{ maxWidth: 340, margin: "0 auto", width: "100%" }}><WalletCard account={preview} /></div>
      <div className="row" style={{ justifyContent: "center", gap: 10 }} role="group" aria-label="Card colour">
        {THEMES.map((t) => <button key={t} aria-label={t} aria-pressed={f.theme === t} onClick={() => setF({ ...f, theme: t })} className={`pay-card ${t}`} style={{ width: 34, height: 34, aspectRatio: "1", borderRadius: 17, padding: 0, outline: f.theme === t ? "3px solid var(--accent)" : "none", outlineOffset: 2 }} />)}
      </div>
      <Field label="Type"><select className="input" value={f.kind} onChange={set("kind")}><option value="card">Card</option><option value="bank">Bank account</option><option value="wallet">Stored-value wallet</option><option value="cash">Cash</option></select></Field>
      <div className="form-row">
        <Field label="Bank or issuer"><input className="input" value={f.bank} onChange={set("bank")} placeholder="e.g. Axis Bank" /></Field>
        <Field label="Card type"><input className="input" value={f.cardType} onChange={set("cardType")} placeholder="e.g. Forex Prepaid Card" /></Field>
      </div>
      <Field label="Name"><input className="input" value={f.name} onChange={set("name")} placeholder="Shown in your activity" /></Field>
      <div className="form-row">
        <Field label="Last four digits"><input className="input num" inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="0000" /></Field>
        <Field label="Currency"><select className="input" value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <Field label="Balance (leave empty if you don't know it)"><input className="input num" inputMode="decimal" value={f.balance} onChange={set("balance")} placeholder="Unknown" /></Field>
      <p className="caption faint" style={{ marginTop: -8, paddingLeft: 4 }}>Folio matches bank messages to this account by its last four digits and never asks for the full number or CVV.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {a && <button className="btn danger block" onClick={remove}><Icon name="trash" />Remove account</button>}
    </Sheet>
  );
}
