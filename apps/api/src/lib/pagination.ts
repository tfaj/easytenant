import { ObjectId, type Collection, type Document, type Filter } from "mongodb";

/**
 * Keyset ("seek") pagination. The cursor holds the sort-key values of the
 * last row returned; the next page asks for rows strictly after it. Unlike
 * skip/limit this costs the same at any depth and doesn't shift when rows
 * are inserted. Every sort must end with a unique field (`_id`).
 */
export interface SortSpec {
  field: string;
  dir: 1 | -1;
  type?: "objectId" | "date" | "string";
}

export const RECENT_FIRST: SortSpec[] = [
  { field: "createdAt", dir: -1, type: "date" },
  { field: "_id", dir: -1, type: "objectId" },
];

export function encodeCursor(doc: Document, specs: SortSpec[]): string {
  const values = specs.map((s) => {
    const v = doc[s.field];
    if (v instanceof ObjectId) return v.toHexString();
    if (v instanceof Date) return v.toISOString();
    return v ?? null;
  });
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined, specs: SortSpec[]): unknown[] | null {
  if (!cursor) return null;
  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(raw) || raw.length !== specs.length) return null;
    return raw.map((v, i) => {
      const t = specs[i]!.type;
      if (t === "objectId") return new ObjectId(String(v));
      if (t === "date") return new Date(String(v));
      return v;
    });
  } catch {
    return null;
  }
}

export function seekFilter(specs: SortSpec[], values: unknown[]): Document {
  const or: Document[] = specs.map((spec, i) => {
    const clause: Document = {};
    for (let j = 0; j < i; j++) clause[specs[j]!.field] = values[j];
    clause[spec.field] = { [spec.dir === 1 ? "$gt" : "$lt"]: values[i] };
    return clause;
  });
  return { $or: or };
}

export function sortOf(specs: SortSpec[]): Record<string, 1 | -1> {
  return Object.fromEntries(specs.map((s) => [s.field, s.dir]));
}

export async function paginate<T extends Document>(
  col: Collection<T>,
  filter: Filter<T>,
  specs: SortSpec[],
  cursor: string | undefined,
  limit: number
): Promise<{ items: T[]; nextCursor: string | null }> {
  const values = decodeCursor(cursor, specs);
  const combined = (values ? { $and: [filter, seekFilter(specs, values)] } : filter) as Filter<T>;
  const docs = (await col.find(combined).sort(sortOf(specs)).limit(limit + 1).toArray()) as T[];
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last, specs) : null };
}

export function parseLimit(raw: string | undefined, fallback = 25): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
