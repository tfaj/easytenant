import type { ObjectId } from "mongodb";
import type { FaultStatus, FaultType, Priority } from "@easytenant/shared";

/**
 * Document shapes as stored in MongoDB. Collection names and field names
 * match the v1 data so existing data keeps working; the v2 migration only
 * converts types (ISO strings to BSON dates) and adds constraints.
 */

export interface UserDoc {
  _id: string; // Firebase uid
  email: string;
  name?: string;
  phone?: string;
  status: "active" | "invited" | "suspended";
  createdAt: Date;
  updatedAt?: Date;
  lastSeenAt?: Date;
}

export interface DevelopmentDoc {
  _id: ObjectId;
  name: string;
  address: string;
  adminIds: string[];
  propertyManagerIds: string[];
  settings?: Record<string, unknown>;
  overdueDays?: number;
  currency?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface PropertyDoc {
  _id: ObjectId;
  developmentId: ObjectId;
  unitNumber: string;
  type: string;
  metadata?: Record<string, unknown>;
  ownerName?: string;
  ownerEmail?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface TenancyDoc {
  _id: ObjectId;
  tenantUserId: string;
  propertyId: ObjectId;
  developmentId: ObjectId;
  startDate: Date;
  endDate?: Date;
  status: "active" | "ended" | "pending";
  createdAt: Date;
}

export interface RoleDoc {
  _id: ObjectId;
  name: string;
  developmentId: ObjectId | null;
  permissions: string[];
  isSystemRole: boolean;
  createdAt: Date;
}

export interface UserRoleDoc {
  _id: ObjectId;
  userId: string;
  developmentId: ObjectId | null;
  roleId: ObjectId;
  createdAt: Date;
}

export interface InviteDoc {
  _id: ObjectId;
  code: string;
  developmentId: ObjectId;
  propertyId: ObjectId | null;
  role: string;
  status: "pending" | "used" | "revoked";
  createdBy: string;
  expiresAt: Date;
  inviteeEmail?: string;
  inviteeName?: string;
  usedBy?: string;
  usedAt?: Date;
  createdAt: Date;
}

export interface AttachmentDoc {
  type: "image" | "video";
  r2Key: string;
  thumbnailKey?: string;
  name?: string;
}

export interface IssueDoc {
  _id: ObjectId;
  reporterId: string;
  propertyId: ObjectId;
  developmentId: ObjectId;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  attachments: AttachmentDoc[];
  status: FaultStatus;
  type: FaultType;
  assignedTo: string[];
  scheduledDate?: Date;
  slaDueAt?: Date;
  vendorName?: string;
  vendorContact?: string;
  agreedCost?: number;
  costApprovedBy?: string;
  costApprovedAt?: Date;
  actualCost?: number;
  invoiceRef?: string;
  closedAt?: Date;
  /** Reminder keys already sent by the scheduled job (dedupe). */
  remindersSent?: string[];
  createdAt: Date;
  updatedAt?: Date;
}

export interface IssueUpdateDoc {
  _id: ObjectId;
  issueId: ObjectId;
  authorId: string;
  note: string;
  attachments: AttachmentDoc[];
  statusChangeTo?: FaultStatus;
  createdAt: Date;
}

export interface NotificationDoc {
  _id: ObjectId;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  channels: string[];
  read: boolean;
  createdAt: Date;
}

export interface NotificationPreferenceDoc {
  _id: ObjectId;
  userId: string;
  eventType: string;
  channels: string[];
}

export interface AuditLogDoc {
  _id: ObjectId;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  developmentId?: ObjectId | null;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
}

export interface MigrationDoc {
  _id: string;
  appliedAt: Date;
  summary?: unknown;
}
