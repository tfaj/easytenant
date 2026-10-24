import type { ObjectId } from "mongodb";
import type { Collections } from "../db/client";

/** Append-only record of privileged actions (role changes, cost approvals,
 * tenancy changes, settings). Never blocks the action it records. */
export async function audit(
  cols: Collections,
  entry: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    developmentId?: ObjectId | null;
    before?: unknown;
    after?: unknown;
  }
) {
  try {
    await cols.auditLog.insertOne({ ...entry, createdAt: new Date() } as never);
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}
