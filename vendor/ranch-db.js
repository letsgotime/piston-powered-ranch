/**
 * One database client for the tools site.
 *
 * Twenty pages used to each hardcode the two Neon endpoints and build their
 * own client. Every one of those calls was identical apart from whitespace,
 * which meant the duplication bought nothing and cost real time: when Better
 * Auth began requiring a name on sign up, the fix had to be found once and
 * then hunted through every file that had a copy, with no compiler to say
 * which one had been missed.
 *
 * September 2026: this used to speak Neon's hosted auth endpoint through a
 * Supabase-GoTrue-shaped compatibility adapter (SupabaseAuthAdapter), which
 * itself talked to a Better Auth server Neon ran on our behalf, using a
 * Google OAuth app Neon owned rather than one of ours. That extra layer is
 * also what turned "email not verified" into "invalid_credentials" (see the
 * retired reallyUnverified() workaround in git history) and quietly ate the
 * Google redirect. This file now talks to our own self-hosted Better Auth
 * server (see lib/auth.js, mounted at /api/auth) with Better Auth's real
 * client library, which is what the adapter was standing in for all along.
 * Nothing about is_staff(), can_see_money(), or any other RLS policy
 * changed: they still verify a session by checking a signature against a
 * public key in neon_auth.jwks, and that never depended on whose server
 * issued the token.
 *
 * Row level security decides what anybody may read, keyed on the caller's
 * token. This module only gets someone signed in.
 */

import { createAuthClient, magicLinkClient, emailOTPClient, jwtClient } from "/vendor/better-auth-client.js?v=2026-09-02d";
import { PostgrestClient } from "/vendor/postgrest-client.js?v=2026-09-02d";

export const DATA_API =
  "https://ep-broad-truth-auz9r4ir.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1";

/**
 * chat/dock.js, team/rail.js and diag/index.html still import this under
 * their older cache-bust query string and never read it once imported, but
 * an ES module that names an export which does not exist fails to link at
 * all, so it has to keep existing even though nothing calls it. Same-origin
 * now, matching basePath in lib/auth.js — there is no separate host to send
 * this to anymore.
 */
export const AUTH_URL = "/api/auth";

/** The Piston Powered Ranch, Saturday 10 October 2026. */
export const EVENT_ID = "6ad3f289-8103-4c69-b10e-923790fb8a88";

let cachedAuth = null;

/**
 * Better Auth's own client — signIn.email, signUp.email, getSession, token,
 * signOut, and the plugin methods below. Every function in this file that
 * talks to /api/auth calls this directly. The twenty pages that render the
 * site never see this shape: what they import as `db` is the composite
 * object further down, which wraps this client in the .auth/.from() shape
 * they were already written against.
 */
function authClient() {
  if (cachedAuth) return cachedAuth;
  try {
    cachedAuth = createAuthClient({
      plugins: [magicLinkClient(), emailOTPClient(), jwtClient()],
    });
  } catch (e) {
    cachedAuth = null;
  }
  return cachedAuth;
}

/**
 * A short-lived JWT, signed by our own server and verifiable against the
 * public key it publishes at /api/auth/jwks — the same key
 * pg_session_jwt / auth.uid() read out of neon_auth.jwks. This is what every
 * PostgREST call attaches as its bearer token, whether that call goes
 * through db().from() below or through rpc().
 */
/**
 * Why this stopped returning null in silence.
 *
 * Every PostgREST call attaches whatever this returns. When it returned null
 * the request went out with no Authorization header, PostgREST answered
 * "missing authentication credentials", and the console rendered that as a
 * card that says Loading forever. A signed out session, an expired token and
 * a network failure were all indistinguishable from a slow connection, and
 * finding out which took a screenshot and an afternoon.
 *
 * It still returns null, because callers rely on that. But it records why on
 * lastTokenError, and db() below turns that into a message a person can act
 * on instead of a spinner that never stops.
 */
export let lastTokenError = null;

export async function accessToken() {
  const c = authClient();
  if (!c) {
    lastTokenError = "The sign in client did not load. Reload the page.";
    return null;
  }
  try {
    const { data, error } = await c.token();
    if (error) {
      lastTokenError =
        error.status === 401 || /unauthor/i.test(error.code || error.message || "")
          ? "Your session has expired. Sign in again."
          : "Could not get a session token: " + (error.message || error.code || "unknown");
      return null;
    }
    const token = (data && data.token) || null;
    lastTokenError = token ? null : "The sign in service returned no token. Sign in again.";
    return token;
  } catch (e) {
    lastTokenError = "Could not reach the sign in service. Check your connection.";
    return null;
  }
}

/**
 * One PostgREST client, reused across every db().from() call. Its fetch is
 * wrapped so every request carries whatever token accessToken() returns at
 * the moment it fires rather than one captured when the client was built —
 * the same "read the token fresh, per request" behavior the old Supabase-
 * shaped bundle had, just without the thousands of unrelated lines that came
 * with it.
 */
let cachedRest = null;
async function withAuth(input, init) {
  const token = await accessToken();
  const headers = new Headers(init && init.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  return fetch(input, Object.assign({}, init, { headers }));
}
function rest() {
  if (!cachedRest) cachedRest = new PostgrestClient(DATA_API, { fetch: withAuth });
  return cachedRest;
}

/**
 * The shape every page already calls: db.auth.getSession() returning
 * { data: { session: { access_token, user: { email, ... } } } }, matching
 * what the old Supabase-shaped client returned. Better Auth's own
 * getSession() puts session and user as siblings and has no access_token
 * field at all (that's the separate JWT plugin token above) — this merges
 * the two into the one shape twenty pages already read from.
 */
async function shimGetSession() {
  const c = authClient();
  if (!c) return { data: null, error: null };
  try {
    const [sessionRes, token] = await Promise.all([c.getSession(), accessToken()]);
    const { data, error } = sessionRes || {};
    if (error || !data || !data.session) return { data: null, error: error || null };
    return {
      data: {
        session: Object.assign({}, data.session, {
          access_token: token,
          accessToken: token,
          user: data.user,
        }),
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: e };
  }
}

let cachedDb = null;

/**
 * One client per tab, in the shape the twenty existing pages were written
 * against: db.auth.getSession(), db.auth.signOut(), db.from(table). Every
 * sign-in/sign-up/magic-link/reset function below is a separate export that
 * talks to authClient() directly instead — this composite exists only for
 * the pages that read and write rows and check who is signed in.
 */
export function db() {
  if (cachedDb) return cachedDb;
  cachedDb = {
    auth: {
      getSession: shimGetSession,
      signOut: async () => {
        const c = authClient();
        if (c) await c.signOut();
      },
    },
    from: (table) => rest().from(table),
    /*
     * clubs, map, show, journeys and status all call db.rpc(fn, args) and
     * read the result as { data, error } — the shape PostgREST's own
     * client already returns from .rpc(), so this needs no shim of its
     * own. This is deliberately separate from the rpc() export above: that
     * one is this file's own internal helper for is_staff()/can_see_money()/
     * me(), used before a page has any reason to hold a db() at all, and it
     * returns a bare value or null rather than { data, error }.
     */
    rpc: (fn, args) => rest().rpc(fn, args || {}),
  };
  return cachedDb;
}

/**
 * Calls a Postgres function through PostgREST.
 *
 * The wrapper does not attach the bearer token to rpc(), which is why
 * is_staff() answered false for genuine staff until this was written by hand.
 * db().from() does attach it, so only RPCs need this.
 */
export async function rpc(fn, body) {
  const token = await accessToken();
  if (!token) return null;
  try {
    const res = await fetch(DATA_API + "/rpc/" + fn, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return text.trim();
    }
  } catch (e) {
    return null;
  }
}

export async function isStaff() {
  return (await rpc("is_staff")) === true;
}

/** Cost and margin are Oscar, Gavin and Bekah only. The policies agree. */
export async function canSeeMoney() {
  return (await rpc("can_see_money")) === true;
}

export async function me() {
  return (await rpc("me")) || "";
}

/* ---------------------------------------------------------------------------
 * Signing in.
 *
 * This algorithm was written three times, in the console, in crew, and again
 * in the Next app, and the three had already drifted: two waited before the
 * second attempt and one did not. Every message below is the wording the team
 * has already seen, so nothing reads differently depending on which door was
 * used. Each returns null when it worked, or something to show the person.
 * ------------------------------------------------------------------------- */

/** gavin@paddockgavin.com becomes Gavin. Enough to satisfy the field. */
function nameFromEmail(email) {
  const local = (email.split("@")[0] || "Staff").replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Staff";
}

/** Better Auth says this when the address has never been confirmed. */
export const NEEDS_VERIFICATION = "needs-verification";

/**
 * True if the code or message we were handed means "not verified".
 *
 * Talking to our own server directly, error.code is now the real
 * EMAIL_NOT_VERIFIED Better Auth returns rather than a value translated
 * through a Supabase-shaped compatibility layer, so this no longer needs a
 * second request to double check what the service actually meant.
 */
function looksUnverified(said) {
  return /EMAIL_NOT_VERIFIED|not verified|unverified|verify your email/i.test(String(said || ""));
}

export async function signIn(email, password) {
  const c = authClient();
  if (!c) return "No connection to the database.";

  /* Each of these can reject instead of answering, and a rejection used to
     travel all the way up to the caller's catch. The console's catch says
     "Could not reach the console database", so a mistyped password was being
     reported as the database being down. Every call is caught here and turned
     into something true, and this function no longer throws. */
  const attempt = async (fn) => {
    try {
      return { value: await fn() };
    } catch (e) {
      return { thrown: e };
    }
  };

  const first = await attempt(() => c.signIn.email({ email, password }));
  if (first.value && !first.value.error) return null;

  /* Checked before anything else, because the account exists and the password
     may well be right: the address simply has never been confirmed. Falling
     through to sign up here is what used to produce "that password does not
     match this account" for people whose password matched perfectly, and sent
     them to reset a password that was never wrong. */
  const firstSaid =
    first.value && first.value.error
      ? first.value.error.code || first.value.error.message || ""
      : "";
  if (firstSaid && looksUnverified(firstSaid)) return NEEDS_VERIFICATION;

  const made = await attempt(() => c.signUp.email({ email, password, name: nameFromEmail(email) }));
  const madeSaid = made.thrown
    ? String((made.thrown && made.thrown.message) || made.thrown)
    : (made.value && made.value.error && (made.value.error.code || made.value.error.message)) || "";

  if (looksUnverified(madeSaid)) return NEEDS_VERIFICATION;

  if (/USER_ALREADY_EXISTS|already exists|already registered/i.test(madeSaid)) {
    /* The address is the one right thing about this attempt. Saying "use
       another email", which is what the service returns, is the opposite of
       what they should do. */
    return "That password does not match this account. Use the sign in link, or reset it below.";
  }

  await new Promise((r) => setTimeout(r, 600));
  const again = await attempt(() => c.signIn.email({ email, password }));
  if (again.value && !again.value.error) return null;

  const againSaid =
    again.value && again.value.error
      ? again.value.error.code || again.value.error.message || ""
      : "";
  if (looksUnverified(againSaid)) return NEEDS_VERIFICATION;

  if (first.thrown || made.thrown || again.thrown) {
    return "Could not reach the sign in service. Check your connection and try again.";
  }
  return madeSaid || "Could not sign in. Try once more, and if it repeats use the reset link.";
}

/**
 * Send the six digit code that confirms an address.
 *
 * Needed because verification is required on this project: an account that has
 * never confirmed its address cannot sign in at all, and until this existed
 * there was no way through that from any of our own pages.
 */
export async function sendEmailCode(email) {
  const c = authClient();
  if (!c) return "No connection to the database.";
  try {
    const { error } = await c.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    if (error) return error.message || "We could not send the code.";
    return null;
  } catch (e) {
    return "We could not reach the sign in service. Check your connection.";
  }
}

/** Confirm the address with the code. Returns null when it worked. */
export async function verifyEmailCode(email, otp) {
  const c = authClient();
  if (!c) return "No connection to the database.";
  try {
    const { error } = await c.emailOtp.verifyEmail({ email, otp: String(otp).trim() });
    if (error) {
      const said = error.code || error.message || "";
      if (/TOO_MANY_ATTEMPTS/i.test(said)) return "Too many tries. Ask for a new code.";
      if (/expired/i.test(said)) return "That code has expired. Ask for a new one.";
      return "That code is not right. Check it and try again.";
    }
    return null;
  } catch (e) {
    return "We could not reach the sign in service. Check your connection.";
  }
}

/** The way the onboarding email tells people to get in. */
export async function magicLink(email, callbackURL) {
  const c = authClient();
  if (!c) return "No connection to the database.";
  try {
    const { error } = await c.signIn.magicLink({ email, callbackURL });
    if (error) return "Could not send the link (" + (error.status || error.code || "") + "). Try the password instead.";
    return null;
  } catch (e) {
    return "Could not reach the sign in service. Check your connection.";
  }
}

/**
 * A reset, for somebody who set a password and cannot remember it. The success
 * line is deliberately vague about whether the address exists, so this cannot
 * be used to find out who is on the staff list.
 */
export async function requestReset(email, redirectTo) {
  const c = authClient();
  if (!c) return "No connection to the database.";
  try {
    const { error } = await c.requestPasswordReset({ email, redirectTo });
    if (error) return "Could not send the reset (" + (error.status || "") + "). Use the sign in link instead.";
    return null;
  } catch (e) {
    return "Could not reach the sign in service. Check your connection.";
  }
}

/**
 * The second half of a reset: taking the token from the emailed link and a
 * new password. Better Auth verifies the token itself; this file never sees
 * or checks it.
 */
export async function completeReset(newPassword, token) {
  const c = authClient();
  if (!c) return "No connection to the database.";
  try {
    const { error } = await c.resetPassword({ newPassword, token });
    if (error) {
      const said = error.code || error.message || "";
      if (/INVALID_TOKEN|expired/i.test(said)) return "That link may have expired. Request a new one.";
      return "That did not work. Try again in a moment.";
    }
    return null;
  } catch (e) {
    return "Could not reach the sign in service. Check your connection.";
  }
}

export async function signOut() {
  try {
    const c = authClient();
    if (c) await c.signOut();
  } catch (e) {
    /* already gone */
  }
}
