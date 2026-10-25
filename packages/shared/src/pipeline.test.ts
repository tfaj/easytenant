import { describe, expect, it } from "vitest";
import { availableTransitions, PERMISSIONS, TRANSITIONS, FAULT_STAGES, faultTone } from "./index";

const none = { permissions: new Set<string>(), isAssignee: false, isReporter: false, isResident: false };

describe("fault pipeline", () => {
  it("every forward transition moves exactly one stage", () => {
    for (const t of TRANSITIONS) {
      if (t.id === "cancel" || t.id === "reject_cost") continue;
      const from = FAULT_STAGES.indexOf(t.from[0] as never);
      expect(FAULT_STAGES.indexOf(t.to as never)).toBe(from + 1);
    }
  });

  it("a stranger can do nothing", () => {
    for (const s of FAULT_STAGES) expect(availableTransitions(s, none)).toEqual([]);
  });

  it("a tenant reporter can only confirm the fix", () => {
    const facts = { ...none, isReporter: true, permissions: new Set([PERMISSIONS.ISSUE_CREATE]) };
    expect(availableTransitions("resident_confirmation", facts).map((t) => t.id)).toEqual(["confirm_resolution"]);
    expect(availableTransitions("logged", facts)).toEqual([]);
  });

  it("the resident of the unit can confirm even if a manager reported it", () => {
    const facts = { ...none, isResident: true };
    expect(availableTransitions("resident_confirmation", facts).map((t) => t.id)).toEqual(["confirm_resolution"]);
  });

  it("only cost approvers can approve or reject a quote", () => {
    const pm = { ...none, permissions: new Set([PERMISSIONS.ISSUE_VIEW_ALL, PERMISSIONS.WORKORDER_ASSIGN, PERMISSIONS.WORKORDER_VERIFY]) };
    expect(availableTransitions("awaiting_cost_approval", pm).map((t) => t.id)).toEqual(["cancel"]);
    const admin = { ...none, permissions: new Set([PERMISSIONS.ISSUE_APPROVE_COST]) };
    expect(availableTransitions("awaiting_cost_approval", admin).map((t) => t.id)).toEqual(["approve_cost", "reject_cost"]);
  });

  it("a non-assigned technician cannot advance someone else's job", () => {
    const tech = { ...none, permissions: new Set([PERMISSIONS.WORKORDER_UPDATE_STATUS]) };
    expect(availableTransitions("technician_assigned", tech)).toEqual([]);
    expect(availableTransitions("technician_assigned", { ...tech, isAssignee: true }).map((t) => t.id)).toEqual(["start_inspection"]);
  });

  it("nothing is possible on terminal faults", () => {
    const all = { permissions: new Set(Object.values(PERMISSIONS)), isAssignee: true, isReporter: true, isResident: true };
    expect(availableTransitions("closed", all)).toEqual([]);
    expect(availableTransitions("cancelled", all)).toEqual([]);
  });
});

describe("faultTone", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  it("classifies by age", () => {
    expect(faultTone({ status: "logged", createdAt: "2026-10-29T12:00:00Z" }, 30, now)).toBe("new");
    expect(faultTone({ status: "inspection", createdAt: "2026-10-29T12:00:00Z" }, 30, now)).toBe("ongoing");
    expect(faultTone({ status: "inspection", createdAt: "2026-10-20T12:00:00Z" }, 30, now)).toBe("aging");
    expect(faultTone({ status: "inspection", createdAt: "2026-09-01T12:00:00Z" }, 30, now)).toBe("overdue");
    expect(faultTone({ status: "inspection", createdAt: "2026-10-20T12:00:00Z" }, 5, now)).toBe("overdue");
    expect(faultTone({ status: "closed", createdAt: "2026-01-01T12:00:00Z" }, 30, now)).toBe("closed");
  });
});
