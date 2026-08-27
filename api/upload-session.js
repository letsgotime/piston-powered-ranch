import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * Exchanges one Turnstile token for a short-lived, signed upload session.
 *
 * Turnstile tokens are single-use at siteverify, but one vehicle submission can
 * be 50 photos plus video, voice and documents, each its own call to
 * /api/upload. Verifying per file would fail on the second one with
 * "timeout-or-duplicate". So the human is checked once here, and the result is
 * a signed session that authorises that submitter's uploads for a short window.
 *
 * Rollout: with TURNSTILE_SECRET unset this reports enforced:false and issues
 * no session, and /api/upload stays open exactly as it is today. Setting the
 * secret turns enforcement on with no code change.
 */

export const SESSION_TTL_MS = 30 * 60 * 1000;
const SUBMISSION_TYPES = new Set(["vehicle", "vendor", "sponsor"]);

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `v1.${body}.${mac}`;
}

export function verifySession(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = createHmac("sha256", secret).update(parts[1]).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.e !== "number" || Date.now() > payload.e) return null;
  return payload;
}

export function sessionSecret() {
  // A dedicated secret is preferred; fall back to the Turnstile secret so
  // enabling the gate never depends on remembering a second variable.
  return process.env.UPLOAD_SESSION_SECRET || process.env.TURNSTILE_SECRET || "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.TURNSTILE_SECRET || "";
  if (!secret) {
    // Not configured: uploads remain open. Loud on the server, explicit to the client.
    console.warn("[turnstile] TURNSTILE_SECRET unset, upload gate NOT enforced");
    return response.status(200).json({ enforced: false, session: null });
  }

  const body =
    typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const token = body.token;
  const draftId = String(body.draftId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const submissionType = SUBMISSION_TYPES.has(body.submissionType)
    ? body.submissionType
    : "vehicle";

  if (typeof token !== "string" || !token || token.length > 2048 || draftId.length < 8) {
    return response.status(403).json({ error: "Verification required" });
  }

  const expectedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  );
  if (expectedHostnames.size === 0) {
    console.error("[turnstile] TURNSTILE_HOSTNAMES unset, refusing to verify");
    return response.status(403).json({ error: "Verification misconfigured" });
  }

  const clientIp =
    (request.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    request.socket?.remoteAddress ||
    "";

  let result;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(clientIp ? { remoteip: clientIp } : {}),
      }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch {
    return response.status(403).json({ error: "Verification failed" });
  }

  if (
    !result.success ||
    result.action !== "submit-media" ||
    !expectedHostnames.has(result.hostname)
  ) {
    return response.status(403).json({ error: "Verification failed" });
  }

  const session = signSession(
    { d: draftId, t: submissionType, e: Date.now() + SESSION_TTL_MS, j: randomUUID() },
    sessionSecret(),
  );
  return response.status(200).json({ enforced: true, session, expiresIn: SESSION_TTL_MS });
}
