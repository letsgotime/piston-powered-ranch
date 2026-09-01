import { issueSignedToken, presignUrl } from "@vercel/blob";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { DATA_API, JWKS_URL } from "./_neon.js";

/**
 * Returns short-lived signed URLs for submitted media.
 *
 * The Blob store is private, so nothing under it is readable by URL. Submitted
 * vehicle photos routinely show plates and VINs, so read access is gated on a
 * verified Neon Auth token belonging to a staff address, mirroring what
 * is_staff() enforces in Postgres. This is deliberately a second, independent
 * check: RLS protects the rows, this protects the pixels.
 * */


/**
 * Authorisation comes from public.staff_allowlist, never from a list in code.
 *
 * We still verify the token ourselves above: that is authentication, and it is
 * cryptographic. This asks the database the separate question of whether the
 * verified person is staff, by replaying their own token against is_staff().
 * The row-level policy and this check therefore read the same table, so
 * adding somebody to the allowlist is the whole job. It used to mean editing
 * every function too, which drifted once and locked Bekah out of her own
 * uploads.
 */
async function isStaff(bearer) {
  let res;
  try {
    res = await fetch(`${DATA_API}/rpc/is_staff`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  return (await res.text()).trim() === "true";
}

const JWKS = createRemoteJWKSet(
  new URL(
    JWKS_URL,
  ),
);

const URL_TTL_MS = 10 * 60 * 1000;
const MAX_PER_REQUEST = 120;

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

  if (!(await isStaff(bearer))) {
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
        // Only ever sign things under a namespace this endpoint owns:
        // submitted entrant media, staff workbench attachments, chat
        // attachments and profile avatars. Anything else, including
        // traversal, is refused rather than signed.
        const allowed =
          pathname.startsWith("submissions/") ||
          pathname.startsWith("workbench/") ||
          pathname.startsWith("chat/") ||
          pathname.startsWith("avatars/");
        if (!allowed || pathname.includes("..")) {
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
