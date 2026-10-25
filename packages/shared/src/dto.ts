import type { CurrencyCode } from "./currency";
import type { Permission, SystemRoleName } from "./permissions";
import type { FaultStatus, FaultType, Priority, TransitionId } from "./pipeline";

/** Shapes the API returns. Dates are ISO strings; ids are strings. */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UserSummary {
  id: string;
  name: string | null;
  email: string;
}

export interface RoleAssignmentDto {
  developmentId: string | null;
  developmentName: string | null;
  roleName: string;
  permissions: Permission[];
}

export interface MeDto {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  emailVerified: boolean;
  roles: RoleAssignmentDto[];
  /** Permissions held platform-wide (roles with developmentId null). */
  platformPermissions: Permission[];
}

export interface DevelopmentDto {
  id: string;
  name: string;
  address: string;
  overdueDays: number | null;
  currency: CurrencyCode | null;
  effectiveOverdueDays: number;
  effectiveCurrency: CurrencyCode;
  createdAt: string;
  stats?: { units: number; occupied: number; invited: number; vacant: number; openFaults: number };
  /** The caller's permissions in this development (UI hints only; the API
   * re-checks every action). */
  myPermissions: Permission[];
}

export type UnitOccupancy = "occupied" | "invited" | "vacant";

export interface UnitDto {
  id: string;
  developmentId: string;
  unitNumber: string;
  type: string;
  ownerName: string | null;
  ownerEmail: string | null;
  occupancy: UnitOccupancy;
  tenant: (UserSummary & { tenancyId: string; since: string }) | null;
  pendingInvite: { id: string; email: string; expiresAt: string } | null;
  createdAt: string;
}

export interface TenancyDto {
  id: string;
  status: "active" | "ended";
  startDate: string;
  endDate: string | null;
  tenant: UserSummary;
  unit: { id: string; unitNumber: string };
  development: { id: string; name: string };
}

export interface InviteDto {
  id: string;
  developmentId: string;
  role: SystemRoleName;
  unit: { id: string; unitNumber: string } | null;
  inviteeEmail: string;
  inviteeName: string | null;
  status: "pending" | "used" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  createdBy: UserSummary | null;
  url?: string;
}

export interface InvitePreviewDto {
  developmentName: string;
  unitLabel: string | null;
  role: SystemRoleName;
  inviteeEmail: string;
  expiresAt: string;
}

export interface AttachmentDto {
  type: "image" | "video";
  key: string;
  name: string | null;
  url: string | null;
}

export interface FaultSummaryDto {
  id: string;
  title: string;
  category: string;
  priority: Priority;
  status: FaultStatus;
  type: FaultType;
  development: { id: string; name: string; overdueDays: number; currency: CurrencyCode };
  unit: { id: string; unitNumber: string };
  reporter: UserSummary | null;
  assignees: UserSummary[];
  attachmentCount: number;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface FaultActivityDto {
  id: string;
  author: UserSummary | null;
  note: string;
  attachments: AttachmentDto[];
  statusChangeTo: FaultStatus | null;
  createdAt: string;
}

export interface FaultDetailDto extends FaultSummaryDto {
  description: string;
  attachments: AttachmentDto[];
  vendorName: string | null;
  vendorContact: string | null;
  agreedCost: number | null;
  costApprovedBy: UserSummary | null;
  costApprovedAt: string | null;
  actualCost: number | null;
  invoiceRef: string | null;
  activity: FaultActivityDto[];
  /** Actions the caller may take right now, computed server-side. */
  availableActions: TransitionId[];
  canComment: boolean;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface UserAdminDto extends UserSummary {
  status: string;
  createdAt: string;
  roles: { developmentId: string | null; developmentName: string | null; roleName: string }[];
}

export interface DashboardSummaryDto {
  developments: number;
  units: number;
  occupied: number;
  occupancyPct: number;
  openFaults: number;
  overdueFaults: number;
  awaitingApproval: number;
  faultsByStatus: Partial<Record<FaultStatus, number>>;
  recentFaults: FaultSummaryDto[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
