/**
 * The Neon endpoints, for the serverless side.
 *
 * The browser gets these from /vendor/ranch-db.js?v=2026-09-02c, which it cannot share with
 * this side: that module is served over HTTP and imports the vendored client,
 * neither of which a function can do. So the endpoints live in two files
 * rather than twenty four, and this is the second one.
 *
 * The underscore keeps it out of routing: it is a helper, not an endpoint.
 */

export const DATA_API =
  "https://ep-broad-truth-auz9r4ir.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1";

export const AUTH_URL =
  "https://ep-broad-truth-auz9r4ir.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth";

/** Where jose fetches the keys that verify a caller's session token. */
export const JWKS_URL = AUTH_URL + "/.well-known/jwks.json";

/** The Piston Powered Ranch, Saturday 10 October 2026. */
export const EVENT_ID = "6ad3f289-8103-4c69-b10e-923790fb8a88";
