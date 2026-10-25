import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cx } from "./ui";

interface ToastItem {
  id: number;
  kind: "success" | "error";
  message: string;
}
const Ctx = createContext<(kind: ToastItem["kind"], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg px-4 py-3 text-sm font-medium shadow-[0_12px_32px_-12px_rgba(0,0,0,.45)]",
              "bg-ink text-page"
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="mt-px size-4 shrink-0 text-primary-soft" /> : <AlertTriangle className="mt-px size-4 shrink-0 text-amber" />}
            <span className="flex-1">{t.message}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return { success: (m: string) => push("success", m), error: (m: string) => push("error", m) };
}
