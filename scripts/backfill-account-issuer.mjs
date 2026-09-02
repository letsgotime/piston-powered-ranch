/**
 * One-time migration: add the `issuer` column Better Auth 1.7 requires on
 * neon_auth.account, backfill it for every pre-1.7 row, then lock it down.
 *
 * Why this exists: Better Auth 1.7 scopes account identity by
 * (issuer, accountId) instead of just (providerId, accountId). The
 * neon_auth.account table here was created by Neon's older hosted Better
 * Auth and has no issuer column at all — every insert/lookup against it
 * fails with `column "issuer" of relation "account" does not exist` until
 * this runs. lib/auth.js sets `account.identityStrategy: "provider-id"`,
 * which is the supported upgrade path for a populated pre-1.7 table: it
 * keeps each row's existing provider-scoped identity by mapping it to a
 * synthetic namespace (`local:credential`, `local:oauth:<provider>`)
 * instead of guessing at a verified OIDC issuer after the fact.
 *
 * Safe to run more than once — every step is idempotent (IF NOT EXISTS /
 * WHERE issuer IS NULL / index created once).
 *
 * Run with: node --env-file-if-exists=.env.development.local scripts/backfill-account-issuer.mjs
 */
import { Pool } from "pg";

const DATABASE_URL =
  process.env.RANCH_DATABASE_URL ||
  process.env.PISTON_RANCH_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("No RANCH_DATABASE_URL / PISTON_RANCH_DATABASE_URL / DATABASE_URL set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function issuerFor(providerId) {
  if (providerId === "credential") return "local:credential";
  return `local:oauth:${providerId}`;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path TO neon_auth, public");
    await client.query("BEGIN");

    console.log("[1/5] Adding nullable issuer column (if missing)...");
    await client.query(`ALTER TABLE account ADD COLUMN IF NOT EXISTS issuer text`);

    console.log("[2/5] Inventorying rows needing a backfill...");
    const { rows: pending } = await client.query(
      `SELECT id, "providerId" FROM account WHERE issuer IS NULL`,
    );
    console.log(`  ${pending.length} row(s) need an issuer value.`);

    const byProvider = {};
    for (const row of pending) {
      byProvider[row.providerId] = (byProvider[row.providerId] || 0) + 1;
    }
    console.log("  by providerId:", byProvider);

    console.log("[3/5] Backfilling issuer per provider-id strategy...");
    for (const providerId of Object.keys(byProvider)) {
      const issuer = issuerFor(providerId);
      const result = await client.query(
        `UPDATE account SET issuer = $1 WHERE "providerId" = $2 AND issuer IS NULL`,
        [issuer, providerId],
      );
      console.log(`  ${providerId} -> ${issuer} (${result.rowCount} row(s))`);
    }

    console.log("[4/5] Checking for (issuer, accountId) collisions before locking down...");
    const { rows: collisions } = await client.query(`
      SELECT issuer, "accountId", COUNT(*) AS account_count, COUNT(DISTINCT "userId") AS user_count
      FROM account
      GROUP BY issuer, "accountId"
      HAVING COUNT(*) > 1
    `);
    if (collisions.length > 0) {
      console.error("  COLLISIONS FOUND — aborting without making issuer NOT NULL:");
      console.error(collisions);
      await client.query("ROLLBACK");
      process.exit(1);
    }
    console.log("  No collisions.");

    console.log("[5/5] Enforcing NOT NULL + unique (issuer, accountId) index...");
    await client.query(`ALTER TABLE account ALTER COLUMN issuer SET NOT NULL`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_accountid_uidx ON account (issuer, "accountId")`,
    );

    await client.query("COMMIT");
    console.log("Done. neon_auth.account is ready for Better Auth 1.7.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
