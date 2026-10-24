/**
 * Grants the platform admin role to an existing user, by email. The user
 * must have signed in once so their profile exists.
 *
 *   npm run bootstrap-admin -w @easytenant/api -- you@example.com
 *
 * This replaces v1's manual "insert two documents in Compass" step.
 */
import { MongoClient } from "mongodb";
import { SYSTEM_ROLES } from "@easytenant/shared";
import { collections } from "../db/client";
import { grantRole } from "../lib/roles";

const email = process.argv[2]?.trim().toLowerCase();
const uri = process.env.MONGODB_URI;
if (!email || !uri) {
  console.error("Usage: MONGODB_URI=... npm run bootstrap-admin -- you@example.com");
  process.exit(1);
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const cols = collections(client.db(process.env.DB_NAME ?? "easytenant"));
  const user = await cols.users.findOne({ email });
  if (!user) {
    console.error(`No user with email ${email}. Sign in to the app once first, then re-run.`);
    process.exitCode = 1;
  } else {
    await grantRole(cols, { userId: user._id, developmentId: null, roleName: SYSTEM_ROLES.ADMIN });
    await cols.auditLog.insertOne({ actorId: "cli", action: "role.grant", targetType: "user", targetId: user._id, developmentId: null, after: { roleName: "admin" }, createdAt: new Date() } as never);
    console.log(`${email} is now a platform admin.`);
  }
} finally {
  await client.close();
}
