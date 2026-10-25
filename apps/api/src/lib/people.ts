import type { UserSummary } from "@easytenant/shared";
import type { Collections } from "../db/client";

/** Batch-resolves user ids to display summaries (one query per call). */
export async function userSummaries(cols: Collections, ids: Iterable<string | undefined | null>) {
  const unique = [...new Set([...ids].filter((x): x is string => Boolean(x)))];
  const map = new Map<string, UserSummary>();
  if (!unique.length) return map;
  const docs = await cols.users
    .find({ _id: { $in: unique } }, { projection: { email: 1, name: 1 } })
    .toArray();
  for (const d of docs) map.set(d._id, { id: d._id, name: d.name ?? null, email: d.email });
  return map;
}

export function displayName(u: { name?: string | null; email: string } | null | undefined): string {
  return u?.name || u?.email || "Someone";
}
