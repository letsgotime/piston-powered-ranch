# These files are no longer served

On 3 September 2026 everything this repository served moved into
`letsgotime/paddockgavin`, which is the deployment behind
pistonpoweredranch.com:

| What | Where it lives now |
| --- | --- |
| The tool pages (console, rsvps, chat, map, journeys and the rest) | `public/<tool>/index.html` |
| The shared scripts, `/vendor` and `/team` | `public/vendor`, `public/team` |
| Photographs, `/img`, `/events/img`, `/brand`, `/og` | `public/…` under the same names |
| The collateral sheet and its files | `public/collateral` |
| `api/config`, `api/planning`, `api/media`, `api/upload`, `api/upload-session` | `app/api/<name>/route.ts` |
| The Better Auth server, `lib/auth.js` and `api/auth/[...all].js` | `lib/ranch/auth.js`, `app/api/auth/[...all]/route.ts` |
| `api/_neon.js` | `lib/ranch/neon.js` |

**Edit the copies over there.** A change made here reaches nobody: the domain
does not read this project any more.

Two endpoints are still proxied back here until the hub project is given their
secrets, and the hub's build log says which: sign in needs
`RANCH_DATABASE_URL` and the same `BETTER_AUTH_SECRET` (the signing key in
`neon_auth.jwks` is encrypted with it, so a different value breaks every
session), and uploads and the media signer need `BLOB_READ_WRITE_TOKEN`.
Once those are set on paddockgavin, this deployment answers nothing and can be
paused.

What stays here: `media/`, the graded masters and culled frames, which were
never deployed, and the scripts under `tools/` that build the collateral page.
