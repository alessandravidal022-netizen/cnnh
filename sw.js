const CACHE_NAME = "cnh-pix-v2";
const ASSETS = [
  "/admin/pwa.html",
  "/manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(
    ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("/api/")) return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "CNH PIX", body: "Nova notificação" };
  try { data = e.data ? e.data.json() : data; } catch {}

  const title = data.title || "CNH PIX";
  const options = {
    body: data.body || "",
    icon: data.icon || "https://plain-enam-prod-public.komododecks.com/202609/27/diNPEXPYl4KSyTz8DzNj/image.png",
    badge: data.badge || "https://plain-enam-prod-public.komododecks.com/202609/27/diNPEXPYl4KSyTz8DzNj/image.png",
    tag: data.tag || "pix-notification",
    renotify: true,
    requireInteraction: false,
    vibrate: data.vibrate || [100, 50, 100],
    data: data.data || {},
    actions: [
      { action: "open", title: "Ver detalhes" },
      { action: "close", title: "Fechar" }
    ]
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.action === "open" && e.notification.data?.url
    ? e.notification.data.url
    : "/admin/pwa.html";
  e.waitUntil(clients.matchAll({ type: "window" }).then((list) => {
    for (const client of list) {
      if (client.url.includes(url) && "focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});