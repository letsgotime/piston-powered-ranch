/**
 * Scans press/files and writes manifest.json for the download page.
 *
 * Run after dropping new deliverables in:  node tools/build-press-manifest.mjs
 * The page renders whatever the manifest lists, so adding a file is a drop-in
 * plus a rerun — no editing markup.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "press/files";

const AUDIENCE = {
  Sponsors: { label: "Sponsors", blurb: "General sponsorship pitch." },
  TitleSponsor_111Motorcars: {
    label: "Title Sponsor — 111 Motorcars",
    blurb: "Named pitch for the Franklin dealership.",
    sensitive: true,
  },
  Vendors: { label: "Vendors", blurb: "Booth pitch, $250 rate." },
  CarCommunity: { label: "Car Community", blurb: "Social announcement for enthusiasts." },
};

const KIND = {
  OnePager: { label: "One-Pager", order: 1 },
  Teaser: { label: "Teaser", order: 2 },
  Social: { label: "Social Graphic", order: 3 },
};

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const files = readdirSync(DIR).filter((f) => /\.(pdf|png|jpe?g)$/i.test(f));
const items = files.map((name) => {
  const size = statSync(join(DIR, name)).size;
  const isPrint = /_PRINT\.pdf$/i.test(name);
  const base = name.replace(/_PRINT\.pdf$/i, ".pdf");
  const m = base.match(/^PPR_(OnePager|Teaser|Social)_(.+)\.(pdf|png|jpe?g)$/i);
  const kindKey = m ? m[1] : "Other";
  const audKey = m ? m[2] : name;
  const aud = AUDIENCE[audKey];
  return {
    name,
    size,
    sizeLabel: human(size),
    ext: name.split(".").pop().toUpperCase(),
    kind: KIND[kindKey]?.label ?? "Other",
    kindOrder: KIND[kindKey]?.order ?? 9,
    audience: aud?.label ?? audKey.replace(/_/g, " "),
    blurb: aud?.blurb ?? "",
    sensitive: Boolean(aud?.sensitive),
    variant: isPrint ? "print" : kindKey === "Social" ? "social" : "screen",
  };
});

items.sort(
  (a, b) =>
    a.kindOrder - b.kindOrder ||
    a.audience.localeCompare(b.audience) ||
    a.variant.localeCompare(b.variant),
);

writeFileSync(
  join(DIR, "manifest.json"),
  JSON.stringify({ generated: null, count: items.length, items }, null, 2) + "\n",
);
console.log(`manifest: ${items.length} files`);
for (const i of items) console.log(`  ${i.kind.padEnd(14)} ${i.audience.padEnd(28)} ${i.variant.padEnd(7)} ${i.sizeLabel}`);
