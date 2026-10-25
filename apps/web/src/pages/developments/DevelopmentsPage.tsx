import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import type { DevelopmentDto } from "@easytenant/shared";
import { useAuth } from "../../auth/AuthProvider";
import { api, errorMessage, qs } from "../../lib/api";
import { useDebounced, usePaged } from "../../lib/hooks";
import { Button, EmptyState, ErrorNote, Field, Input, LoadMore, PageHeader, Panel, Spinner } from "../../components/ui";
import { Dialog } from "../../components/Dialog";

function Occupancy({ s }: { s: NonNullable<DevelopmentDto["stats"]> }) {
  const pct = (n: number) => (s.units ? (n / s.units) * 100 : 0);
  return (
    <div className="min-w-36">
      <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span className="bg-primary" style={{ width: `${pct(s.occupied)}%` }} />
        <span className="bg-sky" style={{ width: `${pct(s.invited)}%` }} />
      </div>
      <div className="tabular mt-1.5 text-[12px] text-ink-3">
        {s.occupied} let, {s.invited} invited, {s.vacant} vacant
      </div>
    </div>
  );
}

export default function DevelopmentsPage() {
  const { caps } = useAuth();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [creating, setCreating] = useState(false);
  const path = `/api/developments${qs({ stats: 1, q, limit: 25 })}`;
  const list = usePaged<DevelopmentDto>(["developments", path], path);

  return (
    <>
      <PageHeader
        title="Developments"
        actions={caps.createDevelopment && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New development</Button>}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input className="pl-9" placeholder="Search by name or address" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search developments" />
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : list.error ? <div className="p-5"><ErrorNote>{list.error.message}</ErrorNote></div> : !list.items.length ? (
          <EmptyState icon={<Building2 className="size-5" />} title={q ? "No developments match" : "No developments yet"}
            action={caps.createDevelopment && !q && <Button variant="primary" onClick={() => setCreating(true)}>Create the first one</Button>}>
            {q ? "Try a different name." : "A development is an estate or building. Add it, then its units."}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line-2">
              {list.items.map((d) => (
                <li key={d.id}>
                  <Link to={`/developments/${d.id}`} className="grid gap-3 px-5 py-4 hover:bg-sunken/60 sm:grid-cols-[minmax(0,1fr)_180px_110px] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{d.name}</div>
                      <div className="truncate text-[13px] text-ink-3">{d.address}</div>
                    </div>
                    {d.stats && <Occupancy s={d.stats} />}
                    {d.stats && (
                      <div className="text-sm sm:text-right">
                        <span className="tabular font-semibold">{d.stats.openFaults}</span>
                        <span className="text-ink-3"> open {d.stats.openFaults === 1 ? "fault" : "faults"}</span>
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Panel>
      <CreateDevelopment open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateDevelopment({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const m = useMutation({
    mutationFn: () => api<DevelopmentDto>("/api/developments", { method: "POST", json: { name, address } }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["developments"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
      navigate(`/developments/${d.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New development"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim() || !address.trim()} onClick={() => m.mutate()}>Create development</Button></>}
    >
      <div className="space-y-4">
        <Field label="Name" hint="For example: Palm Grove Estate">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Address">{(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} />}</Field>
        {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
      </div>
    </Dialog>
  );
}
