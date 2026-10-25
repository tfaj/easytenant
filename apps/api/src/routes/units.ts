import { Hono } from "hono";
import { MongoServerError, type Document } from "mongodb";
import {
  bulkUnitsBody,
  PERMISSIONS,
  SYSTEM_ROLES,
  unitBody,
  updateUnitBody,
  type UnitDto,
} from "@easytenant/shared";
import { body, type AppEnv, type Deps } from "../context";
import type { Access } from "../access/access";
import type { PropertyDoc } from "../db/types";
import { conflict, forbidden, notFound } from "../lib/errors";
import { isoRequired, oid } from "../lib/ids";
import { escapeRegex, paginate, parseLimit } from "../lib/pagination";
import { userSummaries } from "../lib/people";
import { loadDevelopment } from "../access/loaders";

/** Permissions that let someone see the full unit list of a development. */
const UNIT_VIEWERS = [PERMISSIONS.DEVELOPMENT_MANAGE, PERMISSIONS.TENANT_INVITE, PERMISSIONS.ISSUE_VIEW_ALL] as const;

async function canViewUnits(access: Access, devId: PropertyDoc["developmentId"]) {
  const perms = await access.permissionsIn(devId);
  return UNIT_VIEWERS.some((p) => perms.has(p));
}

/** Units with their occupancy: active tenant, else a pending invite. */
export async function unitDtos(deps: Deps, units: PropertyDoc[]): Promise<UnitDto[]> {
  const { cols } = deps;
  if (!units.length) return [];
  const ids = units.map((u) => u._id);
  const [tenancies, invites] = await Promise.all([
    cols.tenancies.find({ propertyId: { $in: ids }, status: "active" }).toArray(),
    cols.invites
      .find({ propertyId: { $in: ids }, status: "pending", role: SYSTEM_ROLES.TENANT, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .toArray(),
  ]);
  const people = await userSummaries(cols, tenancies.map((t) => t.tenantUserId));
  const tenancyBy = new Map(tenancies.map((t) => [String(t.propertyId), t]));
  const inviteBy = new Map<string, (typeof invites)[number]>();
  for (const i of invites) if (!inviteBy.has(String(i.propertyId))) inviteBy.set(String(i.propertyId), i);

  return units.map((u) => {
    const t = tenancyBy.get(String(u._id));
    const inv = t ? undefined : inviteBy.get(String(u._id));
    const person = t ? people.get(t.tenantUserId) : undefined;
    return {
      id: String(u._id),
      developmentId: String(u.developmentId),
      unitNumber: u.unitNumber,
      type: u.type,
      ownerName: u.ownerName ?? null,
      ownerEmail: u.ownerEmail ?? null,
      occupancy: t ? "occupied" : inv ? "invited" : "vacant",
      tenant: t
        ? { id: t.tenantUserId, name: person?.name ?? null, email: person?.email ?? "unknown", tenancyId: String(t._id), since: isoRequired(t.startDate) }
        : null,
      pendingInvite: inv ? { id: String(inv._id), email: inv.inviteeEmail ?? "", expiresAt: isoRequired(inv.expiresAt) } : null,
      createdAt: isoRequired(u.createdAt),
    };
  });
}

function duplicateUnit(err: unknown) {
  return err instanceof MongoServerError && err.code === 11000;
}

const units = new Hono<AppEnv>();

units.get("/developments/:id/units", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  if (!(await canViewUnits(access, dev._id))) throw forbidden();
  const filter: Document = { developmentId: dev._id };
  const q = c.req.query("q")?.trim();
  if (q) filter.unitNumber = { $regex: escapeRegex(q), $options: "i" };
  const page = await paginate(deps.cols.properties, filter, [
    { field: "unitNumber", dir: 1, type: "string" },
    { field: "_id", dir: 1, type: "objectId" },
  ], c.req.query("cursor"), parseLimit(c.req.query("limit"), 50));
  return c.json({ items: await unitDtos(deps, page.items), nextCursor: page.nextCursor });
});

units.post("/developments/:id/units", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.DEVELOPMENT_MANAGE, dev._id);
  const input = await body(c, unitBody);
  const doc = {
    developmentId: dev._id,
    unitNumber: input.unitNumber,
    type: input.type || "unit",
    metadata: {},
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
    createdAt: new Date(),
  };
  try {
    const res = await deps.cols.properties.insertOne(doc as never);
    const [dto] = await unitDtos(deps, [{ ...doc, _id: res.insertedId } as PropertyDoc]);
    return c.json(dto, 201);
  } catch (err) {
    if (duplicateUnit(err)) throw conflict(`Unit ${input.unitNumber} already exists in this development.`);
    throw err;
  }
});

/** CSV import. Rows whose unit number already exists are skipped and
 * reported, not treated as an error. */
units.post("/developments/:id/units/bulk", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.DEVELOPMENT_MANAGE, dev._id);
  const input = await body(c, bulkUnitsBody);
  const existing = new Set(
    (await deps.cols.properties.find({ developmentId: dev._id }, { projection: { unitNumber: 1 } }).toArray()).map((p) => p.unitNumber)
  );
  const seen = new Set<string>();
  const skipped: string[] = [];
  const invalid: string[] = [];
  const now = new Date();
  const docs = [];
  for (const row of input.units) {
    const unitNumber = row.unitNumber.trim();
    if (!unitNumber) continue;
    if (existing.has(unitNumber) || seen.has(unitNumber)) {
      skipped.push(unitNumber);
      continue;
    }
    const ownerEmail = row.ownerEmail?.trim().toLowerCase();
    if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      invalid.push(unitNumber);
      continue;
    }
    seen.add(unitNumber);
    docs.push({
      developmentId: dev._id,
      unitNumber,
      type: row.type?.trim() || "unit",
      metadata: {},
      ...(row.ownerName?.trim() ? { ownerName: row.ownerName.trim() } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
      createdAt: now,
    });
  }
  let inserted = 0;
  if (docs.length) {
    try {
      inserted = (await deps.cols.properties.insertMany(docs as never[], { ordered: false })).insertedCount;
    } catch (err) {
      // A concurrent insert of the same unit number; count what landed.
      if (!duplicateUnit(err)) throw err;
      inserted = (err as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0;
    }
  }
  return c.json({ inserted, skipped, invalid }, 201);
});

async function loadUnit(deps: Deps, access: Access, id: string | undefined) {
  access.verified;
  const unit = await deps.cols.properties.findOne({ _id: oid(id, "unit id") });
  if (!unit) throw notFound("Unit");
  return unit;
}

units.get("/units/:id", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const unit = await loadUnit(deps, access, c.req.param("id"));
  const isResident = Boolean(
    await deps.cols.tenancies.findOne({ propertyId: unit._id, tenantUserId: access.me.uid, status: "active" })
  );
  if (!isResident && !(await canViewUnits(access, unit.developmentId))) throw notFound("Unit");
  const [dto] = await unitDtos(deps, [unit]);
  return c.json(dto);
});

units.patch("/units/:id", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const unit = await loadUnit(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.DEVELOPMENT_MANAGE, unit.developmentId);
  const input = await body(c, updateUnitBody);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  if (input.unitNumber) set.unitNumber = input.unitNumber;
  if (input.type) set.type = input.type;
  for (const k of ["ownerName", "ownerEmail"] as const) {
    if (input[k] === null || input[k] === "") unset[k] = "";
    else if (input[k] !== undefined) set[k] = input[k];
  }
  try {
    const updated = await deps.cols.properties.findOneAndUpdate(
      { _id: unit._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: "after" }
    );
    const [dto] = await unitDtos(deps, [updated!]);
    return c.json(dto);
  } catch (err) {
    if (duplicateUnit(err)) throw conflict(`Unit ${input.unitNumber} already exists in this development.`);
    throw err;
  }
});

export default units;
