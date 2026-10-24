import { Link } from "react-router";
import { Image as ImageIcon } from "lucide-react";
import type { FaultSummaryDto } from "@easytenant/shared";
import { timeAgo, personName } from "../lib/format";
import { MiniTrack, PriorityPill, ToneBadge } from "./FaultBits";
import { UnitPlate } from "./ui";

/** Faults as a table on wide screens and as stacked rows on phones. */
export function FaultList({ items, showDevelopment = true }: { items: FaultSummaryDto[]; showDevelopment?: boolean }) {
  return (
    <>
      <table className="hidden w-full text-left text-sm md:table">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-3">
            <th className="py-2.5 pl-5 pr-3 font-medium">Fault</th>
            <th className="px-3 py-2.5 font-medium">Unit</th>
            <th className="px-3 py-2.5 font-medium">Stage</th>
            <th className="px-3 py-2.5 font-medium">Priority</th>
            <th className="py-2.5 pl-3 pr-5 font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <tr key={f.id} className="group relative border-b border-line-2 last:border-0 hover:bg-sunken/60">
              <td className="max-w-[320px] py-3 pl-5 pr-3">
                <Link to={`/faults/${f.id}`} className="block truncate font-semibold text-ink after:absolute after:inset-0 group-hover:text-primary">
                  {f.title}
                </Link>
                <div className="mt-0.5 flex items-center gap-2 truncate text-[13px] text-ink-3">
                  <span className="capitalize">{f.category}</span>
                  {showDevelopment && <span className="truncate">{f.development.name}</span>}
                  {f.attachmentCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <ImageIcon className="size-3.5" aria-label="Photos" />
                      {f.attachmentCount}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3"><UnitPlate size="sm">{f.unit.unitNumber}</UnitPlate></td>
              <td className="px-3 py-3"><MiniTrack status={f.status} /></td>
              <td className="px-3 py-3"><PriorityPill priority={f.priority} /></td>
              <td className="py-3 pl-3 pr-5"><ToneBadge status={f.status} createdAt={f.createdAt} overdueDays={f.development.overdueDays} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line-2 md:hidden">
        {items.map((f) => (
          <li key={f.id}>
            <Link to={`/faults/${f.id}`} className="flex gap-3 px-4 py-3.5 active:bg-sunken">
              <UnitPlate size="sm">{f.unit.unitNumber}</UnitPlate>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-snug text-ink">{f.title}</span>
                  <PriorityPill priority={f.priority} />
                </div>
                <div className="mt-1.5"><MiniTrack status={f.status} /></div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                  <ToneBadge status={f.status} createdAt={f.createdAt} overdueDays={f.development.overdueDays} />
                  <span>{timeAgo(f.createdAt)}</span>
                  {showDevelopment && <span>{f.development.name}</span>}
                  {f.reporter && <span>by {personName(f.reporter)}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
