import { MongoClient, ObjectId } from "mongodb";
import { SYSTEM_ROLES } from "@easytenant/shared";
import { createApp } from "../src/app";
import { collections } from "../src/db/client";
import { ensureIndexes } from "../src/db/indexes";
import { grantRole } from "../src/lib/roles";
import type { Email } from "../src/lib/mailer";
import type { Config } from "../src/config";

export interface TestUser {
  uid: string;
  email: string;
  verified?: boolean;
  name?: string;
}

const config: Config = {
  env: "test",
  port: 0,
  mongoUri: "",
  dbName: "",
  webOrigins: ["http://localhost:5173"],
  publicWebUrl: "http://localhost:5173",
  emailFrom: "test@example.com",
  jobSecret: "job-secret",
  faultOverdueDays: 30,
  defaultCurrency: "NGN",
  version: "test",
};

/** A fresh database per test file, a fake Firebase verifier (the bearer
 * token is the user's uid), and a mailer that records emails. */
export async function makeHarness() {
  const client = new MongoClient(process.env.TEST_MONGO_URI!);
  await client.connect();
  const db = client.db(`t_${new ObjectId().toHexString()}`);
  await ensureIndexes(db);
  const cols = collections(db);
  const users = new Map<string, TestUser>();
  const emails: Email[] = [];
  const app = createApp({
    config: { ...config, dbName: db.databaseName },
    client,
    cols,
    verifier: {
      async verify(token) {
        const u = users.get(token);
        return u ? { uid: u.uid, email: u.email, emailVerified: u.verified !== false, name: u.name } : null;
      },
    },
    storage: {
      enabled: true,
      async presignPut(key) {
        return `https://r2.test/${key}?put`;
      },
      async presignGet(key) {
        return `https://r2.test/${key}?get`;
      },
    },
    mailer: {
      async send(e) {
        emails.push(e);
      },
    },
  });

  async function addUser(u: TestUser, opts: { profile?: boolean } = {}) {
    users.set(u.uid, u);
    if (opts.profile !== false) {
      await cols.users.updateOne(
        { _id: u.uid },
        { $set: { email: u.email, ...(u.name ? { name: u.name } : {}) }, $setOnInsert: { status: "active", createdAt: new Date() } },
        { upsert: true }
      );
    }
    return u;
  }

  async function call(user: TestUser | null, method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(user ? { Authorization: `Bearer ${user.uid}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async function seedDevelopment(name: string, unitNumbers = ["A1", "A2", "A3"]) {
    const dev = await cols.developments.insertOne({ name, address: `${name} Road`, adminIds: [], propertyManagerIds: [], createdAt: new Date() } as never);
    const unitIds: ObjectId[] = [];
    for (const n of unitNumbers) {
      const r = await cols.properties.insertOne({ developmentId: dev.insertedId, unitNumber: n, type: "flat", createdAt: new Date() } as never);
      unitIds.push(r.insertedId);
    }
    return { id: dev.insertedId, unitIds };
  }

  async function grant(user: TestUser, roleName: string, developmentId: ObjectId | null) {
    await grantRole(cols, { userId: user.uid, developmentId, roleName });
  }

  async function makeTenant(user: TestUser, devId: ObjectId, unitId: ObjectId) {
    await grant(user, SYSTEM_ROLES.TENANT, devId);
    await cols.tenancies.insertOne({ tenantUserId: user.uid, propertyId: unitId, developmentId: devId, startDate: new Date(), status: "active", createdAt: new Date() } as never);
  }

  async function close() {
    await db.dropDatabase();
    await client.close();
  }

  return { app, cols, db, client, emails, addUser, call, seedDevelopment, grant, makeTenant, close };
}

export type Harness = Awaited<ReturnType<typeof makeHarness>>;
