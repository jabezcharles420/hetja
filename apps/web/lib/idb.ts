/**
 * IndexedDB persistence for the offline feed queue.
 *
 * Each queued scan carries a fresh `clientUuid` (per scan, not per device) so
 * the API's `ON CONFLICT (client_uuid) DO NOTHING` makes replay idempotent:
 * re-posting an already-created scan returns `created: false` and the record
 * is dropped instead of re-queued.
 */

export interface QueuedScan {
  id: string;
  clientUuid: string;
  dogSlug: string;
  /** Raw base64 photo (no data-URL prefix), optional. */
  photo?: string;
  geo?: { lat: number; lng: number };
  capturedAt: string;
  queuedAt: string;
  /**
   * Attested device token, minted when the feed was CAPTURED and persisted
   * with the record (schema v2). POST /api/v1/scans needs a feeder Bearer OR
   * this header token (routes/scans.ts); replay used to send neither, so an
   * anonymous queued feed 401'd forever and re-uploaded its photo bytes on
   * every app open. Records queued before v2 carry none and cannot be
   * retroactively attested — offline-queue's flush drops them through the
   * dropped-feeds path rather than retrying them forever.
   */
  deviceToken?: string;
}

const DB_NAME = "hetja-feeder";
/**
 * v2: queued records gained `deviceToken`. Object stores are schemaless apart
 * from the key path, so the upgrade itself migrates nothing — deliberately NO
 * backfill, because a token minted now would attest this device at FLUSH time,
 * not at capture time, and attaching it to old records would publish photos
 * nobody vouched for when they were taken. Tokenless leftovers are handled by
 * the flush-time drop path.
 */
const DB_VERSION = 2;
const STORE = "scan-queue";

let dbPromise: Promise<IDBDatabase> | undefined;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
  }
  return dbPromise;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("indexedDB request failed"));
  });
}

export async function queueScan(record: Omit<QueuedScan, "id" | "queuedAt">): Promise<QueuedScan> {
  const full: QueuedScan = { ...record, id: uuid(), queuedAt: new Date().toISOString() };
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(full));
  return full;
}

export async function listQueued(): Promise<QueuedScan[]> {
  const db = await openDb();
  const rows = await request<QueuedScan[]>(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
  return [...rows].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueued(id: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
