import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, FileUp, MailPlus, Pencil, Plus, Search, UserMinus } from "lucide-react";
import {
  CURRENCY_META,
  PERMISSIONS,
  ROLE_LABEL,
  SUPPORTED_CURRENCIES,
  type DevelopmentDto,
  type InviteDto,
  type SystemRoleName,
  type UnitDto,
} from "@easytenant/shared";
import { api, errorMessage, qs } from "../../lib/api";
import { useDebounced, usePaged } from "../../lib/hooks";
import { parseCsv } from "../../lib/csv";
import { formatDate, personName } from "../../lib/format";
import { Button, ButtonLink, EmptyState, ErrorNote, Field, Input, LoadMore, PageHeader, Panel, PanelTitle, Pill, Select, Spinner, Stat, Tabs, UnitPlate } from "../../components/ui";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";

type Tab = "units" | "invites" | "settings";

export default function DevelopmentDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "units";
  const dev = useQuery({ queryKey: ["development", id], queryFn: () => api<DevelopmentDto>(`/api/developments/${id}`) });
  if (dev.isPending) return <Spinner />;
  if (dev.error) return <ErrorNote>{dev.error.message}</ErrorNote>;
  const d = dev.data;
  const can = (p: string) => d.myPermissions.includes(p as never);
  const tabs: { value: Tab; label: string }[] = [
    { value: "units", label: "Units" },
    ...(can(PERMISSIONS.TENANT_INVITE) ? [{ value: "invites" as const, label: "Invites" }] : []),
    ...(can(PERMISSIONS.DEVELOPMENT_MANAGE) ? [{ value: "settings" as const, label: "Settings" }] : []),
  ];

  return (
    <>
      <PageHeader
        back={<Link to="/developments" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Developments</Link>}
        title={d.name}
        description={d.address}
        actions={<ButtonLink to={`/faults?developmentId=${d.id}`}>View faults</ButtonLink>}
      />
      {d.stats && (
        <Panel className="mb-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            <Stat label="Units" value={d.stats.units} />
            <Stat label="Let" value={d.stats.occupied} />
            <Stat label="Invited" value={d.stats.invited} />
            <Stat label="Vacant" value={d.stats.vacant} />
            <Stat label="Open faults" value={d.stats.openFaults} />
          </div>
        </Panel>
      )}
      <div className="mb-5">
        <Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={tabs} />
      </div>
      {tab === "units" && <UnitsTab dev={d} />}
      {tab === "invites" && <InvitesTab dev={d} />}
      {tab === "settings" && <SettingsTab dev={d} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function UnitsTab({ dev }: { dev: DevelopmentDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const path = `/api/developments/${dev.id}/units${qs({ q, limit: 50 })}`;
  const list = usePaged<UnitDto>(["units", path], path);
  const [editing, setEditing] = useState<UnitDto | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [inviteFor, setInviteFor] = useState<UnitDto | null>(null);
  const [ending, setEnding] = useState<UnitDto | null>(null);
  const canManage = dev.myPermissions.includes(PERMISSIONS.DEVELOPMENT_MANAGE);
  const canInvite = dev.myPermissions.includes(PERMISSIONS.TENANT_INVITE);
  const canRemove = dev.myPermissions.includes(PERMISSIONS.TENANT_REMOVE);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["units"] });
    void qc.invalidateQueries({ queryKey: ["development", dev.id] });
  };
  const end = useMutation({
    mutationFn: (tenancyId: string) => api(`/api/tenancies/${tenancyId}/end`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Tenancy ended. The unit is vacant.");
      setEnding(null);
      refresh();
    },
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input className="pl-9" placeholder="Search unit number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search units" />
        </div>
        {canManage && (
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add unit</Button>
          </>
        )}
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : !list.items.length ? (
          <EmptyState title={q ? "No units match" : "No units yet"} action={canManage && !q && <Button variant="primary" onClick={() => setImporting(true)}>Import from a spreadsheet</Button>}>
            {q ? "Check the unit number." : "Add units one at a time, or import a CSV with a unitNumber column."}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line-2">
              {list.items.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <UnitPlate>{u.unitNumber}</UnitPlate>
                  <div className="min-w-0 flex-1">
                    {u.occupancy === "occupied" && u.tenant ? (
                      <>
                        <div className="truncate font-medium">{personName(u.tenant)}</div>
                        <div className="truncate text-[13px] text-ink-3">{u.type}, since {formatDate(u.tenant.since)}</div>
                      </>
                    ) : u.occupancy === "invited" && u.pendingInvite ? (
                      <>
                        <div className="truncate font-medium text-ink-2">Invite sent to {u.pendingInvite.email}</div>
                        <div className="text-[13px] text-ink-3">Expires {formatDate(u.pendingInvite.expiresAt)}</div>
                      </>
                    ) : (
                      <div className="capitalize text-ink-3">{u.type}</div>
                    )}
                  </div>
                  {u.ownerName || u.ownerEmail ? <div className="hidden min-w-0 max-w-48 text-[13px] text-ink-3 lg:block"><span className="block truncate">Owner: {u.ownerName || u.ownerEmail}</span></div> : null}
                  <Pill tint={u.occupancy === "occupied" ? "primary" : u.occupancy === "invited" ? "sky" : "neutral"}>
                    {u.occupancy === "occupied" ? "Let" : u.occupancy === "invited" ? "Invited" : "Vacant"}
                  </Pill>
                  <div className="flex gap-1">
                    {u.occupancy === "vacant" && canInvite && <Button size="sm" icon={<MailPlus className="size-3.5" />} onClick={() => setInviteFor(u)}>Invite tenant</Button>}
                    {u.occupancy === "occupied" && canRemove && <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => setEnding(u)}>End tenancy</Button>}
                    {canManage && <Button size="sm" variant="ghost" aria-label={`Edit unit ${u.unitNumber}`} onClick={() => setEditing(u)}><Pencil className="size-3.5" /></Button>}
                  </div>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Panel>

      {editing && <UnitDialog dev={dev} unit={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {importing && <ImportDialog dev={dev} onClose={() => setImporting(false)} onDone={refresh} />}
      {inviteFor && <InviteDialog dev={dev} unit={inviteFor} onClose={() => setInviteFor(null)} onDone={refresh} />}
      <Dialog
        open={Boolean(ending)}
        onClose={() => setEnding(null)}
        title={`End the tenancy at unit ${ending?.unitNumber ?? ""}?`}
        description={`${personName(ending?.tenant)} will lose access to this unit. Their past faults stay on record.`}
        footer={<><Button onClick={() => setEnding(null)}>Keep tenancy</Button><Button variant="danger" loading={end.isPending} onClick={() => ending?.tenant && end.mutate(ending.tenant.tenancyId)}>End tenancy</Button></>}
      >
        {end.error ? <ErrorNote>{errorMessage(end.error)}</ErrorNote> : <p className="text-sm text-ink-2">Use this when someone moves out. You can invite a new tenant straight after.</p>}
      </Dialog>
    </>
  );
}

function UnitDialog({ dev, unit, onClose, onSaved }: { dev: DevelopmentDto; unit: UnitDto | null; onClose: () => void; onSaved: () => void }) {
  const [unitNumber, setUnitNumber] = useState(unit?.unitNumber ?? "");
  const [type, setType] = useState(unit?.type ?? "flat");
  const [ownerName, setOwnerName] = useState(unit?.ownerName ?? "");
  const [ownerEmail, setOwnerEmail] = useState(unit?.ownerEmail ?? "");
  const m = useMutation({
    mutationFn: () =>
      unit
        ? api(`/api/units/${unit.id}`, { method: "PATCH", json: { unitNumber, type, ownerName: ownerName || null, ownerEmail: ownerEmail || null } })
        : api(`/api/developments/${dev.id}/units`, { method: "POST", json: { unitNumber, type, ownerName, ownerEmail } }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={unit ? `Edit unit ${unit.unitNumber}` : "Add a unit"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!unitNumber.trim()} onClick={() => m.mutate()}>{unit ? "Save changes" : "Add unit"}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit number">{(id) => <Input id={id} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} autoFocus />}</Field>
          <Field label="Type">{(id) => <Input id={id} value={type} onChange={(e) => setType(e.target.value)} placeholder="flat, duplex, shop" />}</Field>
        </div>
        <Field label="Owner's name" optional>{(id) => <Input id={id} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />}</Field>
        <Field label="Owner's email" optional hint="The owner is emailed when a repair on this unit is closed.">
          {(id) => <Input id={id} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />}
        </Field>
        {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
      </div>
    </Dialog>
  );
}

function ImportDialog({ dev, onClose, onDone }: { dev: DevelopmentDto; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: string[]; invalid: string[] } | null>(null);
  const units = (rows ?? []).map((r) => ({
    unitNumber: r["unitnumber"] ?? r["unit number"] ?? r["unit"] ?? "",
    type: r["type"] || undefined,
    ownerName: r["ownername"] ?? r["owner name"] ?? undefined,
    ownerEmail: r["owneremail"] ?? r["owner email"] ?? undefined,
  })).filter((u) => u.unitNumber.trim());
  const m = useMutation({
    mutationFn: () => api<{ inserted: number; skipped: string[]; invalid: string[] }>(`/api/developments/${dev.id}/units/bulk`, { method: "POST", json: { units } }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import units from CSV"
      description={<>Columns: <code>unitNumber</code>, and optionally <code>type</code>, <code>ownerName</code>, <code>ownerEmail</code>. Existing unit numbers are skipped.</>}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!units.length} onClick={() => m.mutate()}>Import {units.length || ""} unit{units.length === 1 ? "" : "s"}</Button></>}
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <p><span className="font-semibold">{result.inserted}</span> unit{result.inserted === 1 ? "" : "s"} added.</p>
          {result.skipped.length > 0 && <p className="text-ink-2">Skipped (already exist): {result.skipped.slice(0, 20).join(", ")}{result.skipped.length > 20 ? "…" : ""}</p>}
          {result.invalid.length > 0 && <p className="text-brick">Not imported, owner email invalid: {result.invalid.join(", ")}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-2 file:font-semibold"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const parsed = parseCsv(await f.text());
              if (!parsed.length || !Object.keys(parsed[0]!).some((k) => ["unitnumber", "unit number", "unit"].includes(k))) {
                setFileError("Couldn't find a unitNumber column in that file.");
                setRows(null);
              } else {
                setFileError(null);
                setRows(parsed);
              }
            }}
          />
          {fileError && <ErrorNote>{fileError}</ErrorNote>}
          {units.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {units.slice(0, 40).map((u, i) => <UnitPlate key={i} size="sm">{u.unitNumber}</UnitPlate>)}
              {units.length > 40 && <span className="self-center text-[13px] text-ink-3">and {units.length - 40} more</span>}
            </div>
          )}
          {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

function InviteDialog({ dev, unit, onClose, onDone }: { dev: DevelopmentDto; unit: UnitDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const canManageRoles = dev.myPermissions.includes(PERMISSIONS.ROLE_MANAGE);
  const [role, setRole] = useState<SystemRoleName>(unit ? "tenant" : "service_personnel");
  const [unitId, setUnitId] = useState(unit?.id ?? "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<InviteDto | null>(null);
  const vacant = useQuery({
    queryKey: ["units", dev.id, "vacant-picker"],
    enabled: role === "tenant" && !unit,
    queryFn: () => api<{ items: UnitDto[] }>(`/api/developments/${dev.id}/units?limit=100`),
    select: (p) => p.items.filter((u) => u.occupancy === "vacant"),
  });
  const m = useMutation({
    mutationFn: () => api<InviteDto>("/api/invites", { method: "POST", json: { developmentId: dev.id, role, unitId: role === "tenant" ? unitId : undefined, inviteeEmail: email, inviteeName: name || undefined } }),
    onSuccess: (inv) => {
      setCreated(inv);
      onDone();
    },
  });
  const roles: SystemRoleName[] = ["tenant", "service_personnel", ...(canManageRoles ? (["property_manager"] as const) : [])];
  return (
    <Dialog
      open
      onClose={onClose}
      title={created ? "Invite sent" : unit ? `Invite a tenant to unit ${unit.unitNumber}` : "Invite someone"}
      footer={created ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!email.trim() || (role === "tenant" && !unitId)} onClick={() => m.mutate()}>Send invite</Button></>}
    >
      {created ? (
        <div className="space-y-3 text-sm">
          <p>We emailed {created.inviteeEmail} a link. It works only for that address and expires on {formatDate(created.expiresAt)}.</p>
          <p className="text-ink-2">If the email doesn't arrive, share this link directly:</p>
          <div className="flex gap-2">
            <Input readOnly value={created.url ?? ""} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <Button icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(created.url ?? ""); toast.success("Link copied."); }}>Copy</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!unit && (
            <Field label="Role">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value as SystemRoleName)}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
              )}
            </Field>
          )}
          {role === "tenant" && !unit && (
            <Field label="Unit" hint={vacant.data && !vacant.data.length ? "No vacant units. End a tenancy first." : undefined}>
              {(id) => (
                <Select id={id} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">Choose a vacant unit</option>
                  {vacant.data?.map((u) => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Their email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
          <Field label="Their name" optional>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
        </div>
      )}
    </Dialog>
  );
}

function InvitesTab({ dev }: { dev: DevelopmentDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const path = `/api/developments/${dev.id}/invites?limit=25`;
  const list = usePaged<InviteDto>(["invites", path], path);
  const act = useMutation({
    mutationFn: ({ id, op }: { id: string; op: "revoke" | "resend" }) => api(`/api/invites/${id}/${op}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast.success(v.op === "revoke" ? "Invite cancelled." : "Invite re-sent and extended by 14 days.");
      void qc.invalidateQueries({ queryKey: ["invites"] });
      void qc.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const tint = { pending: "sky", used: "moss", revoked: "neutral", expired: "amber" } as const;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon={<MailPlus className="size-4" />} onClick={() => setCreating(true)}>Invite someone</Button>
      </div>
      <Panel padded={false}>
        {list.isPending ? <Spinner /> : !list.items.length ? (
          <EmptyState title="No invites yet">Invite tenants from a vacant unit, or invite technicians here.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line-2">
              {list.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.inviteeName ? `${i.inviteeName} (${i.inviteeEmail})` : i.inviteeEmail}</div>
                    <div className="text-[13px] text-ink-3">
                      {ROLE_LABEL[i.role]}{i.unit ? `, unit ${i.unit.unitNumber}` : ""}. Sent {formatDate(i.createdAt)} by {personName(i.createdBy)}
                    </div>
                  </div>
                  <Pill tint={tint[i.status]}>{i.status === "used" ? "Accepted" : i.status.charAt(0).toUpperCase() + i.status.slice(1)}</Pill>
                  {(i.status === "pending" || i.status === "expired") && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: i.id, op: "resend" })}>Re-send</Button>
                      {i.status === "pending" && <Button size="sm" variant="ghost" className="text-brick" onClick={() => act.mutate({ id: i.id, op: "revoke" })}>Cancel</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Panel>
      {creating && <InviteDialog dev={dev} unit={null} onClose={() => setCreating(false)} onDone={() => void qc.invalidateQueries({ queryKey: ["invites"] })} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsTab({ dev }: { dev: DevelopmentDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(dev.name);
  const [address, setAddress] = useState(dev.address);
  const [overdue, setOverdue] = useState(dev.overdueDays ? String(dev.overdueDays) : "");
  const [currency, setCurrency] = useState(dev.currency ?? "");
  const m = useMutation({
    mutationFn: () =>
      api<DevelopmentDto>(`/api/developments/${dev.id}`, {
        method: "PATCH",
        json: { name, address, overdueDays: overdue ? Number(overdue) : null, currency: currency || null },
      }),
    onSuccess: (d) => {
      qc.setQueryData(["development", dev.id], { ...dev, ...d, stats: dev.stats });
      void qc.invalidateQueries({ queryKey: ["developments"] });
      toast.success("Settings saved.");
    },
  });
  return (
    <Panel className="max-w-2xl">
      <PanelTitle>Development settings</PanelTitle>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Address">{(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Overdue after (days)" hint={`Blank uses the platform default (${dev.effectiveOverdueDays} days).`}>
            {(id) => <Input id={id} type="number" min={1} max={365} className="tabular" value={overdue} onChange={(e) => setOverdue(e.target.value)} placeholder={String(dev.effectiveOverdueDays)} />}
          </Field>
          <Field label="Currency for costs">
            {(id) => (
              <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">Platform default ({dev.effectiveCurrency})</option>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_META[c].symbol} {CURRENCY_META[c].label}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
        <Button type="submit" variant="primary" loading={m.isPending}>Save settings</Button>
      </form>
    </Panel>
  );
}
