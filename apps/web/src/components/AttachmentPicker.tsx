import { useRef, useState } from "react";
import { Camera, Film, X } from "lucide-react";
import { MAX_ATTACHMENTS, type AttachmentInput } from "@easytenant/shared";
import { uploadFile, validateFile, type PendingUpload } from "../lib/upload";
import { errorMessage } from "../lib/api";
import { Button, cx } from "./ui";

/** Photo/video picker that uploads as soon as files are chosen, so the
 * form can submit straight away. */
export function useAttachments(developmentId: string | undefined) {
  const [items, setItems] = useState<PendingUpload[]>([]);
  const update = (id: string, patch: Partial<PendingUpload>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  function add(files: FileList | null) {
    if (!files || !developmentId) return;
    for (const file of Array.from(files).slice(0, MAX_ATTACHMENTS - items.length)) {
      const id = crypto.randomUUID();
      const problem = validateFile(file);
      const item: PendingUpload = { id, file, preview: URL.createObjectURL(file), progress: 0, status: problem ? "error" : "uploading", error: problem ?? undefined };
      setItems((xs) => [...xs, item]);
      if (problem) continue;
      uploadFile(developmentId, file, (p) => update(id, { progress: p }))
        .then((result) => update(id, { status: "done", result, progress: 100 }))
        .catch((e) => update(id, { status: "error", error: errorMessage(e) }));
    }
  }
  return {
    items,
    add,
    remove: (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)),
    reset: () => setItems([]),
    busy: items.some((x) => x.status === "uploading"),
    ready: items.filter((x) => x.status === "done" && x.result).map((x) => x.result as AttachmentInput),
  };
}

export function AttachmentPicker({ state, disabled }: { state: ReturnType<typeof useAttachments>; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={input} type="file" accept="image/*,video/*" multiple className="sr-only" onChange={(e) => { state.add(e.target.files); e.target.value = ""; }} tabIndex={-1} />
      {state.items.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {state.items.map((x) => (
            <li key={x.id} className="relative aspect-square overflow-hidden rounded-md border border-line bg-sunken">
              {x.file.type.startsWith("video/") ? (
                <div className="grid h-full place-items-center text-ink-3"><Film className="size-6" /></div>
              ) : (
                <img src={x.preview} alt="" className="h-full w-full object-cover" />
              )}
              {x.status === "uploading" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20"><div className="h-full bg-primary transition-[width]" style={{ width: `${x.progress}%` }} /></div>
              )}
              {x.status === "error" && <div className="absolute inset-0 grid place-items-center bg-brick/85 p-1 text-center text-[11px] font-semibold text-white">{x.error}</div>}
              <button type="button" onClick={() => state.remove(x.id)} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" aria-label={`Remove ${x.file.name}`}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" icon={<Camera className="size-4" />} disabled={disabled || state.items.length >= MAX_ATTACHMENTS} onClick={() => input.current?.click()} className={cx(state.items.length >= MAX_ATTACHMENTS && "hidden")}>
        Add photos or video
      </Button>
    </div>
  );
}
