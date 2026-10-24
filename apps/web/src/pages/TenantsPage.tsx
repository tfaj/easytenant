import { useState } from "react";
import { Link } from "react-router";
import { Search, UserRound } from "lucide-react";
import type { TenancyDto } from "@easytenant/shared";
import { qs } from "../lib/api";
import { useDebounced, useDevelopments, usePaged } from "../lib/hooks";
import { formatDate, personName } from "../lib/format";
import { EmptyState, ErrorNote, Input, LoadMore, PageHeader, Panel, Select, Spinner, Tabs, UnitPlate } from "../components/ui";

export default function TenantsPage() {
  const [search, setSearch] = useState("");
  const [developmentId, setDevelopmentId] = useState("");
  const [status, setStatus] = useState<"active" | "ended">("active");
  const q = useDebounced(search.trim());
  const devs = useDevelopments();
  const path = `/api/tenants${qs({ q, developmentId, status, limit: 25 })}`;
  const list = usePaged<TenancyDto>(["tenants", path], path);
  return (
    <>
      <PageHeader title="Tenants" description="Everyone living in the developments you manage." />
      <div className="mb-4">
        <Tabs value={status} onChange={setStatus} items={[{ value: "active", label: "Current" }, { value: "ended", label: "Moved out" }]} />
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input className="pl-9" placeholder="Name, email or unit number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tenants" />
        </div>
        {(devs.data?.length ?? 0) > 1 && (
          <Select className="sm:w-64" value={developmentId} onChange={(e) => setDevelopmentId(e.target.value)} aria-label="Development">
            <option value="">All developments</option>
            {devs.data!.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : list.error ? <div className="p-5"><ErrorNote>{list.error.message}</ErrorNote></div> : !list.items.length ? (
          <EmptyState icon={<UserRound className="size-5" />} title={q ? "Nobody matches" : status === "active" ? "No tenants yet" : "No one has moved out"}>
            {q ? "Try part of their name or the unit number." : status === "active" ? "Invite tenants from a vacant unit on the development page." : undefined}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line-2">
              {list.items.map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                  <UnitPlate>{t.unit.unitNumber}</UnitPlate>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{personName(t.tenant)}</div>
                    <div className="truncate text-[13px] text-ink-3">{t.tenant.email}</div>
                  </div>
                  <div className="hidden text-right text-[13px] sm:block">
                    <Link to={`/developments/${t.development.id}`} className="font-medium text-ink-2 hover:text-primary">{t.development.name}</Link>
                    <div className="text-ink-3">{status === "active" ? `Since ${formatDate(t.startDate)}` : `Left ${formatDate(t.endDate)}`}</div>
                  </div>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Panel>
    </>
  );
}
