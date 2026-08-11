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

vi.stubGlobal("localStorage", localStorageMock);

afterEach(() => {
  storage.clear();
});
