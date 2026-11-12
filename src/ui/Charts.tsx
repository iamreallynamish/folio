import { useEffect, useRef, useState, type ReactNode } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export interface Segment { id: number | string; label: string; value: number; color: string }
/** Donut with a 2px surface gap between segments. `active` is controlled so a legend can drive it. */
export function Donut({ segments, active, onActive, center }: { segments: Segment[]; active: Segment["id"] | null; onActive: (id: Segment["id"] | null) => void; center: (s: Segment | null) => ReactNode }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 80, r = 54, C = 100;
  let angle = -Math.PI / 2;
  const arcs = segments.map((s) => {
    const sweep = total ? (s.value / total) * Math.PI * 2 : 0, a0 = angle, a1 = angle + sweep;
    angle = a1;
    const pt = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    const large = sweep > Math.PI ? 1 : 0;
    const d = segments.length === 1
      ? `M${C} ${C - R}A${R} ${R} 0 1 1 ${C - 0.01} ${C - R}L${C - 0.01} ${C - r}A${r} ${r} 0 1 0 ${C} ${C - r}Z`
      : `M${pt(R, a0)}A${R} ${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r} ${r} 0 ${large} 0 ${pt(r, a0)}Z`;
    return { s, d };
  });
  const cur = segments.find((s) => s.id === active) ?? null;
  return (
    <div className="chart" style={{ maxWidth: 240, margin: "0 auto" }}>
      <svg viewBox="0 0 200 200" role="img" aria-label="Spending by category">
        {arcs.map(({ s, d }) => (
          <path key={s.id} d={d} fill={s.color} stroke="var(--surface)" strokeWidth="2" strokeLinejoin="round"
            opacity={active == null || active === s.id ? 1 : 0.3} style={{ transition: "opacity .2s", cursor: "pointer" }}
            onPointerEnter={() => onActive(s.id)} onPointerLeave={() => onActive(null)} onClick={() => onActive(active === s.id ? null : s.id)}>
            <title>{s.label}</title>
          </path>
        ))}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none", padding: "0 56px" }}>{center(cur)}</div>
    </div>
  );
}

export interface Point { label: string; value: number }
/** Single-series line with crosshair tooltip and an optional reference line (e.g. the budget). */
export function LineChart({ points, format, reference, color = "var(--accent)", height = 180, area = true, cutoff }: {
  points: Point[]; format: (v: number) => string; reference?: { value: number; label: string }; color?: string; height?: number; area?: boolean;
  /** Points after this index are not drawn (future days). */ cutoff?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 8, r: 44, t: 12, b: 22 };
  const shown = cutoff != null ? points.slice(0, cutoff + 1) : points;
  const vals = shown.map((p) => p.value);
  const lo0 = Math.min(...vals, reference?.value ?? Infinity), hi0 = Math.max(...vals, reference?.value ?? -Infinity);
  const zeroBased = area;
  const hi = zeroBased ? niceMax(Math.max(hi0, 1)) : hi0 + (hi0 - lo0 || hi0 * 0.02 || 1) * 0.12;
  const lo = zeroBased ? 0 : lo0 - (hi0 - lo0 || hi0 * 0.02 || 1) * 0.12;
  const x = (i: number) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * (W - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const line = shown.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const move = (e: React.PointerEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(shown.length - 1, i)));
  };
  const h = hover != null ? shown[hover] : null;
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Line chart">
        {ticks.map((t, i) => (
          <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={W - pad.r + 6} y={y(t) + 4}>{compact(t)}</text></g>
        ))}
        {reference && reference.value <= hi && (
          <g><line x1={pad.l} x2={W - pad.r} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--label-3)" strokeDasharray="4 4" />
            <text x={pad.l + 2} y={y(reference.value) - 5} style={{ fill: "var(--label-2)" }}>{reference.label}</text></g>
        )}
        {area && shown.length > 1 && <path d={`${line}L${x(shown.length - 1)} ${y(lo)}L${x(0)} ${y(lo)}Z`} fill={color} opacity="0.12" />}
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {shown.length === 1 && <circle cx={x(0)} cy={y(shown[0].value)} r="4" fill={color} />}
        {labels.map((i) => <text key={i} x={x(i)} y={height - 5} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{points[i].label}</text>)}
        {h && hover != null && (
          <g><line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--label-3)" />
            <circle cx={x(hover)} cy={y(h.value)} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" /></g>
        )}
      </svg>
      {h && hover != null && <div className="tip" style={{ left: Math.min(W - 60, Math.max(60, x(hover))), top: y(h.value) - 10 }}>{h.label}<b>{format(h.value)}</b></div>}
    </div>
  );
}

export interface Bar { key: string; label: string; value: number; tip?: string }
/** Thin rounded bars anchored to the baseline; tap or hover for the value, click to select. */
export function BarChart({ bars, format, selected, onSelect, height = 170, color = "var(--s1)", labelEvery = 1 }: {
  bars: Bar[]; format: (v: number) => string; selected?: string; onSelect?: (key: string) => void; height?: number; color?: string; labelEvery?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 4, r: 44, t: 12, b: 22 };
  const hi = niceMax(Math.max(...bars.map((b) => b.value), 1));
  const band = (W - pad.l - pad.r) / bars.length, bw = Math.max(3, Math.min(28, band - 2));
  const y = (v: number) => pad.t + (1 - Math.max(0, v) / hi) * (height - pad.t - pad.b);
  const base = height - pad.b;
  const cx = (i: number) => pad.l + band * i + band / 2;
  const h = hover != null ? bars[hover] : null;
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} onPointerLeave={() => setHover(null)} role="img" aria-label="Bar chart">
        {[0, hi / 2, hi].map((t, i) => <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={W - pad.r + 6} y={y(t) + 4}>{compact(t)}</text></g>)}
        {bars.map((b, i) => {
          const top = y(b.value), hh = Math.max(b.value > 0 ? 2 : 0, base - top), r = Math.min(4, bw / 2, hh);
          const on = hover === i || (hover == null && selected === b.key);
          return (
            <g key={b.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onClick={() => onSelect?.(b.key)} style={{ cursor: onSelect ? "pointer" : "default" }}>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={height - pad.t} fill="transparent" />
              {hh > 0 && <path d={`M${cx(i) - bw / 2} ${base}V${top + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${base}Z`} fill={color} opacity={selected == null || on || hover === i ? 1 : 0.4} style={{ transition: "opacity .2s" }} />}
              {i % labelEvery === 0 && <text x={cx(i)} y={height - 5} textAnchor="middle" style={on ? { fill: "var(--label)", fontWeight: 600 } : undefined}>{b.label}</text>}
            </g>
          );
        })}
      </svg>
      {h && hover != null && <div className="tip" style={{ left: Math.min(W - 60, Math.max(60, cx(hover))), top: y(h.value) - 8 }}>{h.tip ?? h.label}<b>{format(h.value)}</b></div>}
    </div>
  );
}

/** Horizontal stacked bar for part-to-whole (allocation). Identity is carried by the legend beside it. */
export function StackBar({ segments, active, onActive }: { segments: Segment[]; active: Segment["id"] | null; onActive: (id: Segment["id"] | null) => void }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: "flex", gap: 2, height: 14, borderRadius: 7, overflow: "hidden" }} role="img" aria-label="Allocation">
      {segments.map((s) => (
        <div key={s.id} title={s.label} onPointerEnter={() => onActive(s.id)} onPointerLeave={() => onActive(null)}
          style={{ width: `${(s.value / total) * 100}%`, minWidth: 3, background: s.color, opacity: active == null || active === s.id ? 1 : 0.3, transition: "opacity .2s" }} />
      ))}
    </div>
  );
}
