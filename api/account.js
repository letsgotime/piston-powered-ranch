import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { DATA_API, jwksUrlFromRequest, EVENT_ID } from "./_neon.js";

/**
 * The customer / vendor / sponsor portal, server side.
 *
 * The event's public forms (a car entry at /console/#submit, an RSVP at
 * /spectate/) write to public.submissions and public.spectators with the
 * signer's own email. Those tables are staff-only under row-level security,
 * so a guest cannot read even their own rows through the PostgREST DATA_API.
 * This endpoint is the one place that reads them on a guest's behalf: it
 * verifies the caller's session token, then queries with the privileged
 * connection but only ever for rows whose email matches the verified caller.
 * A person therefore sees their own entries and nothing else, without any
 * table having to relax its policy.
 *
 * There is deliberately no new "roles" table. What someone is follows from
 * what they have done: a vehicle submission makes them an entrant, a vendor
 * or sponsor submission makes them that, an RSVP makes them a spectator, and
 * staff is still the allowlist answered by is_staff(). "Staff assigns" a
 * vendor by approving that vendor's submission in the console, which flips
 * its status to approved — the same flow that already exists.
 */

// JWKS now lives on this same deployment; its host isn't known until a
// request arrives, so cache the verifier per host exactly like the other
// protected endpoints do.
const jwksByHost = new Map();
function getJwks(request) {
  const url = jwksUrlFromRequest(request);
  if (!jwksByHost.has(url)) {
    jwksByHost.set(url, createRemoteJWKSet(new URL(url)));
  }
  return jwksByHost.get(url);
}

/**
 * Authentication is cryptographic (above). This asks the separate question of
 * whether the verified person is staff, by replaying their own token against
 * is_staff() — the same table the row-level policies read, so the allowlist
 * is the whole answer. Any failure is treated as "not staff": the worst case
 * is a staff member not seeing the console shortcut on their portal, which is
 * harmless since they reach /console/ directly.
 */
async function isStaff(bearer) {
  try {
    const res = await fetch(`${DATA_API}/rpc/is_staff`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return false;
    return (await res.text()).trim() === "true";
  } catch {
    return false;
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const auth = request.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearer) return response.status(401).json({ error: "Sign in required" });

  let email = "";
  try {
    const { payload } = await jwtVerify(bearer, getJwks(request));
    email = String(payload.email || payload.sub_email || "").toLowerCase();
  } catch {
    return response.status(401).json({ error: "Invalid or expired session" });
  }
  if (!email) return response.status(401).json({ error: "Session has no email" });

  const dbUrl = process.env.RANCH_DATABASE_URL || process.env.PISTON_RANCH_DATABASE_URL;
  if (!dbUrl) return response.status(500).json({ error: "Portal storage is not configured" });

  const sql = neon(dbUrl);

  let entries = [];
  let rsvps = [];
  let staff = false;
  try {
    const [subs, specs, isS] = await Promise.all([
      sql`
        select type, applicant_name, status, details, media_link, created_at
        from submissions
        where lower(email) = ${email}
        order by created_at desc
      `,
      sql`
        select name, party_size, source, created_at
        from spectators
        where lower(email) = ${email}
        order by created_at desc
      `,
      isStaff(bearer),
    ]);
    entries = subs || [];
    rsvps = specs || [];
    staff = isS;
  } catch (err) {
    return response
      .status(500)
      .json({ error: "Could not load your account", detail: String(err && err.message) });
  }

  // What the person is follows from what they have.
  const roleSet = new Set();
  for (const e of entries) {
    if (e.type === "vehicle") roleSet.add("entrant");
    else if (e.type === "vendor") roleSet.add("vendor");
    else if (e.type === "sponsor") roleSet.add("sponsor");
  }
  if (rsvps.length) roleSet.add("spectator");
  if (staff) roleSet.add("staff");

  response.setHeader("Cache-Control", "no-store, private");
  return response.status(200).json({
    email,
    isStaff: staff,
    roles: Array.from(roleSet),
    entries,
    rsvps,
    eventId: EVENT_ID,
  });
}
