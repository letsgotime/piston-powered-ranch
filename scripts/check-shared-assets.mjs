#!/usr/bin/env node
/**
 * The six pictures that exist in both repos, checked for drift.
 *
 * Eleven files were byte identical across the two deployments. Five of them
 * were dead weight in the Next app and are gone. The remaining six are
 * genuinely needed on both, because each deployment serves them to browsers on
 * its own domain, and pointing one at the other would make every page load on
 * one site depend on the other being up.
 *
 * So the duplication stays, and what gets prevented instead is the failure it
 * causes: somebody replaces the hero photograph on one side, not the other,
 * and nobody notices for a month. Two of them are also stored under different
 * names, which is how the same picture stops looking like the same picture.
 *
 * Renaming them was the obvious fix and it is the wrong one: it would touch
 * twenty three references across nine live pages to buy nothing but a tidier
 * listing. This costs nothing and catches the actual problem.
 *
 * Runs on every commit next to the brand check. If the sibling repo is not
 * checked out beside this one it skips, because a machine that only has one of
 * them cannot be wrong about the other.
 */

import { readFileSync, existsSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const RANCH = join(HERE, "..")
const OTHER = join(RANCH, "..", "paddockgavin")

/* Same bytes, and in two cases not the same name. */
const PAIRS = [
  ["events/img/hero.jpg", "public/images/ranch/ppr-hero.jpg"],
  ["events/img/ranch.jpg", "public/images/ranch/ppr-field.jpg"],
  ["events/img/walk.jpg", "public/images/ranch/ppr-walk.jpg"],
  ["events/img/dusk.jpg", "public/images/ranch/ppr-dusk.jpg"],
  ["og/ppr-og-1200.jpg", "public/og/ppr-og-1200.jpg"],
  ["brand/rj-mark-ondark.png", "public/brand/rj-mark-ondark.png"],
]

if (!existsSync(OTHER)) {
  console.log("shared assets: paddockgavin is not beside this repo, skipping")
  process.exit(0)
}

const digest = (p) => createHash("md5").update(readFileSync(p)).digest("hex")
const problems = []

for (const [here, there] of PAIRS) {
  const a = join(RANCH, here)
  const b = join(OTHER, there)
  if (!existsSync(a)) { problems.push([here, there, "missing in this repo"]); continue }
  if (!existsSync(b)) { problems.push([here, there, "missing in paddockgavin"]); continue }
  if (digest(a) !== digest(b)) {
    const sa = statSync(a).size
    const sb = statSync(b).size
    problems.push([here, there, `different bytes (${sa} here, ${sb} there)`])
  }
}

if (problems.length) {
  console.error("\n\x1b[41m\x1b[97m SHARED ASSETS HAVE DRIFTED \x1b[0m\n")
  console.error("These pictures exist in both repos and are meant to be the same file.\n")
  for (const [here, there, why] of problems) {
    console.error(`  \x1b[1m${here}\x1b[0m`)
    console.error(`  \x1b[1m${there}\x1b[0m  (in paddockgavin)`)
    console.error(`    \x1b[33m${why}\x1b[0m\n`)
  }
  console.error("Copy the one you meant over the other, then commit both.\n")
  process.exit(1)
}

console.log(`shared assets: ${PAIRS.length} pictures identical in both repos`)
