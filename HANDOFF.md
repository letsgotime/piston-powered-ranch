# Piston Powered Ranch: Project Handoff

Event console for "The Piston Powered Ranch" (Rancho Jaramillo, Oct 10 2026),
run by GoTime Motorsports / PaddockGavin.

> **Operators:** IDs, endpoints, and account specifics are kept out of this
> file because this repo is public. They live in `HANDOFF.local.md`, which is
> gitignored. Ask Gavin for a copy if you need it.

## What this is

One self-contained `index.html`, the entire console. No build step, no
framework, no backend server code. All data access happens client-side,
straight from the browser to Neon (Postgres + Auth + Data API).

Views: Telemetry dashboard, public Submit form, Event Info (public), Ops &
Staff, Budget Ledger, Scope of Work, Documents & Legal.

## Deploying

Git is connected to Vercel. **Every push to `main` deploys production.**

```bash
vercel --prod    # fallback: manual deploy straight from disk
```

Vercel is configured for pure static file serving. Framework, buildCommand,
installCommand, and outputDirectory are all deliberately null. Keep them that
way. A stale Node build config from an earlier architecture used to interfere,
and re-introducing a `package.json` or build script at the repo root can make
Vercel auto-detect a build again and break static serving.

Deployment Protection / Vercel SSO is intentionally OFF. The public Submit and
Event Info pages must be reachable with zero login. To protect a *specific*
page later, use a different mechanism. Project-wide protection would take the
public pages down with it.

## Rules that bite if ignored

**1. Every new domain needs a Neon Auth trusted origin.**
Adding a custom domain, a new Vercel alias, or connecting git (which silently
creates a `-git-<branch>-` URL) produces a new origin. Any origin missing from
Neon Auth's `trusted_origins` makes sign-in fail with a 403 that looks exactly
like a wrong password. There is no "bad origin" message anywhere in the UI.
Add the origin via `configure_neon_auth` (`add_trusted_origin`) at the same
time you add the domain, not after someone reports a broken login.

**2. Access control is server-side; don't rely on the client.**
A `SECURITY DEFINER` SQL function gates all internal data against a fixed
staff allowlist. Row Level Security enforces it. The email checks visible in
`index.html` are convenience only. Never move an authorization decision into
the client file.

**3. Don't deploy this file by pasting its contents.**
Sending the whole file as model output hit a hard 64,000-output-token ceiling
once it grew past a certain size, and repeatedly broke production. Deploy from
disk via git push or the Vercel CLI, which upload bytes directly. This
constraint is why the project moved to local tooling.

## Media uploads (built: vehicle path)

Submitted media goes to a **private** Vercel Blob store. This is not a
preference; submitted vehicle photos routinely show plates and VINs in the
pixels, and a public store makes every one of them readable by URL forever.
An unauthenticated fetch of a blob URL returns 403.

- `api/upload.js` mints short-lived, scoped upload tokens. The Submit form is
  public by requirement, so all limits are server-side: per-kind content-type
  allowlists, per-kind size caps, and a pathname that must sit under the
  caller's own `submissions/<type>/<draft>/<kind>/` prefix.
- `api/media.js` returns 10-minute signed read URLs, gated on a verified Neon
  Auth JWT whose email is on the same three-address staff allowlist that
  `is_staff()` enforces in Postgres. Two independent checks: RLS protects the
  rows, this protects the pixels.
- The media manifest rides in `submissions.details` (jsonb), no schema
  migration, no new RLS policy.
- Vehicle form takes point of contact first, owner's name below it (brokers
  submit on an owner's behalf), and requires at least 5 photos.

`package.json` exists only to give those two functions their dependencies.
There is still **no build step**. Framework and buildCommand stay null, and
`index.html` is still served as a static file. Don't add a build script.

## Still to build

0. **Turn the Turnstile gate ON.** The code is built and deployed but
   deliberately inert. With `TURNSTILE_SECRET` unset, `/api/upload-session`
   reports `enforced:false`, the widget does not render, and uploads behave
   exactly as they did before. Enabling it is configuration, not code:

   1. Cloudflare dash → Turnstile → **Add widget**. Mode: Managed. Hostnames:
      the production hostnames only. Do NOT add `localhost` to a widget whose
      secret is used in production.
   2. Copy the **sitekey** (public) into `PPR.TURNSTILE_SITEKEY` in
      `index.html`. Copy the **secret** into Vercel:
      `vercel env add TURNSTILE_SECRET production`
   3. Add the hostname allowlist, comma separated, matching what siteverify
      will return: `vercel env add TURNSTILE_HOSTNAMES production`
   4. Redeploy, then confirm `/api/upload-session` returns `enforced:true`
      and that a real upload still succeeds through the widget.

   The widget action is `submit-media`; the server checks it, so the widget
   must be rendered with that action or every verification fails closed.

   Why a session rather than a token per file: Turnstile tokens are single-use
   at siteverify, and one submission is up to 50 photos plus video, voice and
   documents, each its own `/api/upload` call. Verifying per file fails on
   the second with `timeout-or-duplicate`. The human is checked once and the
   result is an HMAC-signed 30-minute session scoped to that draft id.
1. **Sponsor field set is a stand-in, not your template.** Vendor and sponsor
   forms are built and live (vendor: offering, space, power, website; sponsor:
   level, goals, activation, website), and staff review renders both. But the
   sponsor set is a sensible standard one. No existing template was found,
   and the standing instruction was to ask rather than guess. Swap it if you
   have a real one. Original notes for reference:
   up to 50 photos, up to 5 min video, up to 5 min voice memo, any document
   type, working identically across iPhone, Android, tablet, and desktop via
   native file and camera pickers. The current photo/video/voice/document
   widgets are UI-only mocks with no real upload. This needs a file-storage
   backend decision (Vercel Blob is the obvious candidate) before any of it
   becomes real.
   - Vendor form: use a solid standard template.
   - Sponsor form: use an existing template if one can be found rather than
     inventing one.
   - Vehicle form: prefer integrating theFOAT (thefoat.com) if feasible.
     Otherwise capture the point-of-contact name first, the actual owner's
     name below it (brokers often submit on an owner's behalf), contact info,
     and a minimum of 5 photos, routed to admin for approve/decline the same
     way vendor and sponsor submissions already work.
2. **Housekeeping:** an earlier architecture assembled production at build
   time from 18 separate preview deployments via a `build.js` fetch script.
   That is long dead, this single `index.html` replaced it, but the old
   preview deployments may still exist in Vercel and can be cleaned up.
