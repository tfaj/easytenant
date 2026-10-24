import type { ObjectId } from "mongodb";
import type { Permission } from "@easytenant/shared";
import type { Collections } from "../db/client";
import { forbidden, unauthorized } from "../lib/errors";
import type { VerifiedToken } from "../auth/verifier";

export interface Grant {
  developmentId: ObjectId | null;
  roleName: string;
  permissions: Permission[];
}

/**
 * The caller's authority, loaded once per request.
 *
 * The rule the whole API follows: a permission check is always made against
 * the development that the *record being touched* belongs to, read from the
 * database, never against an id the client sent. Routes load the record
 * first, then call `require(permission, record.developmentId)`.
 */
export class Access {
  private grants: Grant[] | null = null;
  private platform = new Set<string>();
  private byDev = new Map<string, Set<string>>();

  constructor(
    private cols: Collections,
    readonly user: VerifiedToken | null
  ) {}

  /** The signed-in user, or a 401. */
  get me(): VerifiedToken {
    if (!this.user) throw unauthorized();
    return this.user;
  }

  /** The signed-in user with a verified email, or a 401/403. Every route
   * that changes data or reveals other people's data uses this. */
  get verified(): VerifiedToken {
    const u = this.me;
    if (!u.emailVerified) throw forbidden("Verify your email address first.");
    return u;
  }

  async load(): Promise<Grant[]> {
    if (this.grants) return this.grants;
    if (!this.user) return (this.grants = []);
    const assignments = await this.cols.userRoles.find({ userId: this.user.uid }).toArray();
    const roles = assignments.length
      ? await this.cols.roles.find({ _id: { $in: assignments.map((a) => a.roleId) } }).toArray()
      : [];
    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    this.grants = assignments.flatMap((a) => {
      const role = roleById.get(String(a.roleId));
      if (!role) return [];
      return [{ developmentId: a.developmentId ?? null, roleName: role.name, permissions: role.permissions as Permission[] }];
    });
    for (const g of this.grants) {
      if (g.developmentId === null) g.permissions.forEach((p) => this.platform.add(p));
      else {
        const key = String(g.developmentId);
        const set = this.byDev.get(key) ?? new Set<string>();
        g.permissions.forEach((p) => set.add(p));
        this.byDev.set(key, set);
      }
    }
    return this.grants;
  }

  /** Permissions in a development, platform-wide ones included. */
  async permissionsIn(developmentId: ObjectId | null): Promise<Set<string>> {
    await this.load();
    const out = new Set(this.platform);
    if (developmentId) this.byDev.get(String(developmentId))?.forEach((p) => out.add(p));
    return out;
  }

  async platformPermissions(): Promise<Set<string>> {
    await this.load();
    return new Set(this.platform);
  }

  async can(permission: Permission, developmentId: ObjectId | null): Promise<boolean> {
    return (await this.permissionsIn(developmentId)).has(permission);
  }

  async require(permission: Permission, developmentId: ObjectId | null): Promise<void> {
    this.verified;
    if (!(await this.can(permission, developmentId))) throw forbidden();
  }

  async requirePlatform(permission: Permission): Promise<void> {
    await this.require(permission, null);
  }

  /** Whether the caller holds any role in the development (or platform-wide). */
  async isMember(developmentId: ObjectId): Promise<boolean> {
    await this.load();
    return this.platform.size > 0 || this.byDev.has(String(developmentId));
  }

  /**
   * Developments where the caller holds `permission`: "all" for a
   * platform-wide grant, otherwise a list (possibly empty). Used to scope
   * list queries.
   */
  async developmentsWith(permission: Permission): Promise<"all" | ObjectId[]> {
    const grants = await this.load();
    if (this.platform.has(permission)) return "all";
    return grants
      .filter((g) => g.developmentId && g.permissions.includes(permission))
      .map((g) => g.developmentId as ObjectId);
  }

  /** Developments the caller is a member of in any role. */
  async memberDevelopments(): Promise<"all" | ObjectId[]> {
    const grants = await this.load();
    if (this.platform.size > 0) return "all";
    const seen = new Map<string, ObjectId>();
    for (const g of grants) if (g.developmentId) seen.set(String(g.developmentId), g.developmentId);
    return [...seen.values()];
  }
}

/** Builds a Mongo filter on `field` from a developmentsWith() result. */
export function scopeFilter(field: string, scope: "all" | ObjectId[]): Record<string, unknown> {
  return scope === "all" ? {} : { [field]: { $in: scope } };
}
