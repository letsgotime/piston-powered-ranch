/**
 * The Neon endpoints, for the serverless side.
 *
 * The browser gets these from /vendor/ranch-db.js?v=2026-09-02d, which it cannot share with
 * this side: that module is served over HTTP and imports the vendored client,
 * neither of which a function can do. So the endpoints live in two files
 * rather than twenty four, and this is the second one.
 *
 * The underscore keeps it out of routing: it is a helper, not an endpoint.
 */

export const DATA_API =
  "https://ep-broad-truth-auz9r4ir.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1";

/**
 * September 2026: auth moved off Neon's hosted endpoint onto our own
 * self-hosted Better Auth server (lib/auth.js, mounted at /api/auth). JWKS
 * is now served from there too, which is why this is a relative path rather
 * than a second hostname — a Vercel function can't reliably know its own
 * public origin, but every request it handles already carries one.
 */
export const AUTH_PATH = "/api/auth";

/** Where jose fetches the keys that verify a caller's session token. */
export const JWKS_PATH = AUTH_PATH + "/jwks";

/**
 * Builds an absolute JWKS URL from the incoming request's own host, since
 * createRemoteJWKSet needs a full URL and this file has no request object
 * of its own.
 */
export function jwksUrlFromRequest(request) {
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}${JWKS_PATH}`;
}

/** The Piston Powered Ranch, Saturday 10 October 2026. */
export const EVENT_ID = "6ad3f289-8103-4c69-b10e-923790fb8a88";
