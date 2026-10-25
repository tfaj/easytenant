import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { DEFAULT_ROLE_PERMISSIONS } from "@easytenant/shared";
import { runMigrations } from "../src/migrations/runner";

/** Builds a database shaped exactly like v1 data: ISO-string dates,
 * pre-pipeline statuses, "issue.*" event names, mixed-case emails, v1's
 * non-unique indexes, and a role missing a newer permission. */
async function seedV1(db: Db) {
  const devId = new ObjectId();
  const unitId = new ObjectId();
  const unit2 = new ObjectId();
  const roleTenant = new ObjectId();
  const roleAdmin = new ObjectId();
  const t = "2026-03-01T10:00:00.000Z";
  await db.collection("developments").insertOne({ _id: devId, name: "Palm Grove", address: "Lekki", adminIds: [], propertyManagerIds: [], createdAt: t });
  await db.collection("properties").insertMany([
    { _id: unitId, developmentId: devId, unitNumber: "A1", type: "flat", ownerEmail: "Owner@Example.com", createdAt: t },
    { _id: unit2, developmentId: devId, unitNumber: "A2", type: "flat", createdAt: t },
  ]);
  await db.collection("users").insertMany([
    { _id: "u-tenant" as never, email: "Tenant@Example.com", status: "active", createdAt: t },
    { _id: "u-admin" as never, email: "admin@example.com", status: "active", createdAt: t },
  ]);
  await db.collection("roles").insertMany([
    { _id: roleTenant, name: "tenant", developmentId: devId, permissions: ["issue:create"], isSystemRole: true, createdAt: t },
    { _id: roleAdmin, name: "admin", developmentId: null, permissions: DEFAULT_ROLE_PERMISSIONS.admin.filter((p) => p !== "issue:approve_cost"), isSystemRole: true, createdAt: t },
  ]);
  await db.collection("userRoles").createIndex({ userId: 1, developmentId: 1, roleId: 1 });
  await db.collection("userRoles").insertMany([
    { userId: "u-tenant", developmentId: devId, roleId: roleTenant, createdAt: t },
    { userId: "u-tenant", developmentId: devId, roleId: roleTenant, createdAt: t },
    { userId: "u-admin", developmentId: null, roleId: roleAdmin, createdAt: t },
  ]);
  await db.collection("tenancies").createIndex({ propertyId: 1, status: 1 });
  await db.collection("tenancies").insertOne({ tenantUserId: "u-tenant", propertyId: unitId, developmentId: devId, startDate: t, status: "active", createdAt: t });
  const issueId = new ObjectId();
  await db.collection("issues").insertMany([
    { _id: issueId, reporterId: "u-tenant", propertyId: unitId, developmentId: devId, title: "Leak", description: "x", category: "plumbing", priority: "high", attachments: [], status: "open", createdAt: t },
    { reporterId: "u-tenant", propertyId: unitId, developmentId: devId, title: "Door", description: "", category: "other", priority: "low", attachments: [], status: "converted", assignedTo: ["tech"], createdAt: t, scheduledDate: "" },
    { reporterId: "u-tenant", propertyId: unitId, developmentId: devId, title: "Done", description: "", category: "other", priority: "low", attachments: [], status: "verified", closedAt: "2026-03-05T10:00:00.000Z", actualCost: 100, createdAt: t },
  ]);
  await db.collection("issueUpdates").insertOne({ issueId, authorId: "u-tenant", note: "hi", attachments: [], createdAt: t });
  await db.collection("notifications").insertOne({ userId: "u-admin", type: "issue.reported", payload: { issueId: String(issueId), title: "Leak" }, channels: ["inapp"], read: false, createdAt: t });
  await db.collection("notificationPreferences").insertOne({ userId: "u-admin", eventType: "issue.updated", channels: ["inapp"] });
  await db.collection("invites").insertOne({ code: "abcdEFGH", developmentId: devId, propertyId: unit2, role: "tenant", status: "pending", createdBy: "u-admin", expiresAt: "2026-12-01T00:00:00.000Z", inviteeEmail: "New@Example.com", createdAt: t });
  await db.collection("workOrders").insertOne({ title: "old" });
  return { devId, unitId, issueId };
}

let client: MongoClient;
let db: Db;
let ids: Awaited<ReturnType<typeof seedV1>>;

beforeAll(async () => {
  client = new MongoClient(process.env.TEST_MONGO_URI!);
  await client.connect();
  db = client.db(`mig_${new ObjectId().toHexString()}`);
  ids = await seedV1(db);
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

describe("v1 → v2 migration", () => {
  it("dry run reports changes and writes nothing", async () => {
    const r = await runMigrations(db, { dryRun: true });
    expect(r.blockers).toEqual([]);
    expect(r.log.join("\n")).toMatch(/issues.createdAt: 3 string date/);
    expect(r.log.join("\n")).toMatch(/"open" -> logged/);
    expect(await db.collection("_migrations").countDocuments()).toBe(0);
    expect(typeof (await db.collection("issues").findOne({ _id: ids.issueId }))!.createdAt).toBe("string");
  });

  it("apply converts the data and adds the constraints", async () => {
    const r = await runMigrations(db, { dryRun: false });
    expect(r.blockers).toEqual([]);
    expect(r.applied).toHaveLength(5);

    const issue = await db.collection("issues").findOne({ _id: ids.issueId });
    expect(issue!.createdAt).toBeInstanceOf(Date);
    expect(issue!.status).toBe("logged");
    expect(issue!.type).toBe("reactive");
    expect(issue!.assignedTo).toEqual([]);
    const statuses = (await db.collection("issues").find().toArray()).map((i) => i.status).sort();
    expect(statuses).toEqual(["closed", "logged", "technician_assigned"]);
    expect((await db.collection("issues").findOne({ title: "Door" }))!.scheduledDate).toBeUndefined();

    expect((await db.collection("users").findOne({ _id: "u-tenant" as never }))!.email).toBe("tenant@example.com");
    expect((await db.collection("invites").findOne({}))!.expiresAt).toBeInstanceOf(Date);
    expect((await db.collection("invites").findOne({}))!.inviteeEmail).toBe("new@example.com");
    expect((await db.collection("notifications").findOne({}))!.type).toBe("fault.reported");
    expect((await db.collection("notificationPreferences").findOne({}))!.eventType).toBe("fault.updated");
    expect(await db.collection("userRoles").countDocuments({ userId: "u-tenant" })).toBe(1);
    expect((await db.collection("roles").findOne({ name: "admin" }))!.permissions).toContain("issue:approve_cost");

    const idx = await db.collection("tenancies").listIndexes().toArray();
    expect(idx.find((i) => i.name === "one_active_tenancy_per_unit")?.unique).toBe(true);
    const grantIdx = await db.collection("userRoles").listIndexes().toArray();
    expect(grantIdx.find((i) => i.name === "unique_grant")?.unique).toBe(true);
    expect(r.log.join("\n")).toMatch(/workOrders: 1 document/);
  });

  it("is idempotent", async () => {
    const r = await runMigrations(db, { dryRun: false });
    expect(r.pending).toEqual([]);
    expect(r.blockers).toEqual([]);
  });
});

describe("blockers", () => {
  it("refuses to continue over two active tenancies on one unit", async () => {
    const d2 = client.db(`mig_${new ObjectId().toHexString()}`);
    const p = new ObjectId();
    await d2.collection("tenancies").insertMany([
      { tenantUserId: "a", propertyId: p, developmentId: new ObjectId(), status: "active", startDate: new Date(), createdAt: new Date() },
      { tenantUserId: "b", propertyId: p, developmentId: new ObjectId(), status: "active", startDate: new Date(), createdAt: new Date() },
    ]);
    const r = await runMigrations(d2, { dryRun: false });
    expect(r.blockers[0]).toMatch(/2 active tenancies/);
    const idx = await d2.collection("tenancies").listIndexes().toArray();
    expect(idx.some((i) => i.name === "one_active_tenancy_per_unit")).toBe(false);
    expect(await d2.collection("_migrations").countDocuments({ _id: "v2-004-duplicates" as never })).toBe(0);
    await d2.dropDatabase();
  });
});
