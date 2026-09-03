#!/usr/bin/env node
/**
 * TYPE YOU CAN READ. Fails the build on text nobody can see.
 *
 * This exists because the same mistake was made three times in one day, and
 * each time it was reported by the person looking at the screen rather than
 * caught here.
 *
 *   1. A hero eyebrow in Jaramillo Red, over the brightest band of a
 *      photograph. 1.07:1, which is not a contrast ratio so much as the
 *      absence of one.
 *   2. A lockup caption at 9px and 52% grey, over the same photograph. 2.11:1.
 *   3. Dark type on the brand red, which the brand check now catches as its
 *      own rule.
 *
 * The second one is the instructive case. Measured against the ink it sits on
 * in theory, 52% grey is 5.06:1 and passes anything. Measured against the
 * photograph it sits on in practice, it is 2.11:1 and invisible. A contrast
 * check that assumes the background is the page background will keep saying
 * yes to text nobody can read.
 *
 * So this does not try to compute ratios against a background it cannot know.
 * It applies two rules that hold whatever is behind the words:
 *
 *   RULE 1: no text below 10px. At that size letterforms fail before contrast
 *   does, and every instance here was 9px or smaller.
 *
 *   RULE 2: no text colour below 70% alpha unless the same declaration carries
 *   a textShadow. Transparency is how type dissolves into a photograph, and a
 *   shadow is what makes it survive one.
 *
 * Both rules are about legibility, not brand, which is why this is a separate
 * check from check-brand.mjs. Run: node scripts/check-readable.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "out", "dist", "coverage", "vendor", "files"])
/* Email is a different medium: it renders in clients with their own minimums
   and its own design system, built and measured separately. */
const SKIP_PREFIX = ["collateral/files/", "brand/"]
const SKIP_FILES = new Set(["scripts/check-readable.mjs", "scripts/check-brand.mjs"])
const EXT = /\.(tsx?|jsx?|css|html)$/

const MIN_PX = 10
const MIN_ALPHA = 0.7

/* fontSize: 9   fontSize: "9px"   font-size: 9.5px */
/* px, or pt for the printed pages: a point is four thirds of a pixel, so 7.5pt
   is the floor there. A unitless number is treated as px. */
const SIZE = /\bfont-?[Ss]ize\s*:\s*"?(\d+(?:\.\d+)?)(px|pt)?"?/g
/* color: "rgba(237,241,246,.52)" — the alpha is what matters. */
const ALPHA_TEXT = /(?<!background|border|box-shadow|outline|-)\bcolor\s*:\s*"?rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

const problems = []

for (const file of walk(process.cwd())) {
  const rel = relative(process.cwd(), file).split(sep).join("/")
  if (SKIP_FILES.has(rel) || SKIP_PREFIX.some((s) => rel.startsWith(s))) continue
  const lines = readFileSync(file, "utf8").split("\n")

  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, "").replace(/(^|\s)\/\/.*$/, "")
    if (line.trim().startsWith("*")) return

    for (const m of line.matchAll(SIZE)) {
      const px = m[2] === "pt" ? Number(m[1]) * (4 / 3) : Number(m[1])
      /* A unitless number under 4 is a scale or a ratio, not a size. */
      if (px < MIN_PX && px >= 4) {
        problems.push([rel, i + 1, line, `${m[1]}${m[2] || "px"} type. Nothing below ${MIN_PX}px, whatever is behind it.`])
      }
    }

    for (const m of line.matchAll(ALPHA_TEXT)) {
      const a = Number(m[1])
      if (a < MIN_ALPHA && !/textShadow|text-shadow/.test(line)) {
        problems.push([
          rel, i + 1, line,
          `text at ${Math.round(a * 100)}% alpha and no shadow. Over a photograph this disappears, whatever it measures on the page colour.`,
        ])
      }
    }
  })
}

if (problems.length) {
  console.error("\n\x1b[41m\x1b[97m READABILITY CHECK FAILED \x1b[0m\n")
  for (const [rel, n, line, why] of problems) {
    console.error(`  \x1b[1m${rel}:${n}\x1b[0m`)
    console.error(`    ${line.trim().slice(0, 120)}`)
    console.error(`    \x1b[33m${why}\x1b[0m\n`)
  }
  console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"}. Build stopped.\n`)
  process.exit(1)
}

console.log(`readable: no type under ${MIN_PX}px, no faded text without a shadow`)
