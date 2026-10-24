import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router";
import { initials } from "../lib/format";

export const cx = clsx;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover",
  secondary: "bg-panel text-ink border border-line hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-panel text-brick border border-line hover:bg-brick-soft hover:border-brick/40",
};
const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
    variantClass[variant],
    sizeClass[size],
    extra
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = "secondary", size = "md", className, icon, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className as string)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const controlClass =
  "w-full rounded-md border border-line bg-panel px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-sunken disabled:text-ink-3";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(controlClass, "h-10", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx(controlClass, "h-10 pr-8", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(controlClass, "py-2 min-h-24 leading-relaxed", className)} {...rest} />;
});

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">optional</span>}
      </label>
      {children(id)}
      {error ? <p className="text-[13px] text-brick">{error}</p> : hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.015em] text-ink">{title}</h1>
          {description && <div className="mt-1 text-ink-2">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx("rounded-lg border border-line bg-panel", padded && "p-5", className)}>{children}</section>;
}

export function PanelTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-full bg-sunken text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-3" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-brick/30 bg-brick-soft px-4 py-3 text-sm text-brick">{children}</div>;
}

// ---------------------------------------------------------------------------
// Small display pieces
// ---------------------------------------------------------------------------

type Tint = "neutral" | "primary" | "amber" | "brick" | "sky" | "moss";
const tintClass: Record<Tint, string> = {
  neutral: "bg-sunken text-ink-2",
  primary: "bg-primary-soft text-primary",
  amber: "bg-amber-soft text-amber",
  brick: "bg-brick-soft text-brick",
  sky: "bg-sky-soft text-sky",
  moss: "bg-moss-soft text-moss",
};

export function Pill({ tint = "neutral", children, dot }: { tint?: Tint; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap", tintClass[tint])}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** A unit number shown like the plate on a door. */
export function UnitPlate({ children, size = "md" }: { children: ReactNode; size?: "sm" | "md" }) {
  return (
    <span
      className={cx(
        "tabular inline-flex items-center justify-center rounded-[4px] border border-ink/25 bg-panel font-bold text-ink shadow-[inset_0_-1px_0_var(--line)]",
        size === "sm" ? "h-6 min-w-8 px-1.5 text-[12px]" : "h-8 min-w-11 px-2 text-[14px]"
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "brick" | "amber"; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={cx("tabular mt-1 text-[28px] font-bold leading-none tracking-[-0.02em]", tone === "brick" ? "text-brick" : tone === "amber" ? "text-amber" : "text-ink")}>{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold transition-colors",
            value === it.value ? "border-primary text-ink" : "border-transparent text-ink-3 hover:text-ink"
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-line-2 p-3">
      <Button variant="ghost" size="sm" loading={loading} onClick={onClick}>
        Show more
      </Button>
    </div>
  );
}
