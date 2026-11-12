import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../ctx.ts";
import { CURRENCIES } from "../../shared/money.ts";
import { fmtDate, pct, plain, relTime, signed, slotColor } from "../format.ts";
import { LineChart, StackBar, type Segment } from "../ui/Charts.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Empty, Field, Notice, Sheet, Skeleton, toast, useLoad, useSheetClose, confirmAction } from "../ui/kit.tsx";

const cls = (n: number | null) => (n == null || n === 0 ? "muted" : n > 0 ? "pos" : "neg");

export function Invest() {
  const { version, go, user } = useApp();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useLoad(() => api(`/portfolio${refreshKey ? "?refresh=1" : ""}`), [version, refreshKey]);
  const news = useLoad(() => api("/portfolio/news"), [version]);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [active, setActive] = useState<Segment["id"] | null>(null);

  const head = (
    <header className="screen-head">
      <h1 className="large-title">Invest</h1>
      <div className="actions">
        {data?.hasKey && data.holdings.length > 0 && <button className="icon-btn" aria-label="Refresh prices" onClick={() => setRefreshKey((k) => k + 1)}><Icon name="refresh" style={loading ? { opacity: 0.4 } : undefined} /></button>}
        <button className="icon-btn" aria-label="Add holding" onClick={() => setEdit("new")}><Icon name="plus" /></button>
      </div>
    </header>
  );
  if (error) return <div className="screen">{head}<p className="error">{error}</p></div>;
  if (!data) return <div className="screen">{head}<Skeleton h={220} /><Skeleton h={200} /></div>;

  if (data.holdings.length === 0) {
    return (
      <div className="screen">{head}
        <div className="card"><Empty icon="trend" title="No holdings yet">
          <p className="subhead">Add the shares you own with the quantity and your average purchase price. Folio never invents holdings; prices come from Alpha Vantage.</p>
          <button className="btn primary small" onClick={() => setEdit("new")}>Add a holding</button>
        </Empty></div>
        {!data.hasKey && <Notice>To load prices, add your free Alpha Vantage key in <button className="btn plain" style={{ minHeight: 0, padding: 0, fontSize: 14 }} onClick={() => go("settings")}>Settings</button>.</Notice>}
        {edit && <HoldingSheet holding={edit} hasKey={data.hasKey} onClose={() => setEdit(null)} />}
      </div>
    );
  }
  const priceDate = data.holdings.find((h: any) => h.priceDate)?.priceDate;
  return (
    <div className="screen">{head}
      {data.notice && <Notice kind={data.hasKey ? "warning" : "info"}>{data.notice}{!data.hasKey && <> <button className="btn plain" style={{ minHeight: 0, padding: 0, fontSize: 14 }} onClick={() => go("settings")}>Open Settings</button></>}</Notice>}

      {data.totals.map((t: any) => {
        const hs = data.holdings.filter((h: any) => h.currency === t.currency);
        const segs: Segment[] = hs.filter((h: any) => h.value != null).sort((a: any, b: any) => b.value - a.value).map((h: any, i: number) => ({ id: h.id, label: h.symbol, value: h.value, color: slotColor(i < 7 ? i + 1 : 0) }));
        return (
          <div key={t.currency} className="stack" style={{ gap: 16 }}>
            <div className="card stack">
              <div className="footnote muted">Portfolio value{data.totals.length > 1 ? ` · ${t.currency}` : ""}</div>
              {t.value != null ? (
                <>
                  <div className="hero">{plain(t.value, t.currency)}</div>
                  <div className="row" style={{ flexWrap: "wrap", gap: "4px 18px" }}>
                    <span className={`subhead num ${cls(t.dayChange)}`}><b>{signed(t.dayChange, t.currency)}</b> ({pct(t.dayChangePct)}) latest day</span>
                    <span className={`subhead num ${cls(t.gain)}`}><b>{signed(t.gain, t.currency)}</b> ({pct(t.gainPct)}) overall</span>
                  </div>
                  {t.history.length > 1 && <LineChart points={t.history.map((p: any) => ({ label: fmtDate(p.date, { day: "numeric", month: "short" }), value: p.value }))} format={(v) => plain(v, t.currency)} area={false} color="var(--s1)" height={200} />}
                  <p className="caption faint">
                    Alpha Vantage daily closes{priceDate ? `, latest ${fmtDate(priceDate)}` : ""}{data.fetchedAt ? ` · fetched ${relTime(data.fetchedAt)}` : ""}. The chart values today's holdings at past prices; it is not a record of past trades.
                    {t.pricedCount < t.count ? ` ${t.count - t.pricedCount} holding${t.count - t.pricedCount > 1 ? "s" : ""} without a price ${t.count - t.pricedCount > 1 ? "are" : "is"} left out.` : ""}
                  </p>
                </>
              ) : (
                <><div className="title">Prices unavailable</div><div className="subhead muted">Cost of holdings: {plain(t.cost, t.currency)}</div></>
              )}
            </div>

            {segs.length > 1 && (
              <div className="card stack">
                <div className="headline">Allocation</div>
                <StackBar segments={segs} active={active} onActive={setActive} />
                <div className="legend">
                  {segs.map((s) => { const h = hs.find((x: any) => x.id === s.id); return (
                    <div key={s.id} className={`legend-row ${active === s.id ? "on" : active != null ? "dim" : ""}`} onPointerEnter={() => setActive(s.id)} onPointerLeave={() => setActive(null)}>
                      <span className="swatch" style={{ background: s.color }} /><span className="grow truncate">{h.symbol} <span className="muted">· {h.name}</span></span><span className="num" style={{ fontWeight: 600 }}>{h.allocationPct}%</span>
                    </div>
                  ); })}
                </div>
              </div>
            )}

            <section>
              <div className="section-label">Holdings{data.totals.length > 1 ? ` · ${t.currency}` : ""}</div>
              <div className="list">
                {hs.map((h: any) => (
                  <button className="cell" key={h.id} onClick={() => setEdit(h)} style={{ alignItems: "flex-start" }}>
                    <span className="grow">
                      <span className="row" style={{ gap: 8 }}><span className="headline">{h.symbol}</span>{Math.abs(h.dayChangePct ?? 0) >= 3 && <span className={`badge ${h.dayChangePct > 0 ? "verified" : "over"}`}>{pct(h.dayChangePct)} today</span>}</span>
                      <span className="footnote muted truncate" style={{ display: "block" }}>{h.name}</span>
                      <span className="caption faint num" style={{ display: "block" }}>{h.quantity} × avg {plain(h.avgPrice, h.currency)}{h.price != null ? ` · now ${plain(h.price, h.currency)}` : ""}</span>
                    </span>
                    <span style={{ textAlign: "right", flex: "none" }}>
                      {h.value != null ? (
                        <>
                          <span className="tx-amount" style={{ display: "block" }}>{plain(h.value, h.currency)}</span>
                          <span className={`footnote num ${cls(h.gain)}`} style={{ display: "block" }}>{signed(h.gain, h.currency)} ({pct(h.gainPct)})</span>
                          <span className={`caption num ${cls(h.dayChange)}`} style={{ display: "block" }}>{h.dayChange != null ? `${signed(h.dayChange, h.currency)} day` : ""}</span>
                        </>
                      ) : (
                        <><span className="headline muted" style={{ display: "block" }}>Price unavailable</span><span className="caption faint" style={{ display: "block", maxWidth: 170 }}>{h.error ?? "Cost " + plain(h.cost, h.currency)}</span></>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        );
      })}

      {(data.contributors.totalUp.length > 0 || data.contributors.totalDown.length > 0) && (
        <div className="grid-2">
          <Contrib title="Biggest gains" rows={data.contributors.totalUp} field="gain" pctField="gainPct" />
          <Contrib title="Biggest losses" rows={data.contributors.totalDown} field="gain" pctField="gainPct" />
          <Contrib title="Lifted the latest day" rows={data.contributors.dayUp} field="dayChange" pctField="dayChangePct" />
          <Contrib title="Weighed on the latest day" rows={data.contributors.dayDown} field="dayChange" pctField="dayChangePct" />
        </div>
      )}

      {data.hasKey && (
        <div className="grid-2">
          <section>
            <div className="section-label">Upcoming earnings</div>
            <div className="list">
              {(news.data?.earnings ?? []).map((e: any) => (
                <div className="cell" key={e.symbol + e.reportDate}>
                  <span className="tx-icon soft" style={{ ["--tint" as any]: "var(--s7)" }}><Icon name="calendar" /></span>
                  <span className="grow"><span className="headline">{e.symbol} reports {fmtDate(e.reportDate)}</span><span className="footnote muted" style={{ display: "block" }}>{e.name}{e.estimate != null ? ` · EPS estimate ${e.estimate} ${e.currency}` : ""}</span></span>
                </div>
              ))}
              {news.data && news.data.earnings.length === 0 && <div className="cell muted subhead">No earnings dates announced for your holdings in the next three months.</div>}
              {!news.data && <div className="cell muted subhead">{news.error ?? "Loading…"}</div>}
            </div>
          </section>
          <section>
            <div className="section-label">News on your holdings</div>
            {news.data?.notice && <Notice kind="warning">{news.data.notice}</Notice>}
            <div className="list">
              {(news.data?.news ?? []).slice(0, 8).map((n: any, i: number) => (
                <a className="cell" key={i} href={n.url || undefined} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", alignItems: "flex-start" }}>
                  <span className="grow"><span className="subhead" style={{ fontWeight: 600, display: "block" }}>{n.title}</span>
                    <span className="caption faint">{n.source}{n.publishedAt ? ` · ${relTime(n.publishedAt)}` : ""}{n.tickers.length ? ` · ${n.tickers.join(", ")}` : ""}{n.sentiment ? ` · ${n.sentiment}` : ""}</span></span>
                  <Icon name="chevron" className="chev" style={{ marginTop: 4 }} />
                </a>
              ))}
              {news.data && news.data.news.length === 0 && <div className="cell muted subhead">No recent articles found.</div>}
            </div>
            <p className="caption faint" style={{ padding: "6px 16px" }}>Headlines and sentiment labels are supplied by Alpha Vantage.</p>
          </section>
        </div>
      )}
      {edit && <HoldingSheet holding={edit} hasKey={data.hasKey} onClose={() => setEdit(null)} />}
      {user && null}
    </div>
  );
}

function Contrib({ title, rows, field, pctField }: { title: string; rows: any[]; field: string; pctField: string }) {
  if (!rows.length) return null;
  return (
    <section>
      <div className="section-label">{title}</div>
      <div className="list">{rows.map((r) => (
        <div className="cell" key={r.symbol}><span className="grow"><span className="headline">{r.symbol}</span><span className="footnote muted truncate" style={{ display: "block" }}>{r.name}</span></span>
          <span style={{ textAlign: "right" }}><span className={`tx-amount ${cls(r[field])}`} style={{ display: "block" }}>{signed(r[field], r.currency)}</span><span className={`caption num ${cls(r[field])}`}>{pct(r[pctField])}</span></span></div>
      ))}</div>
    </section>
  );
}

function HoldingSheet({ holding, hasKey, onClose }: { holding: any | "new"; hasKey: boolean; onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { refresh } = useApp();
  const h = holding === "new" ? null : holding;
  const [f, setF] = useState({ symbol: h?.symbol ?? "", name: h?.name ?? "", quantity: h ? String(h.quantity) : "", avgPrice: h ? String(h.avgPrice) : "", currency: h?.currency ?? "USD" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    if (!hasKey || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api(`/portfolio/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r.results); setError(""); }).catch((e) => setError(e.message)), 500);
    return () => clearTimeout(t);
  }, [q, hasKey]);
  async function save() {
    try { await api(h ? `/holdings/${h.id}` : "/holdings", { method: h ? "PATCH" : "POST", body: f }); refresh(); toast("Holding saved"); sheet.dismiss(); } catch (e: any) { setError(e.message); }
  }
  async function remove() { if (!(await confirmAction({ title: `Remove ${h.symbol}?`, message: "Your quantity and purchase price for this holding will be deleted.", confirm: "Remove Holding", destructive: true }))) return; await api(`/holdings/${h.id}`, { method: "DELETE" }); refresh(); toast("Holding removed"); sheet.dismiss(); }
  return (
    <Sheet closeRef={sheet.ref} title={h ? h.symbol : "New holding"} onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      {!h && hasKey && (
        <>
          <div className="search"><Icon name="search" /><input className="input" type="search" placeholder="Search company or ticker" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search symbols" /></div>
          {hits.length > 0 && <div className="list">{hits.map((x) => (
            <button className="cell" key={x.symbol} onClick={() => { setF({ ...f, symbol: x.symbol, name: x.name, currency: CURRENCIES.includes(x.currency) ? x.currency : f.currency }); setHits([]); setQ(""); }}>
              <span className="grow"><span className="headline">{x.symbol}</span><span className="footnote muted truncate" style={{ display: "block" }}>{x.name} · {x.region}</span></span><span className="value">{x.currency}</span>
            </button>
          ))}</div>}
        </>
      )}
      <div className="form-row">
        <Field label="Ticker symbol"><input className="input" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="e.g. AAPL or RELIANCE.BSE" autoCapitalize="characters" /></Field>
        <Field label="Currency"><select className="input" value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <Field label="Company name"><input className="input" value={f.name} onChange={set("name")} /></Field>
      <div className="form-row">
        <Field label="Quantity"><input className="input num" inputMode="decimal" value={f.quantity} onChange={set("quantity")} /></Field>
        <Field label="Average purchase price"><input className="input num" inputMode="decimal" value={f.avgPrice} onChange={set("avgPrice")} /></Field>
      </div>
      <p className="footnote muted">Use the symbol exactly as Alpha Vantage lists it. Exchanges outside the US carry a suffix, for example .BSE, .LON or .T.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {h && <button className="btn danger block" onClick={remove}><Icon name="trash" />Remove holding</button>}
    </Sheet>
  );
}
