import type { Deps } from "../context";
import type { Access } from "./access";
import { forbidden, notFound } from "../lib/errors";
import { oid } from "../lib/ids";

/** Loads a development the caller belongs to, or 404/403. */
export async function loadDevelopment(deps: Deps, access: Access, id: string | undefined) {
  access.verified;
  const dev = await deps.cols.developments.findOne({ _id: oid(id, "development id") });
  if (!dev) throw notFound("Development");
  if (!(await access.isMember(dev._id))) throw forbidden();
  return dev;
}
