import { useEffect, useRef } from "react";

/**
 * Ambient background: an ordered-dither portrait that slowly "pulses", after the ASCII effect on
 * 21st.dev (community/ascii, the "man" recipe). Canvas 2D, reimplemented from the recipe's pipeline:
 *
 *   source image → grid of `cellSize` cells → per-cell luminance (contrast / brightness) →
 *   renderMode "dither": a square where the luminance beats a 4×4 Bayer threshold →
 *   animStyle "pulse": a slow breath of brightness spreading outwards from the subject.
 *
 * Only the "dither" mode, the recipe's settings, is implemented; bgMode "none", no post-effects,
 * lights or mask (all disabled in the recipe).
 *
 * Kept out of the way: it sits behind everything, is faint, fades out towards the content column,
 * redraws at ~12 fps, stops while the tab is hidden, and holds a still frame under Reduce Motion.
 * The subject is drawn here (a lit head-and-shoulders figure) rather than loaded as a photo.
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
 * The subject, as luminance on the cell grid (0 = nothing drawn): a head-and-shoulders figure shaded as
 * smooth 3D forms under a key light from the upper left, with a rim light behind. Equivalent to sampling
 * a studio portrait's average brightness per cell.
 */
function portrait(cols: number, rows: number, cx: number, size: number): Float32Array {
  const L = new Float32Array(cols * rows);
  const key = norm([-0.45, -0.5, 0.74]);
  // Forms in grid units: [centre x, centre y, radius x, radius y, depth]. Overlapping, so the figure is
  // one silhouette: head on a neck that sinks into the shoulders.
  const head = [cx, rows - size * 0.64, size * 0.165, size * 0.215, size * 0.19];
  const hair = [cx + size * 0.005, rows - size * 0.73, size * 0.175, size * 0.16, size * 0.2];
  const neck = [cx, rows - size * 0.38, size * 0.09, size * 0.14, size * 0.12];
  const torso = [cx, rows + size * 0.1, size * 0.5, size * 0.4, size * 0.32];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let best = -1, n: number[] | null = null, albedo = 1;
      for (const [f, a] of [[torso, 0.72], [neck, 0.8], [head, 1], [hair, 0.42]] as [number[], number][]) {
        const dx = (x - f[0]) / f[2], dy = (y - f[1]) / f[3], r2 = dx * dx + dy * dy;
        if (r2 >= 1) continue;
        const z = Math.sqrt(1 - r2) * f[4];
        if (z > best) { best = z; albedo = a; n = norm([dx / f[2], dy / f[3], Math.sqrt(1 - r2) / f[4]]); }
      }
      if (!n) continue;
      const lambert = Math.max(0, n[0] * key[0] + n[1] * key[1] + n[2] * key[2]);
      const rim = Math.pow(1 - Math.max(0, n[2]), 3) * 0.55; // edge light from behind
      L[y * cols + x] = Math.min(1, (0.22 + lambert * 0.85) * albedo + rim);
    }
  }
  return L;
}
function norm(v: number[]) { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }

export function AsciiBackground({ params = MAN_DITHER }: { params?: AsciiParams }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const p = params;
    let cols = 0, rows = 0, lum: Float32Array = new Float32Array(0), color = "#fff", cx = 0, cy = 0;
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
      // Large, so it shows through the gaps between cards rather than hiding behind one.
      // Wide screens: right of centre; phones: centred, lower down.
      const size = Math.min(rows * (wide ? 1.05 : 0.8), cols * (wide ? 0.62 : 1.2));
      cx = wide ? cols * 0.7 : cols * 0.5;
      cy = rows - size * 0.55;
      lum = portrait(cols, rows, cx, size);
      color = getComputedStyle(document.documentElement).getPropertyValue("--label").trim() || "#fff";
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
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
          // pulse: a breath of light that travels outwards from the subject's centre
          const r = Math.hypot(x - cx, (y - cy) * 1.2) / 40;
          v *= 1 + amp * Math.sin(t * speed * 1.6 - r);
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
      if (reduce.matches || document.hidden) { draw(start + 1200); return; } // a still frame
      raf = requestAnimationFrame(loop);
    };

    let resizeT = 0;
    const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { layout(); run(); }, 150); };
    const onTheme = () => { layout(); draw(performance.now()); };
    // Text moves when the page scrolls, changes or loads; re-mark (cheaply) on the next frame.
    const dirty = () => { clearDirty = true; if (reduce.matches || document.hidden) draw(start + 1200); };
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
