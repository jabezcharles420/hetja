/**
 * Photo decode gate: at most N photos in flight at once, a short queue, and a
 * fast 503 beyond that (audit A-06).
 *
 * The API runs inside a 300-360 MB memory room shared with nothing we control
 * (ops/room/README.md). A photo upload costs its base64 body (~2.8 MB at the
 * contract ceiling), the decoded bytes (~2 MiB) and the stripped copy (~2 MiB)
 * until the background write lands. Nothing bounded how many of those could be
 * alive at once, so a burst of large uploads from several attested devices
 * could push the process into the cgroup's OOM killer, which takes SOS down
 * with it.
 *
 * A permit is taken before decode and released when the photo is stored (or
 * dropped), so the bound covers the whole lifetime of the decoded buffers,
 * not just the synchronous decode.
 *
 *   concurrency 2   two photos decoded / being written at any moment
 *   waiters 8       up to eight more requests wait (at most WAIT_MS) for a slot
 *   otherwise       PhotoBusyError -> 503 PHOTO_BUSY, retry-after 5
 *
 * 503 rather than 429 on purpose: nobody is over a budget, the server is busy,
 * and the offline queue (apps/web/lib/offline-queue.ts) retries every 5xx.
 */

export class PhotoBusyError extends Error {
  constructor() {
    super("photo processing is busy");
    this.name = "PhotoBusyError";
  }
}

/** Seconds a client is told to wait after PHOTO_BUSY. */
export const PHOTO_BUSY_RETRY_AFTER_SEC = 5;

export type Release = () => void;

export class PhotoGate {
  private active = 0;
  private readonly waiters: Array<{ grant: (release: Release) => void; timer: NodeJS.Timeout }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxWaiters: number,
    private readonly waitMs: number,
  ) {}

  /** Photos currently holding a permit. */
  get inFlight(): number {
    return this.active;
  }

  /** Requests currently queued for a permit. */
  get queued(): number {
    return this.waiters.length;
  }

  /**
   * Resolves with a release function once a slot is free. Rejects at once
   * with PhotoBusyError when the queue is full, or after `waitMs` in the
   * queue. The release function is idempotent: calling it twice frees one
   * slot, not two.
   */
  acquire(): Promise<Release> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.makeRelease());
    }
    if (this.waiters.length >= this.maxWaiters) {
      return Promise.reject(new PhotoBusyError());
    }
    return new Promise<Release>((resolve, reject) => {
      const entry = {
        grant: (release: Release) => {
          clearTimeout(entry.timer);
          resolve(release);
        },
        timer: setTimeout(() => {
          const at = this.waiters.indexOf(entry);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(new PhotoBusyError());
        }, this.waitMs),
      };
      entry.timer.unref?.();
      this.waiters.push(entry);
    });
  }

  private makeRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        // Hand the slot straight to the next waiter: `active` stays the same.
        next.grant(this.makeRelease());
      } else {
        this.active = Math.max(0, this.active - 1);
      }
    };
  }

  /** Test seam. Never call this from a route. */
  reset(): void {
    for (const w of this.waiters.splice(0)) clearTimeout(w.timer);
    this.active = 0;
  }
}

/** The process-wide gate every photo-accepting route shares. */
export const photoGate = new PhotoGate(2, 8, 10_000);
