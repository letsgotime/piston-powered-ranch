/**
 * Ranch Team, installed.
 *
 * One worker for the whole toolset rather than one per surface, because the
 * Team rail moves between thirteen pages and thirteen separate installs would
 * be thirteen icons on a phone for one job.
 *
 * The strategy is deliberately the opposite of a marketing site's.
 *
 *   Navigations go to the network first. A dashboard that serves a cached page
 *   is a dashboard showing yesterday's numbers with today's confidence, which
 *   is worse than one that admits it is offline. The cache is only a fallback
 *   for when the network genuinely is not there, and at the ranch the back
 *   field has no signal at all.
 *
 *   The Data API is never cached, at all, under any condition. Live counts are
 *   the entire point of these pages.
 *
 *   Brand assets are cache first. They do not change and they are the slowest
 *   thing on a cold load over a phone connection.
 *
 * Scope is the origin, so this also covers /chat/. Chat registers its own
 * worker at /chat/, and the more specific scope wins for those pages, so the
 * two do not fight.
 */

/* v2 retires v1. The activate step throws away every cache that is not
   this one, which is how the poisoned copies leave every phone. */
var SHELL = "ranch-team-shell-v2";
var API_HOST = "apirest.c-10.us-east-1.aws.neon.tech";

/* Only the things that make an offline page legible. Deliberately small: a
   large precache is a large thing to get wrong, and these pages are useless
   without live data anyway. */
var FILES = [
  "/team.webmanifest",
  "/brand/rj-icon-192.png",
  "/brand/rj-icon-512.png",
  "/brand/pg-mark.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches
      .open(SHELL)
      .then(function (c) {
        /* One bad URL must not fail the whole install. */
        return Promise.all(
          FILES.map(function (f) {
            return c.add(f).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== SHELL;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }

  /* Live data, never cached. Not stale-while-revalidate either: a number that
     is briefly wrong on a page headed "live" is the failure this whole tool
     exists to prevent. */
  if (url.hostname.indexOf(API_HOST) !== -1) return;

  /* Someone else's origin is their business. */
  if (url.origin !== self.location.origin) return;

  /* Pages: network first, cache only as a fallback, and a clear offline note
     if there is nothing cached either. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          if (!res.ok) return res;
          var copy = res.clone();
          caches.open(SHELL).then(function (c) {
            c.put(req, copy).catch(function () {});
          });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return (
              hit ||
              new Response(
                "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
                  "<title>Offline</title>" +
                  "<body style=\"margin:0;background:#0A1523;color:#DDE3EB;font:16px/1.6 Georgia,serif;display:flex;align-items:center;justify-content:center;height:100vh\">" +
                  "<div style='text-align:center;padding:24px;max-width:34ch'>" +
                  "<div style=\"font:600 11px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#FF1A21\">Ranch Team</div>" +
                  "<p style='margin:14px 0 0'>No signal here. This page needs live data, so it is not going to pretend.</p>" +
                  "<p style='margin:12px 0 0;color:#8B93A7;font-size:14px'>It will load the moment you have a bar.</p>" +
                  "</div></body>",
                { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
              )
            );
          });
        })
    );
    return;
  }

  /* Brand assets and icons: cache first, they do not change. */
  if (/\/brand\/|\.(png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return (
          hit ||
          fetch(req).then(function (res) {
            /* Only what actually arrived. This used to store whatever came
               back, and for the five ground pictures that was a 404 page from
               the days before /img/ was forwarded. The branch below is cache
               first, so that page was then served as the picture, forever,
               on every phone that had ever opened the tool, long after the
               server was fixed. A miss is not a thing to remember. */
            if (!res.ok) return res;
            var copy = res.clone();
            caches.open(SHELL).then(function (c) {
              c.put(req, copy).catch(function () {});
            });
            return res;
          })
        );
      })
    );
  }
});
