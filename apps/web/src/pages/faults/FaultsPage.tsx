import { useState } from "react";
import { useSearchParams } from "react-router";
import { ClipboardList, PlusCircle, Search } from "lucide-react";
import { FAULT_STAGES, STAGE_LABEL, type FaultSummaryDto } from "@easytenant/shared";
import { useAuth } from "../../auth/AuthProvider";
import { qs } from "../../lib/api";
import { useDebounced, useDevelopments, usePaged } from "../../lib/hooks";
import { ButtonLink, EmptyState, ErrorNote, Input, LoadMore, PageHeader, Panel, Select, Spinner, Tabs } from "../../components/ui";
import { FaultList } from "../../components/FaultList";

type Scope = "all" | "assigned" | "mine";

export default function FaultsPage() {
  const { caps } = useAuth();
  const [params, setParams] = useSearchParams();
  const scopes: { value: Scope; label: string }[] = [
    ...(caps.manager ? [{ value: "all" as const, label: "All faults" }] : []),
    ...(caps.technician ? [{ value: "assigned" as const, label: "Assigned to me" }] : []),
    { value: "mine" as const, label: caps.manager || caps.technician ? "Reported by me" : "My faults" },
  ];
  const scope = (params.get("scope") as Scope) || scopes[0]!.value;
  const status = params.get("status") ?? "open";
  const developmentId = params.get("developmentId") ?? "";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim());
  const devs = useDevelopments();

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const path = `/api/faults${qs({
    scope,
    q,
    developmentId: scope === "all" ? developmentId : undefined,
    open: status === "open" ? "1" : status === "done" ? "0" : undefined,
    status: status !== "open" && status !== "done" && status !== "any" ? status : undefined,
    limit: 25,
  })}`;
  const list = usePaged<FaultSummaryDto>(["faults", path], path);

  const title = scope === "assigned" ? "My jobs" : scope === "mine" && !caps.manager ? "My faults" : "Faults";
  return (
    <>
      <PageHeader
        title={title}
        actions={(caps.tenant || caps.manager) && <ButtonLink to="/faults/new" variant="primary" icon={<PlusCircle className="size-4" />}>{caps.manager ? "Log a fault" : "Report a fault"}</ButtonLink>}
      />
      {scopes.length > 1 && (
        <div className="mb-4">
          <Tabs value={scope} onChange={(v) => set("scope", v)} items={scopes} />
        </div>
      )}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input className="pl-9" placeholder="Search by title" value={search} onChange={(e) => { setSearch(e.target.value); }} aria-label="Search faults" />
        </div>
        <Select className="sm:w-56" value={status} onChange={(e) => set("status", e.target.value)} aria-label="Stage">
          <option value="open">Open</option>
          <option value="done">Closed or cancelled</option>
          <option value="any">Any stage</option>
          <optgroup label="Exact stage">
            {[...FAULT_STAGES, "cancelled" as const].map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </optgroup>
        </Select>
        {scope === "all" && (devs.data?.length ?? 0) > 1 && (
          <Select className="sm:w-56" value={developmentId} onChange={(e) => set("developmentId", e.target.value)} aria-label="Development">
            <option value="">All developments</option>
            {devs.data!.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : list.error ? <div className="p-5"><ErrorNote>{list.error.message}</ErrorNote></div> : list.items.length ? (
          <>
            <FaultList items={list.items} />
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        ) : (
          <EmptyState icon={<ClipboardList className="size-5" />} title={q || status !== "open" ? "Nothing matches these filters" : "No open faults"}>
            {q || status !== "open" ? "Try another stage or clear the search." : "When a fault is reported, it shows up here."}
          </EmptyState>
        )}
      </Panel>
    </>
  );
}
