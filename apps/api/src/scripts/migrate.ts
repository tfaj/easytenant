/**
 * npm run db:migrate              dry run: prints what would change
 * npm run db:migrate -- --apply   applies the changes
 *
 * Needs MONGODB_URI and DB_NAME. Take a backup first (see docs/MIGRATION.md).
 */
import { MongoClient } from "mongodb";
import { runMigrations } from "../migrations/runner";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME ?? "easytenant";
if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

const client = new MongoClient(uri, { appName: "easytenant-migrate" });
try {
  await client.connect();
  console.log(`${apply ? "Applying" : "Dry run"} against database "${dbName}"\n`);
  const result = await runMigrations(client.db(dbName), { dryRun: !apply });
  for (const line of result.log) console.log(line);
  if (result.blockers.length) {
    console.error("\nBlocked. Fix these, then run again:");
    for (const b of result.blockers) console.error(`  - ${b}`);
    process.exitCode = 2;
  } else if (!apply) {
    console.log(`\n${result.pending.length} migration(s) pending. Nothing was changed. Re-run with --apply.`);
  } else {
    console.log(`\nDone. Applied: ${result.applied.join(", ") || "none (already up to date)"}.`);
  }
} finally {
  await client.close();
}
