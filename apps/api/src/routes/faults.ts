import { Hono } from "hono";
import type { Document, ObjectId } from "mongodb";
import {
  availableTransitions,
  createFaultBody,
  faultListQuery,
  faultUpdateBody,
  formatMoney,
  getTransition,
  isCurrencyCode,
  OPEN_STATUSES,
  PERMISSIONS,
  STAGE_LABEL,
  SYSTEM_ROLES,
  transitionBody,
  type ActorFacts,
  type AttachmentInput,
  type FaultDetailDto,
  type FaultSummaryDto,
  type TransitionDef,
} from "@easytenant/shared";
import { body, query, type AppEnv, type Deps } from "../context";
import type { Access } from "../access/access";
import type { AttachmentDoc, IssueDoc } from "../db/types";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { iso, isoRequired, oid } from "../lib/ids";
import { escapeRegex, paginate, RECENT_FIRST } from "../lib/pagination";
import { displayName, userSummaries } from "../lib/people";
import { uploadPrefix } from "../lib/storage";
import { notify } from "../lib/notify";
import { renderEmail } from "../lib/mailer";
import { audit } from "../lib/audit";
import { loadDevelopment } from "../access/loaders";

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export async function faultSummaries(deps: Deps, docs: IssueDoc[]): Promise<FaultSummaryDto[]> {
  const { cols, config } = deps;
  if (!docs.length) return [];
  const [devs, units, people] = await Promise.all([
    cols.developments.find({ _id: { $in: docs.map((d) => d.developmentId) } }, { projection: { name: 1, overdueDays: 1, currency: 1 } }).toArray(),
    cols.properties.find({ _id: { $in: docs.map((d) => d.propertyId) } }, { projection: { unitNumber: 1 } }).toArray(),
    userSummaries(cols, docs.flatMap((d) => [d.reporterId, ...(d.assignedTo ?? [])])),
  ]);
  const dev = new Map(devs.map((d) => [String(d._id), d]));
  const unit = new Map(units.map((u) => [String(u._id), u]));
  return docs.map((d) => {
    const dv = dev.get(String(d.developmentId));
    return {
      id: String(d._id),
      title: d.title,
      category: d.category ?? "other",
      priority: d.priority ?? "medium",
      status: d.status,
      type: d.type ?? "reactive",
      development: {
        id: String(d.developmentId),
        name: dv?.name ?? "?",
        overdueDays: dv?.overdueDays ?? config.faultOverdueDays,
        currency: isCurrencyCode(dv?.currency) ? dv.currency : config.defaultCurrency,
      },
      unit: { id: String(d.propertyId), unitNumber: unit.get(String(d.propertyId))?.unitNumber ?? "?" },
      reporter: people.get(d.reporterId) ?? null,
      assignees: (d.assignedTo ?? []).map((id) => people.get(id) ?? { id, name: null, email: "unknown" }),
      attachmentCount: d.attachments?.length ?? 0,
      scheduledDate: iso(d.scheduledDate),
      createdAt: isoRequired(d.createdAt),
      updatedAt: isoRequired(d.updatedAt ?? d.createdAt),
      closedAt: iso(d.closedAt),
    };
  });
}

async function attachmentDtos(deps: Deps, list: AttachmentDoc[] | undefined) {
  return Promise.all(
    (list ?? []).map(async (a) => ({
      type: a.type,
      key: a.r2Key,
      name: a.name ?? null,
      url: await deps.storage.presignGet(a.r2Key),
    }))
  );
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

interface FaultAccess extends ActorFacts {
  canView: boolean;
}

async function factsFor(deps: Deps, access: Access, fault: IssueDoc): Promise<FaultAccess> {
  const me = access.me.uid;
  const [permissions, residency] = await Promise.all([
    access.permissionsIn(fault.developmentId),
    deps.cols.tenancies.findOne({ propertyId: fault.propertyId, tenantUserId: me, status: "active" }, { projection: { _id: 1 } }),
  ]);
  const isReporter = fault.reporterId === me;
  const isAssignee = (fault.assignedTo ?? []).includes(me);
  const isResident = Boolean(residency);
  return {
    permissions,
    isReporter,
    isAssignee,
    isResident,
    canView: permissions.has(PERMISSIONS.ISSUE_VIEW_ALL) || isReporter || isAssignee || isResident,
  };
}

/** Loads a fault the caller may see. Someone who may not see it gets a 404,
 * so fault ids can't be probed. */
async function loadFault(deps: Deps, access: Access, id: string | undefined) {
  access.verified;
  const fault = await deps.cols.issues.findOne({ _id: oid(id, "fault id") });
  if (!fault) throw notFound("Fault");
  const facts = await factsFor(deps, access, fault);
  if (!facts.canView) throw notFound("Fault");
  return { fault, facts };
}

function checkAttachments(input: AttachmentInput[], developmentId: ObjectId, userId: string): AttachmentDoc[] {
  const prefix = uploadPrefix(String(developmentId), userId);
  return input.map((a) => {
    if (!a.key.startsWith(prefix)) throw badRequest("One of the attachments wasn't uploaded by you for this development.");
    return { type: a.type, r2Key: a.key, ...(a.name ? { name: a.name } : {}) };
  });
}

async function detail(deps: Deps, fault: IssueDoc, facts: FaultAccess): Promise<FaultDetailDto> {
  const { cols } = deps;
  const updates = await cols.issueUpdates.find({ issueId: fault._id }).sort({ createdAt: 1, _id: 1 }).toArray();
  const [[summary], people, attachments, activityAttachments] = await Promise.all([
    faultSummaries(deps, [fault]),
    userSummaries(cols, [fault.costApprovedBy, ...updates.map((u) => u.authorId)]),
    attachmentDtos(deps, fault.attachments),
    Promise.all(updates.map((u) => attachmentDtos(deps, u.attachments))),
  ]);
  return {
    ...summary!,
    description: fault.description ?? "",
    attachments,
    vendorName: fault.vendorName ?? null,
    vendorContact: fault.vendorContact ?? null,
    agreedCost: fault.agreedCost ?? null,
    costApprovedBy: fault.costApprovedBy ? (people.get(fault.costApprovedBy) ?? null) : null,
    costApprovedAt: iso(fault.costApprovedAt),
    actualCost: fault.actualCost ?? null,
    invoiceRef: fault.invoiceRef ?? null,
    activity: updates.map((u, i) => ({
      id: String(u._id),
      author: people.get(u.authorId) ?? null,
      note: u.note ?? "",
      attachments: activityAttachments[i] ?? [],
      statusChangeTo: u.statusChangeTo ?? null,
      createdAt: isoRequired(u.createdAt),
    })),
    availableActions: availableTransitions(fault.status, facts).map((t) => t.id),
    canComment: facts.canView && fault.status !== "cancelled",
  };
}

const link = (id: ObjectId) => `/faults/${id}`;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const faults = new Hono<AppEnv>();

faults.get("/", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const me = access.verified;
  const q = query(c, faultListQuery);
  const filter: Document = {};

  if (q.scope === "all") {
    const scope = await access.developmentsWith(PERMISSIONS.ISSUE_VIEW_ALL);
    if (q.developmentId) {
      const devId = oid(q.developmentId);
      if (scope !== "all" && !scope.some((d) => d.equals(devId))) throw forbidden();
      filter.developmentId = devId;
    } else if (scope !== "all") {
      if (!scope.length) return c.json({ items: [], nextCursor: null });
      filter.developmentId = { $in: scope };
    }
  } else if (q.scope === "mine") {
    const homes = await deps.cols.tenancies.find({ tenantUserId: me.uid, status: "active" }, { projection: { propertyId: 1 } }).toArray();
    filter.$or = [{ reporterId: me.uid }, ...(homes.length ? [{ propertyId: { $in: homes.map((h) => h.propertyId) } }] : [])];
    if (q.developmentId) filter.developmentId = oid(q.developmentId);
  } else {
    filter.assignedTo = me.uid;
    if (q.developmentId) filter.developmentId = oid(q.developmentId);
  }
  if (q.status) filter.status = q.status;
  else if (q.open === "1") filter.status = { $in: [...OPEN_STATUSES] };
  else if (q.open === "0") filter.status = { $in: ["closed", "cancelled"] };
  if (q.q) filter.title = { $regex: escapeRegex(q.q), $options: "i" };

  const page = await paginate(deps.cols.issues, filter, RECENT_FIRST, q.cursor, q.limit);
  return c.json({ items: await faultSummaries(deps, page.items), nextCursor: page.nextCursor });
});

faults.post("/", async (c) => {
  const deps = c.var.deps;
  const { cols } = deps;
  const access = c.var.access;
  const me = access.verified;
  const input = await body(c, createFaultBody);
  const dev = await loadDevelopment(deps, access, input.developmentId);
  await access.require(PERMISSIONS.ISSUE_CREATE, dev._id);
  const perms = await access.permissionsIn(dev._id);

  const unit = await cols.properties.findOne({ _id: oid(input.unitId), developmentId: dev._id });
  if (!unit) throw badRequest("That unit isn't in this development.");
  if (!perms.has(PERMISSIONS.ISSUE_VIEW_ALL)) {
    const home = await cols.tenancies.findOne({ propertyId: unit._id, tenantUserId: me.uid, status: "active" });
    if (!home) throw forbidden("You can only report faults for your own unit.");
  }
  if (input.type !== "reactive" && !perms.has(PERMISSIONS.WORKORDER_CREATE)) {
    throw forbidden("Only managers can schedule planned maintenance.");
  }

  const now = new Date();
  const doc = {
    reporterId: me.uid,
    propertyId: unit._id,
    developmentId: dev._id,
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    attachments: checkAttachments(input.attachments, dev._id, me.uid),
    status: "logged" as const,
    type: input.type,
    assignedTo: [],
    ...(input.scheduledDate ? { scheduledDate: new Date(input.scheduledDate) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const res = await cols.issues.insertOne(doc as never);
  await cols.issueUpdates.insertOne({ issueId: res.insertedId, authorId: me.uid, note: "", attachments: [], statusChangeTo: "logged", createdAt: now } as never);
  const reporter = (await cols.users.findOne({ _id: me.uid })) ?? { email: me.email, name: me.name };

  await notify(deps, {
    event: "fault.reported",
    developmentId: dev._id,
    permission: PERMISSIONS.ISSUE_VIEW_ALL,
    exclude: me.uid,
    title: `New fault: ${doc.title}`,
    body: `${displayName(reporter)} reported a ${doc.priority}-priority ${doc.category} fault at ${dev.name}, unit ${unit.unitNumber}.`,
    link: link(res.insertedId),
  });

  const saved = (await cols.issues.findOne({ _id: res.insertedId }))!;
  return c.json(await detail(deps, saved, await factsFor(deps, access, saved)), 201);
});

faults.get("/:id", async (c) => {
  const deps = c.var.deps;
  const { fault, facts } = await loadFault(deps, c.var.access, c.req.param("id"));
  return c.json(await detail(deps, fault, facts));
});

faults.post("/:id/updates", async (c) => {
  const deps = c.var.deps;
  const { cols } = deps;
  const access = c.var.access;
  const { fault, facts } = await loadFault(deps, access, c.req.param("id"));
  if (fault.status === "cancelled") throw conflict("This fault was cancelled.");
  const input = await body(c, faultUpdateBody);
  const me = access.me;
  await cols.issueUpdates.insertOne({
    issueId: fault._id,
    authorId: me.uid,
    note: input.note,
    attachments: checkAttachments(input.attachments, fault.developmentId, me.uid),
    createdAt: new Date(),
  } as never);
  await cols.issues.updateOne({ _id: fault._id }, { $set: { updatedAt: new Date() } });

  const fromResident = facts.isReporter || facts.isResident;
  await notify(deps, {
    event: "fault.updated",
    developmentId: fault.developmentId,
    userIds: fromResident ? fault.assignedTo : [fault.reporterId, ...fault.assignedTo],
    permission: fromResident ? PERMISSIONS.ISSUE_VIEW_ALL : undefined,
    exclude: me.uid,
    title: `Update on "${fault.title}"`,
    body: input.note ? `${me.name || me.email}: ${input.note.slice(0, 280)}` : `${me.name || me.email} added photos or videos.`,
    link: link(fault._id),
  });
  return c.json(await detail(deps, (await cols.issues.findOne({ _id: fault._id }))!, facts), 201);
});

faults.post("/:id/transition", async (c) => {
  const deps = c.var.deps;
  const { cols } = deps;
  const access = c.var.access;
  const me = access.verified;
  const { fault, facts } = await loadFault(deps, access, c.req.param("id"));
  const input = await body(c, transitionBody);
  const def = getTransition(input.action) as TransitionDef;

  if (!def.from.includes(fault.status)) {
    throw conflict(`This fault is at "${STAGE_LABEL[fault.status] ?? fault.status}", so "${def.label}" isn't possible.`);
  }
  if (!availableTransitions(fault.status, facts).some((t) => t.id === def.id)) throw forbidden();
  if (def.noteRequired && !input.note) throw badRequest("Add a short reason.");

  const now = new Date();
  const set: Record<string, unknown> = { status: def.to, updatedAt: now };
  const unset: Record<string, ""> = {};

  switch (def.id) {
    case "classify":
      if (!input.priority) throw badRequest("Choose a priority.");
      set.priority = input.priority;
      break;
    case "assign": {
      const ids = [...new Set(input.assignedTo ?? [])];
      if (!ids.length) throw badRequest("Choose at least one technician.");
      const role = await cols.roles.findOne({ developmentId: fault.developmentId, name: SYSTEM_ROLES.SERVICE_PERSONNEL });
      const eligible = role
        ? new Set((await cols.userRoles.find({ developmentId: fault.developmentId, roleId: role._id, userId: { $in: ids } }).toArray()).map((g) => g.userId))
        : new Set<string>();
      if (ids.some((id) => !eligible.has(id))) throw badRequest("Everyone assigned must be service personnel in this development.");
      set.assignedTo = ids;
      if (input.scheduledDate) set.scheduledDate = new Date(input.scheduledDate);
      break;
    }
    case "submit_quote":
      if (!input.vendorName || input.agreedCost === undefined) throw badRequest("Add the vendor and the agreed cost.");
      set.vendorName = input.vendorName;
      set.agreedCost = input.agreedCost;
      if (input.vendorContact) set.vendorContact = input.vendorContact;
      else unset.vendorContact = "";
      break;
    case "approve_cost":
      set.costApprovedBy = me.uid;
      set.costApprovedAt = now;
      break;
    case "reject_cost":
      Object.assign(unset, { vendorName: "", vendorContact: "", agreedCost: "", costApprovedBy: "", costApprovedAt: "" });
      break;
    case "close":
      if (input.actualCost === undefined) throw badRequest("Record the final cost.");
      set.actualCost = input.actualCost;
      if (input.invoiceRef) set.invoiceRef = input.invoiceRef;
      set.closedAt = now;
      break;
  }

  // Conditional on the status we read, so two people acting at once can't
  // both move the fault.
  const updated = await cols.issues.findOneAndUpdate(
    { _id: fault._id, status: fault.status },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: "after" }
  );
  if (!updated) throw conflict("Someone else just updated this fault. Refresh and try again.");

  await cols.issueUpdates.insertOne({
    issueId: fault._id,
    authorId: me.uid,
    note: input.note ?? "",
    attachments: [],
    statusChangeTo: def.to,
    createdAt: now,
  } as never);

  if (["approve_cost", "reject_cost", "close", "cancel"].includes(def.id)) {
    await audit(cols, {
      actorId: me.uid,
      action: `fault.${def.id}`,
      targetType: "fault",
      targetId: String(fault._id),
      developmentId: fault.developmentId,
      before: { status: fault.status, agreedCost: fault.agreedCost },
      after: { status: def.to, agreedCost: updated.agreedCost, actualCost: updated.actualCost },
    });
  }

  await notifyTransition(deps, fault, updated, def, me.uid);
  const freshFacts = await factsFor(deps, access, updated);
  return c.json(await detail(deps, updated, freshFacts));
});

async function notifyTransition(deps: Deps, before: IssueDoc, after: IssueDoc, def: TransitionDef, actorId: string) {
  const dev = await deps.cols.developments.findOne({ _id: after.developmentId }, { projection: { name: 1, currency: 1 } });
  const currency = isCurrencyCode(dev?.currency) ? dev.currency : deps.config.defaultCurrency;
  if (def.id === "assign") {
    await notify(deps, {
      event: "fault.assigned",
      developmentId: after.developmentId,
      userIds: after.assignedTo,
      exclude: actorId,
      title: `New job: ${after.title}`,
      body: `You've been assigned a ${after.priority}-priority job at ${dev?.name ?? "a development"}.${after.scheduledDate ? ` Scheduled for ${after.scheduledDate.toDateString()}.` : ""}`,
      link: link(after._id),
    });
  }
  const extra =
    def.id === "submit_quote"
      ? ` Quote: ${formatMoney(after.agreedCost, currency)} from ${after.vendorName}.`
      : def.id === "close"
        ? ` Final cost: ${formatMoney(after.actualCost, currency)}.`
        : "";
  await notify(deps, {
    event: "fault.status_changed",
    developmentId: after.developmentId,
    userIds: [after.reporterId, ...after.assignedTo, ...(def.id === "reject_cost" ? before.assignedTo : [])],
    permission: PERMISSIONS.ISSUE_VIEW_ALL,
    exclude: actorId,
    title: `${after.title}: ${STAGE_LABEL[after.status]}`,
    body: `The fault moved from "${STAGE_LABEL[before.status]}" to "${STAGE_LABEL[after.status]}".${extra}`,
    link: link(after._id),
  });
  if (def.id === "close") await emailOwnerOnClose(deps, after, dev?.name ?? "", currency);
}

/** The unit's owner is a contact, not a user, so they get a direct email
 * when a repair on their unit is closed. */
async function emailOwnerOnClose(deps: Deps, fault: IssueDoc, devName: string, currency: string) {
  const unit = await deps.cols.properties.findOne({ _id: fault.propertyId });
  if (!unit?.ownerEmail) return;
  const days = Math.max(1, Math.round(((fault.closedAt?.getTime() ?? Date.now()) - fault.createdAt.getTime()) / 86_400_000));
  const { text, html } = renderEmail({
    heading: `Repair completed at unit ${unit.unitNumber}`,
    paragraphs: [
      `Hi ${unit.ownerName || "there"},`,
      `The fault "${fault.title}" at ${devName}, unit ${unit.unitNumber}, has been repaired and closed after ${days} day${days === 1 ? "" : "s"}.`,
      `Final cost: ${formatMoney(fault.actualCost, currency)}${fault.vendorName ? ` (${fault.vendorName})` : ""}${fault.invoiceRef ? `, invoice ${fault.invoiceRef}` : ""}.`,
    ],
    footer: "You're receiving this as the owner on record for this unit.",
  });
  await deps.mailer.send({ to: unit.ownerEmail, subject: `Repair completed: ${fault.title} (unit ${unit.unitNumber})`, text, html });
}

export default faults;
