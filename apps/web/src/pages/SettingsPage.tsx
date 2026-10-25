import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NOTIFICATION_EVENT_LABEL, type NotificationEvent } from "@easytenant/shared";
import { useAuth } from "../auth/AuthProvider";
import { api, errorMessage } from "../lib/api";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Button, ErrorNote, Field, Input, PageHeader, Panel, PanelTitle, Spinner, cx } from "../components/ui";
import { useToast } from "../components/Toast";

export default function SettingsPage() {
  const { me, refreshMe } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const save = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", json: { name, phone } }),
    onSuccess: async () => {
      await refreshMe();
      toast.success("Profile saved.");
    },
  });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <Panel>
          <PanelTitle>Profile</PanelTitle>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
              <Field label="Phone" optional hint="Shown to your property manager.">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}</Field>
            </div>
            <Field label="Email" hint="Your sign-in address. It can't be changed here.">{(id) => <Input id={id} value={me?.email ?? ""} disabled />}</Field>
            {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
            <Button type="submit" variant="primary" loading={save.isPending}>Save profile</Button>
          </form>
        </Panel>
        <EmailPreferences />
        <Appearance />
      </div>
    </>
  );
}

function EmailPreferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => api<{ eventType: NotificationEvent; email: boolean }[]>("/api/notifications/preferences") });
  const set = useMutation({
    mutationFn: (v: { eventType: NotificationEvent; email: boolean }) => api("/api/notifications/preferences", { method: "PUT", json: v }),
    onMutate: (v) => qc.setQueryData(["prefs"], (old: typeof prefs.data) => old?.map((p) => (p.eventType === v.eventType ? v : p))),
    onError: () => void qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  return (
    <Panel>
      <PanelTitle>Email me when</PanelTitle>
      <p className="-mt-2 mb-4 text-sm text-ink-2">You'll always see these in the app. Turn off the ones you don't want in your inbox.</p>
      {prefs.isPending ? <Spinner /> : (
        <ul className="divide-y divide-line-2">
          {prefs.data?.map((p) => (
            <li key={p.eventType} className="flex items-center justify-between gap-4 py-3">
              <span className="text-sm">{NOTIFICATION_EVENT_LABEL[p.eventType]}</span>
              <button
                role="switch"
                aria-checked={p.email}
                aria-label={NOTIFICATION_EVENT_LABEL[p.eventType]}
                onClick={() => set.mutate({ eventType: p.eventType, email: !p.email })}
                className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors", p.email ? "bg-primary" : "bg-line")}
              >
                <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]", p.email ? "left-[18px]" : "left-0.5")} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Appearance() {
  const [choice, setChoice] = useTheme();
  const opts: { v: ThemeChoice; label: string }[] = [
    { v: "auto", label: "Match my device" },
    { v: "light", label: "Light" },
    { v: "dark", label: "Dark" },
  ];
  return (
    <Panel>
      <PanelTitle>Appearance</PanelTitle>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
        {opts.map((o) => (
          <button key={o.v} role="radio" aria-checked={choice === o.v} onClick={() => setChoice(o.v)}
            className={cx("rounded-md border px-4 py-2 text-sm font-medium", choice === o.v ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-sunken")}>
            {o.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}
