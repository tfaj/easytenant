import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@easytenant/shared";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  DB_NAME: z.string().default("easytenant"),
  WEB_ORIGINS: z.string().default("http://localhost:5173"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("EasyTenant <notifications@easytenant.ng>"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("easytenant-media"),
  JOB_SECRET: z.string().optional(),
  FAULT_OVERDUE_DAYS: z.coerce.number().int().min(1).default(30),
  DEFAULT_CURRENCY: z.enum(SUPPORTED_CURRENCIES).default("NGN"),
  GIT_SHA: z.string().default("dev"),
});

export type Config = {
  env: "development" | "test" | "production";
  port: number;
  mongoUri: string;
  dbName: string;
  webOrigins: string[];
  publicWebUrl: string;
  firebaseProjectId?: string;
  firebaseServiceAccountJson?: string;
  resendApiKey?: string;
  emailFrom: string;
  r2?: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  jobSecret?: string;
  faultOverdueDays: number;
  defaultCurrency: (typeof SUPPORTED_CURRENCIES)[number];
  version: string;
};

/** Reads and validates the environment once, at startup. A bad or missing
 * value stops the process before it accepts traffic. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}\nSee apps/api/.env.example.`);
  }
  const e = parsed.data;
  const r2 =
    e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY
      ? {
          accountId: e.R2_ACCOUNT_ID,
          accessKeyId: e.R2_ACCESS_KEY_ID,
          secretAccessKey: e.R2_SECRET_ACCESS_KEY,
          bucket: e.R2_BUCKET,
        }
      : undefined;

  if (e.NODE_ENV === "production") {
    const missing = [
      !e.FIREBASE_PROJECT_ID && "FIREBASE_PROJECT_ID",
      !r2 && "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY",
      !e.JOB_SECRET && "JOB_SECRET",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing production settings: ${missing.join(", ")}`);
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    mongoUri: e.MONGODB_URI,
    dbName: e.DB_NAME,
    webOrigins: e.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/$/, ""),
    firebaseProjectId: e.FIREBASE_PROJECT_ID,
    firebaseServiceAccountJson: e.FIREBASE_SERVICE_ACCOUNT_JSON,
    resendApiKey: e.RESEND_API_KEY || undefined,
    emailFrom: e.EMAIL_FROM,
    r2,
    jobSecret: e.JOB_SECRET,
    faultOverdueDays: e.FAULT_OVERDUE_DAYS,
    defaultCurrency: e.DEFAULT_CURRENCY,
    version: e.GIT_SHA,
  };
}
