import type { ClientSession, ObjectId } from "mongodb";
import { DEFAULT_ROLE_PERMISSIONS, isSystemRoleName, type Permission } from "@easytenant/shared";
import type { Collections } from "../db/client";

/** Finds (or creates from defaults) the named role in a development. The
 * unique (developmentId, name) index makes concurrent creation safe. */
export async function ensureRole(
  cols: Collections,
  developmentId: ObjectId | null,
  roleName: string,
  session?: ClientSession
) {
  const permissions: Permission[] = isSystemRoleName(roleName) ? DEFAULT_ROLE_PERMISSIONS[roleName] : [];
  const role = await cols.roles.findOneAndUpdate(
    { developmentId, name: roleName },
    {
      $setOnInsert: {
        developmentId,
        name: roleName,
        permissions,
        isSystemRole: isSystemRoleName(roleName),
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", session }
  );
  return role!;
}

export async function grantRole(
  cols: Collections,
  params: { userId: string; developmentId: ObjectId | null; roleName: string },
  session?: ClientSession
): Promise<void> {
  const role = await ensureRole(cols, params.developmentId, params.roleName, session);
  await cols.userRoles.updateOne(
    { userId: params.userId, developmentId: params.developmentId, roleId: role._id },
    { $setOnInsert: { userId: params.userId, developmentId: params.developmentId, roleId: role._id, createdAt: new Date() } },
    { upsert: true, session }
  );
}

export async function revokeRole(
  cols: Collections,
  params: { userId: string; developmentId: ObjectId | null; roleName: string },
  session?: ClientSession
): Promise<boolean> {
  const role = await cols.roles.findOne({ developmentId: params.developmentId, name: params.roleName }, { session });
  if (!role) return false;
  const res = await cols.userRoles.deleteOne(
    { userId: params.userId, developmentId: params.developmentId, roleId: role._id },
    { session }
  );
  return res.deletedCount > 0;
}

/** User ids holding `permission` in a development, platform-wide holders
 * included. */
export async function holdersOf(cols: Collections, permission: Permission, developmentId: ObjectId | null) {
  const roles = await cols.roles
    .find({ permissions: permission, developmentId: developmentId ? { $in: [developmentId, null] } : null })
    .toArray();
  if (!roles.length) return [];
  const grants = await cols.userRoles.find({ roleId: { $in: roles.map((r) => r._id) } }).toArray();
  return [...new Set(grants.map((g) => g.userId))];
}
