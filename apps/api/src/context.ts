import type { Context } from "hono";
import type { MongoClient } from "mongodb";
import type { z } from "zod";
import type { Config } from "./config";
import type { Collections } from "./db/client";
import type { TokenVerifier } from "./auth/verifier";
import type { Storage } from "./lib/storage";
import type { Mailer } from "./lib/mailer";
import type { Access } from "./access/access";
import { badRequest } from "./lib/errors";

export interface Deps {
  config: Config;
  client: MongoClient;
  cols: Collections;
  verifier: TokenVerifier;
  storage: Storage;
  mailer: Mailer;
}

export type AppEnv = { Variables: { deps: Deps; access: Access } };
export type Ctx = Context<AppEnv>;

/** Parses and validates a JSON body; a bad body is a 400 with field errors. */
export async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return parse(schema, raw);
}

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw badRequest(fields[0]?.message ?? "Invalid request.", { fields });
  }
  return result.data;
}

export function query<S extends z.ZodType>(c: Ctx, schema: S): z.output<S> {
  return parse(schema, c.req.query());
}
