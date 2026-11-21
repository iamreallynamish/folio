/*
 * Folio service worker: shows push notifications (budget, payments, new transactions, daily summary)
 * even when Folio is closed, and opens the right screen when one is tapped. It caches nothing:
 * Folio always loads fresh from the server.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Folio", body: event.data ? event.data.text() : "" }; }
  const accent = /^[a-z]+$/.test(data.accent || "") ? data.accent : "folio";
  event.waitUntil(self.registration.showNotification(data.title || "Folio", {
    body: data.body || "",
    icon: `/icons/${accent}-192.png`,
    tag: data.tag,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { await w.focus(); if ("navigate" in w) await w.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});
