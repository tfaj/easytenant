import { Hono } from "hono";
import type { Document } from "mongodb";
import { PERMISSIONS, ROLE_LABEL, roleGrantBody, SYSTEM_ROLES, type SystemRoleName, type UserAdminDto } from "@easytenant/shared";
import { body, type AppEnv, type Deps } from "../context";
import type { Access } from "../access/access";
import { badRequest, conflict, notFound } from "../lib/errors";
import { isoRequired, oid } from "../lib/ids";
import { escapeRegex, paginate, parseLimit } from "../lib/pagination";
import { grantRole, revokeRole } from "../lib/roles";
import { notify } from "../lib/notify";
import { audit } from "../lib/audit";

const users = new Hono<AppEnv>();

/** Platform admins only: everyone on the platform with their roles. */
users.get("/", async (c) => {
  const { cols } = c.var.deps;
  await c.var.access.requirePlatform(PERMISSIONS.ROLE_MANAGE);
  const filter: Document = {};
  const q = c.req.query("q")?.trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const page = await paginate(cols.users, filter, [
    { field: "email", dir: 1, type: "string" },
    { field: "_id", dir: 1, type: "string" },
  ], c.req.query("cursor"), parseLimit(c.req.query("limit")));
  const ids = page.items.map((u) => u._id);
  const grants = ids.length ? await cols.userRoles.find({ userId: { $in: ids } }).toArray() : [];
  const [roles, devs] = await Promise.all([
    cols.roles.find({ _id: { $in: grants.map((g) => g.roleId) } }).toArray(),
    cols.developments.find({ _id: { $in: grants.map((g) => g.developmentId).filter((x) => x !== null) } }, { projection: { name: 1 } }).toArray(),
  ]);
  const roleName = new Map(roles.map((r) => [String(r._id), r.name]));
  const devName = new Map(devs.map((d) => [String(d._id), d.name]));
  const items: UserAdminDto[] = page.items.map((u) => ({
    id: u._id,
    name: u.name ?? null,
    email: u.email,
    status: u.status ?? "active",
    createdAt: isoRequired(u.createdAt),
    roles: grants
      .filter((g) => g.userId === u._id)
      .map((g) => ({
        developmentId: g.developmentId ? String(g.developmentId) : null,
        developmentName: g.developmentId ? (devName.get(String(g.developmentId)) ?? null) : null,
        roleName: roleName.get(String(g.roleId)) ?? "unknown",
      })),
  }));
  return c.json({ items, nextCursor: page.nextCursor });
});

/** ROLE_MANAGE where the role applies: platform-wide for a platform role,
 * that development for a development role. */
async function authorise(deps: Deps, access: Access, developmentId: string | null) {
  const devId = developmentId ? oid(developmentId, "development id") : null;
  if (devId && !(await deps.cols.developments.findOne({ _id: devId }, { projection: { _id: 1 } }))) {
    throw notFound("Development");
  }
  await access.require(PERMISSIONS.ROLE_MANAGE, devId);
  return devId;
}

users.post("/:id/roles", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const input = await body(c, roleGrantBody);
  const devId = await authorise(deps, access, input.developmentId);
  const target = await deps.cols.users.findOne({ _id: c.req.param("id") });
  if (!target) throw notFound("User");
  if (devId === null && input.roleName !== SYSTEM_ROLES.ADMIN) throw badRequest("Only the admin role can be granted platform-wide.");
  await grantRole(deps.cols, { userId: target._id, developmentId: devId, roleName: input.roleName });
  await audit(deps.cols, { actorId: access.me.uid, action: "role.grant", targetType: "user", targetId: target._id, developmentId: devId, after: input });
  const label = ROLE_LABEL[input.roleName as SystemRoleName] ?? input.roleName;
  await notify(deps, {
    event: "account.role_granted",
    developmentId: devId,
    userIds: [target._id],
    exclude: access.me.uid,
    title: `You're now ${label.toLowerCase()}${devId ? "" : " (platform-wide)"}`,
    body: `${access.me.name || access.me.email} gave you the ${label.toLowerCase()} role. Sign in to see what's changed.`,
    link: "/",
  });
  return c.json({ ok: true }, 201);
});

users.delete("/:id/roles", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const input = await body(c, roleGrantBody);
  const devId = await authorise(deps, access, input.developmentId);
  const userId = c.req.param("id");
  if (devId === null && input.roleName === SYSTEM_ROLES.ADMIN) {
    if (userId === access.me.uid) throw conflict("You can't remove your own platform admin role.");
    const adminRole = await deps.cols.roles.findOne({ developmentId: null, name: SYSTEM_ROLES.ADMIN });
    const admins = adminRole ? await deps.cols.userRoles.countDocuments({ developmentId: null, roleId: adminRole._id }) : 0;
    if (admins <= 1) throw conflict("This is the last platform admin.");
  }
  const removed = await revokeRole(deps.cols, { userId, developmentId: devId, roleName: input.roleName });
  if (removed) {
    await audit(deps.cols, { actorId: access.me.uid, action: "role.revoke", targetType: "user", targetId: userId, developmentId: devId, before: input });
  }
  return c.json({ ok: true, removed });
});

export default users;
