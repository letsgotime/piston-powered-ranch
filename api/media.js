import { issueSignedToken, presignUrl } from "@vercel/blob";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Returns short-lived signed URLs for submitted media.
 *
 * The Blob store is private, so nothing under it is readable by URL. Submitted
 * vehicle photos routinely show plates and VINs, so read access is gated on a
 * verified Neon Auth token belonging to a staff address, mirroring what
 * is_staff() enforces in Postgres. This is deliberately a second, independent
 * check: RLS protects the rows, this protects the pixels.
 *
 * Keep this set in step with public.staff_allowlist. It drifted once already:
 * the table had bekahstallard@gmail.com (the address she actually signs in
 * with) while this list only had bekah@paddock20.com, so her session verified
 * and was then refused here. Once DATABASE_URL is in the Vercel env this
 * should read the allowlist table instead of duplicating it.
 */

const STAFF = new Set([
  "paddock20auto@gmail.com",
  "gavin@paddock20.com",
  "bekah@paddock20.com",
  "bekahstallard@gmail.com",
]);

const JWKS = createRemoteJWKSet(
  new URL(
    "https://ep-broad-truth-auz9r4ir.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json",
  ),
);

const URL_TTL_MS = 10 * 60 * 1000;
const MAX_PER_REQUEST = 60;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const auth = request.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearer) return response.status(401).json({ error: "Sign in required" });

  let email = "";
  try {
    const { payload } = await jwtVerify(bearer, JWKS);
    email = String(payload.email || payload.sub_email || "").toLowerCase();
  } catch {
    return response.status(401).json({ error: "Invalid or expired session" });
  }

  if (!STAFF.has(email)) {
    return response.status(403).json({ error: "Not authorised for submitted media" });
  }

  const body =
    typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const pathnames = Array.isArray(body.pathnames) ? body.pathnames : [];
  if (!pathnames.length) return response.status(400).json({ error: "No pathnames given" });
  if (pathnames.length > MAX_PER_REQUEST) {
    return response.status(400).json({ error: `Too many items (max ${MAX_PER_REQUEST})` });
  }

  const validUntil = Date.now() + URL_TTL_MS;

  try {
    const urls = await Promise.all(
      pathnames.map(async (raw) => {
        const pathname = String(raw || "");
        // Only ever sign things that live under the submissions namespace.
        if (!pathname.startsWith("submissions/") || pathname.includes("..")) {
          return { pathname, error: "Refused" };
        }
        const signed = await issueSignedToken({
          pathname,
          operations: ["get"],
          validUntil,
        });
        const { presignedUrl } = await presignUrl(signed, {
          operation: "get",
          pathname,
          access: "private",
          validUntil,
        });
        return { pathname, url: presignedUrl };
      }),
    );
    return response.status(200).json({ urls, expiresAt: validUntil });
  } catch (error) {
    return response.status(500).json({ error: error?.message || "Could not sign media URLs" });
  }
}
