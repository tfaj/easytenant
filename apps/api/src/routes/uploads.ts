import { Hono } from "hono";
import { MAX_UPLOAD_BYTES, presignBody } from "@easytenant/shared";
import { body, type AppEnv } from "../context";
import { loadDevelopment } from "../access/loaders";
import { AppError, badRequest } from "../lib/errors";
import { buildUploadKey } from "../lib/storage";

const uploads = new Hono<AppEnv>();

/** Issues a signed PUT URL so the browser uploads straight to R2. The key
 * is namespaced to the development and the uploader; the fault endpoints
 * only accept keys under the caller's own prefix. */
uploads.post("/presign", async (c) => {
  const deps = c.var.deps;
  const access = c.var.access;
  const input = await body(c, presignBody);
  const dev = await loadDevelopment(deps, access, input.developmentId);
  if (!deps.storage.enabled) throw new AppError(503, "storage_disabled", "Uploads aren't configured on this server.");
  const kind = input.contentType.startsWith("video/") ? "video" : "image";
  const max = MAX_UPLOAD_BYTES[kind];
  if (input.size > max) throw badRequest(`That ${kind} is too large (max ${Math.round(max / 1024 / 1024)} MB).`);
  const key = buildUploadKey(String(dev._id), access.me.uid, input.filename);
  const uploadUrl = await deps.storage.presignPut(key, input.contentType, input.size);
  return c.json({ key, uploadUrl, type: kind });
});

export default uploads;
