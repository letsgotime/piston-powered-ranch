# Paddock Events Platform: Build Order

Canonical spec, adopted Aug 28, 2026. Authored by the Cowork session, amended
by the Claude Code session that builds here. The tracker artifact mirrors
progress; the console stays the source of truth for event data.

## Architecture verdict

One platform, six surfaces. One codebase, one Neon Postgres, one auth, one
design system (floating glass on a full-bleed editorial ground, per the
standing direction). The single-file index.html era ends with the Next.js
migration in P1; the live site stays up throughout and deploys stay git-push.

- Vercel: piston-powered-ranch (prj_xkNiyY8AKvP58rlAmg15DWSTNl4B), team go-time-motorsports
- Neon: wispy-wave-74040583, branch main, db neondb, Neon Auth + Data API live
- Stripe: build against the Paddock20 sandbox (acct_1TpxSsF2UEFJidMh, test
  mode) via the Stripe MCP, per Gavin Aug 28. Live keys require Gavin to
  activate the account. The other connected account (GT Premier Mobile
  Detailing, acct_1Jq2CiFC0g3jRYhU, livemode) is a different business; never
  use it. Sandbox scaffolding created Aug 28: product prod_V9eQl4XHYCHpnz
  (Vendor Booth Setup Deposit) with price price_1U9L7vF2UEFJidMhUm3FBBCV
  ($250 one-time, 10x10). Additional footprint prices get added as the booth
  matrix firms up; Checkout sessions in P1 reference these.
- Any new domain or preview URL that serves auth goes into Neon Auth
  trusted_origins first, or logins 403 silently.

## Roles

staff (three-address allowlist, is_staff(), later a staff table), vendor,
sponsor, club_rep, participant, volunteer, public. Every new table ships with
RLS before it ships: owner-scoped for account roles, staff-full,
public-insert-only where forms need it.

## Schema

Additive migrations only. Shipped Aug 28: `events` (multi-event spine, seeded
with piston-powered-ranch, id 6ad3f289-8103-4c69-b10e-923790fb8a88) and
`spectators` (public insert, staff read), both RLS'd. Note Neon's anonymous
role is `anonymous`, not `anon`. Still to ship: profiles, accounts,
vendor_booths, sponsor_packages, payments, clubs, club_submissions,
volunteers, interactions, plus submissions extensions (foat_id,
status_history, user_id, owner vs point-of-contact split already captured in
details). Full DDL for those lives in the Cowork spec and gets applied per
phase.

## The six surfaces

1. Public site and info station: current pages plus /spectate (SHIPPED,
   Turnstile-ready and inert until the widget key exists), /events brand home
   (SHIPPED), UTM source capture on inbound RSVP links (SHIPPED), sitemap and
   robots (SHIPPED; /collateral stays crawl-blocked).
2. Vendor portal: apply, approve, invite, sign in, Stripe Checkout deposit
   (FROM $250 scaling by footprint), webhook marks payments, post-event sales
   report computes the 15 to 20 percent ranch share, staff invoices it.
   Ranch remittance is a ledger line in v1; Stripe Connect is a v2 decision.
3. Sponsor portal: same skeleton. AMENDMENT: no tier prices on any public,
   pre-login surface, per the standing pricing rule. A signed-in sponsor sees
   their own package terms; the public tier cards describe benefits and say
   "terms in the proposal." Supporting tier pays by Checkout; title tiers are
   handshake deals invoiced from the CRM.
4. Vehicle submission hub: participant login or email-token claim, status
   timeline (submitted, in review, approved, pass issued). theFOAT v1 stays
   the human loop with foat_id stored; API or embed is v2 and does not block.
5. Car club hub: club rep applies, submits a block with a roster, approval
   spawns linked individual vehicle submissions so every car gets a pass.
6. PaddockGavin Events CRM: staff-only, event switcher keyed on event_id from
   day one, pipeline boards, interactions timeline, payments ledger fed by
   the Stripe webhook. The existing console (telemetry, budget, run of show,
   Decision Desk) folds in as CRM tabs.

## Phases against the calendar

- P0, before the Aug 30 launch: SHIPPED Aug 28. /spectate RSVP with source
  capture, events + spectators tables, sitemap + robots, brand kit at /brand,
  spectate links from the console and events home.
- P1, Sept 1 to 12: Next.js scaffold absorbing current pages; profiles,
  roles, RLS; vendor portal end to end with sandbox Checkout; CRM v1 boards.
  Stripe flips live when Gavin activates the account.
- P2, Sept 14 to 25: sponsor portal and invoicing, club hub, vehicle hub
  logins and status timeline, volunteer intake, CRM interactions and exports.
- P3, Sept 28 to Oct 9: day-of ops (check-in lists, booth map, parking, QR
  pass at the gate), food-vendor sales report, reconciliation, full dry run.
- Post-event: revenue-share invoicing, remittance ledger, thank-you sends,
  clone-event templates.

## Corrections to the original spec (already done before adoption)

- Charity is Community Elementary School everywhere, app and database. The
  Folds of Honor swap the spec requests was completed Aug 27.
- Turnstile cannot just be "flipped on": the code ships inert and needs Gavin
  to create the widget in the Cloudflare dashboard and set TURNSTILE_SECRET,
  TURNSTILE_HOSTNAMES, and the sitekey. Steps are in HANDOFF.md.
- Decisions belong to Gavin (the spec says Mikal; same person as addressed
  here, kept as Gavin in this repo).
- VIP is already priced and published: Ranch Pass $400 x10, Owner's Circle
  $800 x10, access-based, standalone. The volunteer paid vip_serving role in
  the spec aligns with the VIP dedicated-host commitment.

## Decisions Gavin owes the build (defaults in effect)

1. Platform domain (default: piston-powered-ranch.vercel.app until chosen;
   new domain requires a Neon Auth trusted origin).
2. Stripe live activation (default: sandbox).
3. The exclusivity collision: 111 Motorcars was pitched the single dealer
   position on the field. Selling a secondary title to another dealer breaks
   that promise. Default: secondary title is category-exclusive and
   non-dealer. Confirm before selling it.
4. Ranch remittance path (default: ledger plus manual payment).
5. Spectators free or ticketed (default: free RSVP; Checkout covers ticketing
   in a day if chosen).

## Guardrails

Never break the public submit form or staff login. Migrations are additive.
RLS on every new table before it ships. New domains into trusted_origins.
Deploys via git only. Secrets in Vercel env, never the client. Test with
throwaway accounts, never the three staff emails. Zero em and en dashes in
prose. Floating glass on a full-bleed editorial ground on every surface.
