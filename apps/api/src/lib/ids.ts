import { ObjectId } from "mongodb";
import { badRequest } from "./errors";

/** Parses a route/query id, turning a malformed one into a 400 instead of
 * a 500 from the driver. */
export function oid(value: string | undefined, what = "id"): ObjectId {
  if (!value || !ObjectId.isValid(value) || value.length !== 24) throw badRequest(`Invalid ${what}.`);
  return new ObjectId(value);
}

export const iso = (d: Date | string | undefined | null): string | null =>
  d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null;

export const isoRequired = (d: Date | string | undefined | null): string =>
  iso(d) ?? new Date(0).toISOString();
