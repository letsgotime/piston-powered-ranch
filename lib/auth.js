import { betterAuth } from "better-auth";
import { passkey } from "better-auth/plugins/passkey";
import { magicLink } from "better-auth/plugins";
import { Pool } from "pg";
import { Resend } from "resend";

/**
 * Self-hosted Better Auth on the same Neon Postgres the whole platform uses.
 * Replaces managed Neon Auth at cutover; until then it runs beside it.
 *
 * Ships inert without env: BETTER_AUTH_SECRET and DATABASE_URL are required
 * to construct at all; RESEND_API_KEY is optional and, when absent, magic
 * links are logged server-side instead of emailed so previews stay testable.
 */

const url = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
const resendKey = process.env.RESEND_API_KEY;
const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const authReady = Boolean(url && secret);

export const auth = authReady
  ? betterAuth({
      baseURL,
      secret,
      // Neon Auth's managed tables live in the neon_auth schema with uuid ids;
      // self-hosted Better Auth rides the same tables, same users, same hashes.
      database: new Pool({
        // Auth uses the UNPOOLED Neon endpoint: the pooler rejects search_path
        // as a startup option, and auth needs session-stable settings. Pool is
        // tiny on purpose; everything else keeps using the pooled Data API.
        connectionString: url.replace("-pooler.", "."),
        max: 3,
        options: "-c search_path=neon_auth,public",
      }),
      advanced: {
        database: { generateId: () => crypto.randomUUID() },
      },
      emailAndPassword: { enabled: true },
      plugins: [
        passkey({
          rpName: "PaddockGavin Events",
        }),
        magicLink({
          async sendMagicLink({ email, url: link }) {
            if (!resendKey) {
              console.log("[auth] magic link for", email, "->", link);
              return;
            }
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: "PaddockGavin Events <signin@paddockgavin.com>",
              to: email,
              subject: "Your PaddockGavin sign-in link",
              text:
                "Tap to sign in to PaddockGavin Events:\n\n" +
                link +
                "\n\nThis link expires shortly and works once. If you did not request it, ignore this email.",
            });
          },
        }),
        // jwt() returns at cutover: the shared jwks table still holds managed
        // Neon Auth's encrypted keys, and live auth depends on them. Once
        // managed auth is retired, clean neon_auth.jwks and re-enable jwt()
        // to serve the JWKS endpoint the Data API will verify against.
      ],
    })
  : null;
