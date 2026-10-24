import { Hono } from "hono";
import { MongoServerError, type Document, type ObjectId } from "mongodb";
import { assignTenancyBody, PERMISSIONS, SYSTEM_ROLES, type TenancyDto } from "@easytenant/shared";
import { body, type AppEnv, type Deps } from "../context";
import type { TenancyDoc } from "../db/types";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { iso, isoRequired, oid } from "../lib/ids";
import { decodeCursor, encodeCursor, escapeRegex, parseLimit, seekFilter, type SortSpec } from "../lib/pagination";
import { grantRole, revokeRole } from "../lib/roles";
import { audit } from "../lib/audit";
import { loadDevelopment } from "../access/loaders";

export const ACTIVE_TENANCY_TAKEN = "This unit already has an active tenant.";

export function isDuplicateKey(err: unknown) {
  return err instanceof MongoServerError && err.code === 11000;
}

const tenancies = new Hono<AppEnv>();

/** The caller's own active tenancies (tenant dashboard, report-a-fault). */
tenancies.get("/tenancies/mine", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  const list = await cols.tenancies.find({ tenantUserId: me.uid, status: "active" }).toArray();
  const [units, devs] = await Promise.all([
    cols.properties.find({ _id: { $in: list.map((t) => t.propertyId) } }).toArray(),
    cols.developments.find({ _id: { $in: list.map((t) => t.developmentId) } }).toArray(),
  ]);
  const u = new Map(units.map((x) => [String(x._id), x]));
  const d = new Map(devs.map((x) => [String(x._id), x]));
  const out: TenancyDto[] = list.map((t) => ({
    id: String(t._id),
    status: "active",
    startDate: isoRequired(t.startDate),
    endDate: null,
    tenant: { id: me.uid, name: me.name ?? null, email: me.email },
    unit: { id: String(t.propertyId), unitNumber: u.get(String(t.propertyId))?.unitNumber ?? "?" },
    development: { id: String(t.developmentId), name: d.get(String(t.developmentId))?.name ?? "?" },
  }));
  return c.json(out);
});

/** Tenant directory across the developments the caller manages. */
tenancies.get("/tenants", async (c) => {
  const { cols } = c.var.deps;
  const access = c.var.access;
  access.verified;
  let scope = await access.developmentsWith(PERMISSIONS.TENANT_INVITE);
  const devParam = c.req.query("developmentId");
  if (devParam) {
    const devId = oid(devParam, "development id");
    if (scope !== "all" && !scope.some((x) => x.equals(devId))) throw forbidden();
    scope = [devId];
  }
  if (scope !== "all" && scope.length === 0) return c.json({ items: [], nextCursor: null });

  const specs: SortSpec[] = [
    { field: "sortName", dir: 1, type: "string" },
    { field: "_id", dir: 1, type: "objectId" },
  ];
  const limit = parseLimit(c.req.query("limit"));
  const status = c.req.query("status") === "ended" ? "ended" : "active";
  const pipeline: Document[] = [
    { $match: { status, ...(scope === "all" ? {} : { developmentId: { $in: scope } }) } },
    { $lookup: { from: "users", localField: "tenantUserId", foreignField: "_id", as: "tenant" } },
    { $unwind: { path: "$tenant", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "properties", localField: "propertyId", foreignField: "_id", as: "unit" } },
    { $unwind: { path: "$unit", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "developments", localField: "developmentId", foreignField: "_id", as: "dev", pipeline: [{ $project: { name: 1 } }] } },
    { $unwind: { path: "$dev", preserveNullAndEmptyArrays: true } },
    { $addFields: { sortName: { $toLower: { $ifNull: ["$tenant.name", { $ifNull: ["$tenant.email", ""] }] } } } },
  ];
  const q = c.req.query("q")?.trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    pipeline.push({ $match: { $or: [{ "tenant.name": rx }, { "tenant.email": rx }, { "unit.unitNumber": rx }] } });
  }
  const cursor = decodeCursor(c.req.query("cursor"), specs);
  if (cursor) pipeline.push({ $match: seekFilter(specs, cursor) });
  pipeline.push({ $sort: { sortName: 1, _id: 1 } }, { $limit: limit + 1 });

  const rows = await cols.tenancies.aggregate<TenancyDoc & { tenant?: { _id: string; name?: string; email: string }; unit?: { _id: ObjectId; unitNumber: string }; dev?: { _id: ObjectId; name: string }; sortName: string }>(pipeline).toArray();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: TenancyDto[] = page.map((r) => ({
    id: String(r._id),
    status: r.status === "ended" ? "ended" : "active",
    startDate: isoRequired(r.startDate),
    endDate: iso(r.endDate),
    tenant: { id: r.tenantUserId, name: r.tenant?.name ?? null, email: r.tenant?.email ?? "unknown" },
    unit: { id: String(r.propertyId), unitNumber: r.unit?.unitNumber ?? "?" },
    development: { id: String(r.developmentId), name: r.dev?.name ?? "?" },
  }));
  const last = page[page.length - 1];
  return c.json({ items, nextCursor: hasMore && last ? encodeCursor(last, specs) : null });
});

/** Direct assignment of an existing user to a unit (the invite flow is the
 * usual path; this covers someone who already has an account). */
tenancies.post("/developments/:id/tenancies", async (c) => {
  const deps = c.var.deps;
  const { cols, client } = deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.TENANT_INVITE, dev._id);
  const input = await body(c, assignTenancyBody);
  const unit = await cols.properties.findOne({ _id: oid(input.unitId), developmentId: dev._id });
  if (!unit) throw badRequest("That unit isn't in this development.");
  const tenant = await cols.users.findOne({ _id: input.tenantUserId });
  if (!tenant) throw badRequest("That person hasn't signed up yet. Send them an invite instead.");

  const session = client.startSession();
  let tenancyId: ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const res = await cols.tenancies.insertOne(
        { tenantUserId: tenant._id, propertyId: unit._id, developmentId: dev._id, startDate: now, status: "active", createdAt: now } as never,
        { session }
      );
      tenancyId = res.insertedId;
      await grantRole(cols, { userId: tenant._id, developmentId: dev._id, roleName: SYSTEM_ROLES.TENANT }, session);
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict(ACTIVE_TENANCY_TAKEN);
    throw err;
  } finally {
    await session.endSession();
  }
  await audit(cols, { actorId: access.me.uid, action: "tenancy.create", targetType: "tenancy", targetId: String(tenancyId), developmentId: dev._id, after: { unitId: input.unitId, tenantUserId: tenant._id } });
  return c.json({ id: String(tenancyId) }, 201);
});

/** Move-out. Revokes the Tenant role if this was their last active
 * tenancy in the development. */
tenancies.post("/tenancies/:id/end", async (c) => {
  const deps = c.var.deps;
  const { cols, client } = deps;
  const access = c.var.access;
  access.verified;
  const tenancy = await cols.tenancies.findOne({ _id: oid(c.req.param("id"), "tenancy id") });
  if (!tenancy) throw notFound("Tenancy");
  await access.require(PERMISSIONS.TENANT_REMOVE, tenancy.developmentId);

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const res = await cols.tenancies.updateOne(
        { _id: tenancy._id, status: "active" },
        { $set: { status: "ended", endDate: new Date() } },
        { session }
      );
      if (res.modifiedCount === 0) throw conflict("This tenancy has already ended.");
      const remaining = await cols.tenancies.countDocuments(
        { tenantUserId: tenancy.tenantUserId, developmentId: tenancy.developmentId, status: "active" },
        { session }
      );
      if (remaining === 0) {
        await revokeRole(cols, { userId: tenancy.tenantUserId, developmentId: tenancy.developmentId, roleName: SYSTEM_ROLES.TENANT }, session);
      }
    });
  } finally {
    await session.endSession();
  }
  await audit(cols, { actorId: access.me.uid, action: "tenancy.end", targetType: "tenancy", targetId: String(tenancy._id), developmentId: tenancy.developmentId });
  return c.json({ ok: true });
});

export default tenancies;
