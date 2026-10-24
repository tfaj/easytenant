import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Film, Send } from "lucide-react";
import {
  CURRENCY_META,
  formatMoney,
  getTransition,
  PRIORITIES,
  STAGE_HINT,
  STAGE_LABEL,
  type AttachmentDto,
  type FaultDetailDto,
  type FaultStatus,
  type TransitionId,
  type UserSummary,
} from "@easytenant/shared";
import { api, errorMessage } from "../../lib/api";
import { formatDate, personName, timeAgo, titleCase } from "../../lib/format";
import { useAuth } from "../../auth/AuthProvider";
import { AttachmentPicker, useAttachments } from "../../components/AttachmentPicker";
import { PriorityPill, StageTrack, ToneBadge } from "../../components/FaultBits";
import { Avatar, Button, ErrorNote, Field, Input, Panel, PanelTitle, Pill, Select, Spinner, Textarea, UnitPlate, cx } from "../../components/ui";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";

export default function FaultDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["fault", id], queryFn: () => api<FaultDetailDto>(`/api/faults/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorNote>{q.error.message}</ErrorNote>;
  const f = q.data;

  const times: Partial<Record<FaultStatus, string>> = {};
  for (const a of f.activity) if (a.statusChangeTo) times[a.statusChangeTo] = a.createdAt;
  times.logged ??= f.createdAt;

  return (
    <>
      <Link to="/faults" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Faults
      </Link>

      <header className="mb-6 flex flex-wrap items-start gap-4">
        <UnitPlate>{f.unit.unitNumber}</UnitPlate>
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.015em]">{f.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>{f.development.name}</span>
            <span className="text-ink-3">reported {timeAgo(f.createdAt)} by {personName(f.reporter)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ToneBadge status={f.status} createdAt={f.createdAt} overdueDays={f.development.overdueDays} />
            <PriorityPill priority={f.priority} />
            <Pill>{titleCase(f.category)}</Pill>
            {f.type !== "reactive" && <Pill tint="sky">{f.type === "mandatory" ? "Mandatory maintenance" : "Optional maintenance"}</Pill>}
          </div>
        </div>
      </header>

      <Panel className="mb-6">
        <StageTrack status={f.status} times={times} />
        <p className="mt-5 border-t border-line-2 pt-4 text-sm text-ink-2">
          <span className="font-semibold text-ink">{STAGE_LABEL[f.status]}.</span> {STAGE_HINT[f.status]}
        </p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {f.availableActions.filter((a) => a !== "cancel").length > 0 && <ActionPanel fault={f} />}
          {(f.description || f.attachments.length > 0) && (
            <Panel>
              <PanelTitle>Report</PanelTitle>
              {f.description && <p className="whitespace-pre-wrap leading-relaxed text-ink">{f.description}</p>}
              {f.attachments.length > 0 && <Gallery items={f.attachments} className={f.description ? "mt-4" : ""} />}
            </Panel>
          )}
          <Activity fault={f} />
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelTitle>Details</PanelTitle>
            <dl className="space-y-3 text-sm">
              <Row label="Assigned to">{f.assignees.length ? <People list={f.assignees} /> : <span className="text-ink-3">Nobody yet</span>}</Row>
              {f.scheduledDate && <Row label="Scheduled">{formatDate(f.scheduledDate, true)}</Row>}
              {f.vendorName && <Row label="Vendor">{f.vendorName}{f.vendorContact && <div className="text-ink-3">{f.vendorContact}</div>}</Row>}
              {f.agreedCost !== null && <Row label="Agreed cost"><span className="tabular font-semibold">{formatMoney(f.agreedCost, f.development.currency)}</span></Row>}
              {f.costApprovedBy && <Row label="Approved by">{personName(f.costApprovedBy)}<div className="text-ink-3">{formatDate(f.costApprovedAt)}</div></Row>}
              {f.actualCost !== null && (
                <Row label="Final cost">
                  <span className="tabular font-semibold">{formatMoney(f.actualCost, f.development.currency)}</span>
                  {f.agreedCost !== null && f.actualCost !== f.agreedCost && (
                    <div className={cx("tabular text-[12px]", f.actualCost > f.agreedCost ? "text-brick" : "text-moss")}>
                      {f.actualCost > f.agreedCost ? "+" : "−"}{formatMoney(Math.abs(f.actualCost - f.agreedCost), f.development.currency)} against quote
                    </div>
                  )}
                </Row>
              )}
              {f.invoiceRef && <Row label="Invoice">{f.invoiceRef}</Row>}
              <Row label="Reported">{formatDate(f.createdAt, true)}</Row>
              {f.closedAt && <Row label="Closed">{formatDate(f.closedAt, true)}</Row>}
            </dl>
          </Panel>
          {f.availableActions.includes("cancel") && <CancelFault fault={f} />}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function People({ list }: { list: UserSummary[] }) {
  return (
    <ul className="space-y-1.5">
      {list.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <Avatar name={personName(p)} size={22} />
          <span className="truncate">{personName(p)}</span>
        </li>
      ))}
    </ul>
  );
}

function Gallery({ items, className }: { items: AttachmentDto[]; className?: string }) {
  return (
    <ul className={cx("grid grid-cols-3 gap-2 sm:grid-cols-4", className)}>
      {items.map((a) => (
        <li key={a.key}>
          <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md border border-line bg-sunken">
            {a.type === "video" || !a.url ? (
              <span className="grid h-full place-items-center text-ink-3"><Film className="size-6" aria-label="Video" /></span>
            ) : (
              <img src={a.url} alt={a.name ?? "Photo"} loading="lazy" className="h-full w-full object-cover" />
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function useTransition(fault: FaultDetailDto) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<FaultDetailDto>(`/api/faults/${fault.id}/transition`, { method: "POST", json: body }),
    onSuccess: (updated, body) => {
      qc.setQueryData(["fault", fault.id], updated);
      void qc.invalidateQueries({ queryKey: ["faults"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
      toast.success(`${getTransition(String(body.action))?.label ?? "Updated"}: done.`);
    },
  });
}

function ActionPanel({ fault }: { fault: FaultDetailDto }) {
  const actions = fault.availableActions.filter((a) => a !== "cancel");
  return (
    <Panel className="border-primary/40 bg-primary-soft/30">
      <PanelTitle>Your next step</PanelTitle>
      <div className="space-y-5">
        {actions.map((a) => <ActionForm key={a} fault={fault} action={a} />)}
      </div>
    </Panel>
  );
}

function ActionForm({ fault, action }: { fault: FaultDetailDto; action: TransitionId }) {
  const def = getTransition(action)!;
  const m = useTransition(fault);
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState(fault.priority);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [scheduled, setScheduled] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorContact, setVendorContact] = useState("");
  const [cost, setCost] = useState(action === "close" && fault.agreedCost !== null ? String(fault.agreedCost) : "");
  const [invoiceRef, setInvoiceRef] = useState("");
  const techs = useQuery({
    queryKey: ["technicians", fault.development.id],
    enabled: action === "assign",
    queryFn: () => api<UserSummary[]>(`/api/developments/${fault.development.id}/service-personnel`),
  });
  const symbol = CURRENCY_META[fault.development.currency].symbol;

  const submit = () => {
    const body: Record<string, unknown> = { action, ...(note.trim() ? { note: note.trim() } : {}) };
    if (action === "classify") body.priority = priority;
    if (action === "assign") Object.assign(body, { assignedTo: assignees, ...(scheduled ? { scheduledDate: new Date(scheduled).toISOString() } : {}) });
    if (action === "submit_quote") Object.assign(body, { vendorName, vendorContact: vendorContact || undefined, agreedCost: Number(cost) });
    if (action === "close") Object.assign(body, { actualCost: Number(cost), invoiceRef: invoiceRef || undefined });
    m.mutate(body);
  };

  const danger = def.tone === "danger";
  return (
    <form
      className={cx("space-y-3", danger && "border-t border-line pt-5")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {action === "classify" && (
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          )}
        </Field>
      )}
      {action === "assign" && (
        <>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold">Technicians</legend>
            {techs.isPending ? <p className="text-sm text-ink-3">Loading…</p> : techs.data?.length ? (
              <div className="flex flex-wrap gap-2">
                {techs.data.map((t) => {
                  const on = assignees.includes(t.id);
                  return (
                    <label key={t.id} className={cx("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", on ? "border-primary bg-panel" : "border-line bg-panel hover:bg-sunken")}>
                      <input type="checkbox" checked={on} onChange={() => setAssignees((xs) => (on ? xs.filter((x) => x !== t.id) : [...xs, t.id]))} className="accent-[var(--primary)]" />
                      {personName(t)}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-2">No service personnel in this development yet. Invite one from the development's Invites tab.</p>
            )}
          </fieldset>
          <Field label="Visit scheduled for" optional>{(id) => <Input id={id} type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />}</Field>
        </>
      )}
      {action === "submit_quote" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor">{(id) => <Input id={id} required value={vendorName} onChange={(e) => setVendorName(e.target.value)} />}</Field>
          <Field label="Vendor phone or email" optional>{(id) => <Input id={id} value={vendorContact} onChange={(e) => setVendorContact(e.target.value)} />}</Field>
          <Field label={`Agreed cost (${symbol})`}>{(id) => <Input id={id} required type="number" min={0} step="0.01" inputMode="decimal" className="tabular" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
      )}
      {action === "approve_cost" && fault.agreedCost !== null && (
        <p className="text-sm">
          <span className="tabular text-[20px] font-bold">{formatMoney(fault.agreedCost, fault.development.currency)}</span>
          <span className="ml-2 text-ink-2">quoted by {fault.vendorName}</span>
        </p>
      )}
      {action === "close" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Final cost (${symbol})`} hint={fault.agreedCost !== null ? `Quote was ${formatMoney(fault.agreedCost, fault.development.currency)}` : undefined}>
            {(id) => <Input id={id} required type="number" min={0} step="0.01" inputMode="decimal" className="tabular" value={cost} onChange={(e) => setCost(e.target.value)} />}
          </Field>
          <Field label="Invoice reference" optional>{(id) => <Input id={id} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />}</Field>
        </div>
      )}
      {(def.noteRequired || ["classify", "assign", "submit_quote", "close", "start_inspection", "complete_repair", "confirm_resolution"].includes(action)) && (
        <Field label={def.noteRequired ? (action === "reject_cost" ? "Why are you rejecting it?" : "Reason") : "Note"} optional={!def.noteRequired}>
          {(id) => <Textarea id={id} rows={2} className="min-h-0" required={def.noteRequired} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      )}
      {m.error && <ErrorNote>{errorMessage(m.error)}</ErrorNote>}
      <Button type="submit" variant={danger ? "danger" : "primary"} loading={m.isPending} disabled={action === "assign" && assignees.length === 0}>
        {def.label}
      </Button>
    </form>
  );
}

function CancelFault({ fault }: { fault: FaultDetailDto }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const m = useTransition(fault);
  return (
    <>
      <Button variant="ghost" size="sm" className="text-brick hover:text-brick" onClick={() => setOpen(true)}>
        Cancel this fault
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this fault?"
        description="It stops here and drops off everyone's list. The history is kept."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Keep it open</Button>
            <Button variant="danger" loading={m.isPending} disabled={!reason.trim()} onClick={() => m.mutate({ action: "cancel", note: reason.trim() }, { onSuccess: () => setOpen(false) })}>
              Cancel fault
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="For example: duplicate of another report, or the tenant fixed it.">
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error && <div className="mt-3"><ErrorNote>{errorMessage(m.error)}</ErrorNote></div>}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function Activity({ fault }: { fault: FaultDetailDto }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const files = useAttachments(fault.development.id);
  const post = useMutation({
    mutationFn: () => api<FaultDetailDto>(`/api/faults/${fault.id}/updates`, { method: "POST", json: { note: note.trim(), attachments: files.ready } }),
    onSuccess: (updated) => {
      qc.setQueryData(["fault", fault.id], updated);
      setNote("");
      files.reset();
    },
  });
  const items = [...fault.activity].reverse();
  return (
    <Panel>
      <PanelTitle>Activity</PanelTitle>
      {fault.canComment && (
        <form
          className="mb-6 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim() || files.ready.length) post.mutate();
          }}
        >
          <Avatar name={me?.name || me?.email || "?"} size={32} />
          <div className="min-w-0 flex-1 space-y-2">
            <Textarea rows={2} className="min-h-0" placeholder="Add an update, a question, or more photos" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Add an update" />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <AttachmentPicker state={files} />
              <Button type="submit" size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={post.isPending} disabled={files.busy || (!note.trim() && !files.ready.length)}>
                Post update
              </Button>
            </div>
            {post.error && <ErrorNote>{errorMessage(post.error)}</ErrorNote>}
          </div>
        </form>
      )}
      <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
        {items.map((a) => (
          <li key={a.id} className="relative flex gap-3">
            {a.statusChangeTo ? (
              <span className="relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border-2 border-primary bg-panel">
                <span className="size-2 rounded-full bg-primary" />
              </span>
            ) : (
              <span className="relative z-10"><Avatar name={personName(a.author)} size={32} /></span>
            )}
            <div className="min-w-0 flex-1 pt-1">
              <div className="text-sm">
                <span className="font-semibold">{personName(a.author)}</span>{" "}
                {a.statusChangeTo ? (
                  <span className="text-ink-2">
                    {a.statusChangeTo === "logged" ? "reported this fault" : <>moved it to <span className="font-semibold text-ink">{STAGE_LABEL[a.statusChangeTo]}</span></>}
                  </span>
                ) : (
                  <span className="text-ink-2">posted an update</span>
                )}
                <span className="ml-2 text-[12px] text-ink-3" title={formatDate(a.createdAt, true)}>{timeAgo(a.createdAt)}</span>
              </div>
              {a.note && <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-sm leading-relaxed">{a.note}</p>}
              {a.attachments.length > 0 && <Gallery items={a.attachments} className="mt-2" />}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
