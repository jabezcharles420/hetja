export interface QueuedScan {
  id: string;
  clientUuid: string;
  dogSlug: string;
  photoBlob: Blob;
  geo?: { lat: number; lng: number };
  capturedAt: string;
  queuedAt: string;
  /**
   * Attested device token, minted when the feed was CAPTURED and persisted
   * with the record (schema v2). POST /api/v1/scans requires a feeder Bearer
   * OR this token (routes/scans.ts answers 401 UNAUTHENTICATED_DEVICE without
   * either) — and this app has no accounts, so the token is the only
   * credential a queued feed will ever have. Records queued before v2 carry
   * none and cannot be retroactively attested; flush.ts drops them through
   * the dropped-feeds path instead of re-uploading their photo bytes forever.
   */
  deviceToken?: string;
}

const DB_NAME = "hetja-scan";
/**
 * v2: queued records gained `deviceToken`. Object stores are schemaless apart
 * from their key path, so the upgrade itself migrates nothing — there is
 * deliberately NO backfill, because a token minted now would attest this
 * device at FLUSH time, not at capture time, and attaching it to old records
 * would publish photos nobody vouched for when they were taken. The bump
 * exists to mark that contract change and to give this hook a version to
 * anchor to; tokenless leftovers are handled by the flush-time drop path.
 */
const DB_VERSION = 2;
const STORE = "scan-queue";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
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
  const rows = await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
  return (rows as QueuedScan[]).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueued(id: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
