import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObjectId } from "mongodb";
import { SYSTEM_ROLES } from "@easytenant/shared";
import { makeHarness, type Harness, type TestUser } from "./harness";

let h: Harness;
let dev: { id: ObjectId; unitIds: ObjectId[] };
let pm: TestUser, admin: TestUser, tech: TestUser, otherTech: TestUser;

beforeAll(async () => {
  h = await makeHarness();
  dev = await h.seedDevelopment("Palm Grove", ["1", "2", "3", "4"]);
  pm = await h.addUser({ uid: "pm", email: "pm@x.test", name: "Pat Manager" });
  admin = await h.addUser({ uid: "admin", email: "admin@x.test" });
  tech = await h.addUser({ uid: "tech", email: "tech@x.test" });
  otherTech = await h.addUser({ uid: "tech2", email: "tech2@x.test" });
  await h.grant(pm, SYSTEM_ROLES.PROPERTY_MANAGER, dev.id);
  await h.grant(admin, SYSTEM_ROLES.ADMIN, null);
  await h.grant(tech, SYSTEM_ROLES.SERVICE_PERSONNEL, dev.id);
  await h.grant(otherTech, SYSTEM_ROLES.SERVICE_PERSONNEL, dev.id);
  await h.cols.properties.updateOne({ _id: dev.unitIds[0] }, { $set: { ownerEmail: "owner@x.test", ownerName: "Olu Owner" } });
});
afterAll(() => h.close());

describe("invites", () => {
  let code: string;
  const invitee = { uid: "newt", email: "new.tenant@x.test" };

  it("a PM invites a tenant to a unit and the email carries the link", async () => {
    const r = await h.call(pm, "POST", "/api/invites", {
      developmentId: String(dev.id),
      role: "tenant",
      unitId: String(dev.unitIds[0]),
      inviteeEmail: "New.Tenant@x.test",
    });
    expect(r.status).toBe(201);
    code = r.body.url.split("/join/")[1];
    expect(h.emails.at(-1)!.to).toBe("new.tenant@x.test");
    expect(h.emails.at(-1)!.text).toContain(`/join/${code}`);
  });

  it("a PM can't invite another PM (needs ROLE_MANAGE)", async () => {
    const r = await h.call(pm, "POST", "/api/invites", { developmentId: String(dev.id), role: "property_manager", inviteeEmail: "x@x.test" });
    expect(r.status).toBe(403);
  });

  it("the public preview works without signing in", async () => {
    const r = await h.call(null, "GET", `/api/public/invites/${code}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ developmentName: "Palm Grove", unitLabel: "1", role: "tenant" });
  });

  it("an unverified account with the right email can't accept", async () => {
    const u = await h.addUser({ ...invitee, verified: false }, { profile: false });
    expect((await h.call(u, "POST", `/api/invites/${code}/accept`)).status).toBe(403);
  });

  it("someone with a different email can't accept", async () => {
    const u = await h.addUser({ uid: "thief", email: "thief@x.test" });
    expect((await h.call(u, "POST", `/api/invites/${code}/accept`)).status).toBe(403);
  });

  it("the invitee accepts once; a second accept is refused", async () => {
    const u = await h.addUser({ ...invitee, verified: true }, { profile: false });
    const r = await h.call(u, "POST", `/api/invites/${code}/accept`);
    expect(r.status).toBe(200);
    const me = await h.call(u, "GET", "/api/me");
    expect(me.body.roles.map((x: { roleName: string }) => x.roleName)).toEqual(["tenant"]);
    expect((await h.call(u, "GET", "/api/tenancies/mine")).body[0].unit.unitNumber).toBe("1");
    expect((await h.call(u, "POST", `/api/invites/${code}/accept`)).status).toBe(410);
  });

  it("two invites for one unit: only one tenant ends up on it", async () => {
    const mk = (email: string) =>
      h.call(pm, "POST", "/api/invites", { developmentId: String(dev.id), role: "tenant", unitId: String(dev.unitIds[1]), inviteeEmail: email });
    const a = await mk("a@x.test");
    const b = await mk("b@x.test");
    const ua = await h.addUser({ uid: "ua", email: "a@x.test" });
    const ub = await h.addUser({ uid: "ub", email: "b@x.test" });
    const results = await Promise.all([
      h.call(ua, "POST", `/api/invites/${a.body.url.split("/join/")[1]}/accept`),
      h.call(ub, "POST", `/api/invites/${b.body.url.split("/join/")[1]}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await h.cols.tenancies.countDocuments({ propertyId: dev.unitIds[1], status: "active" })).toBe(1);
  });

  it("ending the last tenancy removes the tenant role", async () => {
    const t = await h.cols.tenancies.findOne({ propertyId: dev.unitIds[1], status: "active" });
    expect((await h.call(pm, "POST", `/api/tenancies/${t!._id}/end`)).status).toBe(200);
    const roles = await h.call({ uid: t!.tenantUserId, email: "" }, "GET", "/api/me");
    expect(roles.status === 401 || roles.body.roles.length === 0).toBe(true);
    expect((await h.call(pm, "POST", `/api/tenancies/${t!._id}/end`)).status).toBe(409);
  });
});

describe("fault pipeline", () => {
  let id: string;
  const tenant = { uid: "newt", email: "new.tenant@x.test" };
  const go = (u: TestUser, action: string, extra: Record<string, unknown> = {}) =>
    h.call(u, "POST", `/api/faults/${id}/transition`, { action, ...extra });

  it("the tenant reports a fault; managers are notified", async () => {
    const r = await h.call(tenant, "POST", "/api/faults", {
      developmentId: String(dev.id),
      unitId: String(dev.unitIds[0]),
      title: "No hot water",
      category: "plumbing",
    });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body.availableActions).toEqual([]);
    expect(await h.cols.notifications.countDocuments({ userId: pm.uid, type: "fault.reported" })).toBe(1);
  });

  it("the PM classifies and assigns; non-technicians can't be assigned", async () => {
    expect((await go(pm, "assign", { assignedTo: [tech.uid] })).status).toBe(409);
    const c = await go(pm, "classify", { priority: "high" });
    expect(c.status).toBe(200);
    expect(c.body.priority).toBe("high");
    expect((await go(pm, "assign", { assignedTo: [pm.uid] })).status).toBe(400);
    const a = await go(pm, "assign", { assignedTo: [tech.uid] });
    expect(a.status).toBe(200);
    expect(a.body.assignees.map((x: { id: string }) => x.id)).toEqual([tech.uid]);
  });

  it("only the assigned technician (not a colleague) can work it", async () => {
    expect((await go(otherTech, "start_inspection")).status).toBe(404);
    const r = await go(tech, "start_inspection");
    expect(r.status).toBe(200);
    expect(r.body.availableActions).toEqual(["submit_quote"]);
    const q = await go(tech, "submit_quote", { vendorName: "FixIt Ltd", agreedCost: 45000 });
    expect(q.status).toBe(200);
  });

  it("a PM can't approve cost; the admin rejects with a reason, then approves", async () => {
    expect((await go(pm, "approve_cost")).status).toBe(403);
    expect((await go(admin, "reject_cost")).status).toBe(400);
    const rej = await go(admin, "reject_cost", { note: "Too high, get another quote" });
    expect(rej.body.status).toBe("inspection");
    expect(rej.body.agreedCost).toBeNull();
    await go(tech, "submit_quote", { vendorName: "Cheaper Co", agreedCost: 30000 });
    const ok = await go(admin, "approve_cost");
    expect(ok.body.status).toBe("repair_in_progress");
    expect(ok.body.costApprovedBy.id).toBe(admin.uid);
  });

  it("the resident confirms, the PM closes, the owner is emailed", async () => {
    await go(tech, "complete_repair");
    expect((await go(tech, "confirm_resolution")).status).toBe(403);
    expect((await go(tenant, "confirm_resolution")).status).toBe(200);
    expect((await go(pm, "close")).status).toBe(400);
    const closed = await go(pm, "close", { actualCost: 32000, invoiceRef: "INV-9" });
    expect(closed.body.status).toBe("closed");
    expect(closed.body.availableActions).toEqual([]);
    expect(h.emails.some((e) => e.to === "owner@x.test" && e.text.includes("32,000"))).toBe(true);
    expect(closed.body.activity.map((a: { statusChangeTo: string | null }) => a.statusChangeTo).filter(Boolean)).toEqual([
      "logged", "priority_classified", "technician_assigned", "inspection", "awaiting_cost_approval",
      "inspection", "awaiting_cost_approval", "repair_in_progress", "resident_confirmation", "cost_recording", "closed",
    ]);
    expect(await h.cols.auditLog.countDocuments({ targetId: id })).toBe(3);
  });

  it("concurrent identical transitions: exactly one wins", async () => {
    const r = await h.call(pm, "POST", "/api/faults", { developmentId: String(dev.id), unitId: String(dev.unitIds[2]), title: "Race" });
    id = r.body.id;
    const results = await Promise.all([go(pm, "classify", { priority: "low" }), go(admin, "classify", { priority: "urgent" })]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  it("the technician sees their jobs; the tenant sees faults on their unit", async () => {
    expect((await h.call(tech, "GET", "/api/faults?scope=assigned")).body.items).toHaveLength(1);
    const pmLogged = await h.call(pm, "POST", "/api/faults", { developmentId: String(dev.id), unitId: String(dev.unitIds[0]), title: "Logged by PM" });
    const mine = await h.call(tenant, "GET", "/api/faults?scope=mine");
    expect(mine.body.items.map((f: { id: string }) => f.id)).toContain(pmLogged.body.id);
  });
});

describe("daily job", () => {
  it("needs the secret", async () => {
    expect((await h.call(null, "POST", "/internal/jobs/daily")).status).toBe(403);
  });

  it("sends reminders and overdue notices once", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    await h.cols.issues.insertOne({
      reporterId: pm.uid, propertyId: dev.unitIds[3], developmentId: dev.id, title: "Old fault", description: "", category: "other",
      priority: "low", attachments: [], status: "logged", type: "reactive", assignedTo: [], createdAt: old, updatedAt: old,
    } as never);
    await h.cols.issues.insertOne({
      reporterId: pm.uid, propertyId: dev.unitIds[3], developmentId: dev.id, title: "Boiler service", description: "", category: "hvac",
      priority: "medium", attachments: [], status: "technician_assigned", type: "mandatory", assignedTo: [tech.uid],
      scheduledDate: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const res1 = await fetchJob();
    const res2 = await fetchJob();
    expect(res1.reminders).toBe(1);
    expect(res1.overdue).toBeGreaterThanOrEqual(1);
    expect(res2).toEqual({ reminders: 0, overdue: 0 });
    expect(await h.cols.notifications.countDocuments({ userId: tech.uid, type: "maintenance.reminder" })).toBe(1);
    expect(await h.cols.notifications.countDocuments({ userId: pm.uid, type: "fault.overdue" })).toBe(1);
  });
});

async function fetchJob() {
  const res = await h.app.request("/internal/jobs/daily", { method: "POST", headers: { "x-job-secret": "job-secret" } });
  return (await res.json()) as { reminders: number; overdue: number };
}
