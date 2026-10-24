import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import {
  createInviteBody,
  MANAGEMENT_ROLES,
  PERMISSIONS,
  ROLE_LABEL,
  SYSTEM_ROLES,
  type InviteDto,
  type InvitePreviewDto,
  type SystemRoleName,
} from "@easytenant/shared";
import { body, type AppEnv, type Ctx, type Deps } from "../context";
import type { InviteDoc } from "../db/types";
import { AppError, badRequest, conflict, forbidden, gone, notFound } from "../lib/errors";
import { isoRequired, oid } from "../lib/ids";
import { paginate, parseLimit, RECENT_FIRST } from "../lib/pagination";
import { userSummaries } from "../lib/people";
import { grantRole } from "../lib/roles";
import { renderEmail } from "../lib/mailer";
import { audit } from "../lib/audit";
import { loadDevelopment } from "../access/loaders";
import { ACTIVE_TENANCY_TAKEN, isDuplicateKey } from "./tenancies";

/** 9 random bytes → 12 URL-safe characters (72 bits). */
const newCode = () => randomBytes(9).toString("base64url");

function permissionToInvite(role: string) {
  return (MANAGEMENT_ROLES as readonly string[]).includes(role) ? PERMISSIONS.ROLE_MANAGE : PERMISSIONS.TENANT_INVITE;
}

function effectiveStatus(i: InviteDoc): InviteDto["status"] {
  if (i.status === "pending" && i.expiresAt.getTime() < Date.now()) return "expired";
  return i.status;
}

async function inviteDtos(deps: Deps, list: InviteDoc[]): Promise<InviteDto[]> {
  const { cols } = deps;
  const [people, units] = await Promise.all([
    userSummaries(cols, list.map((i) => i.createdBy)),
    cols.properties.find({ _id: { $in: list.map((i) => i.propertyId).filter((x): x is ObjectId => Boolean(x)) } }, { projection: { unitNumber: 1 } }).toArray(),
  ]);
  const unitBy = new Map(units.map((u) => [String(u._id), u.unitNumber]));
  return list.map((i) => ({
    id: String(i._id),
    developmentId: String(i.developmentId),
    role: i.role as SystemRoleName,
    unit: i.propertyId ? { id: String(i.propertyId), unitNumber: unitBy.get(String(i.propertyId)) ?? "?" } : null,
    inviteeEmail: i.inviteeEmail ?? "",
    inviteeName: i.inviteeName ?? null,
    status: effectiveStatus(i),
    expiresAt: isoRequired(i.expiresAt),
    createdAt: isoRequired(i.createdAt),
    createdBy: people.get(i.createdBy) ?? null,
  }));
}

async function sendInviteEmail(deps: Deps, invite: InviteDoc, developmentName: string, unitLabel: string | null) {
  const url = `${deps.config.publicWebUrl}/join/${invite.code}`;
  const roleLabel = ROLE_LABEL[invite.role as SystemRoleName] ?? invite.role;
  const where = unitLabel ? `${developmentName}, unit ${unitLabel}` : developmentName;
  const { text, html } = renderEmail({
    heading: `You're invited to ${developmentName}`,
    paragraphs: [
      `Hi ${invite.inviteeName || "there"},`,
      `You've been invited to join ${where} on EasyTenant as ${roleLabel.toLowerCase()}.`,
      `Sign up or sign in with ${invite.inviteeEmail} to accept. The link expires on ${invite.expiresAt.toDateString()}.`,
    ],
    action: { label: "Accept invite", url },
    footer: "If you weren't expecting this, you can ignore this email.",
  });
  await deps.mailer.send({ to: invite.inviteeEmail!, subject: `Invitation to ${developmentName} on EasyTenant`, text, html });
  return url;
}

const invites = new Hono<AppEnv>();

invites.post("/invites", async (c) => {
  const deps = c.var.deps;
  const { cols } = deps;
  const access = c.var.access;
  const input = await body(c, createInviteBody);
  const dev = await loadDevelopment(deps, access, input.developmentId);
  await access.require(permissionToInvite(input.role), dev._id);

  let unit = null;
  if (input.role === SYSTEM_ROLES.TENANT) {
    unit = await cols.properties.findOne({ _id: oid(input.unitId), developmentId: dev._id });
    if (!unit) throw badRequest("That unit isn't in this development.");
    if (await cols.tenancies.findOne({ propertyId: unit._id, status: "active" })) throw conflict(ACTIVE_TENANCY_TAKEN);
  }

  const now = new Date();
  const doc = {
    code: newCode(),
    developmentId: dev._id,
    propertyId: unit?._id ?? null,
    role: input.role,
    status: "pending" as const,
    createdBy: access.me.uid,
    expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
    inviteeEmail: input.inviteeEmail,
    ...(input.inviteeName ? { inviteeName: input.inviteeName } : {}),
    createdAt: now,
  };
  const res = await cols.invites.insertOne(doc as never);
  const saved = { ...doc, _id: res.insertedId } as InviteDoc;
  const url = await sendInviteEmail(deps, saved, dev.name, unit?.unitNumber ?? null);
  const [dto] = await inviteDtos(deps, [saved]);
  return c.json({ ...dto, url }, 201);
});

invites.get("/developments/:id/invites", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const dev = await loadDevelopment(deps, access, c.req.param("id"));
  await access.require(PERMISSIONS.TENANT_INVITE, dev._id);
  const filter: Record<string, unknown> = { developmentId: dev._id };
  if (c.req.query("status") === "pending") {
    filter.status = "pending";
    filter.expiresAt = { $gt: new Date() };
  }
  const page = await paginate(deps.cols.invites, filter, RECENT_FIRST, c.req.query("cursor"), parseLimit(c.req.query("limit")));
  return c.json({ items: await inviteDtos(deps, page.items), nextCursor: page.nextCursor });
});

async function loadManagedInvite(c: Ctx) {
  const { cols } = c.var.deps;
  const access = c.var.access;
  access.verified;
  const invite = await cols.invites.findOne({ _id: oid(c.req.param("id"), "invite id") });
  if (!invite) throw notFound("Invite");
  await access.require(permissionToInvite(invite.role), invite.developmentId);
  return invite;
}

invites.post("/invites/:id/revoke", async (c) => {
  const { cols } = c.var.deps;
  const invite = await loadManagedInvite(c);
  const res = await cols.invites.updateOne({ _id: invite._id, status: "pending" }, { $set: { status: "revoked" } });
  if (!res.modifiedCount) throw conflict("Only a pending invite can be revoked.");
  await audit(cols, { actorId: c.var.access.me.uid, action: "invite.revoke", targetType: "invite", targetId: String(invite._id), developmentId: invite.developmentId });
  return c.json({ ok: true });
});

/** Re-sends the email and pushes the expiry out by 14 days. */
invites.post("/invites/:id/resend", async (c) => {
  const deps = c.var.deps;
  const invite = await loadManagedInvite(c);
  if (invite.status !== "pending") throw conflict("Only a pending invite can be re-sent.");
  const expiresAt = new Date(Date.now() + 14 * 86_400_000);
  await deps.cols.invites.updateOne({ _id: invite._id }, { $set: { expiresAt } });
  const [dev, unit] = await Promise.all([
    deps.cols.developments.findOne({ _id: invite.developmentId }),
    invite.propertyId ? deps.cols.properties.findOne({ _id: invite.propertyId }) : null,
  ]);
  if (!invite.inviteeEmail) throw badRequest("This invite has no email address.");
  const url = await sendInviteEmail(deps, { ...invite, expiresAt }, dev?.name ?? "your development", unit?.unitNumber ?? null);
  return c.json({ ok: true, url });
});

async function findUsableInvite(deps: Deps, code: string) {
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) throw notFound("Invite");
  const invite = await deps.cols.invites.findOne({ code });
  if (!invite) throw notFound("Invite");
  if (invite.status !== "pending") throw gone("This invite has already been used or was cancelled.");
  if (invite.expiresAt.getTime() < Date.now()) throw gone("This invite has expired. Ask for a new one.");
  return invite;
}

/** Public: what the /join/:code page shows before sign-in. */
invites.get("/public/invites/:code", async (c) => {
  const deps = c.var.deps;
  const invite = await findUsableInvite(deps, c.req.param("code"));
  const [dev, unit] = await Promise.all([
    deps.cols.developments.findOne({ _id: invite.developmentId }, { projection: { name: 1 } }),
    invite.propertyId ? deps.cols.properties.findOne({ _id: invite.propertyId }, { projection: { unitNumber: 1 } }) : null,
  ]);
  const dto: InvitePreviewDto = {
    developmentName: dev?.name ?? "Unknown development",
    unitLabel: unit?.unitNumber ?? null,
    role: invite.role as SystemRoleName,
    inviteeEmail: invite.inviteeEmail ?? "",
    expiresAt: isoRequired(invite.expiresAt),
  };
  return c.json(dto);
});

/**
 * Accepts an invite. Requires a verified email matching the invite. The
 * invite is claimed and the role/tenancy created in one transaction, so a
 * double click or two people racing for one link can't both succeed, and
 * the unique active-tenancy index stops two tenants landing on one unit.
 */
invites.post("/invites/:code/accept", async (c) => {
  const deps = c.var.deps;
  const { cols, client } = deps;
  const me = c.var.access.verified;
  const invite = await findUsableInvite(deps, c.req.param("code"));
  if (!invite.inviteeEmail || invite.inviteeEmail !== me.email) {
    throw forbidden(`This invite was sent to ${invite.inviteeEmail ?? "someone else"}. Sign in with that address to accept it.`);
  }
  await cols.users.updateOne(
    { _id: me.uid },
    { $setOnInsert: { _id: me.uid, email: me.email, status: "active", createdAt: new Date(), ...(invite.inviteeName ? { name: invite.inviteeName } : {}) } },
    { upsert: true }
  );

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const claimed = await cols.invites.updateOne(
        { _id: invite._id, status: "pending" },
        { $set: { status: "used", usedBy: me.uid, usedAt: new Date() } },
        { session }
      );
      if (!claimed.modifiedCount) throw gone("This invite has already been used.");
      await grantRole(cols, { userId: me.uid, developmentId: invite.developmentId, roleName: invite.role }, session);
      if (invite.role === SYSTEM_ROLES.TENANT && invite.propertyId) {
        const now = new Date();
        await cols.tenancies.insertOne(
          { tenantUserId: me.uid, propertyId: invite.propertyId, developmentId: invite.developmentId, startDate: now, status: "active", createdAt: now } as never,
          { session }
        );
      }
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict(`${ACTIVE_TENANCY_TAKEN} Ask your property manager for a new invite.`);
    if (err instanceof AppError) throw err;
    throw err;
  } finally {
    await session.endSession();
  }
  await audit(cols, { actorId: me.uid, action: "invite.accept", targetType: "invite", targetId: String(invite._id), developmentId: invite.developmentId, after: { role: invite.role } });
  return c.json({ developmentId: String(invite.developmentId), role: invite.role });
});

export default invites;
