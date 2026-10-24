import type { Db, IndexDescription } from "mongodb";

/**
 * Every index the API relies on. Applied by the migration runner
 * (npm run db:migrate), not at server boot, so cold starts stay fast.
 * docs/DATABASE.md explains which query each index serves.
 */
export const INDEXES: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, name: "email" }],
  developments: [{ key: { name: 1, _id: 1 }, name: "name_id" }],
  properties: [
    {
      key: { developmentId: 1, unitNumber: 1 },
      name: "unique_unit_per_development",
      unique: true,
    },
  ],
  tenancies: [
    {
      key: { propertyId: 1 },
      name: "one_active_tenancy_per_unit",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
    { key: { developmentId: 1, status: 1 }, name: "development_status" },
    { key: { tenantUserId: 1, status: 1 }, name: "tenant_status" },
  ],
  roles: [
    { key: { developmentId: 1, name: 1 }, name: "unique_role_name", unique: true },
  ],
  userRoles: [
    { key: { userId: 1, developmentId: 1, roleId: 1 }, name: "unique_grant", unique: true },
    { key: { developmentId: 1, roleId: 1 }, name: "development_role" },
  ],
  invites: [
    { key: { code: 1 }, name: "unique_code", unique: true },
    { key: { developmentId: 1, createdAt: -1, _id: -1 }, name: "development_recent" },
    { key: { propertyId: 1, status: 1 }, name: "property_status" },
  ],
  issues: [
    { key: { developmentId: 1, createdAt: -1, _id: -1 }, name: "development_recent" },
    { key: { developmentId: 1, status: 1, createdAt: -1, _id: -1 }, name: "development_status_recent" },
    { key: { createdAt: -1, _id: -1 }, name: "recent" },
    { key: { reporterId: 1, createdAt: -1, _id: -1 }, name: "reporter_recent" },
    { key: { propertyId: 1, createdAt: -1, _id: -1 }, name: "property_recent" },
    { key: { assignedTo: 1, createdAt: -1, _id: -1 }, name: "assignee_recent" },
    { key: { status: 1, scheduledDate: 1 }, name: "status_scheduled" },
  ],
  issueUpdates: [{ key: { issueId: 1, createdAt: 1 }, name: "issue_timeline" }],
  notifications: [
    { key: { userId: 1, createdAt: -1 }, name: "user_recent" },
    { key: { userId: 1, read: 1 }, name: "user_unread" },
    // Keep a year of notifications; M0 storage is 512 MB.
    { key: { createdAt: 1 }, name: "ttl_one_year", expireAfterSeconds: 365 * 86_400 },
  ],
  notificationPreferences: [
    { key: { userId: 1, eventType: 1 }, name: "unique_user_event", unique: true },
  ],
  auditLog: [
    { key: { targetType: 1, targetId: 1, createdAt: -1 }, name: "target_recent" },
    { key: { createdAt: -1 }, name: "recent" },
  ],
};

const CONFLICT_CODES = new Set([85, 86]); // IndexOptionsConflict, IndexKeySpecsConflict

function sameKey(a: Record<string, unknown>, b: Record<string, unknown>) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Creates each index. If an index with the same key already exists with
 * different options (e.g. a v1 non-unique index we now want unique), the
 * old one is dropped and recreated. Returns a log of what changed.
 */
export async function ensureIndexes(db: Db, log: (msg: string) => void = () => {}) {
  for (const [name, specs] of Object.entries(INDEXES)) {
    const col = db.collection(name);
    for (const spec of specs) {
      try {
        await col.createIndexes([spec]);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (!code || !CONFLICT_CODES.has(code)) throw err;
        const existing = await col.listIndexes().toArray();
        const clash = existing.find(
          (i) => i.name === spec.name || sameKey(i.key, spec.key as Record<string, unknown>)
        );
        if (!clash || clash.name === "_id_") throw err;
        log(`${name}: replacing index "${clash.name}" with "${spec.name}"`);
        await col.dropIndex(clash.name);
        await col.createIndexes([spec]);
      }
    }
  }
}
