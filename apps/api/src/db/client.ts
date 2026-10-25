import { MongoClient, type Collection, type Db, type OptionalUnlessRequiredId } from "mongodb";
import type * as T from "./types";

export interface Collections {
  users: Collection<T.UserDoc>;
  developments: Collection<T.DevelopmentDoc>;
  properties: Collection<T.PropertyDoc>;
  tenancies: Collection<T.TenancyDoc>;
  roles: Collection<T.RoleDoc>;
  userRoles: Collection<T.UserRoleDoc>;
  invites: Collection<T.InviteDoc>;
  issues: Collection<T.IssueDoc>;
  issueUpdates: Collection<T.IssueUpdateDoc>;
  notifications: Collection<T.NotificationDoc>;
  notificationPreferences: Collection<T.NotificationPreferenceDoc>;
  auditLog: Collection<T.AuditLogDoc>;
  migrations: Collection<T.MigrationDoc>;
}

export function collections(db: Db): Collections {
  return {
    users: db.collection("users"),
    developments: db.collection("developments"),
    properties: db.collection("properties"),
    tenancies: db.collection("tenancies"),
    roles: db.collection("roles"),
    userRoles: db.collection("userRoles"),
    invites: db.collection("invites"),
    issues: db.collection("issues"),
    issueUpdates: db.collection("issueUpdates"),
    notifications: db.collection("notifications"),
    notificationPreferences: db.collection("notificationPreferences"),
    auditLog: db.collection("auditLog"),
    migrations: db.collection("_migrations"),
  };
}

/** One client per process, opened at startup and reused for every request.
 * maxPoolSize is small on purpose: Atlas M0 allows 500 connections in total
 * and Cloud Run may run several instances. */
export async function connectMongo(uri: string, dbName: string) {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 10_000,
    appName: "easytenant-api",
  });
  await client.connect();
  const db = client.db(dbName);
  return { client, db, cols: collections(db) };
}

export type Insertable<D extends { _id: unknown }> = OptionalUnlessRequiredId<D>;
