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
 * This is the same shape as lib/crm/client.ts in the Next app, deliberately,
 * so the two halves of the estate describe the database the same way while
 * they are still two halves.
 *
 *     import { db, EVENT_ID } from "/vendor/ranch-db.js";
 *     const rows = await db().from("submissions").select("*");
 *
 * Nothing here decides what anybody may read. Row level security does that,
 * keyed on the caller's token, so knowing these URLs buys nothing.
 */

import { createClient, SupabaseAuthAdapter } from "/vendor/neon-js.js";

export const DATA_API =
  "https://ep-broad-truth-auz9r4ir.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1";
export const AUTH_URL =
  "https://ep-broad-truth-auz9r4ir.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth";

/** The Piston Powered Ranch, Saturday 10 October 2026. */
export const EVENT_ID = "6ad3f289-8103-4c69-b10e-923790fb8a88";

let cached = null;

/** One client per tab. Null only if the module failed to construct. */
export function db() {
  if (cached) return cached;
  try {
    cached = createClient({
      auth: { url: AUTH_URL, allowAnonymous: true, adapter: SupabaseAuthAdapter() },
      dataApi: { url: DATA_API },
    });
  } catch (e) {
    cached = null;
  }
  return cached;
}

export async function accessToken() {
  const c = db();
  if (!c) return null;
  try {
    const s = await c.auth.getSession();
    return (s && s.data && s.data.session && s.data.session.access_token) || null;
  } catch (e) {
    return null;
  }
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

/**
 * Sign in, sign up, then sign in once more whatever sign up said.
 *
 * Sign up can create the account and still fail to hand back a session, which
 * used to end in an error message beside a working account. The auth service
 * also requires a name and answers [body.name] Invalid input without one,
 * which reads as a wrong password, so the name is derived from the address.
 */
export async function signIn(email, password) {
  const c = db();
  if (!c) return "No connection to the database.";

  const first = await c.auth.signInWithPassword({ email, password });
  if (!first.error) return null;

  const made = await c.auth.signUp({ email, password, name: nameFromEmail(email) });
  if (made.error && /already exists|already registered|USER_ALREADY/i.test(made.error.message || "")) {
    /* The address is the one right thing about this attempt. Saying "use
       another email", which is what the service returns, is the opposite of
       what they should do. */
    return "That password does not match this account. Use the sign in link, or reset it below.";
  }

  await new Promise((r) => setTimeout(r, 600));
  const again = await c.auth.signInWithPassword({ email, password });
  if (again.error) {
    return (made.error && made.error.message) ||
      "Could not sign in. Try once more, and if it repeats use the reset link.";
  }
  return null;
}

/** The way the onboarding email tells people to get in. */
export async function magicLink(email, callbackURL) {
  try {
    const r = await fetch(AUTH_URL + "/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL }),
    });
    if (r.status === 404) return "Sign in links are not switched on yet. Use a password for now.";
    if (!r.ok) return "Could not send the link (" + r.status + "). Try the password instead.";
    return null;
  } catch (e) {
    return "Could not reach the sign in service. Check your connection.";
  }
}

/**
 * Google. Answers with a one time token URL that redirects to the consent
 * screen. Credentialed because the endpoint sets state on the auth origin,
 * which its CORS headers allow from all four of our domains.
 *
 * This puts nobody on the staff list. is_staff() still decides what anybody
 * sees, so an address that is not on the list signs in and finds nothing.
 */
export async function signInWithGoogle(callbackURL) {
  try {
    const r = await fetch(AUTH_URL + "/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL }),
    });
    if (r.status === 400) return "Google sign in is not switched on for this project.";
    if (!r.ok) return "Could not start Google sign in (" + r.status + "). Use the email link instead.";
    const data = await r.json();
    if (!data || !data.url) return "Google did not give us anywhere to send you. Use the email link instead.";
    window.location.href = data.url;
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
  try {
    const r = await fetch(AUTH_URL + "/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo }),
    });
    if (r.status === 404) return "Password resets are not switched on. Use the sign in link instead.";
    if (!r.ok) return "Could not send the reset (" + r.status + "). Use the sign in link instead.";
    return null;
  } catch (e) {
    return "Could not reach the sign in service. Check your connection.";
  }
}

export async function signOut() {
  try {
    const c = db();
    if (c) await c.auth.signOut();
  } catch (e) {
    /* already gone */
  }
}
