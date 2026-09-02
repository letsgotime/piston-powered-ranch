/**
 * Catch-all route for the self-hosted Better Auth server.
 *
 * Handles /api/auth/sign-in/email, /api/auth/sign-up/email,
 * /api/auth/callback/google, /api/auth/token (JWT plugin), /api/auth/magic-link/*,
 * /api/auth/email-otp/*, /api/auth/session, /api/auth/sign-out, and every
 * other Better Auth endpoint. See lib/auth.js for the actual configuration.
 */
import { toNodeHandler } from "better-auth/node";
import { auth } from "../../lib/auth.js";

// Note: Vercel's plain /api functions (unlike Next.js API routes) have no
// bodyParser config to disable — req.body arrives already parsed. Better
// Auth's Node adapter (better-call/node) explicitly falls back to a
// pre-parsed request.body when the raw stream has already been consumed,
// so this works as-is; see node_modules/better-auth/node_modules/better-call.
export default toNodeHandler(auth);
