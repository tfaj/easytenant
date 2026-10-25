import { Hono } from "hono";
import { updateProfileBody, type MeDto, type Permission } from "@easytenant/shared";
import { body, type AppEnv } from "../context";

const me = new Hono<AppEnv>();

/** Creates the profile on first sign-in and keeps email/name in sync with
 * Firebase. Safe to call on every app load. */
me.post("/sync", async (c) => {
  const { cols } = c.var.deps;
  const u = c.var.access.me;
  const now = new Date();
  await cols.users.updateOne(
    { _id: u.uid },
    {
      $set: { email: u.email, lastSeenAt: now },
      $setOnInsert: { _id: u.uid, status: "active", createdAt: now, ...(u.name ? { name: u.name } : {}) },
    },
    { upsert: true }
  );
  return c.json({ ok: true });
});

me.get("/", async (c) => {
  const { cols } = c.var.deps;
  const access = c.var.access;
  const u = access.me;
  const [profile, grants] = await Promise.all([cols.users.findOne({ _id: u.uid }), access.load()]);
  const devIds = grants.map((g) => g.developmentId).filter((x) => x !== null);
  const devs = devIds.length
    ? await cols.developments.find({ _id: { $in: devIds } }, { projection: { name: 1 } }).toArray()
    : [];
  const devName = new Map(devs.map((d) => [String(d._id), d.name]));
  const dto: MeDto = {
    id: u.uid,
    email: u.email,
    name: profile?.name ?? u.name ?? null,
    phone: profile?.phone ?? null,
    emailVerified: u.emailVerified,
    roles: grants.map((g) => ({
      developmentId: g.developmentId ? String(g.developmentId) : null,
      developmentName: g.developmentId ? (devName.get(String(g.developmentId)) ?? null) : null,
      roleName: g.roleName,
      permissions: g.permissions,
    })),
    platformPermissions: [...(await access.platformPermissions())] as Permission[],
  };
  return c.json(dto);
});

me.patch("/", async (c) => {
  const { cols } = c.var.deps;
  const u = c.var.access.me;
  const input = await body(c, updateProfileBody);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  for (const k of ["name", "phone"] as const) {
    if (k in input) {
      if (input[k]) set[k] = input[k];
      else unset[k] = "";
    }
  }
  await cols.users.updateOne({ _id: u.uid }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  return c.json({ ok: true });
});

export default me;
