import type { Db } from "mongodb";
import { collections } from "../db/client";
import { ensureSchema, MIGRATIONS, type MigrationContext } from "./index";

export interface RunResult {
  applied: string[];
  pending: string[];
  blockers: string[];
  log: string[];
}

/**
 * Runs pending migrations in order. In dry-run mode nothing is written and
 * the log describes what would change. Any blocker (data a person must fix)
 * stops the run before index changes, so a unique index is never created
 * over data that violates it.
 */
export async function runMigrations(db: Db, opts: { dryRun: boolean }): Promise<RunResult> {
  const log: string[] = [];
  const blockers: string[] = [];
  const done = new Set((await collections(db).migrations.find().toArray()).map((m) => m._id));
  const pending = MIGRATIONS.filter((m) => !done.has(m.id));
  const applied: string[] = [];

  for (const m of pending) {
    const before = blockers.length;
    const ctx: MigrationContext = {
      db,
      dryRun: opts.dryRun,
      log: (msg) => log.push(`[${m.id}] ${msg}`),
      block: (msg) => blockers.push(`[${m.id}] ${msg}`),
    };
    log.push(`[${m.id}] ${m.description}${opts.dryRun ? " (dry run)" : ""}`);
    await m.run(ctx);
    if (blockers.length > before) break;
    if (!opts.dryRun) {
      await collections(db).migrations.insertOne({ _id: m.id, appliedAt: new Date() });
      applied.push(m.id);
    }
  }

  if (!blockers.length) {
    await ensureSchema({ db, dryRun: opts.dryRun, log: (msg) => log.push(`[schema] ${msg}`), block: (msg) => blockers.push(msg) });
  }
  return { applied, pending: pending.map((m) => m.id), blockers, log };
}
