/**
 * Read-only verification: confirms the two live-DB backfills we relied on
 * this session actually landed, instead of trusting them secondhand.
 *
 *   1. neon_auth.account.issuer — NOT NULL, unique (issuer, accountId) index
 *      present, zero rows with a null issuer (backfill-account-issuer.mjs).
 *   2. neon_auth.user.emailVerified — every existing user is verified, since
 *      lib/auth.js now sets requireEmailVerification: true and an unverified
 *      row would be locked out of sign-in.
 *
 * Makes NO writes. Safe to run any time.
 *
 * Run with: node --env-file-if-exists=.env.development.local scripts/verify-backfills.mjs
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

async function main() {
  const client = await pool.connect();
  let ok = true;
  try {
    await client.query("SET search_path TO neon_auth, public");

    console.log("=== 1. account.issuer backfill ===");
    const { rows: colInfo } = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'neon_auth' AND table_name = 'account' AND column_name = 'issuer'
    `);
    if (colInfo.length === 0) {
      console.error("  FAIL: neon_auth.account.issuer column does not exist.");
      ok = false;
    } else {
      console.log(`  issuer column nullable: ${colInfo[0].is_nullable} (expect NO)`);
      if (colInfo[0].is_nullable !== "NO") ok = false;
    }

    const { rows: nullIssuers } = await client.query(
      `SELECT COUNT(*) AS n FROM account WHERE issuer IS NULL`,
    );
    console.log(`  rows with NULL issuer: ${nullIssuers[0].n} (expect 0)`);
    if (Number(nullIssuers[0].n) !== 0) ok = false;

    const { rows: idx } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'neon_auth' AND tablename = 'account'
        AND indexname = 'account_issuer_accountid_uidx'
    `);
    console.log(`  unique (issuer, accountId) index present: ${idx.length > 0} (expect true)`);
    if (idx.length === 0) ok = false;

    const { rows: byIssuer } = await client.query(
      `SELECT issuer, COUNT(*) AS n FROM account GROUP BY issuer ORDER BY issuer`,
    );
    console.log("  issuer breakdown:", byIssuer);

    console.log("\n=== 2. user.emailVerified backfill ===");
    const { rows: unverified } = await client.query(
      `SELECT id, email, "emailVerified" FROM "user" WHERE "emailVerified" IS NOT TRUE ORDER BY email`,
    );
    console.log(`  unverified users: ${unverified.length} (expect 0)`);
    if (unverified.length > 0) {
      console.log("  UNVERIFIED ROWS (would be locked out now that requireEmailVerification is on):");
      console.log(unverified);
      ok = false;
    }

    const { rows: allUsers } = await client.query(
      `SELECT email, "emailVerified" FROM "user" ORDER BY email`,
    );
    console.log("  all users:", allUsers);

    console.log(`\n=== RESULT: ${ok ? "PASS — both backfills confirmed" : "FAIL — see above"} ===`);
    if (!ok) process.exit(1);
  } catch (err) {
    console.error("Verification query failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
