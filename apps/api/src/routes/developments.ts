import { Hono } from "hono";
import type { Document, ObjectId } from "mongodb";
import {
  createDevelopmentBody,
  isCurrencyCode,
  OPEN_STATUSES,
  PERMISSIONS,
  SYSTEM_ROLES,
  updateDevelopmentBody,
  type DashboardSummaryDto,
  type DevelopmentDto,
  type Permission,
} from "@easytenant/shared";
import { body, type AppEnv, type Deps } from "../context";
import type { DevelopmentDoc } from "../db/types";
import { notFound } from "../lib/errors";
import { loadDevelopment } from "../access/loaders";
import { SEARCH_INDEX } from "../db/indexes";
import { oid, isoRequired } from "../lib/ids";
import { escapeRegex, paginate, parseLimit } from "../lib/pagination";
import { audit } from "../lib/audit";
import { faultSummaries } from "./faults";


export function devDto(
  deps: Deps,
  d: DevelopmentDoc,
  myPermissions: Iterable<string>,
  stats?: DevelopmentDto["stats"]
): DevelopmentDto {
  return {
    id: String(d._id),
    name: d.name,
    address: d.address,
    overdueDays: d.overdueDays ?? null,
    currency: isCurrencyCode(d.currency) ? d.currency : null,
    effectiveOverdueDays: d.overdueDays ?? deps.config.faultOverdueDays,
    effectiveCurrency: isCurrencyCode(d.currency) ? d.currency : deps.config.defaultCurrency,
    createdAt: isoRequired(d.createdAt),
    myPermissions: [...myPermissions] as Permission[],
    ...(stats ? { stats } : {}),
  };
}

/** Unit / occupancy / open-fault counts for a set of developments, in four
 * grouped aggregations rather than one query per development. */
export async function occupancyStats(deps: Deps, devIds: ObjectId[]) {
  const { cols } = deps;
  const out = new Map<string, NonNullable<DevelopmentDto["stats"]>>();
  if (!devIds.length) return out;
  const match = { developmentId: { $in: devIds } };
  const [units, occupied, invited, open] = await Promise.all([
    cols.properties.aggregate<{ _id: ObjectId; n: number }>([{ $match: match }, { $group: { _id: "$developmentId", n: { $sum: 1 } } }]).toArray(),
    cols.tenancies
      .aggregate<{ _id: ObjectId; ids: ObjectId[] }>([
        { $match: { ...match, status: "active" } },
        { $group: { _id: "$developmentId", ids: { $addToSet: "$propertyId" } } },
      ])
      .toArray(),
    cols.invites
      .aggregate<{ _id: ObjectId; ids: ObjectId[] }>([
        { $match: { ...match, role: SYSTEM_ROLES.TENANT, status: "pending", expiresAt: { $gt: new Date() } } },
        { $group: { _id: "$developmentId", ids: { $addToSet: "$propertyId" } } },
      ])
      .toArray(),
    cols.issues
      .aggregate<{ _id: ObjectId; n: number }>([
        { $match: { ...match, status: { $in: [...OPEN_STATUSES] } } },
        { $group: { _id: "$developmentId", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const u = new Map(units.map((x) => [String(x._id), x.n]));
  const o = new Map(occupied.map((x) => [String(x._id), new Set(x.ids.map(String))]));
  const i = new Map(invited.map((x) => [String(x._id), new Set(x.ids.map(String))]));
  const f = new Map(open.map((x) => [String(x._id), x.n]));
  for (const id of devIds) {
    const key = String(id);
    const total = u.get(key) ?? 0;
    const occ = o.get(key) ?? new Set<string>();
    const inv = [...(i.get(key) ?? [])].filter((p) => !occ.has(p)).length;
    out.set(key, {
      units: total,
      occupied: occ.size,
      invited: inv,
      vacant: Math.max(0, total - occ.size - inv),
      openFaults: f.get(key) ?? 0,
    });
  }
  return out;
}

async function search(deps: Deps, q: string, scope: "all" | ObjectId[], limit: number) {
  const { cols } = deps;
  const restrict = scope === "all" ? [] : [{ $match: { _id: { $in: scope } } }];
  try {
    return await cols.developments
      .aggregate<DevelopmentDoc>([
        {
          $search: {
            index: SEARCH_INDEX,
            compound: {
              should: [
                { autocomplete: { query: q, path: "name" } },
                { autocomplete: { query: q, path: "address" } },
              ],
              minimumShouldMatch: 1,
            },
          },
        },
        ...restrict,
        { $limit: limit },
      ])
      .toArray();
  } catch {
    // No Atlas Search (local Mongo) or the index is still building.
    const rx = { $regex: escapeRegex(q), $options: "i" };
    const filter: Document = { $or: [{ name: rx }, { address: rx }] };
    if (scope !== "all") filter._id = { $in: scope };
    return cols.developments.find(filter).limit(limit).toArray();
  }
}

const developments = new Hono<AppEnv>();

developments.get("/", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  access.verified;
  const scope = await access.memberDevelopments();
  const limit = parseLimit(c.req.query("limit"));
  const q = c.req.query("q")?.trim();
  const withStats = c.req.query("stats") === "1";

  let items: DevelopmentDoc[];
  let nextCursor: string | null = null;
  if (q) {
    items = await search(deps, q, scope, limit);
  } else {
    const filter = scope === "all" ? {} : { _id: { $in: scope } };
    const page = await paginate(deps.cols.developments, filter, [
      { field: "name", dir: 1, type: "string" },
      { field: "_id", dir: 1, type: "objectId" },
    ], c.req.query("cursor"), limit);
    items = page.items;
    nextCursor = page.nextCursor;
  }
  const stats = withStats ? await occupancyStats(deps, items.map((d) => d._id)) : null;
  const dtos = await Promise.all(
    items.map(async (d) => devDto(deps, d, await access.permissionsIn(d._id), stats?.get(String(d._id))))
  );
  return c.json({ items: dtos, nextCursor });
});

/** Portfolio summary for the manager dashboard: every development where the
 * caller can see all faults. */
developments.get("/summary", async (c) => {
  const deps = c.var.deps;
  const { cols, config } = deps;
  const access = c.var.access;
  access.verified;
  const scope = await access.developmentsWith(PERMISSIONS.ISSUE_VIEW_ALL);
  const devs = await cols.developments.find(scope === "all" ? {} : { _id: { $in: scope } }).toArray();
  const devIds = devs.map((d) => d._id);
  const stats = await occupancyStats(deps, devIds);
  let units = 0;
  let occupied = 0;
  for (const s of stats.values()) {
    units += s.units;
    occupied += s.occupied;
  }

  const match = { developmentId: { $in: devIds } };
  const now = Date.now();
  const [byStatus, recent, overdue] = await Promise.all([
    cols.issues.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    cols.issues.find(match).sort({ createdAt: -1, _id: -1 }).limit(8).toArray(),
    Promise.all(
      devs.map((d) =>
        cols.issues.countDocuments({
          developmentId: d._id,
          status: { $in: [...OPEN_STATUSES] },
          createdAt: { $lte: new Date(now - (d.overdueDays ?? config.faultOverdueDays) * 86_400_000) },
        })
      )
    ),
  ]);
  const faultsByStatus = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const openFaults = byStatus.filter((s) => (OPEN_STATUSES as readonly string[]).includes(s._id)).reduce((a, s) => a + s.n, 0);

  const dto: DashboardSummaryDto = {
    developments: devs.length,
    units,
    occupied,
    occupancyPct: units ? Math.round((occupied / units) * 100) : 0,
    openFaults,
    overdueFaults: overdue.reduce((a, n) => a + n, 0),
    awaitingApproval: faultsByStatus["awaiting_cost_approval"] ?? 0,
    faultsByStatus,
    recentFaults: await faultSummaries(deps, recent),
  };
  return c.json(dto);
});

developments.post("/", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  await access.requirePlatform(PERMISSIONS.DEVELOPMENT_CREATE);
  const input = await body(c, createDevelopmentBody);
  const doc = {
    name: input.name,
    address: input.address,
    adminIds: [access.me.uid],
    propertyManagerIds: [],
    settings: {},
    createdAt: new Date(),
  };
  const res = await deps.cols.developments.insertOne(doc as never);
  const created = (await deps.cols.developments.findOne({ _id: res.insertedId }))!;
  await audit(deps.cols, { actorId: access.me.uid, action: "development.create", targetType: "development", targetId: String(res.insertedId), developmentId: res.insertedId, after: doc });
  return c.json(devDto(deps, created, await access.permissionsIn(created._id)), 201);
});

developments.get("/:id", async (c) => {
  const deps = c.var.deps;
  const dev = await loadDevelopment(deps, c.var.access, c.req.param("id"));
  const stats = await occupancyStats(deps, [dev._id]);
  return c.json(devDto(deps, dev, await c.var.access.permissionsIn(dev._id), stats.get(String(dev._id))));
});

developments.patch("/:id", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.DEVELOPMENT_MANAGE, dev._id);
  const input = await body(c, updateDevelopmentBody);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.address !== undefined) set.address = input.address;
  for (const k of ["overdueDays", "currency"] as const) {
    if (input[k] === null) unset[k] = "";
    else if (input[k] !== undefined) set[k] = input[k];
  }
  const updated = await deps.cols.developments.findOneAndUpdate(
    { _id: dev._id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: "after" }
  );
  await audit(deps.cols, { actorId: access.me.uid, action: "development.update", targetType: "development", targetId: String(dev._id), developmentId: dev._id, before: dev, after: input });
  return c.json(devDto(deps, updated!, await access.permissionsIn(dev._id)));
});

/** Technicians who can be assigned to faults in this development. */
developments.get("/:id/service-personnel", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.WORKORDER_ASSIGN, dev._id);
  const role = await deps.cols.roles.findOne({ developmentId: dev._id, name: SYSTEM_ROLES.SERVICE_PERSONNEL });
  if (!role) return c.json([]);
  const grants = await deps.cols.userRoles.find({ developmentId: dev._id, roleId: role._id }).toArray();
  const users = await deps.cols.users
    .find({ _id: { $in: grants.map((g) => g.userId) } }, { projection: { email: 1, name: 1 } })
    .sort({ name: 1, email: 1 })
    .toArray();
  return c.json(users.map((u) => ({ id: u._id, name: u.name ?? null, email: u.email })));
});

export default developments;
