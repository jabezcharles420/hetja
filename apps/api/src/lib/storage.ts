/**
 * Photo storage backend. Dev default is a local directory (STORAGE_LOCAL_DIR);
 * production uses S3. Photo writes happen in the background of a scan POST —
 * they never block the API response (and never block on AI).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface StorageConfig {
  STORAGE_BACKEND: "local" | "s3";
  STORAGE_LOCAL_DIR: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
}

export function newPhotoKey(): string {
  return `photos/${randomUUID()}.jpg`;
}

function stripDataPrefix(base64: string): string {
  return base64.replace(/^data:[a-z0-9/+-]+;base64,/, "");
}

async function storeLocal(base64: string, key: string, dir: string): Promise<void> {
  const filePath = join(dir, key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(stripDataPrefix(base64), "base64"));
}

export async function storePhoto(photoBase64: string, key: string, config: StorageConfig): Promise<string> {
  switch (config.STORAGE_BACKEND) {
    case "local":
      await storeLocal(photoBase64, key, config.STORAGE_LOCAL_DIR);
      return key;
    case "s3":
      // S3 PUT requires signed requests; wired in a production follow-up.
      throw new Error("STORAGE_BACKEND=s3 is not implemented in this build");
    default:
      throw new Error(`unknown STORAGE_BACKEND: ${String(config.STORAGE_BACKEND)}`);
  }
}
