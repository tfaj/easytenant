/**
 * Roles and permissions.
 *
 * Permission strings are stored inside `roles` documents in MongoDB, so the
 * values below are part of the data contract with existing data. Rename a
 * value only together with a migration.
 */

export const SYSTEM_ROLES = {
  ADMIN: "admin",
  PROPERTY_MANAGER: "property_manager",
  TENANT: "tenant",
  SERVICE_PERSONNEL: "service_personnel",
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const SYSTEM_ROLE_NAMES = Object.values(SYSTEM_ROLES) as SystemRoleName[];

export const ROLE_LABEL: Record<SystemRoleName, string> = {
  admin: "Admin",
  property_manager: "Property manager",
  tenant: "Tenant",
  service_personnel: "Service personnel",
};

export const PERMISSIONS = {
  DEVELOPMENT_CREATE: "development:create",
  DEVELOPMENT_MANAGE: "development:manage",
  TENANT_INVITE: "tenant:invite",
  TENANT_REMOVE: "tenant:remove",
  ISSUE_CREATE: "issue:create",
  ISSUE_VIEW_ALL: "issue:view_all",
  ISSUE_APPROVE_COST: "issue:approve_cost",
  WORKORDER_CREATE: "workorder:create",
  WORKORDER_ASSIGN: "workorder:assign",
  WORKORDER_UPDATE_STATUS: "workorder:update_status",
  WORKORDER_VERIFY: "workorder:verify",
  SERVICE_PERSONNEL_ONBOARD: "service_personnel:onboard",
  ROLE_MANAGE: "role:manage",
  REPORT_VIEW: "report:view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  admin: ALL_PERMISSIONS,
  property_manager: [
    PERMISSIONS.TENANT_INVITE,
    PERMISSIONS.TENANT_REMOVE,
    PERMISSIONS.ISSUE_CREATE,
    PERMISSIONS.ISSUE_VIEW_ALL,
    PERMISSIONS.WORKORDER_CREATE,
    PERMISSIONS.WORKORDER_ASSIGN,
    PERMISSIONS.WORKORDER_VERIFY,
    PERMISSIONS.SERVICE_PERSONNEL_ONBOARD,
    PERMISSIONS.REPORT_VIEW,
  ],
  tenant: [PERMISSIONS.ISSUE_CREATE],
  service_personnel: [PERMISSIONS.WORKORDER_UPDATE_STATUS],
};

/** Roles that grant management power. Inviting or granting them needs
 * ROLE_MANAGE, not just TENANT_INVITE. */
export const MANAGEMENT_ROLES: readonly SystemRoleName[] = [
  SYSTEM_ROLES.ADMIN,
  SYSTEM_ROLES.PROPERTY_MANAGER,
];

export function isSystemRoleName(value: string): value is SystemRoleName {
  return (SYSTEM_ROLE_NAMES as string[]).includes(value);
}
