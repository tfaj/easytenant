import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "./currency";
import { FAULT_STATUSES, FAULT_TYPES, PRIORITIES, type TransitionId } from "./pipeline";
import { SYSTEM_ROLE_NAMES } from "./permissions";

/** Request-body schemas. The API validates every body with these; the web
 * app reuses them for form validation. */

export const objectIdString = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Invalid id");

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const MAX_UPLOAD_BYTES = {
  image: 15 * 1024 * 1024,
  video: 60 * 1024 * 1024,
} as const;
export const MAX_ATTACHMENTS = 10;

export const attachmentInput = z.object({
  type: z.enum(["image", "video"]),
  key: z.string().min(1).max(512),
  name: z.string().max(255).optional(),
});
export type AttachmentInput = z.infer<typeof attachmentInput>;

// --- profile ---
export const updateProfileBody = z.object({
  name: optionalTrimmed(120),
  phone: optionalTrimmed(40),
});

// --- developments ---
export const createDevelopmentBody = z.object({
  name: trimmed(160),
  address: trimmed(400),
});

export const updateDevelopmentBody = z
  .object({
    name: trimmed(160).optional(),
    address: trimmed(400).optional(),
    overdueDays: z.number().int().min(1).max(365).nullable().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

// --- units ---
export const unitBody = z.object({
  unitNumber: trimmed(60),
  type: z.string().trim().max(60).default("unit"),
  ownerName: optionalTrimmed(120),
  ownerEmail: email.optional().or(z.literal("").transform(() => undefined)),
});

export const updateUnitBody = z
  .object({
    unitNumber: trimmed(60).optional(),
    type: z.string().trim().max(60).optional(),
    ownerName: z.string().trim().max(120).nullable().optional(),
    ownerEmail: email.nullable().optional().or(z.literal("").transform(() => null)),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const bulkUnitsBody = z.object({
  units: z
    .array(
      z.object({
        unitNumber: z.string().trim().max(60),
        type: z.string().trim().max(60).optional(),
        ownerName: z.string().trim().max(120).optional(),
        ownerEmail: z.string().trim().max(254).optional(),
      })
    )
    .min(1)
    .max(5000),
});

// --- tenancies ---
export const assignTenancyBody = z.object({
  unitId: objectIdString,
  tenantUserId: z.string().min(1).max(128),
});

// --- invites ---
export const createInviteBody = z
  .object({
    developmentId: objectIdString,
    role: z.enum(SYSTEM_ROLE_NAMES as [string, ...string[]]),
    unitId: objectIdString.optional(),
    inviteeEmail: email,
    inviteeName: optionalTrimmed(120),
    expiresInDays: z.number().int().min(1).max(60).default(14),
  })
  .refine((v) => v.role !== "tenant" || Boolean(v.unitId), {
    message: "Pick the unit this tenant is joining",
    path: ["unitId"],
  });

// --- faults ---
export const createFaultBody = z.object({
  developmentId: objectIdString,
  unitId: objectIdString,
  title: trimmed(160),
  description: z.string().trim().max(5000).default(""),
  category: z.string().trim().max(40).default("other"),
  priority: z.enum(PRIORITIES).default("medium"),
  type: z.enum(FAULT_TYPES).default("reactive"),
  scheduledDate: z.iso.datetime({ offset: true }).optional(),
  attachments: z.array(attachmentInput).max(MAX_ATTACHMENTS).default([]),
});

export const faultUpdateBody = z
  .object({
    note: z.string().trim().max(5000).default(""),
    attachments: z.array(attachmentInput).max(MAX_ATTACHMENTS).default([]),
  })
  .refine((v) => v.note.length > 0 || v.attachments.length > 0, "Add a note or an attachment");

export const transitionBody = z.object({
  action: z.enum([
    "classify",
    "assign",
    "start_inspection",
    "submit_quote",
    "approve_cost",
    "reject_cost",
    "complete_repair",
    "confirm_resolution",
    "close",
    "cancel",
  ] as [TransitionId, ...TransitionId[]]),
  note: z.string().trim().max(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: z.array(z.string().min(1).max(128)).max(10).optional(),
  scheduledDate: z.iso.datetime({ offset: true }).optional(),
  vendorName: optionalTrimmed(160),
  vendorContact: optionalTrimmed(160),
  agreedCost: z.number().nonnegative().max(1e12).optional(),
  actualCost: z.number().nonnegative().max(1e12).optional(),
  invoiceRef: optionalTrimmed(120),
});
export type TransitionBody = z.infer<typeof transitionBody>;

export const faultListQuery = z.object({
  scope: z.enum(["all", "mine", "assigned"]).default("all"),
  developmentId: objectIdString.optional(),
  status: z.enum(FAULT_STATUSES as [string, ...string[]]).optional(),
  open: z.enum(["1", "0"]).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// --- roles ---
export const roleGrantBody = z.object({
  developmentId: objectIdString.nullable(),
  roleName: z.enum(SYSTEM_ROLE_NAMES as [string, ...string[]]),
});

// --- uploads ---
export const presignBody = z.object({
  developmentId: objectIdString,
  filename: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .regex(/^(image|video)\/[a-z0-9.+-]+$/i, "Only images and videos can be uploaded"),
  size: z.number().int().positive(),
});

// --- notifications ---
export const NOTIFICATION_EVENTS = [
  "fault.reported",
  "fault.updated",
  "fault.status_changed",
  "fault.assigned",
  "maintenance.reminder",
  "fault.overdue",
  "account.role_granted",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABEL: Record<NotificationEvent, string> = {
  "fault.reported": "A new fault is reported",
  "fault.updated": "Someone adds an update to a fault",
  "fault.status_changed": "A fault moves to a new stage",
  "fault.assigned": "A job is assigned to me",
  "maintenance.reminder": "Scheduled maintenance is coming up",
  "fault.overdue": "A fault becomes overdue",
  "account.role_granted": "My access changes",
};

export const preferenceBody = z.object({
  eventType: z.enum(NOTIFICATION_EVENTS),
  email: z.boolean(),
});
