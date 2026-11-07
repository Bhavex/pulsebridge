const VERSION = "pb-v3-1";
const SHELL = [
  "./", "index.html", "login.html", "find-donors.html", "contact-request.html", "my-requests.html", "donate.html",
  "about.html", "privacy.html", "confirm.html", "css/style.css", "css/theme.css", "css/home.css", "js/home3d.js", "js/vendor/three.module.min.js", "js/vendor/gsap.min.js", "js/vendor/ScrollTrigger.min.js", "js/ui.js", "js/auth.js", "js/supabase-config.js",
  "js/donors.js", "js/requests.js", "js/donor-portal.js", "js/confirm.js", "js/vendor/supabase.js",
  "pulsebridge-logo.svg", "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/admin.html") || url.pathname.endsWith("/js/admin.js")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic" && !url.search) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("index.html")))
  );
});
