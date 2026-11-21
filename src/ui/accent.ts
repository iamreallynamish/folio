/**
 * Applies an accent: recolours the app (CSS variables keyed on <html data-accent>) and points the
 * favicon, the iPhone home-screen icon and the install manifest at that accent's icon set, so adding
 * Folio to the home screen (or installing it) uses the chosen colour.
 */
import { accentCss, accentOf, DEFAULT_ACCENT } from "../../shared/accents.ts";

let injected = false;
function ensureCss() {
  if (injected) return;
  const style = document.createElement("style");
  style.id = "folio-accents";
  style.textContent = accentCss();
  document.head.appendChild(style);
  injected = true;
}

function setLink(rel: string, href: string, type?: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
  if (type) el.type = type;
  if (el.getAttribute("href") !== href) el.href = href;
}

export function applyAccent(key: string | null | undefined) {
  ensureCss();
  const a = accentOf(key);
  document.documentElement.dataset.accent = a.key;
  try { a.key === DEFAULT_ACCENT ? localStorage.removeItem("folio-accent") : localStorage.setItem("folio-accent", a.key); } catch { /* storage off */ }
  setLink("icon", `/icons/${a.key}.svg`, "image/svg+xml");
  setLink("apple-touch-icon", `/icons/${a.key}-180.png`);
  setLink("manifest", `/manifests/${a.key}.webmanifest`);
  window.dispatchEvent(new Event("folio:accent"));
}
export const currentAccent = () => document.documentElement.dataset.accent ?? DEFAULT_ACCENT;
