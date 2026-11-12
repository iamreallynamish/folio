import { useEffect, useRef } from "react";

/**
 * Ambient background: a live candlestick chart in ordered dither, flowing across the screen, after the
 * ASCII effect on 21st.dev (community/ascii; the "man" recipe's settings). Canvas 2D, reimplemented
 * from the recipe's pipeline:
 *
 *   source (the chart, drawn each frame) → grid of `cellSize` cells → per-cell luminance (contrast) →
 *   renderMode "dither": a square where the luminance beats a 4×4 Bayer threshold →
 *   animStyle "pulse": a slow breath of brightness travelling across the chart.
 *
 * Only the "dither" mode, the recipe's settings, is implemented; bgMode "none", no post-effects,
 * lights or mask (all disabled in the recipe).
 *
 * Kept out of the way: it sits behind everything, is faint, fades out towards the content column,
 * redraws at ~12 fps, stops while the tab is hidden, and holds a still frame under Reduce Motion.
 * The market is made up (a seeded random walk): decoration, never data.
 */
export interface AsciiParams {
  cellSize: number;
  /** 0–200; 100 = unchanged. */
  contrast: number;
  /** -100–100. */
  brightness: number;
  /** 0–100: how much of each cell the dot fills. */
  density: number;
  invert: boolean;
  animSpeed: number; // 0–100
  animIntensity: number; // 0–100
}

/** The recipe's values ("renderMode": "dither", "animStyle": "pulse"). */
export const MAN_DITHER: AsciiParams = { cellSize: 9, contrast: 158, brightness: 0, density: 20, invert: false, animSpeed: 100, animIntensity: 60 };

/** Text that sits straight on the background (not inside a card); the pattern keeps clear of it. */
const FREE_TEXT = ".main h1, .main h2, .main h3, .main p, .main .section-label, .main .eyebrow, .main .caption, .main .footnote, .main .hint, .main .large-title, .main .screen-head, .main .home-head, .main .between > *";
const ON_SURFACE = ".card, .list, .pay-card, .month-panel, .market-frame, .wallet-stack, .btn, .quick-pills, .sheet, .tile";
const CLEAR = 14; // px of breathing room around text

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const FPS = 12;

/**
 * The subject: a live candlestick chart that flows from right to left. Each frame it is rasterised
 * straight onto the cell grid with sub-cell coverage (so it glides rather than jumping a cell at a
 * time), and the dither turns that coverage into dots. Rising candles are solid, falling ones sparse,
 * so the two read apart even in one colour; the newest candle ticks as it forms at the right edge.
 */
interface Candle { o: number; h: number; l: number; c: number; v: number }
const PITCH = 7; // cells from one candle to the next
const BODY = 4.6; // body width, cells
const FLOW = 1.4; // cells per second

function makeMarket(seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const candles = new Map<number, Candle>();
  let last = 100, trend = 0;
  let next = 0;
  const gen = (): Candle => {
    // A random walk with momentum and a pull back towards 100, so it trends, turns and never runs away.
    // Chunky bodies and short wicks, inside a calm overall range, so each candle reads at 9 px dots.
    trend = trend * 0.6 + (rand() - 0.5) * 0.8 + (100 - last) * 0.06;
    const o = last, c = o + trend + (rand() < 0.5 ? -1 : 1) * (1 + rand() * 2.2);
    const h = Math.max(o, c) + rand() * 0.9, l = Math.min(o, c) - rand() * 0.9;
    last = c;
    return { o, h, l, c, v: 0.3 + rand() * 0.7 + Math.min(1, Math.abs(c - o) / 3) * 0.4 };
  };
  return {
    get(i: number): Candle {
      while (next <= i) { candles.set(next, gen()); next++; }
      for (const k of candles.keys()) { if (k < i - 400) candles.delete(k); else break; }
      return candles.get(i) ?? candles.get(next - 1)!;
    },
  };
}

/** Adds `v` to every cell overlapped by the rectangle [x0,x1]×[y0,y1] (cell units), weighted by coverage. */
function fillRect(L: Float32Array, cols: number, rows: number, x0: number, x1: number, y0: number, y1: number, v: number) {
  const cx0 = Math.max(0, Math.floor(x0)), cx1 = Math.min(cols - 1, Math.floor(x1));
  const cy0 = Math.max(0, Math.floor(y0)), cy1 = Math.min(rows - 1, Math.floor(y1));
  for (let y = cy0; y <= cy1; y++) {
    const fy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (fy <= 0) continue;
    for (let x = cx0; x <= cx1; x++) {
      const fx = Math.min(x + 1, x1) - Math.max(x, x0);
      if (fx > 0) L[y * cols + x] = Math.min(1, L[y * cols + x] + v * fx * fy);
    }
  }
}

export function AsciiBackground({ params = MAN_DITHER }: { params?: AsciiParams }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const p = params;
    let cols = 0, rows = 0, lum: Float32Array = new Float32Array(0), color = "#fff";
    let top = 0, bottom = 0, volTop = 0, volBottom = 0;
    const market = makeMarket();
    let lo = 95, hi = 105; // smoothed price range on screen
    let raf = 0, last = 0, start = performance.now();
    // Cells to leave empty, so dots never touch a heading or a line of text on the background.
    let keepClear = new Uint8Array(0), clearDirty = true;
    const markClear = () => {
      clearDirty = false;
      keepClear = new Uint8Array(cols * rows);
      for (const el of document.querySelectorAll<HTMLElement>(FREE_TEXT)) {
        if (el.closest(ON_SURFACE) || !el.textContent?.trim()) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.bottom < 0 || b.top > innerHeight) continue;
        const x0 = Math.max(0, Math.floor((b.left - CLEAR) / p.cellSize)), x1 = Math.min(cols - 1, Math.floor((b.right + CLEAR) / p.cellSize));
        const y0 = Math.max(0, Math.floor((b.top - CLEAR) / p.cellSize)), y1 = Math.min(rows - 1, Math.floor((b.bottom + CLEAR) / p.cellSize));
        for (let y = y0; y <= y1; y++) keepClear.fill(1, y * cols + x0, y * cols + x1 + 1);
      }
    };

    const layout = () => {
      // One canvas pixel per CSS pixel is plenty for 9 px squares, and keeps redraws cheap.
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      cols = Math.ceil(innerWidth / p.cellSize);
      rows = Math.ceil(innerHeight / p.cellSize);
      const wide = innerWidth >= 900;
      // The chart's price band and the volume strip under it; on phones, lower down the screen.
      // Low on the screen, where pages leave open space under their cards.
      top = rows * (wide ? 0.6 : 0.58); bottom = rows * 0.9;
      volTop = rows * 0.925; volBottom = rows * 0.98;
      lum = new Float32Array(cols * rows);
      color = getComputedStyle(document.documentElement).getPropertyValue("--label").trim() || "#fff";
    };

    /** Rasterise the chart as it stands at time t (seconds). */
    const chart = (t: number) => {
      lum.fill(0);
      const flow = t * FLOW + PITCH * 40; // start with the screen already full of history
      const newest = Math.floor(flow / PITCH);
      const first = newest - Math.ceil(cols / PITCH) - 1;
      // Fit the visible prices, easing the scale so it never jumps.
      let vlo = Infinity, vhi = -Infinity;
      for (let i = first; i <= newest; i++) { const k = market.get(i); vlo = Math.min(vlo, k.l); vhi = Math.max(vhi, k.h); }
      const pad = (vhi - vlo) * 0.04 + 0.2;
      lo += (vlo - pad - lo) * 0.08; hi += (vhi + pad - hi) * 0.08;
      const y = (price: number) => bottom - ((price - lo) / (hi - lo)) * (bottom - top);
      for (let i = first; i <= newest; i++) {
        const k = market.get(i);
        // The newest candle is still forming: its close drifts towards its final value, with a small tick.
        const forming = i === newest ? (flow / PITCH) % 1 : 1;
        const c = i === newest ? k.o + (k.c - k.o) * forming + Math.sin(t * 5.3) * 0.25 * (1 - forming) : k.c;
        const h = i === newest ? Math.max(k.o, c) + (k.h - Math.max(k.o, k.c)) * forming : k.h;
        const l = i === newest ? Math.min(k.o, c) - (Math.min(k.o, k.c) - k.l) * forming : k.l;
        const x = cols - (flow - i * PITCH) - PITCH; // newest at the right edge, older ones further left
        const up = c >= k.o;
        // Wick: one whole cell wide in the nearest column, so it stays a clean line of dots as it moves.
        const wx = Math.round(x - 0.5);
        fillRect(lum, cols, rows, wx, wx + 1, y(h), y(l), 0.85);
        const yTop = y(Math.max(k.o, c)), yBot = Math.max(y(Math.min(k.o, c)), yTop + 1);
        fillRect(lum, cols, rows, x - BODY / 2, x + BODY / 2, yTop, yBot, up ? 1 : 0.62);
        fillRect(lum, cols, rows, x - BODY / 2, x + BODY / 2, volBottom - (volBottom - volTop) * k.v * forming, volBottom, 0.38);
      }
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      chart(t);
      const speed = 0.35 + (p.animSpeed / 100) * 0.65; // breaths per ~4 s at full speed
      const amp = (p.animIntensity / 100) * 0.32;
      const k = 1 + (p.contrast - 100) / 100, b = p.brightness / 100;
      const dot = Math.max(2, Math.round(p.cellSize * (0.35 + p.density / 100 * 0.6)));
      const off = Math.floor((p.cellSize - dot) / 2);
      if (clearDirty || keepClear.length !== cols * rows) markClear();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let v = lum[y * cols + x];
          if (v <= 0 || keepClear[y * cols + x]) continue;
          // pulse: a slow breath of light that travels across the chart
          v *= 1 + amp * Math.sin(t * speed * 1.6 - x / 18);
          v = (v - 0.5) * k + 0.5 + b;
          if (p.invert) v = 1 - v;
          if (v > BAYER[(y & 3) * 4 + (x & 3)]) ctx.rect(x * p.cellSize + off, y * p.cellSize + off, dot, dot);
        }
      }
      ctx.fill();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches || document.hidden) { draw(start); return; } // a still frame
      raf = requestAnimationFrame(loop);
    };

    let resizeT = 0;
    const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { layout(); run(); }, 150); };
    const onTheme = () => { layout(); draw(performance.now()); };
    // Text moves when the page scrolls, changes or loads; re-mark (cheaply) on the next frame.
    const dirty = () => { clearDirty = true; if (reduce.matches || document.hidden) draw(start); };
    const mo = new MutationObserver(dirty);
    mo.observe(document.querySelector(".app") ?? document.body, { childList: true, subtree: true });
    addEventListener("scroll", dirty, { passive: true });
    layout(); run();
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", run);
    reduce.addEventListener("change", run);
    addEventListener("folio:theme", onTheme);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onTheme);
    return () => {
      mo.disconnect(); removeEventListener("scroll", dirty);
      cancelAnimationFrame(raf); clearTimeout(resizeT);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", run);
      reduce.removeEventListener("change", run);
      removeEventListener("folio:theme", onTheme);
      mq.removeEventListener("change", onTheme);
    };
  }, [params]);

  return <canvas ref={ref} className="ascii-bg" aria-hidden="true" />;
}
