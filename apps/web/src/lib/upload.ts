import { MAX_UPLOAD_BYTES, type AttachmentInput } from "@easytenant/shared";
import { api } from "./api";

export interface PendingUpload {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  result?: AttachmentInput;
}

export function validateFile(file: File): string | null {
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
  if (!kind) return "Only photos and videos can be attached.";
  if (file.size > MAX_UPLOAD_BYTES[kind]) return `Too large. ${kind === "video" ? "Videos" : "Photos"} can be up to ${MAX_UPLOAD_BYTES[kind] / 1024 / 1024} MB.`;
  return null;
}

/** Gets a signed URL from the API, then PUTs the file straight to storage
 * with progress (XMLHttpRequest, because fetch has no upload progress). */
export async function uploadFile(developmentId: string, file: File, onProgress: (pct: number) => void): Promise<AttachmentInput> {
  const { key, uploadUrl, type } = await api<{ key: string; uploadUrl: string; type: "image" | "video" }>("/api/uploads/presign", {
    method: "POST",
    json: { developmentId, filename: file.name, contentType: file.type, size: file.size },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.send(file);
  });
  return { type, key, name: file.name };
}
