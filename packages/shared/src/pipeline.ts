import { PERMISSIONS, type Permission } from "./permissions";

/**
 * The fault lifecycle, defined once as data so the API (which enforces it)
 * and the web app (which renders it) can never drift apart.
 *
 *   logged → priority_classified → technician_assigned → inspection →
 *   awaiting_cost_approval → repair_in_progress → resident_confirmation →
 *   cost_recording → closed
 *
 * Two moves are non-linear: "reject_cost" sends a quote back to inspection,
 * and "cancel" ends a fault from any open stage.
 */

export const FAULT_STAGES = [
  "logged",
  "priority_classified",
  "technician_assigned",
  "inspection",
  "awaiting_cost_approval",
  "repair_in_progress",
  "resident_confirmation",
  "cost_recording",
  "closed",
] as const;

export type FaultStage = (typeof FAULT_STAGES)[number];
export type FaultStatus = FaultStage | "cancelled";

export const FAULT_STATUSES: readonly FaultStatus[] = [...FAULT_STAGES, "cancelled"];
export const TERMINAL_STATUSES: readonly FaultStatus[] = ["closed", "cancelled"];
export const OPEN_STATUSES: readonly FaultStatus[] = FAULT_STAGES.filter((s) => s !== "closed");

export const STAGE_LABEL: Record<FaultStatus, string> = {
  logged: "Logged",
  priority_classified: "Prioritised",
  technician_assigned: "Technician assigned",
  inspection: "Inspection",
  awaiting_cost_approval: "Awaiting cost approval",
  repair_in_progress: "Repair in progress",
  resident_confirmation: "Resident confirmation",
  cost_recording: "Cost recording",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Short description of what has to happen while a fault sits in a stage. */
export const STAGE_HINT: Record<FaultStatus, string> = {
  logged: "A manager sets the priority.",
  priority_classified: "A manager assigns a technician.",
  technician_assigned: "The technician starts the inspection.",
  inspection: "The technician submits a vendor and quote.",
  awaiting_cost_approval: "An admin approves or rejects the quote.",
  repair_in_progress: "The technician marks the repair complete.",
  resident_confirmation: "The resident (or a manager) confirms the fix.",
  cost_recording: "A manager records the final cost to close it.",
  closed: "Done.",
  cancelled: "This fault was cancelled.",
};

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const FAULT_TYPES = ["reactive", "mandatory", "optional"] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export const FAULT_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "structural",
  "appliance",
  "security",
  "pest",
  "cleaning",
  "other",
] as const;

export type TransitionId =
  | "classify"
  | "assign"
  | "start_inspection"
  | "submit_quote"
  | "approve_cost"
  | "reject_cost"
  | "complete_repair"
  | "confirm_resolution"
  | "close"
  | "cancel";

/** Who may perform a transition. Any one matching rule is enough. */
export interface ActorRule {
  permission?: Permission;
  assignee?: boolean;
  reporter?: boolean;
  resident?: boolean;
}

export interface TransitionDef {
  id: TransitionId;
  from: readonly FaultStatus[];
  to: FaultStatus;
  label: string;
  /** Fields the request must (or may) carry. Validated by the API. */
  fields: readonly ("priority" | "assignedTo" | "scheduledDate" | "vendorName" | "vendorContact" | "agreedCost" | "actualCost" | "invoiceRef" | "note")[];
  noteRequired?: boolean;
  allowed: readonly ActorRule[];
  tone?: "primary" | "danger" | "neutral";
}

export const TRANSITIONS: readonly TransitionDef[] = [
  {
    id: "classify",
    from: ["logged"],
    to: "priority_classified",
    label: "Set priority",
    fields: ["priority", "note"],
    allowed: [{ permission: PERMISSIONS.ISSUE_VIEW_ALL }],
  },
  {
    id: "assign",
    from: ["priority_classified"],
    to: "technician_assigned",
    label: "Assign technician",
    fields: ["assignedTo", "scheduledDate", "note"],
    allowed: [{ permission: PERMISSIONS.WORKORDER_ASSIGN }],
  },
  {
    id: "start_inspection",
    from: ["technician_assigned"],
    to: "inspection",
    label: "Start inspection",
    fields: ["note"],
    allowed: [{ assignee: true }, { permission: PERMISSIONS.WORKORDER_ASSIGN }],
  },
  {
    id: "submit_quote",
    from: ["inspection"],
    to: "awaiting_cost_approval",
    label: "Submit quote",
    fields: ["vendorName", "vendorContact", "agreedCost", "note"],
    allowed: [{ assignee: true }, { permission: PERMISSIONS.WORKORDER_ASSIGN }],
  },
  {
    id: "approve_cost",
    from: ["awaiting_cost_approval"],
    to: "repair_in_progress",
    label: "Approve cost",
    fields: ["note"],
    allowed: [{ permission: PERMISSIONS.ISSUE_APPROVE_COST }],
  },
  {
    id: "reject_cost",
    from: ["awaiting_cost_approval"],
    to: "inspection",
    label: "Reject quote",
    fields: ["note"],
    noteRequired: true,
    allowed: [{ permission: PERMISSIONS.ISSUE_APPROVE_COST }],
    tone: "danger",
  },
  {
    id: "complete_repair",
    from: ["repair_in_progress"],
    to: "resident_confirmation",
    label: "Mark repair complete",
    fields: ["note"],
    allowed: [{ assignee: true }, { permission: PERMISSIONS.WORKORDER_ASSIGN }],
  },
  {
    id: "confirm_resolution",
    from: ["resident_confirmation"],
    to: "cost_recording",
    label: "Confirm it's fixed",
    fields: ["note"],
    allowed: [{ reporter: true }, { resident: true }, { permission: PERMISSIONS.WORKORDER_VERIFY }],
  },
  {
    id: "close",
    from: ["cost_recording"],
    to: "closed",
    label: "Record cost and close",
    fields: ["actualCost", "invoiceRef", "note"],
    allowed: [{ permission: PERMISSIONS.WORKORDER_VERIFY }],
  },
  {
    id: "cancel",
    from: OPEN_STATUSES,
    to: "cancelled",
    label: "Cancel fault",
    fields: ["note"],
    noteRequired: true,
    allowed: [{ permission: PERMISSIONS.ISSUE_VIEW_ALL }],
    tone: "danger",
  },
];

export interface ActorFacts {
  /** Permissions the actor holds in the fault's development (platform-wide
   * permissions included). */
  permissions: ReadonlySet<string>;
  isAssignee: boolean;
  isReporter: boolean;
  isResident: boolean;
}

export function matchesRule(rule: ActorRule, facts: ActorFacts): boolean {
  if (rule.permission && facts.permissions.has(rule.permission)) return true;
  if (rule.assignee && facts.isAssignee) return true;
  if (rule.reporter && facts.isReporter) return true;
  if (rule.resident && facts.isResident) return true;
  return false;
}

export function getTransition(id: string): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.id === id);
}

/** Transitions this actor can perform on a fault currently in `status`. */
export function availableTransitions(status: FaultStatus, facts: ActorFacts): TransitionDef[] {
  return TRANSITIONS.filter(
    (t) => t.from.includes(status) && t.allowed.some((rule) => matchesRule(rule, facts))
  );
}

export function stageIndex(status: FaultStatus): number {
  return (FAULT_STAGES as readonly string[]).indexOf(status);
}

export function isFaultStatus(value: unknown): value is FaultStatus {
  return typeof value === "string" && (FAULT_STATUSES as readonly string[]).includes(value);
}
