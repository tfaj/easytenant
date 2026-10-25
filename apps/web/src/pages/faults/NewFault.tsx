import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FAULT_CATEGORIES,
  PERMISSIONS,
  PRIORITIES,
  type FaultDetailDto,
  type Page,
  type TenancyDto,
  type UnitDto,
} from "@easytenant/shared";
import { useAuth } from "../../auth/AuthProvider";
import { api, errorMessage } from "../../lib/api";
import { useDebounced, useDevelopments } from "../../lib/hooks";
import { titleCase } from "../../lib/format";
import { AttachmentPicker, useAttachments } from "../../components/AttachmentPicker";
import { Button, ErrorNote, Field, Input, PageHeader, Panel, Select, Spinner, Textarea, UnitPlate, cx } from "../../components/ui";
import { useToast } from "../../components/Toast";

const PRIORITY_HELP: Record<string, string> = {
  low: "Can wait a week or two",
  medium: "Needs fixing soon",
  high: "Affecting daily life",
  urgent: "Danger, flooding, no power or water",
};

export default function NewFault() {
  const { caps } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const homes = useQuery({ queryKey: ["tenancies", "mine"], queryFn: () => api<TenancyDto[]>("/api/tenancies/mine"), enabled: caps.tenant });
  const devs = useDevelopments();
  const managedDevs = useMemo(() => (devs.data ?? []).filter((d) => d.myPermissions.includes(PERMISSIONS.ISSUE_VIEW_ALL)), [devs.data]);

  const [developmentId, setDevelopmentId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("plumbing");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("reactive");
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A tenant with one home doesn't have to pick anything.
  useEffect(() => {
    if (!developmentId && homes.data?.length === 1 && !caps.manager) {
      setDevelopmentId(homes.data[0]!.development.id);
      setUnitId(homes.data[0]!.unit.id);
    }
  }, [homes.data, developmentId, caps.manager]);
  useEffect(() => {
    if (!developmentId && caps.manager && managedDevs.length === 1) setDevelopmentId(managedDevs[0]!.id);
  }, [managedDevs, developmentId, caps.manager]);

  const isManagerHere = managedDevs.some((d) => d.id === developmentId);
  const q = useDebounced(unitSearch.trim());
  const units = useQuery({
    queryKey: ["units", developmentId, q],
    enabled: Boolean(developmentId) && isManagerHere,
    queryFn: () => api<Page<UnitDto>>(`/api/developments/${developmentId}/units?limit=60${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const files = useAttachments(developmentId || undefined);

  const create = useMutation({
    mutationFn: () =>
      api<FaultDetailDto>("/api/faults", {
        method: "POST",
        json: {
          developmentId,
          unitId,
          title,
          description,
          category,
          priority,
          type,
          ...(type !== "reactive" && scheduledDate ? { scheduledDate: new Date(scheduledDate).toISOString() } : {}),
          attachments: files.ready,
        },
      }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ["faults"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Fault reported. We'll keep you posted.");
      navigate(`/faults/${f.id}`, { replace: true });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if ((caps.tenant && homes.isPending) || devs.isPending) return <Spinner />;

  const homeChoices = homes.data ?? [];
  const needsPicker = caps.manager || homeChoices.length > 1;

  return (
    <>
      <PageHeader title={caps.manager ? "Log a fault" : "Report a fault"} description="Describe what's wrong. Photos help the technician come prepared." />
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!unitId) return setError("Choose the unit this fault is in.");
          create.mutate();
        }}
      >
        <div className="space-y-6">
          {needsPicker && (
            <Panel>
              <h2 className="mb-4 font-semibold">Where</h2>
              <div className="space-y-4">
                {homeChoices.length > 0 && !caps.manager ? (
                  <div className="flex flex-wrap gap-2">
                    {homeChoices.map((h) => (
                      <button
                        type="button"
                        key={h.id}
                        onClick={() => { setDevelopmentId(h.development.id); setUnitId(h.unit.id); }}
                        className={cx("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left", unitId === h.unit.id ? "border-primary bg-primary-soft" : "border-line hover:bg-sunken")}
                      >
                        <UnitPlate size="sm">{h.unit.unitNumber}</UnitPlate>
                        <span className="text-sm font-medium">{h.development.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {managedDevs.length > 1 && (
                      <Field label="Development">
                        {(id) => (
                          <Select id={id} value={developmentId} onChange={(e) => { setDevelopmentId(e.target.value); setUnitId(""); files.reset(); }} required>
                            <option value="">Choose a development</option>
                            {managedDevs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </Select>
                        )}
                      </Field>
                    )}
                    {developmentId && (
                      <Field label="Unit">
                        {(id) => (
                          <div className="space-y-2">
                            <Input id={id} placeholder="Search unit number" value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} />
                            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                              {units.data?.items.map((u) => (
                                <button
                                  type="button"
                                  key={u.id}
                                  onClick={() => setUnitId(u.id)}
                                  className={cx("tabular h-8 min-w-11 rounded-[4px] border px-2 text-[13px] font-bold", unitId === u.id ? "border-primary bg-primary text-primary-ink" : "border-line bg-panel hover:border-ink/30")}
                                  aria-pressed={unitId === u.id}
                                >
                                  {u.unitNumber}
                                </button>
                              ))}
                              {units.data && !units.data.items.length && <p className="text-sm text-ink-3">No units match. Add units on the development page.</p>}
                            </div>
                          </div>
                        )}
                      </Field>
                    )}
                  </>
                )}
              </div>
            </Panel>
          )}

          <Panel>
            <h2 className="mb-4 font-semibold">What's wrong</h2>
            <div className="space-y-4">
              <Field label="Short title" hint="For example: Kitchen tap leaking under the sink">
                {(id) => <Input id={id} required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              <Field label="Category">
                {(id) => (
                  <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {FAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c === "hvac" ? "Air conditioning / ventilation" : titleCase(c)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Details" optional hint="When did it start? Is it getting worse? When can someone get in?">
                {(id) => <Textarea id={id} rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />}
              </Field>
              <div>
                <div className="mb-1.5 text-[13px] font-semibold">Photos or video <span className="font-normal text-ink-3">optional</span></div>
                <AttachmentPicker state={files} disabled={!developmentId} />
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <h2 className="mb-3 font-semibold">How urgent</h2>
            <div className="space-y-2" role="radiogroup" aria-label="Urgency">
              {PRIORITIES.map((p) => (
                <label key={p} className={cx("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5", priority === p ? "border-primary bg-primary-soft" : "border-line hover:bg-sunken")}>
                  <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="mt-1 accent-[var(--primary)]" />
                  <span>
                    <span className="block text-sm font-semibold">{titleCase(p)}</span>
                    <span className="block text-[13px] text-ink-2">{PRIORITY_HELP[p]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Panel>

          {isManagerHere && (
            <Panel>
              <h2 className="mb-3 font-semibold">Planned work</h2>
              <div className="space-y-4">
                <Field label="Type">
                  {(id) => (
                    <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                      <option value="reactive">Reported fault</option>
                      <option value="mandatory">Mandatory maintenance</option>
                      <option value="optional">Optional maintenance</option>
                    </Select>
                  )}
                </Field>
                {type !== "reactive" && (
                  <Field label="Scheduled for" optional>
                    {(id) => <Input id={id} type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />}
                  </Field>
                )}
              </div>
            </Panel>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="w-full" loading={create.isPending} disabled={files.busy}>
            {files.busy ? "Uploading photos…" : caps.manager ? "Log fault" : "Report fault"}
          </Button>
        </div>
      </form>
    </>
  );
}
