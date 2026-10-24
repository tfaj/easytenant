import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Native <dialog>: focus trapping, Escape and the backdrop come free. */
export function Dialog({ open, onClose, title, description, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border border-line bg-panel p-0 text-ink shadow-[0_24px_64px_-16px_rgba(0,0,0,.5)] backdrop:bg-[rgba(10,20,22,.55)]`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-5 py-4">
            <div>
              <h2 className="text-[17px] font-semibold">{title}</h2>
              {description && <div className="mt-0.5 text-sm text-ink-2">{description}</div>}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line-2 px-5 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
