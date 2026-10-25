import { Hono } from "hono";
import { NOTIFICATION_EVENTS, preferenceBody, type NotificationDto } from "@easytenant/shared";
import { body, type AppEnv } from "../context";
import type { NotificationDoc } from "../db/types";
import { isoRequired, oid } from "../lib/ids";

/** v1 notifications stored only {issueId, title, status}; build text for them. */
function toDto(n: NotificationDoc): NotificationDto {
  const p = n.payload ?? {};
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const issueId = str("issueId");
  const legacyTitle: Record<string, string> = {
    "fault.reported": "New fault reported",
    "fault.updated": "New update on a fault",
    "fault.status_changed": "Fault status changed",
    "maintenance.reminder": "Upcoming maintenance",
  };
  return {
    id: String(n._id),
    type: n.type,
    title: str("body") ? (str("title") ?? "Notification") : (legacyTitle[n.type] ?? "Notification"),
    body: str("body") ?? str("title") ?? "",
    link: str("link") ?? (issueId ? `/faults/${issueId}` : null),
    read: n.read,
    createdAt: isoRequired(n.createdAt),
  };
}

const notifications = new Hono<AppEnv>();

notifications.get("/", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  const [list, unread] = await Promise.all([
    cols.notifications.find({ userId: me.uid }).sort({ createdAt: -1 }).limit(30).toArray(),
    cols.notifications.countDocuments({ userId: me.uid, read: false }),
  ]);
  return c.json({ items: list.map(toDto), unread });
});

notifications.post("/read-all", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  await cols.notifications.updateMany({ userId: me.uid, read: false }, { $set: { read: true } });
  return c.json({ ok: true });
});

notifications.post("/:id/read", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  await cols.notifications.updateOne({ _id: oid(c.req.param("id")), userId: me.uid }, { $set: { read: true } });
  return c.json({ ok: true });
});

notifications.get("/preferences", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  const prefs = await cols.notificationPreferences.find({ userId: me.uid }).toArray();
  const by = new Map(prefs.map((p) => [p.eventType, p.channels]));
  return c.json(NOTIFICATION_EVENTS.map((e) => ({ eventType: e, email: (by.get(e) ?? ["inapp", "email"]).includes("email") })));
});

notifications.put("/preferences", async (c) => {
  const { cols } = c.var.deps;
  const me = c.var.access.verified;
  const input = await body(c, preferenceBody);
  await cols.notificationPreferences.updateOne(
    { userId: me.uid, eventType: input.eventType },
    { $set: { channels: input.email ? ["inapp", "email"] : ["inapp"] } },
    { upsert: true }
  );
  return c.json({ ok: true });
});

export default notifications;
