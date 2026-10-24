import type { ObjectId } from "mongodb";
import type { NotificationEvent, Permission } from "@easytenant/shared";
import type { Deps } from "../context";
import { holdersOf } from "./roles";
import { renderEmail } from "./mailer";

export interface NotifyParams {
  event: NotificationEvent;
  developmentId: ObjectId | null;
  userIds?: string[];
  /** Everyone holding this permission in the development. */
  permission?: Permission;
  /** Usually the person who caused the event; they aren't notified. */
  exclude?: string;
  title: string;
  body: string;
  /** Path inside the web app, e.g. /faults/abc. */
  link?: string;
  emailSubject?: string;
}

/**
 * Writes an in-app notification for every recipient and emails those who
 * haven't turned email off for this event. In-app is always on.
 */
export async function notify(deps: Deps, p: NotifyParams): Promise<void> {
  const { cols, mailer, config } = deps;
  try {
    const ids = new Set(p.userIds ?? []);
    if (p.permission) (await holdersOf(cols, p.permission, p.developmentId)).forEach((id) => ids.add(id));
    if (p.exclude) ids.delete(p.exclude);
    const recipients = [...ids];
    if (!recipients.length) return;

    const now = new Date();
    await cols.notifications.insertMany(
      recipients.map((userId) => ({
        userId,
        type: p.event,
        payload: { title: p.title, body: p.body, link: p.link ?? null },
        channels: ["inapp"],
        read: false,
        createdAt: now,
      })) as never[]
    );

    const optedOut = new Set(
      (
        await cols.notificationPreferences
          .find({ userId: { $in: recipients }, eventType: p.event })
          .toArray()
      )
        .filter((pref) => !pref.channels.includes("email"))
        .map((pref) => pref.userId)
    );
    const emailIds = recipients.filter((id) => !optedOut.has(id));
    if (!emailIds.length) return;
    const users = await cols.users.find({ _id: { $in: emailIds } }, { projection: { email: 1, name: 1 } }).toArray();
    const url = `${config.publicWebUrl}${p.link ?? "/"}`;
    await Promise.allSettled(
      users.map((u) => {
        const { text, html } = renderEmail({
          heading: p.title,
          paragraphs: [`Hi ${u.name || "there"},`, p.body],
          action: { label: "Open in EasyTenant", url },
          footer: "You can change which emails you get under Settings → Notifications.",
        });
        return mailer.send({ to: u.email, subject: p.emailSubject ?? p.title, text, html });
      })
    );
  } catch (err) {
    // Notifications are a side effect; never fail the user's action.
    console.error(`[notify] ${p.event} failed:`, err);
  }
}
