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

export async function signOut() {
  try {
    const c = db();
    if (c) await c.auth.signOut();
  } catch (e) {
    /* already gone */
  }
}
