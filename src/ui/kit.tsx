import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** Load data, re-running when `deps` change. Keeps the previous data visible while refreshing. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    fn().then((d) => { if (n === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

export function Sheet({ title, onClose, children, action, cancelLabel = "Cancel" }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode; cancelLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  // Animate out, then tell the parent.
  const close = useCallback(() => { setClosing(true); setTimeout(onClose, 230); }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [close]);
  // Drag the header down to dismiss, like a native sheet.
  const down = (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("button")) return; drag.current = { y: e.clientY, dy: 0 }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transition = "none"; ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const up = () => {
    if (!drag.current || !ref.current) return;
    const dy = drag.current.dy; drag.current = null;
    ref.current.style.transition = "";
    if (dy > 110) close(); else ref.current.style.transform = "";
  };
  return (
    <div className={`sheet-backdrop ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={{ outline: "none" }}>
        <div className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <button className="btn plain" onClick={close}>{cancelLabel}</button>
          <span className="headline">{title}</span>
          <span style={{ minWidth: 64, textAlign: "right" }}>{action}</span>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export const currentTheme = (): "light" | "dark" => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
export function setTheme(t: "system" | "light" | "dark") {
  if (t === "system") { localStorage.removeItem("folio-theme"); delete document.documentElement.dataset.theme; }
  else { localStorage.setItem("folio-theme", t); document.documentElement.dataset.theme = t; }
  window.dispatchEvent(new Event("folio:theme"));
}
export function ThemeToggle() {
  const [t, setT] = useState(currentTheme);
  useEffect(() => { const f = () => setT(currentTheme()); window.addEventListener("folio:theme", f); return () => window.removeEventListener("folio:theme", f); }, []);
  return <button className="icon-btn" aria-label={t === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(t === "dark" ? "light" : "dark")}><Icon name={t === "dark" ? "sun" : "moon"} /></button>;
}
export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, [q]);
  return m;
}

/** Circular progress with content in the middle. */
export function Ring({ pct, size = 128, tone = "", children }: { pct: number; size?: number; tone?: string; children?: ReactNode }) {
  const r = 44, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`ring ${tone}`} style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r={r} className="track" /><circle cx="50" cy="50" r={r} className="bar" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" /></svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><div className="headline" style={{ color: "var(--label)" }}>{title}</div>{children}</div>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warning" | "over"; children: ReactNode }) {
  return <div className={`notice ${kind === "info" ? "" : kind}`} role={kind === "info" ? undefined : "status"}><Icon name={kind === "info" ? "info" : "warn"} /><div>{children}</div></div>;
}

export function Provenance({ kind }: { kind: "verified" | "estimate" | "ai" | "none" }) {
  if (kind === "none") return null;
  const map = { verified: ["check", "Verified from your records"], estimate: ["info", "Estimate"], ai: ["spark", "AI-generated"] } as const;
  return <span className={`badge ${kind}`}><Icon name={map[kind][0]} />{map[kind][1]}</span>;
}

let pushToast: (m: string) => void = () => {};
export const toast = (m: string) => pushToast(m);
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    pushToast = (m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 3200); };
    return () => clearTimeout(t);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function Skeleton({ h = 120 }: { h?: number }) { return <div className="skeleton" style={{ height: h }} aria-hidden="true" />; }

export function MonthNav({ month, onChange, max }: { month: string; onChange: (m: string) => void; max: string }) {
  const shift = (by: number) => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="icon-btn" aria-label="Previous month" onClick={() => onChange(shift(-1))}><Icon name="back" /></button>
      <span className="headline num" style={{ minWidth: 132, textAlign: "center" }} aria-live="polite">{label}</span>
      <button className="icon-btn" aria-label="Next month" disabled={month >= max} style={{ opacity: month >= max ? 0.35 : 1 }} onClick={() => onChange(shift(1))}><Icon name="chevron" /></button>
    </div>
  );
}
