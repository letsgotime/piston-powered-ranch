/**
 * Generates collateral/captions.html from PPR_Social_Captions.md.
 * One card per platform section, each with a copy button that copies the
 * caption text exactly. Re-run after editing the md:
 *
 *   node tools/build-captions-page.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("collateral/files/PPR_Social_Captions.md", "utf8");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// sections: "## Platform: label" followed by body until next ## or ---
const parts = md.split(/^## /m).slice(1);
const PAIR = {
  "Instagram: feed post": "Pair with the Social Square graphic",
  "Instagram: story": "Pair with the Social Story graphic",
  "Facebook: event or page post": "Pair with the Social Square graphic",
  "TikTok: caption": "Pair with the Social Story graphic",
};
const sections = parts.map((p) => {
  const nl = p.indexOf("\n");
  const heading = p.slice(0, nl).trim();
  let body = p.slice(nl + 1).replace(/^---$/gm, "").trim();
  const key = Object.keys(PAIR).find((k) => heading.startsWith(k.split(" (")[0]));
  return { heading, body, pair: key ? PAIR[key] : "" };
});

let cards = "";
for (const s of sections) {
  cards += `
      <article class="cap">
        <div class="cap-head">
          <h2>${esc(s.heading)}</h2>
          <button class="copybtn" type="button">Copy caption</button>
        </div>
        ${s.pair ? `<p class="pair">${esc(s.pair)}, from the collateral kit.</p>` : ""}
        <pre>${esc(s.body)}</pre>
      </article>`;
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Caption Pack · The Piston Powered Ranch</title>
    <meta name="description" content="Ready-to-post captions for The Piston Powered Ranch. Copy, paste, post." />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#0d1620" />
    <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png" />
    <style>
      :root{--bg:#0d1620;--surface:#121d2a;--surface-2:#16222f;--ink:#fff;--ink-dim:#c4cbd6;--ink-mute:#8b95a3;--accent:#f8b800;--accent-2:#00d2be;--line:#27384f;--line-soft:#1c2a3d}
      *{box-sizing:border-box}
      body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
      .rule{height:3px;background:linear-gradient(90deg,var(--accent) 0 25%,var(--accent-2) 25% 50%,#005185 50% 75%,#8b95a3 75% 100%)}
      .wrap{max-width:760px;margin:0 auto;padding:34px 20px 64px}
      .eyebrow{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-mute);display:flex;align-items:center;gap:8px}
      .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
      h1{font-size:clamp(28px,6.4vw,42px);line-height:1.06;margin:10px 0 0;letter-spacing:-.02em}
      h1 .accent{color:var(--accent)}
      .lede{color:var(--ink-dim);font-size:16.5px;margin:14px 0 0;max-width:56ch}
      .back{display:inline-flex;align-items:center;gap:6px;margin-top:16px;color:var(--accent-2);text-decoration:none;font-size:13.5px;font-weight:600}
      .cap{background:var(--surface);border:1px solid var(--line-soft);border-radius:16px;padding:20px 22px;margin-top:20px}
      .cap-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
      .cap h2{font-size:15px;margin:0;letter-spacing:.01em}
      .pair{margin:6px 0 0;color:var(--accent-2);font-size:12.5px}
      .cap pre{margin:14px 0 0;white-space:pre-wrap;font-family:inherit;font-size:14.5px;line-height:1.7;color:var(--ink-dim);background:var(--surface-2);border:1px solid var(--line-soft);border-radius:10px;padding:14px 16px}
      .copybtn{font:inherit;font-size:13px;font-weight:650;color:#151000;background:var(--accent);border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
      .copybtn.done{background:var(--accent-2);color:#00302b}
      footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--line-soft);color:var(--ink-mute);font-size:13px}
    </style>
  </head>
  <body>
    <div class="rule"></div>
    <div class="wrap">
      <img src="/brand/pg-mark.png" alt="PaddockGavin" style="height:44px;width:auto;margin-bottom:14px" />
      <div class="eyebrow"><span class="dot"></span>Caption Pack</div>
      <h1>Ready to<br /><span class="accent">Post</span></h1>
      <p class="lede">
        One caption per platform, written to pair with the graphics in the collateral kit. Tap
        copy, paste it into the app, attach the matching graphic, post.
      </p>
      <a class="back" href="/collateral/">Back to the collateral kit</a>
${cards}
      <footer>
        © 2026 PaddockGavin. All rights reserved. Part of the Paddock20 family.
      </footer>
    </div>
    <script>
      document.addEventListener("click", function (e) {
        var b = e.target.closest(".copybtn");
        if (!b) return;
        var text = b.closest(".cap").querySelector("pre").textContent;
        navigator.clipboard.writeText(text).then(function () {
          b.textContent = "Copied";
          b.classList.add("done");
          setTimeout(function () {
            b.textContent = "Copy caption";
            b.classList.remove("done");
          }, 1600);
        });
      });
    </script>
  </body>
</html>
`;
writeFileSync("collateral/captions.html", html);
console.log("captions.html:", sections.length, "sections");
