import { AwsClient } from "aws4fetch";
import type { Config } from "../config";

/** Private media storage (Cloudflare R2). Nothing is public: every read
 * and write goes through a short-lived signed URL. */
export interface Storage {
  readonly enabled: boolean;
  presignPut(key: string, contentType: string, size: number): Promise<string>;
  presignGet(key: string): Promise<string | null>;
}

const GET_TTL_SECONDS = 3600;
const PUT_TTL_SECONDS = 900;

export function r2Storage(r2: NonNullable<Config["r2"]>): Storage {
  const client = new AwsClient({
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `https://${r2.accountId}.r2.cloudflarestorage.com/${r2.bucket}`;
  const urlFor = (key: string, ttl: number) => {
    const u = new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
    u.searchParams.set("X-Amz-Expires", String(ttl));
    return u.toString();
  };

  return {
    enabled: true,
    async presignPut(key, contentType, size) {
      // content-length is signed, so R2 rejects a body of any other size.
      const signed = await client.sign(urlFor(key, PUT_TTL_SECONDS), {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(size) },
        aws: { signQuery: true, allHeaders: true },
      });
      return signed.url;
    },
    async presignGet(key) {
      const signed = await client.sign(urlFor(key, GET_TTL_SECONDS), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}

/** Used when R2 isn't configured (local dev): uploads are refused and
 * media URLs come back null instead of crashing. */
export const disabledStorage: Storage = {
  enabled: false,
  async presignPut() {
    throw new Error("Media storage is not configured");
  },
  async presignGet() {
    return null;
  },
};

/** Keys a user may attach: their own uploads in this development. */
export function uploadPrefix(developmentId: string, userId: string): string {
  return `dev/${developmentId}/u/${userId}/`;
}

export function buildUploadKey(developmentId: string, userId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return `${uploadPrefix(developmentId, userId)}${crypto.randomUUID()}-${safe}`;
}
