import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ClipboardList, KeyRound, PlusCircle, Wrench } from "lucide-react";
import { FAULT_STAGES, STAGE_LABEL, type DashboardSummaryDto, type FaultSummaryDto, type Page, type TenancyDto } from "@easytenant/shared";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";
import { ButtonLink, EmptyState, ErrorNote, PageHeader, Panel, PanelTitle, Spinner, Stat, UnitPlate, cx } from "../components/ui";
import { FaultList } from "../components/FaultList";

export default function Home() {
  const { caps } = useAuth();
  if (caps.manager) return <ManagerOverview />;
  if (caps.technician) return <TechnicianHome />;
  if (caps.tenant) return <TenantHome />;
  return <NoAccess />;
}

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

function ManagerOverview() {
  const { me } = useAuth();
  const { data, isPending, error } = useQuery({ queryKey: ["summary"], queryFn: () => api<DashboardSummaryDto>("/api/developments/summary") });
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote>{error.message}</ErrorNote>;

  const open = FAULT_STAGES.filter((s) => s !== "closed").map((s) => ({ stage: s, n: data.faultsByStatus[s] ?? 0 }));
  const maxN = Math.max(1, ...open.map((o) => o.n));

  return (
    <>
      <PageHeader title={greeting(me?.name)} description={`${data.developments} development${data.developments === 1 ? "" : "s"} in your care.`} />

      <Panel className="mb-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
          <Stat label="Open faults" value={data.openFaults} />
          <Stat label="Overdue" value={data.overdueFaults} tone={data.overdueFaults ? "brick" : undefined} hint="Past each development's limit" />
          <Stat label="Awaiting cost approval" value={data.awaitingApproval} tone={data.awaitingApproval ? "amber" : undefined} />
          <Stat label="Units" value={data.units} />
          <Stat label="Occupancy" value={`${data.occupancyPct}%`} hint={`${data.occupied} of ${data.units} let`} />
        </div>
      </Panel>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel padded={false}>
          <div className="px-5 pt-5">
            <PanelTitle action={<Link to="/faults" className="text-[13px] font-semibold text-primary hover:underline">All faults</Link>}>Latest faults</PanelTitle>
          </div>
          {data.recentFaults.length ? (
            <FaultList items={data.recentFaults} />
          ) : (
            <EmptyState icon={<ClipboardList className="size-5" />} title="No faults yet">When tenants report something, it shows up here.</EmptyState>
          )}
        </Panel>

        <Panel>
          <PanelTitle>Where open faults are</PanelTitle>
          <ol className="space-y-2.5">
            {open.map((o, i) => (
              <li key={o.stage}>
                <Link to={`/faults?status=${o.stage}`} className="group grid grid-cols-[22px_1fr_auto] items-center gap-3">
                  <span className="tabular text-[12px] font-bold text-ink-3">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink-2 group-hover:text-ink">{STAGE_LABEL[o.stage]}</span>
                    <span className="mt-1 block h-1.5 rounded-full bg-sunken">
                      <span
                        className={cx("block h-full rounded-full", o.stage === "awaiting_cost_approval" ? "bg-amber" : "bg-primary")}
                        style={{ width: `${(o.n / maxN) * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className="tabular w-6 text-right text-sm font-semibold">{o.n}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

function TenantHome() {
  const { me } = useAuth();
  const homes = useQuery({ queryKey: ["tenancies", "mine"], queryFn: () => api<TenancyDto[]>("/api/tenancies/mine") });
  const faults = useQuery({ queryKey: ["faults", "mine", "open"], queryFn: () => api<Page<FaultSummaryDto>>("/api/faults?scope=mine&open=1&limit=10") });
  return (
    <>
      <PageHeader
        title={greeting(me?.name)}
        description={homes.data?.length ? "Something not working? Report it and follow the repair here." : undefined}
        actions={<ButtonLink to="/faults/new" variant="primary" icon={<PlusCircle className="size-4" />}>Report a fault</ButtonLink>}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        {homes.data?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <UnitPlate>{t.unit.unitNumber}</UnitPlate>
            <div className="text-sm">
              <div className="font-semibold">{t.development.name}</div>
              <div className="text-ink-3">Your home</div>
            </div>
          </div>
        ))}
      </div>
      <Panel padded={false}>
        <div className="px-5 pt-5"><PanelTitle action={<Link to="/faults" className="text-[13px] font-semibold text-primary hover:underline">History</Link>}>Open faults</PanelTitle></div>
        {faults.isPending ? <Spinner /> : faults.data?.items.length ? <FaultList items={faults.data.items} showDevelopment={false} /> : (
          <EmptyState icon={<KeyRound className="size-5" />} title="Nothing open">Everything at home is working. If that changes, report it here.</EmptyState>
        )}
      </Panel>
    </>
  );
}

function TechnicianHome() {
  const { me } = useAuth();
  const jobs = useQuery({ queryKey: ["faults", "assigned", "open"], queryFn: () => api<Page<FaultSummaryDto>>("/api/faults?scope=assigned&open=1&limit=25") });
  const items = jobs.data?.items ?? [];
  const needsMe = items.filter((f) => ["technician_assigned", "inspection", "repair_in_progress"].includes(f.status));
  return (
    <>
      <PageHeader title={greeting(me?.name)} description={jobs.data ? `${needsMe.length} job${needsMe.length === 1 ? "" : "s"} waiting on you.` : undefined} />
      <Panel padded={false}>
        <div className="px-5 pt-5"><PanelTitle>Your open jobs</PanelTitle></div>
        {jobs.isPending ? <Spinner /> : items.length ? <FaultList items={items} /> : (
          <EmptyState icon={<Wrench className="size-5" />} title="No jobs assigned">New jobs appear here, and you'll get an email too.</EmptyState>
        )}
      </Panel>
    </>
  );
}

function NoAccess() {
  const { me } = useAuth();
  return (
    <Panel>
      <EmptyState icon={<KeyRound className="size-5" />} title="You're signed in, but not part of a development yet">
        Ask your property manager to send an invite to <strong className="text-ink">{me?.email}</strong>. When you open the link, you'll get access.
      </EmptyState>
    </Panel>
  );
}
