import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { OPEN_STATUSES, PERMISSIONS } from "@easytenant/shared";
import type { AppEnv, Deps } from "../context";
import { forbidden } from "../lib/errors";
import { notify } from "../lib/notify";

const DAY = 86_400_000;

function secretMatches(given: string | undefined, expected: string | undefined) {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily job (Cloud Scheduler → POST /internal/jobs/daily):
 *  - reminds assignees and managers about work scheduled in the next 48h;
 *  - tells managers once when a fault passes its development's overdue
 *    threshold.
 * Each reminder is recorded on the fault (remindersSent) so re-runs never
 * send duplicates.
 */
export async function runDailyJob(deps: Deps, now = new Date()) {
  const { cols, config } = deps;
  let reminders = 0;
  let overdue = 0;

  const upcoming = await cols.issues
    .find({ status: { $in: [...OPEN_STATUSES] }, scheduledDate: { $gte: now, $lte: new Date(now.getTime() + 2 * DAY) } })
    .toArray();
  for (const f of upcoming) {
    const key = `scheduled:${f.scheduledDate!.toISOString().slice(0, 10)}`;
    if (f.remindersSent?.includes(key)) continue;
    const claimed = await cols.issues.updateOne({ _id: f._id, remindersSent: { $ne: key } }, { $addToSet: { remindersSent: key } });
    if (!claimed.modifiedCount) continue;
    reminders++;
    await notify(deps, {
      event: "maintenance.reminder",
      developmentId: f.developmentId,
      userIds: f.assignedTo,
      permission: PERMISSIONS.ISSUE_VIEW_ALL,
      title: `Coming up: ${f.title}`,
      body: `Scheduled for ${f.scheduledDate!.toUTCString().slice(0, 16)}.`,
      link: `/faults/${f._id}`,
    });
  }

  const devs = await cols.developments.find({}, { projection: { name: 1, overdueDays: 1 } }).toArray();
  for (const d of devs) {
    const days = d.overdueDays ?? config.faultOverdueDays;
    const late = await cols.issues
      .find({
        developmentId: d._id,
        status: { $in: [...OPEN_STATUSES] },
        createdAt: { $lte: new Date(now.getTime() - days * DAY) },
        remindersSent: { $ne: "overdue" },
      })
      .limit(200)
      .toArray();
    for (const f of late) {
      const claimed = await cols.issues.updateOne({ _id: f._id, remindersSent: { $ne: "overdue" } }, { $addToSet: { remindersSent: "overdue" } });
      if (!claimed.modifiedCount) continue;
      overdue++;
      await notify(deps, {
        event: "fault.overdue",
        developmentId: d._id,
        permission: PERMISSIONS.ISSUE_VIEW_ALL,
        title: `Overdue: ${f.title}`,
        body: `This fault at ${d.name} has been open for more than ${days} days.`,
        link: `/faults/${f._id}`,
      });
    }
  }
  return { reminders, overdue };
}

const jobs = new Hono<AppEnv>();

jobs.post("/daily", async (c) => {
  const deps = c.var.deps;
  if (!secretMatches(c.req.header("x-job-secret"), deps.config.jobSecret)) throw forbidden();
  const result = await runDailyJob(deps);
  console.log("[job] daily", result);
  return c.json(result);
});

export default jobs;
