/**
 * Chat, installed.
 *
 * The shell is cached so the app opens instantly and shows something honest
 * when the phone has no signal, which at the ranch is most of the back field.
 * Messages are never cached: they are the one thing that must be current, so
 * every API call goes to the network and fails loudly rather than serving a
 * stale conversation that looks live.
 */
var SHELL = "ranch-chat-shell-v4";
var FILES = [
  "/chat/",
  "/chat/index.html",
  "/chat/manifest.webmanifest",
  "/brand/pg-mark.png",
  "/brand/rj-icon-192.png",
  "/brand/rj-icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      /* one bad URL must not fail the whole install */
      return Promise.all(FILES.map(function (f) { return c.add(f).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== SHELL; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  /* Anything that is data stays on the network, always. */
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  /* Network first for the document, so a deploy lands without a hard reload,
     with the cached shell as the fallback when there is no signal. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(function (r) {
          var copy = r.clone();
          caches.open(SHELL).then(function (c) { c.put("/chat/index.html", copy); });
          return r;
        })
        .catch(function () {
          return caches.match("/chat/index.html").then(function (m) {
            return m || new Response("Offline, and the shell was never cached.", {
              status: 503, headers: { "Content-Type": "text/plain" } });
          });
        })
    );
    return;
  }

  /* Static assets: cache first, refresh behind the scenes. */
  if (/\.(png|jpg|jpeg|webp|avif|svg|webmanifest|css)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (r) {
          if (r && r.status === 200) {
            var copy = r.clone();
            caches.open(SHELL).then(function (c) { c.put(req, copy); });
          }
          return r;
        }).catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});
