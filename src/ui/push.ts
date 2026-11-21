/**
 * Push notifications on this device. On iPhone they need iOS 16.4+ and Folio opened from its Home Screen
 * icon (Safari tabs can't receive them); permission is asked only after the person taps to turn them on.
 */
import { api } from "../api.ts";

export type PushState = "unsupported" | "needs-home-screen" | "denied" | "off" | "on";

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

export function registerWorker() {
  if (!("serviceWorker" in navigator) || location.port === "5173") return; // not under the Vite dev server
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !standalone()) return "needs-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string) {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Must be called from a tap: asks permission, subscribes this device, and registers it with Folio. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api("/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api("/push/subscribe", { body: { subscription: sub.toJSON() } });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api("/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  return "off";
}
