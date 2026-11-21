import { useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../ctx.ts";
import { MAX_WATCH, parseSymbols } from "../../shared/tradingview.ts";
import { Icon } from "../ui/Icon.tsx";
import { Sheet, toast, useSheetClose } from "../ui/kit.tsx";

/** Choose what Market watch shows: paste TradingView links, symbols, or an embed snippet. */
export function MarketSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetClose(onClose);
  const { user, setUser } = useApp();
  const [list, setList] = useState<string[]>(user.marketSymbols ?? []);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  function add() {
    const { symbols, changed } = parseSymbols(text);
    if (!symbols.length) { setError("Paste a TradingView link (tradingview.com/symbols/…) or a symbol like NASDAQ:AAPL."); return; }
    const next = [...new Set([...list, ...symbols])];
    if (next.length > MAX_WATCH) { setError(`Market watch shows up to ${MAX_WATCH} symbols.`); return; }
    setList(next); setText(""); setError("");
    setNote(changed.length ? `TradingView doesn't allow NSE charts in embeds, so ${changed.join(", ")} (the same company's BSE listing).` : "");
  }
  async function save() {
    try { const r = await api("/me", { method: "PATCH", body: { marketSymbols: list } }); setUser(r.user); toast("Market watch updated"); sheet.dismiss(); }
    catch (e: any) { setError(e.message); }
  }
  return (
    <Sheet closeRef={sheet.ref} title="Market watch" onClose={onClose} action={<button className="btn plain" style={{ fontWeight: 700 }} onClick={save}>Save</button>}>
      <p className="subhead muted" style={{ margin: 0 }}>Paste a link to any stock, index or crypto page on TradingView, or type its symbol. The chart follows your colour and light or dark mode.</p>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="tradingview.com/symbols/NASDAQ-AAPL or BSE:TCS" aria-label="TradingView link or symbol" autoFocus />
        <button className="btn tinted" onClick={add} disabled={!text.trim()}><Icon name="plus" />Add</button>
      </div>
      {note && <p className="caption faint" style={{ margin: 0 }}>{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="list">
        {list.map((s, i) => (
          <div className="cell" key={s}>
            <span className="tx-icon soft" style={{ ["--tint" as any]: "var(--accent)" }}><Icon name="trend" /></span>
            <span className="grow"><span className="headline">{s.split(":").pop()}</span><span className="footnote muted" style={{ display: "block" }}>{s.includes(":") ? s.split(":")[0] : "TradingView"}{i === 0 ? " · shown first" : ""}</span></span>
            <button className="icon-btn" aria-label={`Remove ${s}`} onClick={() => setList(list.filter((x) => x !== s))}><Icon name="x" /></button>
          </div>
        ))}
        {list.length === 0 && <div className="cell muted subhead">Nothing yet. Add a link or symbol above.</div>}
      </div>
    </Sheet>
  );
}
