import { auth, authReady } from "../../../../lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const inert = () =>
  Response.json({ error: "Auth not configured. Set BETTER_AUTH_SECRET and DATABASE_URL." }, { status: 503 });

const handlers = authReady ? toNextJsHandler(auth) : { GET: inert, POST: inert };
export const GET = handlers.GET;
export const POST = handlers.POST;
