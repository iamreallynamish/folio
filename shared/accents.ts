/**
 * Accent colours. Each recolours the whole app: buttons, selection, highlights, the Folio mark's
 * gradient and the home-screen icon. Colours are Apple's system palette; every accent has a light-mode
 * value dark enough for text on white and a dark-mode value bright enough on black (WCAG AA), each with
 * the text colour that reads on top of it.
 */
export interface Accent {
  key: string;
  name: string;
  /** The mark's gradient, bottom-left to top-right. */
  stops: [string, string, string];
  light: string; onLight: string;
  dark: string; onDark: string;
}

export const ACCENTS: Accent[] = [
  { key: "folio", name: "Folio", stops: ["#19c37d", "#20b7c9", "#6c7bff"], light: "#0a7d5a", onLight: "#ffffff", dark: "#3ad07f", onDark: "#04210f" },
  { key: "ocean", name: "Ocean", stops: ["#64d2ff", "#0a84ff", "#5e5ce6"], light: "#0062cc", onLight: "#ffffff", dark: "#409cff", onDark: "#00132b" },
  { key: "violet", name: "Violet", stops: ["#e0a8ff", "#bf5af2", "#5e5ce6"], light: "#8944ab", onLight: "#ffffff", dark: "#c38bff", onDark: "#1f0636" },
  { key: "rose", name: "Rose", stops: ["#ffa8c8", "#ff375f", "#bf5af2"], light: "#c4153f", onLight: "#ffffff", dark: "#ff6482", onDark: "#33000f" },
  { key: "sunset", name: "Sunset", stops: ["#ffd60a", "#ff9f0a", "#ff453a"], light: "#b25000", onLight: "#ffffff", dark: "#ffab3d", onDark: "#2e1600" },
  { key: "mint", name: "Mint", stops: ["#a3f0c2", "#00c7be", "#30b0c7"], light: "#00736d", onLight: "#ffffff", dark: "#3fd9cf", onDark: "#00201e" },
  { key: "lime", name: "Lime", stops: ["#e4f56b", "#a6e22e", "#34c759"], light: "#3c7a00", onLight: "#ffffff", dark: "#b2ec4b", onDark: "#142400" },
  { key: "graphite", name: "Graphite", stops: ["#ffffff", "#c7c7cc", "#8e8e93"], light: "#3a3a3c", onLight: "#ffffff", dark: "#e5e5ea", onDark: "#000000" },
];
export const DEFAULT_ACCENT = "folio";
export const accentOf = (key: string | null | undefined) => ACCENTS.find((a) => a.key === key) ?? ACCENTS[0];

/** The app icon: the mark in the accent's gradient on a near-black tile (rounded corners for favicons only). */
export function iconSvg(a: Accent, rounded = true): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16181d"/><stop offset="1" stop-color="#06070a"/></linearGradient>
    <linearGradient id="g" x1="0.1" y1="1" x2="0.9" y2="0"><stop offset="0" stop-color="${a.stops[0]}"/><stop offset="0.5" stop-color="${a.stops[1]}"/><stop offset="1" stop-color="${a.stops[2]}"/></linearGradient>
  </defs>
  <rect width="512" height="512"${rounded ? ' rx="114"' : ""} fill="url(#bg)"/>
  <g transform="translate(96 96) scale(3.2)">
    <path d="M46 6Q51 51 90 56Q51 61 46 96Q41 61 8 56Q41 51 46 6Z" fill="url(#g)"/>
    <path d="M46 6Q51 51 90 56Q51 61 46 96Z" fill="#fff" fill-opacity=".2"/>
    <circle cx="79" cy="19" r="8" fill="url(#g)"/>
  </g>
</svg>`;
}

/** The web app manifest for an accent: its icon set and colours, so an installed Folio carries the chosen icon. */
export function manifestFor(a: Accent) {
  return {
    name: "Folio", short_name: "Folio", description: "Personal finance and investments",
    start_url: "/", display: "standalone", background_color: "#000000", theme_color: "#000000",
    icons: [
      { src: `/icons/${a.key}.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: `/icons/${a.key}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icons/${a.key}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icons/${a.key}-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: { action: "/", method: "GET", params: { text: "share_text", title: "share_title" } },
  };
}

/**
 * CSS for every accent, keyed on <html data-accent>. Light values by default; dark values when the
 * system is dark (unless Folio is forced light) or Folio is forced dark. More specific than the base
 * theme rules, so it wins regardless of order.
 */
export function accentCss(): string {
  return ACCENTS.map((a) => {
    const sel = `:root[data-accent="${a.key}"]`;
    const soft = (hex: string, alpha: number) => `color-mix(in srgb, ${hex} ${alpha}%, transparent)`;
    const light = `--g1:${a.stops[0]};--g2:${a.stops[1]};--g3:${a.stops[2]};--accent:${a.light};--on-accent:${a.onLight};--accent-soft:${soft(a.light, 12)};`;
    const dark = `--accent:${a.dark};--on-accent:${a.onDark};--accent-soft:${soft(a.dark, 16)};`;
    return `${sel}{${light}}@media (prefers-color-scheme: dark){${sel}:not([data-theme="light"]){${dark}}}${sel}[data-theme="dark"]{${dark}}`;
  }).join("\n");
}
