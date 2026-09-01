#!/usr/bin/env node
/**
 * NO PINK, for the ranch's static surfaces.
 *
 * Pink reached this site by five different routes, none of which looked wrong
 * on its own:
 *
 *   1. A published tint ramp on the brand page itself (--red-300 #EA4C51,
 *      --red-200 #EF7A7D, --red-100 #F5A8AA), rendered as official swatches
 *      with their hex codes printed under them. Everybody downstream copied
 *      what the brand kit told them was on brand.
 *   2. A "third red" (#E5484D) that was never in the brand, used for --crit
 *      on sixteen pages.
 *   3. A coral error colour (#EF6D70) on validation messages.
 *   4. Coral shadows (#FF6B5E) on the console buttons.
 *   5. The same colours again as rgba() triples, which no hex grep would find.
 *
 * So this does not grep for hex values. It reads every colour literal in every
 * notation, works out what it is, and applies one rule.
 *
 * Pink is a red with white in it, measured as the smallest RGB channel.
 * Jaramillo Red has 20/255 of white; the tint that shipped had 165. Anything
 * red-family carrying more than a fifth white is pink, salmon, coral or rose.
 *
 * The red family, and there is nothing outside it. Every one is the same hue
 * taken darker or lifted in place. None of them carries white, which is the
 * whole point: the red goes darker to become readable, never paler.
 *   #E5141A  Jaramillo Red. Paints anything: fills, borders, rules, display.
 *   #FF1A21  the same hue lifted for small text on the ink, 4.74:1. Text only.
 *   #B3121A  the same red taken down for text on paper, 6.56:1. Text only.
 *   #BF1116  Red 700, for large type on paper, 5.99:1.
 *   #9A0D11  Red 900, the deepest step, 8.12:1 on paper.
 *
 * Run: node scripts/check-brand.mjs     Also runs on every commit, see
 * .git/hooks/pre-commit. There is no build step to hang it on, so the commit
 * is the gate. If it fires, the fix is the colour, never the rule.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const FILL = "#E5141A"
const TEXT = "#FF1A21"
const INK = "#B3121A"
/* The darker steps. They carry less white than Jaramillo Red, not more. */
const DEEP = ["#BF1116", "#9A0D11"]
const ALLOWED = new Set([FILL, TEXT, INK, ...DEEP])

const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", ".next", "dist", "out"])
const SKIP_FILES = new Set(["scripts/check-brand.mjs"])
const EXT = /\.(html|css|js|mjs|svg)$/

/**
 * Third party marks are not ours to recolour.
 *
 * Google's G is #4285F4, #34A853, #FBBC05 and #EA4335, and that last one is a
 * red carrying 21% white, so this check would otherwise call it pink. Their
 * brand guidelines require those exact values. Exempt only where all four
 * appear together, which is a whole G and not one pink smuggled through.
 */
const GOOGLE_MARK = ["#4285F4", "#34A853", "#FBBC05", "#EA4335"]
const isGoogleMark = (src) => GOOGLE_MARK.every((c) => src.toUpperCase().includes(c))

const HEX = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi
const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi
const NAMED =
  /\b(pink|hotpink|lightpink|deeppink|palevioletred|mediumvioletred|salmon|lightsalmon|darksalmon|lightcoral|coral|tomato|crimson|indianred|mistyrose|lavenderblush|rosybrown)\b/i

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

function toRgb(hex) {
  let s = hex.replace("#", "")
  if (s.length === 3) s = [...s].map((c) => c + c).join("")
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/* Hue and saturation in HSL, plus "white": the smallest channel, 0..1. */
function describe([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l, white: min }
}

const isRed = (d) => (d.h >= 330 || d.h <= 20) && d.s >= 0.25 && d.l >= 0.08 && d.l <= 0.95
const isPink = (d) => isRed(d) && d.white > 0.2
const canon = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()

const problems = []

for (const file of walk(process.cwd())) {
  const rel = relative(process.cwd(), file).split(sep).join("/")
  if (SKIP_FILES.has(rel)) continue

  const source = readFileSync(file, "utf8")
  const exemptMark = isGoogleMark(source)
  source.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, "").replace(/(^|\s)\/\/.*$/, "")
    const seen = []
    for (const m of line.matchAll(HEX)) seen.push({ raw: m[0], rgb: toRgb(m[0]) })
    for (const m of line.matchAll(RGB)) seen.push({ raw: m[0] + ")", rgb: [+m[1], +m[2], +m[3]] })

    for (const c of seen) {
      const d = describe(c.rgb)
      if (!isRed(d)) continue
      if (exemptMark && GOOGLE_MARK.includes(canon(c.rgb))) continue
      if (isPink(d)) {
        problems.push({
          rel, n: i + 1, line: line.trim().slice(0, 110),
          why: `${c.raw} is pink: ${Math.round(d.white * 100)}% white in a red. Reds here are ${FILL}, or ${TEXT} for small text on the ink.`,
        })
      } else if (!ALLOWED.has(canon(c.rgb))) {
        problems.push({
          rel, n: i + 1, line: line.trim().slice(0, 110),
          why: `${c.raw} is a red that is not the brand's. There are three: ${FILL} paints, ${TEXT} writes on the ink, ${INK} writes on paper.`,
        })
      }
    }

    if (NAMED.test(line) && /(color|background|border|fill|stroke|shadow|outline)\s*:/i.test(line)) {
      problems.push({ rel, n: i + 1, line: line.trim().slice(0, 110), why: "a named CSS pink, coral or salmon." })
    }
  })
}

if (problems.length) {
  console.error("\n\x1b[41m\x1b[97m BRAND CHECK FAILED: PINK \x1b[0m\n")
  for (const p of problems) {
    console.error(`  \x1b[1m${p.rel}:${p.n}\x1b[0m`)
    console.error(`    ${p.line}`)
    console.error(`    \x1b[33m${p.why}\x1b[0m\n`)
  }
  console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"}. Nothing committed.\n`)
  process.exit(1)
}

console.log(`brand check: no pink, no off-brand reds (${FILL} paints, ${TEXT} and ${INK} write)`)
