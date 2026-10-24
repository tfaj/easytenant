import type { FaultStatus } from "./pipeline";

/**
 * Colour-coding for how long a fault has been open. Thresholds: under 3 days
 * and still "logged" is new; 7+ days is aging; the development's overdue
 * threshold (30 days by default) is overdue.
 */
export type FaultTone = "new" | "ongoing" | "aging" | "overdue" | "closed" | "cancelled";

export const NEW_THRESHOLD_DAYS = 3;
export const AGING_THRESHOLD_DAYS = 7;
export const DEFAULT_OVERDUE_DAYS = 30;

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, to: Date = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS);
}

export function faultTone(
  fault: { status: FaultStatus; createdAt: string; closedAt?: string | null },
  overdueDays: number = DEFAULT_OVERDUE_DAYS,
  now: Date = new Date()
): FaultTone {
  if (fault.status === "closed") return "closed";
  if (fault.status === "cancelled") return "cancelled";
  const days = daysBetween(fault.createdAt, now);
  if (days >= overdueDays) return "overdue";
  if (days >= AGING_THRESHOLD_DAYS) return "aging";
  if (fault.status === "logged" && days < NEW_THRESHOLD_DAYS) return "new";
  return "ongoing";
}

export const FAULT_TONE_LABEL: Record<FaultTone, string> = {
  new: "New",
  ongoing: "Ongoing",
  aging: "Aging",
  overdue: "Overdue",
  closed: "Closed",
  cancelled: "Cancelled",
};
