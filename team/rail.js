/**
 * The team rail.
 *
 * Every staff tool was built as its own page with its own design, and that was
 * right: the board, Journeys, the map and the awards want different shapes.
 * What they never had was a shared edge, so moving between them meant knowing
 * the URL or going back through Journeys.
 *
 * This adds one: a glass rail down the left on a laptop, a pill at the top on a
 * phone, carrying every destination and live counts of the three things that
 * actually need a person. Each page keeps its own layout untouched; the rail
 * shifts the body over rather than restyling anything inside it.
 *
 *     <script type="module" src="/team/rail.js"></script>
 *
 * Staff only, on the same is_staff() the rest of the estate uses. Signed out it
 * renders nothing at all, which is why it is safe on pages that also have a
 * public face.
 */
import { db as makeDb, DATA_API, AUTH_URL as AUTH } from "/vendor/ranch-db.js?v=2026-09-02f";

var W = 60, WIDE = 208;

/* label, href, glyph, and which badge it carries */
var NAV = [
  ["Journeys", "/journeys/", "M4 5h16M4 12h16M4 19h10", "decisions"],
  ["Targets", "https://pistonpoweredranch.com/targets", "M12 3v18 M3 12h18 M12 7a5 5 0 100 10 5 5 0 000-10z", "empty"],
  ["The Board", "/board/", "M4 4h6v7H4z M14 4h6v11h-6z M4 15h6v5H4z M14 19h6", null],
  ["The Asks", "/asks/", "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01", null],
  ["Crew", "/crew/", "M17 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9.5 6.5a3 3 0 106 0 3 3 0 00-6 0 M22 20v-2a4 4 0 00-3-3.9", "short"],
  ["Spectators", "/rsvps/", "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z M12 9a3 3 0 100 6 3 3 0 000-6z", "rsvp"],
  ["The Awards", "/judging/", "M8 4h8v5a4 4 0 01-8 0z M12 13v4 M9 21h6 M5 5h3 M16 5h3", null],
  ["Map", "/map/", "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14", null],
  ["Site plan", "/site-plan/", "M4 4h16v16H4z M4 10h16 M10 10v10", null],
  ["Collateral", "/collateral/", "M6 3h9l4 4v14H6z M15 3v4h4", null],
  ["Brand kit", "/brand/rancho/", "M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z", null],
  ["Chat", "/chat/", "M21 11.5a8.4 8.4 0 01-9 8.4 9.9 9.9 0 01-3.8-.7L3 21l1.9-4.9A8.3 8.3 0 013.6 11.5a8.4 8.4 0 019-8.4 8.4 8.4 0 018.4 8.4z", "chat"],
];

/* Who owns what, in the order that person should meet it.
 *
 * This ranks attention. It does not remove access: anything not listed for a
 * role still appears below a divider, because at six in the morning on the
 * tenth somebody will need a page that is not theirs, and a menu that hid it
 * would be a menu they route around. Thinner, not weaker.
 *
 * Owner is deliberately null: Gavin carries all of it, so splitting his rail
 * would be pretending otherwise.
 *
 * Roles come from public.staff_allowlist, the same table is_staff() reads, so
 * the menu and the row level policies can never disagree about who someone is.
 */
/* This list has a twin: lib/tools.ts in the paddockgavin repo, which the CRM
   rail and the roles sheet both read. The two repos cannot import from each
   other, so this is the one copy that has to be kept in step by hand. Labels,
   paths and the FOCUS ordering below must match it. If you change one, change
   the other in the same sitting. */
var FOCUS = {
  /* Deliberately unranked, and the one place this list differs from its twin:
     the roles sheet shows Gavin a "leads with" six, because a card needs a
     short list, while the rail itself ranks nothing for him. */
  Owner: null,
  /* Oscar owns the ground. The land, who is standing on it, and the plan. */
  "Property Owner": ["/journeys/", "/map/", "/site-plan/", "/crew/", "/rsvps/", "/chat/"],
  /* Bekah carries the brand and everyone we are talking to. */
  "Brand Director": ["https://pistonpoweredranch.com/targets", "/console/#/ops", "/collateral/", "/brand/rancho/", "/asks/", "/chat/"],
  /* Arnie and Josh work the chase and the day itself. Journeys sits below
     the divider for them rather than being hidden: they can open it, and the
     money columns are withheld by can_see_money() rather than by this file. */
  Member: ["https://pistonpoweredranch.com/targets", "/crew/", "/board/", "/asks/", "/chat/"],
};

/* The chat runs inside the floating dock's iframe. A rail in there would be a
   rail inside a panel inside a page, so it stops before it builds anything. */
if (window.self !== window.top || location.search.indexOf("embed=1") > -1) {
  throw new Error("team rail: not in an embedded frame");
}

var db = null, counts = {}, me = "", role = "", people = {};

try {
  db = makeDb();
} catch (e) {}

var css = document.createElement("style");
css.textContent = [
  ":root{--tr-w:" + W + "px}",
  ".tRail{position:fixed;left:0;top:0;bottom:0;z-index:9990;width:var(--tr-w);",
  "display:none;flex-direction:column;overflow:hidden;",
  "background:rgba(11,18,27,.74);border-right:1px solid rgba(255,255,255,.11);",
  "-webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5);",
  "transition:width .2s cubic-bezier(.16,.84,.32,1)}",
  ".tRail.on{display:flex}",
  ".tRail:hover,.tRail:focus-within{width:" + WIDE + "px}",
  ".tRail .tTop{flex:0 0 auto;padding:13px 0 11px;display:flex;align-items:center;",
  "gap:11px;padding-left:17px;border-bottom:1px solid rgba(255,255,255,.09)}",
  ".tRail .tTop img{width:26px;height:auto;flex:0 0 auto}",
  ".tRail .tWord{font:700 12.5px/1 Archivo,system-ui,sans-serif;letter-spacing:-.01em;color:#fff;",
  "white-space:nowrap;opacity:0;transition:opacity .16s}",
  ".tRail:hover .tWord,.tRail:focus-within .tWord{opacity:1}",
  ".tRail nav{flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 0}",
  ".tRail a{display:flex;align-items:center;gap:13px;height:42px;padding-left:18px;",
  "text-decoration:none;color:#a9b4c2;position:relative;white-space:nowrap}",
  ".tRail a:hover{background:rgba(255,255,255,.06);color:#fff}",
  ".tRail a.here{color:#fff;background:rgba(248,184,0,.1)}",
  ".tRail a.here::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;",
  "border-radius:0 3px 3px 0;background:#f8b800}",
  ".tRail a svg{width:19px;height:19px;flex:0 0 auto}",
  ".tRail a span{font:600 13px/1 Archivo,system-ui,sans-serif;letter-spacing:-.005em;",
  "opacity:0;transition:opacity .16s}",
  ".tRail:hover a span,.tRail:focus-within a span{opacity:1}",
  ".tRail a b{position:absolute;left:31px;top:7px;min-width:16px;height:16px;padding:0 4px;",
  "border-radius:999px;background:#00d2be;color:#04211d;font:900 10px/16px Archivo,system-ui,sans-serif;",
  "text-align:center;transition:all .16s}",
  ".tRail a b.at{background:#f8b800;color:#2a1e00}",
  ".tRail a b.warn{background:#E5141A;color:#fff}",
  ".tRail:hover a b,.tRail:focus-within a b{left:auto;right:14px;top:13px}",
  /* Group headings. Collapsed to a hairline when the rail is narrow, so the
     icons stay evenly spaced and the words appear with everything else. */
  ".tRail .tGrp{margin:14px 0 5px;padding:0 0 0 2px;font:700 9px/1 Archivo,system-ui,sans-serif;",
  "letter-spacing:.18em;text-transform:uppercase;color:#5d6875;white-space:nowrap;",
  "opacity:0;transition:opacity .16s ease}",
  ".tRail .tGrp:first-child{margin-top:2px}",
  ".tRail:hover .tGrp,.tRail:focus-within .tGrp{opacity:1}",
  /* Narrow rail: a rule instead of a word, so the split still reads. */
  ".tRail .tGrp::after{content:\"\";display:block;height:1px;background:rgba(255,255,255,.13);",
  "margin-top:5px}",
  ".tRail .tMe i{display:block;font:600 9.5px/1.5 Archivo,system-ui,sans-serif;font-style:normal;",
  "letter-spacing:.13em;text-transform:uppercase;color:#5d6875}",
  ".tRail .tMe{flex:0 0 auto;display:flex;align-items:center;gap:11px;padding:11px 0 ",
  "calc(11px + env(safe-area-inset-bottom));padding-left:17px;",
  "border-top:1px solid rgba(255,255,255,.09);white-space:nowrap}",
  ".tRail .tMe .av{width:26px;height:26px;border-radius:50%;object-fit:cover;flex:0 0 auto;",
  "background:#00d2be;color:#04211d;font:900 10px/26px Archivo,system-ui,sans-serif;text-align:center}",
  ".tRail .tMe span{font:600 11.5px/1 Archivo,system-ui,sans-serif;color:#7f8a99;",
  "opacity:0;transition:opacity .16s}",
  ".tRail:hover .tMe span,.tRail:focus-within .tMe span{opacity:1}",
  /* phone: the rail becomes a sheet behind a pill, so no page layout is touched */
  "@media (max-width:900px){",
  ".tRail{width:100%;max-width:280px;transform:translateX(-101%);display:flex;",
  "transition:transform .24s cubic-bezier(.16,.84,.32,1);box-shadow:0 0 40px rgba(0,0,0,.6)}",
  ".tRail.open{transform:none}",
  ".tRail .tWord,.tRail a span,.tRail .tMe span{opacity:1}",
  ".tRail a b{left:auto;right:14px;top:13px}",
  ".tPill{display:flex}}",
  ".tPill{position:fixed;left:12px;top:calc(10px + env(safe-area-inset-top));z-index:9991;",
  "display:none;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:999px;",
  "cursor:pointer;border:1px solid rgba(255,255,255,.19);background:rgba(11,18,27,.8);",
  "-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);color:#fff;",
  "font:700 12.5px/1 Archivo,system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.45)}",
  ".tPill b{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#f8b800;",
  "color:#2a1e00;font:900 10px/16px Archivo,system-ui,sans-serif}",
  ".tScrim{position:fixed;inset:0;z-index:9989;background:rgba(4,8,13,.55);display:none}",
  ".tScrim.on{display:block}",
  "@media (prefers-reduced-motion:reduce){.tRail{transition:none}}",
].join("");
document.head.appendChild(css);

var rail = document.createElement("aside");
rail.className = "tRail";
rail.setAttribute("aria-label", "Team navigation");

var pill = document.createElement("button");
pill.className = "tPill";
pill.type = "button";
pill.setAttribute("aria-label", "Open team navigation");
pill.innerHTML = "<span>Team</span>";

var scrim = document.createElement("div");
scrim.className = "tScrim";

function here(href) {
  var p = location.pathname;
  /* One file, one address. A panel hash still counts as being on Journeys. */
  if (href.indexOf("/journeys/") === 0) return p.indexOf("/journeys") === 0;
  return p.indexOf(href) === 0;
}

function paint() {
  var badge = function (kind) {
    var n = counts[kind];
    if (!n) return "";
    var cls = kind === "chat" ? (counts.mentioned ? " at" : "") : kind === "empty" || kind === "short" ? " warn" : " at";
    return "<b class='" + cls.trim() + "'>" + (n > 99 ? "99+" : n) + "</b>";
  };
  var link = function (n) {
    return "<a href='" + n[1] + "'" + (here(n[1]) ? " class='here'" : "") + " title='" + n[0] + "'>" +
      "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' " +
      "stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='" + n[2] + "'/></svg>" +
      "<span>" + n[0] + "</span>" + (n[3] ? badge(n[3]) : "") + "</a>";
  };

  /* Rank by responsibility. An unknown role falls through to the full list
     rather than to an empty rail: failing open is right for navigation, where
     failing closed strands somebody mid job. */
  var want = Object.prototype.hasOwnProperty.call(FOCUS, role) ? FOCUS[role] : null;
  var body;
  if (!want) {
    body = NAV.map(link).join("");
  } else {
    var mine = [];
    want.forEach(function (href) {
      NAV.forEach(function (n) { if (n[1] === href) mine.push(n); });
    });
    var rest = NAV.filter(function (n) { return want.indexOf(n[1]) === -1; });
    body =
      "<p class='tGrp'>Yours</p>" + mine.map(link).join("") +
      (rest.length ? "<p class='tGrp'>Everything else</p>" + rest.map(link).join("") : "");
  }

  rail.innerHTML =
    "<div class='tTop'><img src='/brand/pg-mark.png' alt='' /><span class='tWord'>The Ranch</span></div><nav>" +
    body +
    "</nav><div class='tMe'>" + avatar() + "<span>" + esc(nameOf(me)) +
    (role ? "<i>" + esc(role) + "</i>" : "") + "</span></div>";

  var tot = (counts.decisions || 0) + (counts.chat || 0) + (counts.short || 0);
  pill.innerHTML = "<span>Team</span>" + (tot ? "<b>" + (tot > 99 ? "99+" : tot) + "</b>" : "");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function nameOf(email) {
  var p = people[String(email || "").toLowerCase()];
  return (p && p.full_name) || String(email || "").split("@")[0] || "";
}
function avatar() {
  var p = people[String(me).toLowerCase()];
  if (p && p.avatar_path && p.signed) return "<img class='av' src='" + esc(p.signed) + "' alt='' />";
  var n = nameOf(me) || "?";
  var ini = n.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  return "<span class='av'>" + esc(ini) + "</span>";
}

async function token() {
  try {
    var s = await db.auth.getSession();
    return (s && s.data && s.data.session && s.data.session.access_token) || null;
  } catch (e) { return null; }
}
async function rpc(fn, tok) {
  var r = await fetch(DATA_API + "/rpc/" + fn, {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) return null;
  var t = await r.text();
  try { return JSON.parse(t); } catch (e) { return t.trim(); }
}

async function load() {
  if (!db) return;
  var tok = await token();
  if (!tok || (await rpc("is_staff", tok)) !== true) {
    /* Signed out, the rail used to disappear entirely, which left every staff
       tool looking like an island with no way back to Journeys, the console or
       anywhere else. Navigation should not vanish because auth has not
       resolved. Show a way in instead. */
    rail.classList.add("on");
    pill.classList.add("on");
    rail.style.display = "";
    pill.style.display = "";
    pill.innerHTML = "<span>Sign in</span>";
    pill.onclick = function () { location.href = "/console/"; };
    rail.innerHTML =
      "<div class='tTop'><img src='/brand/pg-mark.png' alt='' /><span class='tWord'>The Ranch</span></div>" +
      // /console/ is where the sign in form lives, and the only reason to
      // send anyone there. Signed in, it hands straight on to Journeys.
      "<nav><a href='/console/' title='Sign in'>" +
      "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' " +
      "stroke-linejoin='round' aria-hidden='true'><path d='M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4 M10 17l5-5-5-5 M15 12H3'/></svg>" +
      "<span>Sign in</span></a></nav>" +
      "<div class='tMe'><span>Not signed in</span></div>";
    if (window.innerWidth > 900) document.body.style.paddingLeft = W + "px";
    return;
  }
  rail.style.display = ""; pill.style.display = "";
  rail.classList.add("on");
  if (window.innerWidth > 900) document.body.style.paddingLeft = W + "px";

  me = (await rpc("me", tok)) || "";
  /* One row, the signed in person's. RLS on staff_allowlist already limits
     this to staff, so a filter here is for bytes rather than for safety. */
  try {
    var al = await db.from("staff_allowlist").select("email,role");
    var mine = (al.data || []).filter(function (x) {
      return String(x.email).toLowerCase() === String(me).toLowerCase();
    })[0];
    role = (mine && mine.role) || "";
  } catch (e) { role = ""; }
  try {
    var pr = await db.from("profiles").select("email,full_name,avatar_path");
    (pr.data || []).forEach(function (x) { people[String(x.email).toLowerCase()] = x; });
  } catch (e) {}

  /* Three counts, because a rail full of numbers is a rail nobody reads:
     unread chat, decisions still open, and posts short of people. */
  try {
    var u = await rpc("my_unread", tok);
    if (Array.isArray(u)) {
      counts.chat = u.reduce(function (n, x) { return n + (x.unread || 0); }, 0);
      counts.mentioned = u.some(function (x) { return x.mentioned; });
    }
  } catch (e) {}
  try {
    var d = await db.from("open_decisions").select("id,status");
    if (!d.error) counts.decisions = (d.data || []).filter(function (x) { return x.status === "open"; }).length;
  } catch (e) {}
  try {
    var sh = await db.from("volunteer_shifts").select("id,needed");
    var as = await db.from("volunteer_assignments").select("shift_id,status");
    if (!sh.error && !as.error) {
      var by = {};
      (as.data || []).forEach(function (a) { if (a.status !== "declined") by[a.shift_id] = (by[a.shift_id] || 0) + 1; });
      counts.short = (sh.data || []).filter(function (s) { return (by[s.id] || 0) < s.needed; }).length;
    }
  } catch (e) {}
  try {
    var c = await db.from("categories").select("id");
    var k = await db.from("account_candidates").select("category_id");
    if (!c.error && !k.error) {
      var hit = {};
      (k.data || []).forEach(function (x) { if (x.category_id != null) hit[x.category_id] = 1; });
      counts.empty = (c.data || []).filter(function (x) { return !hit[x.id]; }).length;
    }
  } catch (e) {}
  try {
    var sp = await db.from("spectators").select("created_at");
    if (!sp.error) {
      var wk = Date.now() - 6048e5;
      counts.rsvp = (sp.data || []).filter(function (x) { return new Date(x.created_at) > wk; }).length;
    }
  } catch (e) {}
  try {
    var q = await db.from("submissions").select("status");
    if (!q.error) counts.queue = (q.data || []).filter(function (x) { return x.status === "pending"; }).length;
  } catch (e) {}
  paint();
}

function sheet(open) {
  rail.classList.toggle("open", open);
  scrim.classList.toggle("on", open);
}
pill.addEventListener("click", function () { sheet(!rail.classList.contains("open")); });
scrim.addEventListener("click", function () { sheet(false); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") sheet(false); });
window.addEventListener("resize", function () {
  document.body.style.paddingLeft =
    window.innerWidth > 900 && rail.classList.contains("on") ? W + "px" : "";
  if (window.innerWidth > 900) sheet(false);
});

document.body.appendChild(scrim);
document.body.appendChild(rail);
document.body.appendChild(pill);
rail.style.display = "none"; pill.style.display = "none";
paint();
load();
setInterval(function () { document.hidden || load(); }, 45000);
