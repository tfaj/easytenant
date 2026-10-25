import {
  FAULT_STAGES,
  FAULT_TONE_LABEL,
  faultTone,
  STAGE_LABEL,
  stageIndex,
  type FaultStatus,
  type FaultTone,
  type Priority,
} from "@easytenant/shared";
import { Check } from "lucide-react";
import { cx, Pill } from "./ui";

const toneTint: Record<FaultTone, "primary" | "neutral" | "amber" | "brick" | "moss"> = {
  new: "primary",
  ongoing: "neutral",
  aging: "amber",
  overdue: "brick",
  closed: "moss",
  cancelled: "neutral",
};

export function ToneBadge({ status, createdAt, overdueDays }: { status: FaultStatus; createdAt: string; overdueDays: number }) {
  const tone = faultTone({ status, createdAt }, overdueDays);
  return (
    <Pill tint={toneTint[tone]} dot>
      {tone === "overdue" ? `Overdue (${overdueDays}+ days)` : FAULT_TONE_LABEL[tone]}
    </Pill>
  );
}

const priorityTint: Record<Priority, "neutral" | "sky" | "amber" | "brick"> = { low: "neutral", medium: "sky", high: "amber", urgent: "brick" };

export function PriorityPill({ priority }: { priority: Priority }) {
  return <Pill tint={priorityTint[priority]}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</Pill>;
}

/** Compact nine-segment bar for list rows: how far along the fault is. */
export function MiniTrack({ status }: { status: FaultStatus }) {
  const at = stageIndex(status);
  const cancelled = status === "cancelled";
  return (
    <div className="flex items-center gap-2" title={STAGE_LABEL[status]}>
      <div className="flex gap-[3px]" aria-hidden>
        {FAULT_STAGES.map((s, i) => (
          <span
            key={s}
            className={cx(
              "h-1.5 w-2.5 rounded-[1px]",
              cancelled ? "bg-line" : i < at || status === "closed" ? "bg-primary" : i === at ? "bg-amber" : "bg-line"
            )}
          />
        ))}
      </div>
      <span className="truncate text-[13px] text-ink-2">{STAGE_LABEL[status]}</span>
    </div>
  );
}

/**
 * The signature element: the fault's journey as a numbered track. Done
 * stages are solid, the current one is ringed, future ones are outlined.
 * On a phone it becomes a vertical list with the current stage first in
 * view.
 */
export function StageTrack({ status, times }: { status: FaultStatus; times: Partial<Record<FaultStatus, string>> }) {
  const at = status === "closed" ? FAULT_STAGES.length : stageIndex(status);
  const cancelled = status === "cancelled";
  return (
    <ol className="grid grid-cols-1 gap-0 sm:grid-cols-9" aria-label="Fault progress">
      {FAULT_STAGES.map((s, i) => {
        const done = !cancelled && i < at;
        const current = !cancelled && i === at;
        // On phones, keep the list short: everything up to the next step.
        const farFuture = !cancelled && i > at + 1;
        return (
          <li key={s} className={cx("relative flex gap-3 pb-4 sm:block sm:pb-0", farFuture && "hidden sm:block")} aria-current={current ? "step" : undefined}>
            {/* connector */}
            {i < FAULT_STAGES.length - 1 && (
              <span
                aria-hidden
                className={cx(
                  "absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-[2px] sm:left-[calc(50%+16px)] sm:top-[13px] sm:h-[2px] sm:w-[calc(100%-32px)]",
                  done ? "bg-primary" : "bg-line"
                )}
              />
            )}
            <span
              className={cx(
                "tabular relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold sm:mx-auto",
                done && "bg-primary text-primary-ink",
                current && "bg-panel text-amber ring-2 ring-amber ring-offset-2 ring-offset-panel",
                !done && !current && "border-2 border-line bg-panel text-ink-3"
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 pt-0.5 sm:mt-2 sm:px-1 sm:pt-0 sm:text-center">
              <div className={cx("text-[13px] leading-tight", current ? "font-semibold text-ink" : done ? "text-ink" : "text-ink-3")}>{STAGE_LABEL[s]}</div>
              {times[s] && (done || current) && (
                <div className="tabular mt-0.5 text-[11px] text-ink-3">{new Date(times[s]!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
              )}
            </div>
          </li>
        );
      })}
      {!cancelled && at + 2 < FAULT_STAGES.length && (
        <li className="pl-10 text-[13px] text-ink-3 sm:hidden">
          {FAULT_STAGES.length - at - 2} more step{FAULT_STAGES.length - at - 2 === 1 ? "" : "s"} to close
        </li>
      )}
    </ol>
  );
}
