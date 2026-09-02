/**
 * Entry point bundled by tools/build-better-auth-client.mjs into
 * vendor/better-auth-client.js. This project deliberately has no runtime
 * build step (see package.json description); this file is a one-time
 * bundling input, not something the browser ever loads directly.
 */
export { createAuthClient } from "better-auth/client";
export { magicLinkClient, emailOTPClient, jwtClient } from "better-auth/client/plugins";
