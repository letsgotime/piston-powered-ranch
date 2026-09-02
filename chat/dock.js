/**
 * The floating chat dock.
 *
 * Any staff page adds one line and gets a glass pill in the corner carrying
 * its own unread count, and a floating panel that opens the chat over the page
 * rather than navigating away from it:
 *
 *     <script type="module" src="/chat/dock.js"></script>
 *
 * The point is that a conversation should reach whatever you are looking at.
 * A page tells the dock what is on screen:
 *
 *     window.RanchChat.subject("candidate", id, "Big Top Tents");
 *
 * and the pill becomes "Discuss Big Top Tents", opening a thread attached to
 * that row. Clear it with window.RanchChat.subject(null) when the sheet closes.
 *
 * The panel is an iframe of /chat/, same origin, so it shares the signed in
 * session and there is exactly one chat implementation rather than a copy of
 * it embedded in every page.
 */
import { db as makeDb, DATA_API, AUTH_URL as AUTH } from "/vendor/ranch-db.js?v=2026-09-02f";

var db = null, unread = 0, mentioned = false, subject = null, open = false, staff = false;

try {
  db = makeDb();
} catch (e) {}

var css = document.createElement("style");
css.textContent = [
  ".rcDock{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:9998;",
  "display:none;align-items:center;gap:9px;max-width:min(320px,72vw);padding:12px 18px;border-radius:999px;",
  "cursor:pointer;font:inherit;font-size:13.5px;font-weight:700;letter-spacing:-.005em;color:#fff;",
  "background:rgba(17,27,40,.72);border:1px solid rgba(255,255,255,.19);",
  "box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.04) inset;",
  "-webkit-backdrop-filter:blur(22px) saturate(1.6);backdrop-filter:blur(22px) saturate(1.6);",
  "transition:transform .22s cubic-bezier(.16,.84,.32,1),border-color .22s}",
  ".rcDock.on{display:flex}",
  ".rcDock:hover{transform:translateY(-2px);border-color:rgba(248,184,0,.55)}",
  ".rcDock .rcT{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".rcDock .rcI{width:17px;height:17px;flex:0 0 auto;opacity:.92}",
  ".rcDock .rcB{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#00d2be;color:#04211d;",
  "font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}",
  ".rcDock .rcB.at{background:#f8b800;color:#2a1e00}",
  ".rcScrim{position:fixed;inset:0;z-index:9998;background:rgba(4,8,13,.5);",
  "-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .24s}",
  ".rcScrim.on{opacity:1;pointer-events:auto}",
  ".rcPanel{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:9999;",
  "width:min(440px,calc(100vw - 36px));height:min(660px,calc(100vh - 96px));border-radius:22px;overflow:hidden;",
  "background:rgba(11,18,27,.82);border:1px solid rgba(255,255,255,.16);",
  "box-shadow:0 30px 80px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.05) inset;",
  "-webkit-backdrop-filter:blur(26px) saturate(1.6);backdrop-filter:blur(26px) saturate(1.6);",
  "display:flex;flex-direction:column;",
  "opacity:0;transform:translateY(14px) scale(.98);pointer-events:none;",
  "transition:opacity .24s cubic-bezier(.16,.84,.32,1),transform .24s cubic-bezier(.16,.84,.32,1)}",
  ".rcPanel.on{opacity:1;transform:none;pointer-events:auto}",
  ".rcBar{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.11);",
  "font:inherit;font-size:12.5px;font-weight:700;color:#dbe2ea;flex:0 0 auto}",
  ".rcBar .rcTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}",
  ".rcBar button,.rcBar a{font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:none;",
  "color:#a9b4c2;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);",
  "border-radius:999px;padding:5px 11px;white-space:nowrap}",
  ".rcBar button:hover,.rcBar a:hover{color:#fff;border-color:rgba(248,184,0,.5)}",
  ".rcPanel iframe{flex:1;width:100%;border:0;background:transparent}",
  "@media (max-width:620px){",
  ".rcPanel{right:0;left:0;bottom:0;width:100%;height:88vh;border-radius:22px 22px 0 0}",
  ".rcDock{right:12px;bottom:calc(12px + env(safe-area-inset-bottom));font-size:13px;padding:11px 15px}}",
  "@media (prefers-reduced-motion:reduce){.rcPanel,.rcDock,.rcScrim{transition:none}}",
].join("");
document.head.appendChild(css);

var dock = document.createElement("button");
dock.className = "rcDock";
dock.type = "button";
dock.setAttribute("aria-label", "Open team chat");
dock.innerHTML =
  '<svg class="rcI" viewBox="0 0 24 24" fill="none" stroke="#f8b800" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.8-.7L3 21l1.9-4.9A8.3 8.3 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4z"/>' +
  "</svg><span class='rcT'>Chat</span>";
document.body.appendChild(dock);

var scrim = document.createElement("div");
scrim.className = "rcScrim";
document.body.appendChild(scrim);

var panel = document.createElement("div");
panel.className = "rcPanel";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Team chat");
panel.innerHTML =
  '<div class="rcBar"><span class="rcTitle">Team chat</span>' +
  '<a class="rcFull" href="/chat/" target="_blank" rel="noopener">Full window</a>' +
  '<button class="rcX" type="button" aria-label="Close chat">Close</button></div>';
var frame = document.createElement("iframe");
frame.title = "Team chat";
panel.appendChild(frame);
document.body.appendChild(panel);

function label() {
  var t = dock.querySelector(".rcT");
  t.textContent = subject ? "Discuss " + subject.title : "Chat";
  var old = dock.querySelector(".rcB");
  if (old) old.remove();
  if (unread > 0) {
    var b = document.createElement("span");
    b.className = "rcB" + (mentioned ? " at" : "");
    b.textContent = mentioned ? "@" : String(unread);
    dock.appendChild(b);
  }
}

function src(embed) {
  var base = "/chat/" + (embed ? "?embed=1" : "");
  if (subject) {
    return base + "#s=" + subject.kind + ":" + encodeURIComponent(subject.id) +
      ":" + encodeURIComponent(subject.title || "");
  }
  return base;
}

function show(on) {
  open = on;
  panel.classList.toggle("on", on);
  scrim.classList.toggle("on", on);
  panel.querySelector(".rcTitle").textContent = subject ? subject.title : "Team chat";
  panel.querySelector(".rcFull").href = src(false);
  if (on) {
    /* Reload on every open so a subject change lands, and so the thread is
       never a stale copy from the last time the panel was used. */
    frame.src = src(true);
  } else {
    frame.src = "about:blank";
    setTimeout(count, 900);
  }
}

dock.addEventListener("click", function () { show(!open); });
panel.querySelector(".rcX").addEventListener("click", function () { show(false); });
scrim.addEventListener("click", function () { show(false); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) show(false); });

async function count() {
  if (!db) return;
  var s = await db.auth.getSession();
  var tok = s && s.data && s.data.session && s.data.session.access_token;
  if (!tok) { staff = false; dock.classList.remove("on"); return; }
  try {
    var r = await fetch(DATA_API + "/rpc/my_unread", {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) { dock.classList.remove("on"); return; }
    var rows = await r.json();
    if (!Array.isArray(rows)) { dock.classList.remove("on"); return; }
    staff = true;
    unread = rows.reduce(function (n, x) { return n + (x.unread || 0); }, 0);
    mentioned = rows.some(function (x) { return x.mentioned; });
    dock.classList.add("on");
    label();
  } catch (e) { dock.classList.remove("on"); }
}

window.RanchChat = {
  /* kind null clears it and the pill goes back to plain Chat */
  subject: function (kind, id, title) {
    subject = kind ? { kind: kind, id: String(id), title: title || String(id) } : null;
    label();
    if (open) show(true);
  },
  open: function () { if (staff) show(true); },
  close: function () { show(false); },
  refresh: count,
};

count();
setInterval(function () { if (!document.hidden && !open) count(); }, 15000);
