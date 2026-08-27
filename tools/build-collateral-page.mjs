/**
 * Generates collateral/index.html from whatever is in collateral/files.
 *
 * Cards are written into the markup as static HTML so the page works with
 * JavaScript disabled; JS only layers on filtering, search, preview and
 * copy-link. Re-run after adding or replacing a deliverable:
 *
 *   node tools/build-collateral-page.mjs
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = "collateral";
const FILES = join(DIR, "files");
const THUMBS = join(DIR, "thumbs");

/** Ordered catalogue. Copy is written, not derived, so the page reads like a
 *  person made it. `aud` drives the filter chips. */
const CATALOG = [
  {
    base: "PPR_Proposal_RanchoJaramillo",
    title: "Venue Proposal",
    aud: "ranch",
    group: "For the ranch",
    blurb:
      "The full proposal for Rancho Jaramillo: terms, revenue share and what the day asks of the venue.",
  },
  {
    base: "PPR_OnePager_TitleSponsor_111Motorcars",
    title: "Title Sponsor Pitch",
    aud: "title",
    group: "Sponsorship",
    sensitive: true,
    blurb: "The premier title position pitch. One title, top billing.",
  },
  {
    base: "PPR_OnePager_Sponsors",
    title: "Sponsorship One-Pager",
    aud: "sponsors",
    group: "Sponsorship",
    blurb: "Every tier and what each one includes. The general ask.",
  },
  {
    base: "PPR_Teaser_Sponsors",
    title: "Sponsorship Teaser",
    aud: "sponsors",
    group: "Sponsorship",
    blurb: "Two-page short form. Send this first, lead with the one-pager after.",
  },
  {
    base: "PPR_OnePager_Vendors",
    title: "Vendor One-Pager",
    aud: "vendors",
    group: "Vendors",
    blurb: "Booth rates, what's included, and how to apply.",
  },
  {
    base: "PPR_Teaser_Vendors",
    title: "Vendor Teaser",
    aud: "vendors",
    group: "Vendors",
    blurb: "Short form for group chats and vendor pages.",
  },
  {
    base: "PPR_OnePager_CarCommunity",
    title: "Car Community One-Pager",
    aud: "community",
    group: "Car community",
    blurb: "For clubs and enthusiast groups. What the day is and who it's for.",
  },
  {
    base: "PPR_Teaser_CarCommunity",
    title: "Car Community Teaser",
    aud: "community",
    group: "Car community",
    blurb: "Built to be forwarded. The one that travels.",
  },
  {
    base: "PPR_OnePager_OpenCall",
    title: "Open Call",
    aud: "community",
    group: "Car community",
    blurb: "The call for entries. Submissions are by approval.",
  },
  {
    base: "PPR_OnePager_Volunteers",
    title: "Volunteers",
    aud: "volunteers",
    group: "Team",
    blurb: "Roles, hours and the ask, for recruiting day-of help.",
  },
  {
    base: "PPR_Social_Square_1080x1080",
    title: "Social Square",
    aud: "community",
    group: "Social",
    blurb: "1080 × 1080. Feed posts.",
    imageOnly: true,
  },
  {
    base: "PPR_Social_Story_1080x1920",
    title: "Social Story",
    aud: "community",
    group: "Social",
    blurb: "1080 × 1920. Stories and Reels.",
    imageOnly: true,
  },
  {
    base: "PPR_Social_Captions",
    title: "Caption Pack",
    aud: "community",
    group: "Social",
    blurb: "Written captions for Instagram, Facebook and stories. Copy, paste, post.",
    textOnly: true,
  },
];

const CHIPS = [
  ["all", "Everything"],
  ["ranch", "For the ranch"],
  ["title", "Title sponsor"],
  ["sponsors", "Sponsors"],
  ["vendors", "Vendors"],
  ["community", "Car community"],
  ["volunteers", "Volunteers"],
];

const human = (b) =>
  b < 1024
    ? `${b} B`
    : b < 1048576
      ? `${Math.round(b / 1024)} KB`
      : `${(b / 1048576).toFixed(1)} MB`;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const present = new Set(readdirSync(FILES));
const size = (n) => (present.has(n) ? statSync(join(FILES, n)).size : 0);
const thumbFor = (base) => {
  for (const c of [`${base}.jpg`, `${base}_p1.jpg`])
    if (existsSync(join(THUMBS, c))) return `thumbs/${c}`;
  return present.has(`${base}.png`) ? `files/${base}.png` : null;
};
/** Preview target. Thumbnails are only 320px wide, so a lightbox built on them
 *  renders small and soft. The full PNG render is sharp at any size and is only
 *  fetched when someone deliberately taps preview. */
const previewFor = (base, thumb) => {
  for (const c of [`${base}.png`, `${base}_p1.png`]) if (present.has(c)) return `files/${c}`;
  return thumb;
};

function assetsFor(it) {
  const out = [];
  const push = (name, kind, label, hint) =>
    present.has(name) && out.push({ name, kind, label, hint, sizeLabel: human(size(name)) });
  if (it.textOnly) {
    push(`${it.base}.md`, "image", "Captions", "Plain text, opens anywhere");
    return out;
  }
  if (!it.imageOnly) {
    push(`${it.base}.pdf`, "screen", "PDF", "Text or email this");
    push(`${it.base}_PRINT.pdf`, "print", "Print PDF", "Take to FedEx Office");
  }
  if (present.has(`${it.base}.png`))
    push(`${it.base}.png`, "image", "PNG", "Image, drops into any chat");
  for (const p of ["p1", "p2"])
    push(
      `${it.base}_${p}.png`,
      "image",
      `PNG ${p.toUpperCase()}`,
      `Page ${p.slice(1)} as an image`,
    );
  return out;
}

const groups = new Map();
let total = 0;
for (const it of CATALOG) {
  const assets = assetsFor(it);
  if (!assets.length) continue;
  total += assets.length;
  if (!groups.has(it.group)) groups.set(it.group, []);
  const thumb = thumbFor(it.base);
  groups.get(it.group).push({ ...it, assets, thumb, preview: previewFor(it.base, thumb) });
}

let cards = "";
for (const [group, items] of groups) {
  cards += `\n        <section class="group" data-group="${esc(group)}">\n          <h2>${esc(group)}</h2>\n          <div class="grid">`;
  for (const it of items) {
    const btns = it.assets
      .map(
        (a) =>
          `<a class="dl ${a.kind}" href="files/${encodeURIComponent(a.name)}" download title="${esc(a.hint)}">` +
          `<span class="k">${esc(a.label)}</span><span class="s">${esc(a.sizeLabel)}</span></a>`,
      )
      .join("");
    cards +=
      `\n            <article class="card" data-aud="${it.aud}" data-name="${esc((it.title + " " + it.blurb).toLowerCase())}">` +
      (it.thumb
        ? `<button class="thumb" data-full="${esc(it.preview)}" aria-label="Preview ${esc(it.title)}">` +
          `<img src="${esc(it.thumb)}" alt="" decoding="async" /></button>`
        : `<div class="thumb noimg"></div>`) +
      `<div class="body"><h3>${esc(it.title)}</h3><p>${esc(it.blurb)}</p><div class="btns">${btns}</div>` +
      `<button class="copy" data-file="files/${encodeURIComponent(it.assets[0].name)}">Copy link</button>` +
      `</div></article>`;
  }
  cards += `\n          </div>\n        </section>`;
}

const chips = CHIPS.map(
  (c, i) => `<button class="chip${i === 0 ? " on" : ""}" data-f="${c[0]}">${esc(c[1])}</button>`,
).join("");

const tpl = readFileSync(join("tools", "collateral-template.html"), "utf8");
writeFileSync(
  join(DIR, "index.html"),
  tpl
    .replace("<!--CHIPS-->", chips)
    .replace("<!--CARDS-->", cards)
    .replace("<!--COUNT-->", String(total)),
);
console.log(`collateral/index.html: ${groups.size} groups, ${total} downloadable files`);
