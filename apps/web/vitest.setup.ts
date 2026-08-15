import { afterEach, vi } from "vitest";

const storage = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
};

/**
 * Installed with `defineProperty`, NOT `vi.stubGlobal`, and that difference is
 * load-bearing rather than stylistic.
 *
 * `vi.stubGlobal` records whatever `globalThis.localStorage` read as when this
 * file ran, and `vi.unstubAllGlobals()` — which suites here call in `afterEach`
 * to drop their `fetch` stub — puts that original back. On Node 20 (what CI
 * runs) there is no native `localStorage`, so under jsdom the original is
 * jsdom's own working Storage and restoring it is harmless. On Node 22+ there
 * IS a native `globalThis.localStorage`: a lazy accessor that evaluates to
 * `undefined` unless the process was started with `--localstorage-file`. Vitest
 * does not let jsdom shadow that own accessor, so the captured "original" is
 * `undefined`, and the first `unstubAllGlobals()` leaves every later test in the
 * file with no `localStorage` at all.
 *
 * That failed silently in exactly the wrong way: `lib/offline-queue.ts` guards
 * its writes with `typeof localStorage === "undefined"`, correctly, so the drop
 * record was simply skipped and the suite reported "the dropped feed was not
 * recorded" — a harness artifact wearing the costume of a data-loss bug, and one
 * that only appears off the CI Node version. A property vitest never registered
 * as a stub is a property `unstubAllGlobals()` cannot take away.
 */
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

afterEach(() => {
  storage.clear();
  // Re-assert ownership in case a suite stubbed and unstubbed localStorage
  // itself, which would have restored the native accessor described above.
  if (globalThis.localStorage !== localStorageMock) {
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  }
});
