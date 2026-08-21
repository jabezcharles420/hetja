/**
 * Dropped-feed record for the scan page — the analogue of
 * apps/web/lib/offline-queue.ts's droppedFeeds store, kept separate from
 * offline.ts/device.ts because service-worker.ts needs it too, and a service
 * worker must not import the PoW-minting stack just to report a drop (it has
 * no DOM and no localStorage anyway; see below).
 *
 * A queued feed that can never be accepted is REMOVED rather than retried —
 * retrying meant re-uploading a photo's bytes on every page open, forever,
 * over mobile data, to be refused again. But INVARIANT 14's principle applies:
 * "a flag nobody looks at is a silent rejection with extra steps." So every
 * drop leaves metadata behind and the page tells the feeder on next open.
 */
import type { QueuedScan } from "./idb";

/** localStorage key holding metadata for feeds this device gave up on. */
export const DROPPED_FEEDS_KEY = "hetja.scan.droppedFeeds";

/**
 * Guarded storage accessor. This module is imported by service-worker.ts,
 * which compiles against WebWorker lib and RUNS where localStorage genuinely
 * does not exist — so `localStorage` is never touched as a bare global.
 * Returns undefined there, which is exactly how the drop record degrades to a
 * console warning (see recordDroppedFeed).
 */
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): KeyValueStore | undefined {
  try {
    return (globalThis as { localStorage?: KeyValueStore }).localStorage;
  } catch {
    return undefined;
  }
}

/** Most recent drops to keep. Bounded so this can never grow without limit. */
const DROPPED_FEEDS_MAX = 20;

/** A feed the client gave up on, kept so the visitor can be told. */
export interface DroppedFeed {
  dogSlug: string;
  capturedAt: string;
  reason: string;
  droppedAt: string;
}

/** Feeds this client gave up on, newest first. Never throws. */
export function listDroppedFeeds(): DroppedFeed[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(DROPPED_FEEDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DroppedFeed[]) : [];
  } catch {
    return [];
  }
}

/** Clear the list — call once the visitor has actually been shown it. */
export function clearDroppedFeeds(): void {
  try {
    storage()?.removeItem(DROPPED_FEEDS_KEY);
  } catch {
    /* private mode / storage disabled — nothing to clear */
  }
}

/**
 * Record + report one permanently-undeliverable feed.
 *
 * Deliberately metadata only — dogSlug, capturedAt, reason — never the photo
 * bytes: localStorage is a small synchronous store shared with the device
 * token, and the photo already lives in IndexedDB until this point.
 *
 * The honest limit, same as web's: the photo IS lost. What survives tells the
 * visitor which dog and when, so the feed can be logged again deliberately.
 *
 * Service-worker caveat, stated rather than hidden: background-sync flushes
 * run with no storage() at all, so there the warning lands in the SW console
 * only and no page banner is possible. That still beats the alternative —
 * leaving the record queued to re-upload forever.
 */
export function recordDroppedFeed(item: QueuedScan, reason: string): void {
  const entry: DroppedFeed = {
    dogSlug: item.dogSlug,
    capturedAt: item.capturedAt,
    reason,
    droppedAt: new Date().toISOString(),
  };
  console.warn(
    `flush: dropped a queued feed for ${item.dogSlug} (${reason}). ` +
      "It will not be retried. See listDroppedFeeds().",
  );
  const s = storage();
  if (!s) return;
  try {
    s.setItem(
      DROPPED_FEEDS_KEY,
      JSON.stringify([entry, ...listDroppedFeeds()].slice(0, DROPPED_FEEDS_MAX)),
    );
  } catch {
    /* storage full or blocked — the console warning above is the fallback */
  }
}
