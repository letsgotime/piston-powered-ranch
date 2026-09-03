/**
 * Self-hosted Better Auth server for the Piston Powered Ranch console.
 *
 * This replaces Neon's hosted auth endpoint (which was itself Better Auth,
 * run on Neon's servers against a Neon-managed Google OAuth app). We now run
 * the same Better Auth engine ourselves, against the *same* database tables
 * Neon was already using (schema `neon_auth`: user, session, account,
 * verification, jwks), so every existing sign-in, staff allowlist entry, and
 * RLS policy (is_staff(), can_see_money(), etc.) keeps working untouched.
 * Those policies verify a session by checking a signature against a public
 * key stored in neon_auth.jwks via the pg_session_jwt extension — they never
 * called out to Neon's servers directly, so swapping who *issues* the token
 * requires no schema or policy change at all.
 */
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";

const DATABASE_URL =
  process.env.RANCH_DATABASE_URL ||
  process.env.PISTON_RANCH_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "No database connection string found. Set RANCH_DATABASE_URL to the " +
      "live Piston Powered Ranch Postgres connection string.",
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * Better Auth's Kysely adapter has no per-adapter "schema" option, so it
 * always issues unqualified table names ("user", "session", ...). Those
 * tables live in `neon_auth`, not `public` — Neon's hosted auth server put
 * them there precisely so an app's own tables in `public` never collide
 * with them. Setting search_path on every new physical connection resolves
 * unqualified names against neon_auth first, without any adapter hacks or
 * table renames, and without touching the connection string other code
 * (api/_neon.js, vendor/ranch-db.js) already relies on.
 */
pool.on("connect", (client) => {
  client.query("SET search_path TO neon_auth, public");
});

// Guarded: a malformed RESEND_API_KEY throws inside the Resend constructor
// (it builds an Authorization header eagerly), which would otherwise take
// down the entire auth server rather than just email delivery.
let resend = null;
if (process.env.RESEND_API_KEY) {
  try {
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (error) {
    console.log("[v0] RESEND_API_KEY is set but invalid — emails will be skipped:", error?.message);
  }
}

const FROM_EMAIL = "Piston Powered Ranch <noreply@pistonpoweredranch.com>";

async function sendAuthEmail({ to, subject, html }) {
  if (!resend) {
    console.log("[v0] RESEND_API_KEY not set — skipping email send:", { to, subject });
    return;
  }
  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  } catch (error) {
    console.log("[v0] Failed to send auth email:", error?.message || error);
  }
}

/**
 * pistonpoweredranch.com is the one canonical domain for this app — every
 * sign-in, magic-link, and session cookie must resolve there, not the
 * *.vercel.app deployment URL. Better Auth sets the session cookie on
 * whatever host baseURL points at, so baseURL has to be the custom domain
 * or logins land on the wrong host and the cookie never reaches the pages
 * the user actually visits.
 *
 * BETTER_AUTH_URL still wins if it is ever set (e.g. to test a different
 * host), but we deliberately do NOT fall back to VERCEL_PROJECT_PRODUCTION_URL
 * / VERCEL_URL for the base URL — those resolve to *.vercel.app and would
 * silently pull auth off the canonical domain.
 */
const CANONICAL_URL = "https://pistonpoweredranch.com";

function resolveBaseURL() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  return CANONICAL_URL;
}

// Origin allowlist for Better Auth's CSRF check. The canonical apex + www
// cover production; the .vercel.app deployment URL and localhost stay listed
// so preview deployments and local dev keep working. The Vercel-provided
// hostnames are also pushed in case the production alias changes.
const trustedOrigins = [
  "https://pistonpoweredranch.com",
  "https://www.pistonpoweredranch.com",
  "https://piston-powered-ranch.vercel.app",
  "http://localhost:3000",
];
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  trustedOrigins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
}
if (process.env.VERCEL_URL) {
  trustedOrigins.push(`https://${process.env.VERCEL_URL}`);
}

export const auth = betterAuth({
  database: pool,
  baseURL: resolveBaseURL(),
  basePath: "/api/auth",
  trustedOrigins,

  // The existing neon_auth schema uses singular table names (user, session,
  // account, verification, jwks) — Better Auth defaults to the same, so no
  // modelName overrides are required. Postgres resolves them via the
  // search_path set on the pooled connection role (neon_auth ahead of
  // public), matching how the hosted Neon Auth endpoint read them.

  // Better Auth 1.7 requires every account row to carry an `issuer` and
  // scopes provider identity by (issuer, accountId). The 8 existing rows
  // in neon_auth.account predate that column (all `credential`, no
  // Google rows yet, no collisions — checked directly against the live
  // database before choosing this). "provider-id" is the supported path
  // for a populated pre-1.7 table: it keeps the same provider-scoped
  // identity those rows already have (synthetic namespace
  // local:credential / local:oauth:google) instead of trying to infer a
  // verified OIDC issuer retroactively. The matching backfill migration
  // lives in scripts/backfill-account-issuer.mjs — it must run once
  // before this config reaches production, or every existing sign-in
  // breaks against the new NOT NULL column.
  account: {
    identityStrategy: "provider-id",
  },

  emailAndPassword: {
    enabled: true,
    /* An account that has never confirmed its address cannot sign in.

       Without this, sendOnSignUp posted a verification email and nothing
       enforced it, so anybody could sign up as any address and be treated as
       that person. is_staff() was hardened in the database to require a
       confirmed address, which closed the worst of it: six allowlisted
       addresses with no account yet were each claimable by whoever typed
       them. This closes the rest, including the portal matching entries by
       email.

       Safe to switch on because the three staff accounts are confirmed. Anyone
       unconfirmed now meets the code box on the sign in screen rather than a
       dead end, which is the part that was missing when this was tried before
       and locked everybody out. */
    requireEmailVerification: true,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Piston Powered Ranch password",
        html: `<p>Click the link below to reset your password.</p><p><a href="${url}">Reset password</a></p><p>If you didn't request this, ignore this email.</p>`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your email for Piston Powered Ranch",
        html: `<p>Click the link below to verify your email address.</p><p><a href="${url}">Verify email</a></p>`,
      });
    },
  },

  plugins: [
    // Issues a signed JWT (and publishes its public key into neon_auth.jwks)
    // on every session — this is what pg_session_jwt / auth.uid() verify
    // against in Postgres RLS policies. This is the load-bearing plugin: it
    // is the entire reason self-hosted Better Auth can stand in for Neon's
    // hosted endpoint without touching a single RLS policy.
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          email: user.email,
          sub_email: user.email,
        }),
      },
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendAuthEmail({
          to: email,
          subject: "Your Piston Powered Ranch sign-in link",
          html: `<p>Click the link below to sign in. It expires shortly.</p><p><a href="${url}">Sign in</a></p>`,
        });
      },
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        const subject =
          type === "sign-in"
            ? "Your Piston Powered Ranch sign-in code"
            : "Your Piston Powered Ranch verification code";
        await sendAuthEmail({
          to: email,
          subject,
          html: `<p>Your code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:0.1em">${otp}</p><p>It expires shortly.</p>`,
        });
      },
    }),
  ],

  advanced: {
    // Every id column in neon_auth (user, session, account, verification,
    // jwks) is `uuid NOT NULL DEFAULT gen_random_uuid()`. Better Auth's
    // default id generator produces short non-UUID strings, which Postgres
    // would reject outright, so every insert needs a real UUID instead.
    database: {
      generateId: "uuid",
    },
    // Required by the cross-site v0 preview iframe — without this, a
    // successful login in the preview appears to sign back out on the next
    // request because the session cookie is dropped. Production keeps
    // Better Auth's secure first-party defaults.
    ...(process.env.NODE_ENV === "development"
      ? {
          defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
          },
        }
      : {}),
  },
});
