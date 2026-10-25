import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObjectId } from "mongodb";
import { SYSTEM_ROLES } from "@easytenant/shared";
import { makeHarness, type Harness, type TestUser } from "./harness";

/**
 * Regression tests for the v1 authorization holes. Each one describes an
 * attack that worked against v1 and must fail now.
 */
let h: Harness;
let devA: { id: ObjectId; unitIds: ObjectId[] };
let devB: { id: ObjectId; unitIds: ObjectId[] };
let pmA: TestUser, pmB: TestUser, tenantB: TestUser, stranger: TestUser, admin: TestUser;
let faultB: string;

beforeAll(async () => {
  h = await makeHarness();
  devA = await h.seedDevelopment("Alpha");
  devB = await h.seedDevelopment("Bravo");
  pmA = await h.addUser({ uid: "pmA", email: "pma@x.test" });
  pmB = await h.addUser({ uid: "pmB", email: "pmb@x.test" });
  tenantB = await h.addUser({ uid: "tenB", email: "tenb@x.test" });
  stranger = await h.addUser({ uid: "str", email: "str@x.test" });
  admin = await h.addUser({ uid: "adm", email: "adm@x.test" });
  await h.grant(pmA, SYSTEM_ROLES.PROPERTY_MANAGER, devA.id);
  await h.grant(pmB, SYSTEM_ROLES.PROPERTY_MANAGER, devB.id);
  await h.grant(admin, SYSTEM_ROLES.ADMIN, null);
  await h.makeTenant(tenantB, devB.id, devB.unitIds[0]!);
  const r = await h.call(tenantB, "POST", "/api/faults", {
    developmentId: String(devB.id),
    unitId: String(devB.unitIds[0]),
    title: "Leaking tap",
    description: "Kitchen tap drips",
  });
  expect(r.status).toBe(201);
  faultB = r.body.id;
});
afterAll(() => h.close());

describe("reads need auth and scope", () => {
  it("an anonymous caller can't read a fault (v1 returned it with photo URLs)", async () => {
    expect((await h.call(null, "GET", `/api/faults/${faultB}`)).status).toBe(401);
  });

  it("a manager of another development gets 404, not the fault", async () => {
    expect((await h.call(pmA, "GET", `/api/faults/${faultB}`)).status).toBe(404);
  });

  it("anonymous unit and tenancy listings are refused", async () => {
    expect((await h.call(null, "GET", `/api/developments/${devB.id}/units`)).status).toBe(401);
    expect((await h.call(null, "GET", `/api/tenants`)).status).toBe(401);
  });

  it("a tenant can't list every unit in their development", async () => {
    expect((await h.call(tenantB, "GET", `/api/developments/${devB.id}/units`)).status).toBe(403);
  });

  it("a manager can't list another development's units or tenants", async () => {
    expect((await h.call(pmA, "GET", `/api/developments/${devB.id}/units`)).status).toBe(403);
    expect((await h.call(pmA, "GET", `/api/tenants?developmentId=${devB.id}`)).status).toBe(403);
  });

  it("a manager's fault list never includes other developments", async () => {
    const r = await h.call(pmA, "GET", "/api/faults?scope=all");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(0);
  });
});

describe("writes are checked against the record, not the request body", () => {
  it("manager A can't cancel a fault in B by sending A's development id", async () => {
    const r = await h.call(pmA, "POST", `/api/faults/${faultB}/transition`, {
      action: "cancel",
      note: "nope",
      developmentId: String(devA.id),
    });
    expect(r.status).toBe(404);
    expect((await h.cols.issues.findOne({}))!.status).toBe("logged");
  });

  it("manager A can't end a tenancy in B", async () => {
    const t = await h.cols.tenancies.findOne({ developmentId: devB.id });
    const r = await h.call(pmA, "POST", `/api/tenancies/${t!._id}/end?developmentId=${devA.id}`, { developmentId: String(devA.id) });
    expect(r.status).toBe(403);
  });

  it("manager A can't edit a unit in B", async () => {
    const r = await h.call(pmA, "PATCH", `/api/units/${devB.unitIds[1]}`, { unitNumber: "HACKED", developmentId: String(devA.id) });
    expect(r.status).toBe(403);
  });

  it("a tenant can only report faults for their own unit", async () => {
    const r = await h.call(tenantB, "POST", "/api/faults", {
      developmentId: String(devB.id),
      unitId: String(devB.unitIds[1]),
      title: "Neighbour's door",
    });
    expect(r.status).toBe(403);
  });

  it("a unit from another development can't be smuggled into a fault", async () => {
    const r = await h.call(pmB, "POST", "/api/faults", {
      developmentId: String(devB.id),
      unitId: String(devA.unitIds[0]),
      title: "Wrong estate",
    });
    expect(r.status).toBe(400);
  });

  it("a tenant can't relabel a report as planned maintenance", async () => {
    const r = await h.call(tenantB, "POST", "/api/faults", {
      developmentId: String(devB.id),
      unitId: String(devB.unitIds[0]),
      title: "x",
      type: "mandatory",
    });
    expect(r.status).toBe(403);
  });

  it("attachments must be the caller's own uploads for that development", async () => {
    const r = await h.call(tenantB, "POST", "/api/faults", {
      developmentId: String(devB.id),
      unitId: String(devB.unitIds[0]),
      title: "Photo",
      attachments: [{ type: "image", key: `dev/${devB.id}/u/someone-else/x.jpg` }],
    });
    expect(r.status).toBe(400);
  });

  it("an outsider can't presign uploads into a development", async () => {
    const r = await h.call(stranger, "POST", "/api/uploads/presign", {
      developmentId: String(devB.id),
      filename: "a.jpg",
      contentType: "image/jpeg",
      size: 1000,
    });
    expect(r.status).toBe(403);
  });

  it("uploads are limited to images/videos and a size cap", async () => {
    const base = { developmentId: String(devB.id), filename: "a.exe" };
    expect((await h.call(tenantB, "POST", "/api/uploads/presign", { ...base, contentType: "application/x-msdownload", size: 10 })).status).toBe(400);
    expect((await h.call(tenantB, "POST", "/api/uploads/presign", { ...base, contentType: "image/png", size: 500 * 1024 * 1024 })).status).toBe(400);
    const ok = await h.call(tenantB, "POST", "/api/uploads/presign", { ...base, filename: "a.png", contentType: "image/png", size: 2048 });
    expect(ok.status).toBe(200);
    expect(ok.body.key.startsWith(`dev/${devB.id}/u/${tenantB.uid}/`)).toBe(true);
  });
});

describe("roles", () => {
  it("a development-scoped admin can't grant platform admin (v1 escalation)", async () => {
    const devAdmin = await h.addUser({ uid: "devadm", email: "devadm@x.test" });
    await h.grant(devAdmin, SYSTEM_ROLES.ADMIN, devA.id);
    const r = await h.call(devAdmin, "POST", `/api/users/${devAdmin.uid}/roles`, { developmentId: null, roleName: "admin" });
    expect(r.status).toBe(403);
  });

  it("platform admin can grant and revoke, but not remove the last admin", async () => {
    expect((await h.call(admin, "POST", `/api/users/${pmA.uid}/roles`, { developmentId: String(devB.id), roleName: "property_manager" })).status).toBe(201);
    expect((await h.call(pmA, "GET", `/api/faults/${faultB}`)).status).toBe(200);
    expect((await h.call(admin, "DELETE", `/api/users/${pmA.uid}/roles`, { developmentId: String(devB.id), roleName: "property_manager" })).status).toBe(200);
    expect((await h.call(pmA, "GET", `/api/faults/${faultB}`)).status).toBe(404);
    expect((await h.call(admin, "DELETE", `/api/users/${admin.uid}/roles`, { developmentId: null, roleName: "admin" })).status).toBe(409);
  });

  it("only platform admins can list all users", async () => {
    expect((await h.call(pmA, "GET", "/api/users")).status).toBe(403);
    const r = await h.call(admin, "GET", "/api/users");
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(3);
  });
});

describe("unverified email", () => {
  it("can load /me but can't touch data", async () => {
    const u = await h.addUser({ uid: "unv", email: "unv@x.test", verified: false });
    await h.grant(u, SYSTEM_ROLES.PROPERTY_MANAGER, devB.id);
    expect((await h.call(u, "GET", "/api/me")).status).toBe(200);
    expect((await h.call(u, "GET", `/api/faults/${faultB}`)).status).toBe(403);
  });

  it("malformed ids are a 400, not a 500", async () => {
    expect((await h.call(admin, "GET", "/api/faults/not-an-id")).status).toBe(400);
  });
});
