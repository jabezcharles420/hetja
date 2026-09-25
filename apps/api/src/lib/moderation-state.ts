/**
 * D13 moderation state (design v7): suspended accounts and blocked devices.
 *
 * SUSPENDED ACCOUNT (feeders.suspended_at, set by an admin). Refused every
 * write with 403 ACCOUNT_SUSPENDED (lib/require-role.ts, routes/scans.ts),
 * never paged for an SOS, never able to take a case, no admin role, no vet
 * signing. Reads still work, and so do the ways OUT: releasing a case they
 * hold, unsubscribing push, exporting or deleting the account. Filing an SOS
 * report is still accepted: an emergency from a suspended account is still an
 * emergency (the same judgement INVARIANT 15 makes for a paused feeder).
 *
 * BLOCKED DEVICE (blocked_devices, keyed on SHA-256 of the canonical device
 * id, never the id or the token). Refused scans, tag reports, problem
 * reports and registrations with 403 DEVICE_BLOCKED. An SOS report from it is
 * still ACCEPTED and still answered with the numbers to call, but pages
 * nobody: no feeder, NGO or vet is woken by it, and it escalates to the
 * tier-2 record at once (routes/sos.ts). A blocked device is an abuser an
 * admin has identified; the reporter still gets every phone number.
 */
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { query } from "@hetja/db";

export function deviceHashOf(deviceSubject: string): string {
  return createHash("sha256").update(`blocked-device|${deviceSubject}`).digest("hex");
}

/** The opaque reference admin pages show for a device: the hash's first 16 hex characters. */
export function deviceRefOf(deviceSubject: string): string {
  return deviceHashOf(deviceSubject).slice(0, 16);
}

const blockCache = new LRUCache<string, boolean>({ max: 5000, ttl: 30_000 });

export async function isDeviceBlocked(deviceSubject: string | null | undefined): Promise<boolean> {
  if (!deviceSubject) return false;
  const h = deviceHashOf(deviceSubject);
  const cached = blockCache.get(h);
  if (cached !== undefined) return cached;
  const r = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM blocked_devices WHERE device_hash = $1 AND lifted_at IS NULL`,
    [h],
  );
  const blocked = (r.rows[0]?.n ?? 0) > 0;
  blockCache.set(h, blocked);
  return blocked;
}

/** Called after a block or unblock so it bites at once, not 30 s later. */
export function forgetDeviceBlocks(): void {
  blockCache.clear();
}

export async function isSuspended(feederId: string | null | undefined): Promise<boolean> {
  if (!feederId) return false;
  const r = await query<{ s: boolean }>(`SELECT suspended_at IS NOT NULL AS s FROM feeders WHERE id = $1`, [feederId]);
  return r.rows[0]?.s === true;
}

export const deviceBlockedBody = {
  ok: false,
  error: { message: "this device has been blocked by a Hetja moderator", code: "DEVICE_BLOCKED" },
} as const;

export const suspendedBody = {
  ok: false,
  error: { message: "this account is suspended", code: "ACCOUNT_SUSPENDED" },
} as const;
