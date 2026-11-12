import { useMemo, useState } from "react";
import { api, type Txn } from "../api.ts";
import { useApp } from "../ctx.ts";
import { dayLabel, formatMoney } from "../format.ts";
import { Icon } from "../ui/Icon.tsx";
import { Empty, Field, Skeleton, useLoad } from "../ui/kit.tsx";
import { TxnRow } from "../ui/TxnRow.tsx";
import { Reveal } from "../ui/Reveal.tsx";

const TYPES = [["", "All"], ["expense", "Expenses"], ["income", "Money in"], ["refund", "Refunds"], ["transfer", "Transfers"], ["review", "To review"]];

export function Activity() {
  const { version, accounts, categories, openTxn, openImport } = useApp();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [f, setF] = useState({ category: "", account: "", from: "", to: "" });
  const [showFilters, setShowFilters] = useState(false);
  const active = Object.values(f).filter(Boolean).length;
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (type === "review") p.set("review", "1"); else if (type) p.set("type", type);
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return p.toString();
  }, [q, type, f]);
  const { data, error } = useLoad(() => api<{ transactions: Txn[] }>(`/transactions?${query}`), [query, version]);

  const days = useMemo(() => {
    const map = new Map<string, Txn[]>();
    for (const t of data?.transactions ?? []) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map];
  }, [data]);
  const dayTotal = (ts: Txn[]) => {
    const by = new Map<string, number>();
    for (const t of ts) if (t.type === "expense" || t.type === "refund") by.set(t.currency, (by.get(t.currency) ?? 0) + (t.type === "refund" ? -t.amountMinor : t.amountMinor));
    return [...by].filter(([, v]) => v !== 0).map(([c, v]) => formatMoney(v, c)).join(" + ");
  };

  return (
    <div className="screen" style={{ gap: 14 }}>
      <header className="screen-head">
        <Reveal as="h1" className="large-title" text="Activity" once="title-activity" />
        <div className="actions">
          <button className="icon-btn" aria-label="Import bank messages" onClick={() => openImport()}><Icon name="tray" /></button>
          <button className="icon-btn" aria-label="Add transaction" onClick={() => openTxn("new")}><Icon name="plus" /></button>
        </div>
      </header>
      <div className="row">
        <div className="search grow"><Icon name="search" /><input className="input" type="search" placeholder="Search merchant, category or note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" /></div>
        <button className="btn small gray" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Filters{active ? ` · ${active}` : ""}</button>
      </div>
      <div className="chips" role="group" aria-label="Type">
        {TYPES.map(([v, label]) => <button key={v} className="chip" aria-pressed={type === v} onClick={() => setType(v)}>{label}</button>)}
      </div>
      {showFilters && (
        <div className="card stack">
          <div className="form-row">
            <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Any</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Account"><select className="input" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="">Any</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ••${a.last4}` : ""}</option>)}</select></Field>
          </div>
          <div className="form-row">
            <Field label="From"><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="To"><input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          {active > 0 && <button className="btn plain small" onClick={() => setF({ category: "", account: "", from: "", to: "" })}>Clear filters</button>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!data && !error && <Skeleton h={300} />}
      {data && days.length === 0 && (
        <div className="card">
          <Empty icon={query ? "search" : "tray"} title={query ? "No matching transactions" : "No transactions yet"}>
            {!query && <><p className="subhead">Import bank messages or add one by hand.</p><button className="btn primary small" onClick={() => openImport()}>Import bank messages</button></>}
          </Empty>
        </div>
      )}
      {days.map(([date, ts]) => (
        <section key={date}>
          <div className="day-head"><span>{dayLabel(date)}</span><span className="num">{dayTotal(ts)}</span></div>
          <div className="list">{ts.map((t) => <TxnRow key={t.id} t={t} showDate={false} onClick={() => openTxn(t)} />)}</div>
        </section>
      ))}
      {data && data.transactions.length >= 500 && <p className="caption faint" style={{ textAlign: "center" }}>Showing the latest 500. Narrow the dates to see older ones.</p>}
    </div>
  );
}
