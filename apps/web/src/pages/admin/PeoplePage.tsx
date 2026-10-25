import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Shield, X } from "lucide-react";
import { ROLE_LABEL, SYSTEM_ROLE_NAMES, isSystemRoleName, type UserAdminDto } from "@easytenant/shared";
import { useAuth } from "../../auth/AuthProvider";
import { api, errorMessage, qs } from "../../lib/api";
import { useDebounced, useDevelopments, usePaged } from "../../lib/hooks";
import { formatDate, personName } from "../../lib/format";
import { Avatar, Button, ErrorNote, Field, Input, LoadMore, PageHeader, Panel, Pill, Select, Spinner } from "../../components/ui";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";

const roleText = (r: string) => (isSystemRoleName(r) ? ROLE_LABEL[r] : r);

export default function PeoplePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const path = `/api/users${qs({ q, limit: 30 })}`;
  const list = usePaged<UserAdminDto>(["users", path], path);
  const [granting, setGranting] = useState<UserAdminDto | null>(null);
  const revoke = useMutation({
    mutationFn: (v: { userId: string; developmentId: string | null; roleName: string }) =>
      api(`/api/users/${encodeURIComponent(v.userId)}/roles`, { method: "DELETE", json: { developmentId: v.developmentId, roleName: v.roleName } }),
    onSuccess: () => {
      toast.success("Role removed.");
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="People" description="Everyone with an account, and what they can do where." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input className="pl-9" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : list.error ? <div className="p-5"><ErrorNote>{list.error.message}</ErrorNote></div> : (
          <>
            <ul className="divide-y divide-line-2">
              {list.items.map((u) => (
                <li key={u.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <Avatar name={personName(u)} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{personName(u)}{u.id === me?.id && <span className="ml-2 text-[13px] font-normal text-ink-3">you</span>}</div>
                    <div className="truncate text-[13px] text-ink-3">{u.email}, joined {formatDate(u.createdAt)}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {u.roles.length === 0 && <span className="text-[13px] text-ink-3">No roles</span>}
                      {u.roles.map((r) => (
                        <span key={`${r.developmentId}-${r.roleName}`} className="inline-flex items-center gap-1 rounded-full bg-sunken py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-ink-2">
                          {r.developmentId === null && <Shield className="size-3 text-primary" aria-label="Platform-wide" />}
                          {roleText(r.roleName)}{r.developmentName ? `, ${r.developmentName}` : r.developmentId === null ? ", all developments" : ""}
                          <button
                            className="grid size-5 place-items-center rounded-full hover:bg-line"
                            aria-label={`Remove ${roleText(r.roleName)} role`}
                            onClick={() => revoke.mutate({ userId: u.id, developmentId: r.developmentId, roleName: r.roleName })}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setGranting(u)}>Add role</Button>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Panel>
      {granting && <GrantDialog user={granting} onClose={() => setGranting(null)} />}
    </>
  );
}

function GrantDialog({ user, onClose }: { user: UserAdminDto; onClose: () => void }) {
  const qc = useQueryClient();
  const devs = useDevelopments();
  const [developmentId, setDevelopmentId] = useState("");
  const [roleName, setRoleName] = useState("property_manager");
  const platform = developmentId === "__platform";
  const m = useMutation({
    mutationFn: () => api(`/api/users/${encodeURIComponent(user.id)}/roles`, { method: "POST", json: { developmentId: platform ? null : developmentId, roleName: platform ? "admin" : roleName } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add a role for ${personName(user)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!developmentId} onClick={() => m.mutate()}>Add role</Button></>}
    >
      <div className="space-y-4">
        <Field label="Where">
          {(id) => (
            <Select id={id} value={developmentId} onChange={(e) => setDevelopmentId(e.target.value)}>
              <option value="">Choose…</option>
              <option value="__platform">Everywhere (platform admin)</option>
              {devs.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        {!platform && (
          <Field label="Role" hint={roleName === "tenant" ? "Tenants also need a unit. Use an invite from the unit instead." : undefined}>
            {(id) => (
              <Select id={id} value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                {SYSTEM_ROLE_NAMES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            )}
          </Field>
        )}
        {platform && <Pill tint="amber">Platform admins can see and change everything, including approving costs.</Pill>}
        {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
      </div>
    </Dialog>
  );
}
