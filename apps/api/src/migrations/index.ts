import type { Db } from "mongodb";
import { DEFAULT_ROLE_PERMISSIONS, FAULT_STATUSES, isSystemRoleName } from "@easytenant/shared";
import { collections } from "../db/client";
import { ensureIndexes, SEARCH_INDEX } from "../db/indexes";

export interface MigrationContext {
  db: Db;
  dryRun: boolean;
  log: (msg: string) => void;
  /** Problems that must be fixed by a person before the migration can
   * finish. Any blocker stops the run. */
  block: (msg: string) => void;
}

export interface Migration {
  id: string;
  description: string;
  run(ctx: MigrationContext): Promise<void>;
}

/** Date fields that v1 stored as ISO strings. */
const DATE_FIELDS: Record<string, string[]> = {
  users: ["createdAt", "updatedAt"],
  developments: ["createdAt", "updatedAt"],
  properties: ["createdAt", "updatedAt"],
  tenancies: ["createdAt", "startDate", "endDate"],
  roles: ["createdAt"],
  userRoles: ["createdAt"],
  invites: ["createdAt", "expiresAt", "usedAt"],
  issues: ["createdAt", "updatedAt", "scheduledDate", "slaDueAt", "costApprovedAt", "closedAt"],
  issueUpdates: ["createdAt"],
  notifications: ["createdAt"],
  auditLog: ["createdAt"],
};

const LEGACY_EVENT_NAMES: Record<string, string> = {
  "issue.reported": "fault.reported",
  "issue.updated": "fault.updated",
  "issue.status_changed": "fault.status_changed",
};

export const MIGRATIONS: Migration[] = [
  {
    id: "v2-001-dates",
    description: "Convert ISO date strings to BSON dates",
    async run({ db, dryRun, log }) {
      for (const [name, fields] of Object.entries(DATE_FIELDS)) {
        const col = db.collection(name);
        for (const f of fields) {
          const empty = await col.countDocuments({ [f]: { $in: ["", null], $exists: true } });
          const strings = await col.countDocuments({ [f]: { $type: "string", $ne: "" } });
          if (!empty && !strings) continue;
          log(`${name}.${f}: ${strings} string date(s) to convert, ${empty} empty/null to remove`);
          if (dryRun) continue;
          if (empty) await col.updateMany({ [f]: { $in: ["", null], $exists: true } }, { $unset: { [f]: "" } });
          await col.updateMany({ [f]: { $type: "string" } }, [
            { $set: { [f]: { $convert: { input: `$${f}`, to: "date", onError: `$${f}`, onNull: "$$REMOVE" } } } },
          ]);
          const bad = await col.countDocuments({ [f]: { $type: "string" } });
          if (bad) log(`  ${bad} value(s) in ${name}.${f} aren't valid dates and were left as they are`);
        }
      }
    },
  },
  {
    id: "v2-002-fault-shape",
    description: "Repair pre-pipeline fault statuses and fill missing fields",
    async run({ db, dryRun, log }) {
      const issues = collections(db).issues;
      const legacy = await issues.find({ status: { $nin: [...FAULT_STATUSES] } }).toArray();
      log(`issues: ${legacy.length} with a pre-pipeline status`);
      for (const i of legacy) {
        // Infer how far it got from the fields the pipeline sets, in order.
        let status = "logged";
        if (i.closedAt) status = "closed";
        else if (i.actualCost !== undefined) status = "cost_recording";
        else if (i.costApprovedAt) status = "repair_in_progress";
        else if (i.agreedCost !== undefined) status = "awaiting_cost_approval";
        else if (Array.isArray(i.assignedTo) && i.assignedTo.length) status = "technician_assigned";
        log(`  ${i._id} "${String(i.status)}" -> ${status}`);
        if (!dryRun) await issues.updateOne({ _id: i._id }, { $set: { status: status as never } });
      }
      const fills: [string, unknown][] = [
        ["assignedTo", []],
        ["attachments", []],
        ["type", "reactive"],
        ["priority", "medium"],
        ["category", "other"],
        ["description", ""],
      ];
      for (const [field, value] of fills) {
        const n = await issues.countDocuments({ [field]: { $exists: false } });
        if (!n) continue;
        log(`issues: ${n} missing "${field}"`);
        if (!dryRun) await issues.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
      }
      const noUpdated = await issues.countDocuments({ updatedAt: { $exists: false } });
      if (noUpdated) {
        log(`issues: ${noUpdated} missing updatedAt (set to createdAt)`);
        if (!dryRun) await issues.updateMany({ updatedAt: { $exists: false } }, [{ $set: { updatedAt: "$createdAt" } }]);
      }
      const upd = collections(db).issueUpdates;
      const noAtt = await upd.countDocuments({ attachments: { $exists: false } });
      if (noAtt && !dryRun) await upd.updateMany({ attachments: { $exists: false } }, { $set: { attachments: [] } });
    },
  },
  {
    id: "v2-003-normalise",
    description: "Lower-case emails, rename notification events, null development ids",
    async run({ db, dryRun, log }) {
      const c = collections(db);
      for (const [name, field] of [["users", "email"], ["invites", "inviteeEmail"], ["properties", "ownerEmail"]] as const) {
        const col = db.collection(name);
        const n = await col.countDocuments({ [field]: { $type: "string", $regex: /[A-Z]|^\s|\s$/ } });
        if (!n) continue;
        log(`${name}.${field}: ${n} to lower-case/trim`);
        if (!dryRun) await col.updateMany({ [field]: { $type: "string" } }, [{ $set: { [field]: { $toLower: { $trim: { input: `$${field}` } } } } }]);
      }
      for (const [from, to] of Object.entries(LEGACY_EVENT_NAMES)) {
        const n1 = await c.notifications.countDocuments({ type: from });
        const n2 = await c.notificationPreferences.countDocuments({ eventType: from });
        if (n1 + n2) log(`event "${from}" -> "${to}": ${n1} notification(s), ${n2} preference(s)`);
        if (!dryRun && n1) await c.notifications.updateMany({ type: from }, { $set: { type: to } });
        if (!dryRun && n2) await c.notificationPreferences.updateMany({ eventType: from }, { $set: { eventType: to } });
      }
      for (const name of ["userRoles", "roles"] as const) {
        const n = await c[name].countDocuments({ developmentId: { $exists: false } });
        if (!n) continue;
        log(`${name}: ${n} missing developmentId (set to null = platform-wide)`);
        if (!dryRun) await c[name].updateMany({ developmentId: { $exists: false } }, { $set: { developmentId: null } });
      }
    },
  },
  {
    id: "v2-004-duplicates",
    description: "Find data that would break the new unique constraints",
    async run({ db, dryRun, log, block }) {
      const c = collections(db);
      const dupTenancies = await c.tenancies
        .aggregate<{ _id: unknown; ids: unknown[]; n: number }>([
          { $match: { status: "active" } },
          { $group: { _id: "$propertyId", ids: { $push: "$_id" }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
        ])
        .toArray();
      for (const d of dupTenancies) {
        block(`Unit ${String(d._id)} has ${d.n} active tenancies (${d.ids.join(", ")}). End all but one in the old app or in Compass, then re-run.`);
      }
      const dupUnits = await c.properties
        .aggregate<{ _id: { developmentId: unknown; unitNumber: string }; ids: unknown[]; n: number }>([
          { $group: { _id: { developmentId: "$developmentId", unitNumber: "$unitNumber" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
        ])
        .toArray();
      for (const d of dupUnits) {
        block(`Development ${String(d._id.developmentId)} has ${d.n} units numbered "${d._id.unitNumber}" (${d.ids.join(", ")}). Rename or merge them, then re-run.`);
      }
      // Exact duplicate role grants are harmless to remove.
      const dupGrants = await c.userRoles
        .aggregate<{ ids: unknown[] }>([
          { $group: { _id: { u: "$userId", d: "$developmentId", r: "$roleId" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
        ])
        .toArray();
      const extra = dupGrants.flatMap((g) => g.ids.slice(1));
      if (extra.length) {
        log(`userRoles: ${extra.length} exact duplicate grant(s) to delete`);
        if (!dryRun) await c.userRoles.deleteMany({ _id: { $in: extra as never[] } });
      }
    },
  },
  {
    id: "v2-005-report-retired",
    description: "Report v1 collections the new app no longer uses (left untouched)",
    async run({ db, log }) {
      const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
      for (const n of ["workOrders", "progressUpdates", "servicePersonnel"]) {
        if (names.has(n)) log(`${n}: ${await db.collection(n).countDocuments()} document(s), no longer used. Kept as-is; drop it once you're happy.`);
      }
      const legacyInvites = await collections(db).invites.countDocuments({ status: "pending", inviteeEmail: { $exists: false } });
      if (legacyInvites) log(`invites: ${legacyInvites} pending invite(s) have no email address. v2 won't accept them; re-send from the Invites page.`);
    },
  },
];

/** Idempotent steps that run on every migrate, after the recorded ones. */
export async function ensureSchema(ctx: MigrationContext) {
  const { db, dryRun, log } = ctx;
  if (dryRun) {
    log("indexes: would create/replace the indexes in db/indexes.ts");
    return;
  }
  await ensureIndexes(db, log);
  await ensureSearchIndex(db, log);
  // Add any permission that was introduced after a system role was created.
  const roles = collections(db).roles;
  for (const r of await roles.find({ isSystemRole: true }).toArray()) {
    if (!isSystemRoleName(r.name)) continue;
    const missing = DEFAULT_ROLE_PERMISSIONS[r.name].filter((p) => !r.permissions.includes(p));
    if (missing.length) {
      log(`roles: adding ${missing.join(", ")} to ${r.name} (${r.developmentId ?? "platform"})`);
      await roles.updateOne({ _id: r._id }, { $addToSet: { permissions: { $each: missing } } });
    }
  }
}

async function ensureSearchIndex(db: Db, log: (m: string) => void) {
  try {
    const col = db.collection("developments");
    const existing = await col.listSearchIndexes().toArray();
    if (existing.some((i) => i.name === SEARCH_INDEX)) return;
    const ac = { type: "autocomplete", tokenization: "nGram", minGrams: 2, maxGrams: 15, foldDiacritics: true };
    await col.createSearchIndex({
      name: SEARCH_INDEX,
      definition: { mappings: { dynamic: false, fields: { name: [{ type: "string" }, ac], address: [{ type: "string" }, ac] } } },
    });
    log(`search index "${SEARCH_INDEX}" created (Atlas builds it in the background)`);
  } catch (err) {
    log(`search index skipped (needs Atlas): ${err instanceof Error ? err.message : err}`);
  }
}
