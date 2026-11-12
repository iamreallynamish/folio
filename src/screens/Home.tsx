import { useLayoutEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../ctx.ts";
import { fmtMonth, formatMoney, relTime, slotColor } from "../format.ts";
import { Icon } from "../ui/Icon.tsx";
import { LogoMark } from "../ui/Logo.tsx";
import { Empty, Skeleton, ThemeToggle, toast, useLoad, useMedia } from "../ui/kit.tsx";
import { TxnRow } from "../ui/TxnRow.tsx";
import { Reveal } from "../ui/Reveal.tsx";
import TradingViewWidget from "@/components/TradingViewWidget";
import { spring, SPRING, type SpringHandle } from "../ui/spring.ts";
import { WalletCard } from "../ui/WalletCard.tsx";

export function Home() {
  const { user, setUser, version, refresh, go, openTxn, openImport, openAccount } = useApp();
  const { data, error } = useLoad(() => api("/home"), [version]);
  const [front, setFront] = useState<number | null>(null);
  // Card stack reorder animates with FLIP + springs: measure, reorder, then spring each card from
  // where it was on screen (including mid-animation) to its new slot.
  const slots = useRef(new Map<number, HTMLDivElement>());
  const before = useRef<Map<number, number> | null>(null);
  const moving = useRef(new Map<number, SpringHandle>());
  // The card-stack hint is shown until the stack has been used once.
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem("folio-stack-hint") === "1"; } catch { return false; } });
  const bringForward = (id: number) => {
    if (!hintSeen) { setHintSeen(true); try { localStorage.setItem("folio-stack-hint", "1"); } catch { /* private mode */ } }
    before.current = new Map([...slots.current].map(([k, el]) => [k, el.getBoundingClientRect().top]));
    setFront(id);
  };
  useLayoutEffect(() => {
    const prev = before.current;
    if (!prev) return;
    before.current = null;
    for (const [id, el] of slots.current) {
      moving.current.get(id)?.stop();
      el.style.transform = "";
      const dy = (prev.get(id) ?? 0) - el.getBoundingClientRect().top;
      if (!dy) continue;
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      moving.current.set(id, spring(dy, 0, SPRING.smooth, (v) => { el.style.transform = v ? `translate3d(0, ${v}px, 0)` : ""; }));
    }
  }, [front]);
  const stacked = useMedia("(max-width: 639px), (min-width: 1100px)");
  const first = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function markReviewed() {
    const r = await api("/review", { method: "POST" });
    setUser(r.user); refresh(); toast("Marked as reviewed");
  }
  const head = (
    <header className="home-head">
      <div className="between">
        <div className="wordmark hide-desktop"><LogoMark size={26} /><span>Folio</span></div>
        <div className="eyebrow show-desktop">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <div className="row" style={{ gap: 8 }}>
          <ThemeToggle />
          <button className="avatar hide-desktop" aria-label="Settings" onClick={() => go("settings")}>{first[0]?.toUpperCase()}</button>
        </div>
      </div>
      <div>
        <div className="eyebrow hide-desktop">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 className="greeting"><Reveal text={`${greeting}, `} once="greeting" /><Reveal text={first} className="name" delay={0.12} once="greeting-name" /></h1>
      </div>
    </header>
  );
  if (error) return <div className="screen">{head}<p className="error">{error}</p></div>;
  if (!data) return <div className="screen">{head}<Skeleton h={220} /><Skeleton h={120} /><Skeleton h={220} /></div>;

  const { summary: s, sinceLastVisit: v } = data;
  const cards = data.accounts.filter((a: any) => a.kind === "card" || a.kind === "bank");
  const wallets = data.accounts.filter((a: any) => a.kind === "wallet" || a.kind === "cash");
  // On a phone the cards overlap like a wallet; the chosen card sits in front.
  const frontId = front ?? cards[0]?.id;
  const ordered = stacked ? [...cards.filter((a: any) => a.id !== frontId), ...cards.filter((a: any) => a.id === frontId)] : cards;
  const weekTotal = data.week.reduce((a: number, d: any) => a + d.total, 0), weekMax = Math.max(1, ...data.week.map((d: any) => d.total));
  const freshChanges = v.changes.filter((c: any) => c.kind === "balance"), standing = v.changes.filter((c: any) => c.kind !== "balance");
  const caughtUp = v.count === 0 && freshChanges.length === 0;
  const state = s.budget == null ? "" : s.spent > s.budget ? "over" : s.pctUsed >= user.alertThreshold ? "warning" : "";
  const changeRow = (c: any, i: number) => {
    const [text, minor, ccy] = c.text.split("|");
    return (
      <div className="cell" key={`c${i}`}>
        <span className="tx-icon" style={{ ["--tint" as any]: c.kind === "over" || c.kind === "overdue" ? "var(--negative)" : c.kind === "warning" ? "#ff9f0a" : "var(--s1)" }}><Icon name={c.kind === "balance" ? "card" : c.kind === "overdue" ? "calendar" : "bell"} /></span>
        <span className="grow subhead">{text}</span>
        {minor && <span className="tx-amount">{formatMoney(Number(minor), ccy)}</span>}
      </div>
    );
  };

  return (
    <div className="screen home">
      {head}

      <div className="home-grid">
      <div className="home-col">
      <section aria-label="Cards" data-tour="cards">
        <div className={`wallet-stack ${stacked ? "stacked" : ""}`}>
          {ordered.map((a: any, i: number) => {
            const peek = stacked && i < ordered.length - 1;
            return (
              <div className="card-slot" key={a.id} ref={(el) => { if (el) slots.current.set(a.id, el); else slots.current.delete(a.id); }}>
                <WalletCard account={a} peek={peek} onClick={() => (peek ? bringForward(a.id) : openAccount(a))} />
              </div>
            );
          })}
        </div>
        {cards.length === 0 && <div className="card"><Empty icon="card" title="No cards yet"><button className="btn tinted small" onClick={() => openAccount("new")}>Add a card</button></Empty></div>}
        {stacked && cards.length > 1 && !hintSeen && <p className="caption faint" style={{ textAlign: "center", marginTop: 10 }}>Tap a card behind to bring it forward</p>}
      </section>

      <nav className="quick-pills" aria-label="Quick actions">
        <button onClick={() => openTxn("new")}><Icon name="plus" />Add</button>
        <button onClick={() => openImport()}><Icon name="tray" />Import</button>
      </nav>

      {wallets.length > 0 && (
        <div className="list">
          {wallets.map((a: any) => (
            <button className="cell" key={a.id} onClick={() => openAccount(a)}>
              <span className="tx-icon" style={{ ["--tint" as any]: "var(--s3)" }}><Icon name="wallet" /></span>
              <span className="grow"><span className="headline truncate" style={{ display: "block" }}>{a.name}</span><span className="footnote muted truncate" style={{ display: "block" }}>{a.kind === "cash" ? "Cash" : "Stored-value wallet"}</span></span>
              <span className="value num subhead">{a.balanceMinor != null ? formatMoney(a.balanceMinor, a.currency) : "Unavailable"}</span>
              <Icon name="chevron" className="chev" />
            </button>
          ))}
        </div>
      )}

        <section aria-label="Latest transactions" data-tour="transactions">
          <div className="between section-label"><span>Latest Transactions</span>{data.recent.length > 0 && <button className="btn plain small" style={{ minHeight: 24 }} onClick={() => go("activity")}>See all</button>}</div>
          <div className="list">
            {data.recent.slice(0, 5).map((t: any) => <TxnRow key={t.id} t={t} onClick={() => openTxn(t)} />)}
            {data.recent.length === 0 && (
              <Empty icon="tray" title="No transactions yet">
                <p className="subhead">Paste your bank messages and Folio will read the amount, merchant, card and balance.</p>
                <button className="btn primary small" onClick={() => openImport()}>Import bank messages</button>
              </Empty>
            )}
          </div>
          {data.needsReview > 0 && <button className="btn gray block" style={{ marginTop: 12 }} onClick={() => go("activity")}>{data.needsReview} transaction{data.needsReview === 1 ? "" : "s"} to review</button>}
        </section>
      </div>
      <div className="home-col">
      <button className="month-panel" data-tour="budget" onClick={() => go("plan")} aria-label={`${fmtMonth(s.month)}: ${formatMoney(s.spent, s.currency)} spent`}>
        <span className="grow">
          <span className="eyebrow">{fmtMonth(s.month)}</span>
          <span className="figure">{formatMoney(s.spent, s.currency)}</span>
          <span className="footnote muted" style={{ display: "block" }}>
            {s.budget != null ? <>{s.remaining >= 0 ? `${formatMoney(s.remaining, s.currency)} left of ${formatMoney(s.budget, s.currency)}` : <span className="neg">{formatMoney(-s.remaining, s.currency)} over budget</span>}</> : "spent · no budget set"}
          </span>
          {s.budget != null && <span className={`progress thin ${state}`} style={{ display: "block", marginTop: 10 }}><i style={{ width: `${Math.min(100, s.pctUsed)}%` }} /></span>}
        </span>
        <span className="week-wrap">
          <span className="caption faint" style={{ display: "block", textAlign: "right" }}>{formatMoney(weekTotal, s.currency)} · 7 days</span>
          <span className="week" aria-hidden="true">
            {data.week.map((d: any, i: number) => (
              <span className={`day ${i === 6 ? "today" : ""}`} key={d.date}>
                <span className="cap">{d.parts.filter((p: any) => p.value > 0).map((p: any) => <i key={p.slot} style={{ height: `${(p.value / weekMax) * 100}%`, background: slotColor(p.slot) }} />)}</span>
                {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "narrow" })}
              </span>
            ))}
          </span>
        </span>
      </button>

      {standing.length > 0 && <div className="list">{standing.map(changeRow)}</div>}

      <div>
        {!caughtUp && (
          // One compact line: new items are marked with a dot in Latest Transactions above.
          <section className="visit-line" aria-label="Since your last visit">
            <button className="grow" onClick={() => go("activity")}>
              <span className="count-pill">{v.count}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="headline" style={{ display: "block" }}>New since {relTime(v.since)}</span>
                <span className="footnote muted truncate" style={{ display: "block" }}>
                  {[...v.totals.map((t: any) => [t.spentMinor !== 0 && `${formatMoney(t.spentMinor, t.currency)} spent`, t.inMinor > 0 && `${formatMoney(t.inMinor, t.currency)} in`, t.movedMinor > 0 && `${formatMoney(t.movedMinor, t.currency)} moved`].filter(Boolean).join(" · ")), freshChanges.length ? `${freshChanges.length} balance update${freshChanges.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
            <button className="btn small gray" onClick={markReviewed}>Mark reviewed</button>
          </section>
        )}

        <section className="market-card" aria-label="Market watch">
          <div className="between section-label"><span>Market watch</span><span className="caption faint">NSE · TradingView</span></div>
          <div className="market-frame"><TradingViewWidget /></div>
        </section>

      </div>
      </div>
      </div>
    </div>
  );
}
