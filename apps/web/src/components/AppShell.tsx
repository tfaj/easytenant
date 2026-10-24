import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ClipboardList,
  Home,
  LogOut,
  Monitor,
  Moon,
  PlusCircle,
  Settings,
  Sun,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { NotificationDto } from "@easytenant/shared";
import { useAuth, type Capabilities } from "../auth/AuthProvider";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Avatar, cx } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export function navFor(caps: Capabilities): NavItem[] {
  const items: NavItem[] = [];
  if (caps.manager) {
    items.push(
      { to: "/", label: "Overview", icon: Home, end: true },
      { to: "/faults", label: "Faults", icon: ClipboardList },
      { to: "/developments", label: "Developments", icon: Building2 },
      { to: "/tenants", label: "Tenants", icon: UserRound }
    );
  } else {
    items.push({ to: "/", label: "Home", icon: Home, end: true });
    if (caps.technician) items.push({ to: "/faults", label: "My jobs", icon: Wrench });
    else if (caps.tenant) items.push({ to: "/faults", label: "My faults", icon: ClipboardList });
    if (caps.tenant) items.push({ to: "/faults/new", label: "Report", icon: PlusCircle, end: true });
  }
  if (caps.platformAdmin) items.push({ to: "/people", label: "People", icon: Users });
  return items;
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img src="/logo-mark.svg" alt="" className="size-8" />
      <span className="text-[17px] font-bold tracking-[-0.01em] text-ink">EasyTenant</span>
    </Link>
  );
}

function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  const opts: { v: ThemeChoice; icon: LucideIcon; label: string }[] = [
    { v: "auto", icon: Monitor, label: "Match system" },
    { v: "light", icon: Sun, label: "Light" },
    { v: "dark", icon: Moon, label: "Dark" },
  ];
  return (
    <div className="flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={choice === o.v}
          title={o.label}
          onClick={() => setChoice(o.v)}
          className={cx("grid size-7 place-items-center rounded-[5px]", choice === o.v ? "bg-sunken text-ink" : "text-ink-3 hover:text-ink")}
        >
          <o.icon className="size-4" aria-hidden />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: NotificationDto[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="tabular absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brick px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_16px_48px_-16px_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between border-b border-line-2 px-4 py-3">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-[13px] font-semibold text-primary hover:underline" onClick={() => markAll.mutate()}>
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-10 text-center text-sm text-ink-3">You're all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={cx("flex w-full gap-3 border-b border-line-2 px-4 py-3 text-left hover:bg-sunken", !n.read && "bg-primary-soft/40")}
                  onClick={() => {
                    if (!n.read) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{n.body}</span>}
                    <span className="mt-1 block text-[12px] text-ink-3">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const name = me?.name || me?.email || "";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-full" aria-label="Account" aria-expanded={open}>
        <Avatar name={name} size={34} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-panel shadow-[0_16px_48px_-16px_rgba(0,0,0,.4)]">
          <div className="border-b border-line-2 px-4 py-3">
            <div className="truncate font-semibold">{me?.name || "Your account"}</div>
            <div className="truncate text-[13px] text-ink-2">{me?.email}</div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-ink-2">Theme</span>
            <ThemeSwitch />
          </div>
          <Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 border-t border-line-2 px-4 py-2.5 text-sm hover:bg-sunken">
            <Settings className="size-4 text-ink-3" /> Settings
          </Link>
          <button onClick={() => void signOut()} className="flex w-full items-center gap-2.5 border-t border-line-2 px-4 py-2.5 text-left text-sm hover:bg-sunken">
            <LogOut className="size-4 text-ink-3" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { caps, me } = useAuth();
  const items = navFor(caps);
  const location = useLocation();
  useEffect(() => window.scrollTo(0, 0), [location.pathname]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-panel md:flex">
        <div className="px-5 pb-6 pt-5">
          <Brand />
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors",
                  isActive ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-sunken hover:text-ink"
                )
              }
            >
              <it.icon className="size-[18px]" aria-hidden />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line-2 px-5 py-4 text-[12px] text-ink-3">
          {me?.roles.length ? (
            <span>
              {[...new Set(me.roles.map((r) => r.developmentName ?? "All developments"))].slice(0, 2).join(", ")}
              {new Set(me.roles.map((r) => r.developmentId)).size > 2 ? " and more" : ""}
            </span>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-page/90 px-4 backdrop-blur md:justify-end md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-6 md:px-8 md:pb-16 md:pt-8">{children ?? <Outlet />}</main>
      </div>

      {/* Phone tab bar: tenants and technicians mostly use the app here. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, minmax(0, 1fr))` }}
        aria-label="Main"
      >
        {items.slice(0, 5).map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", isActive ? "text-primary" : "text-ink-3")}
          >
            <it.icon className="size-5" aria-hidden />
            {it.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
