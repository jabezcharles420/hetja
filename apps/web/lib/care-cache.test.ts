// @vitest-environment jsdom
/**
 * N7's promise, "numbers for your wards are saved on this phone": the care
 * numbers for the feeder's wards are fetched while online and read back
 * with no signal. IndexedDB is mocked as a Map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./idb", () => ({
  putCached: async (k: string, v: unknown) => {
    store.set(k, JSON.parse(JSON.stringify(v)));
  },
  getCached: async (k: string) => store.get(k),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: { ...actual.api, getFeederMe: vi.fn() } };
});

vi.mock("@/app/map/api", () => ({ mapApi: { ward: vi.fn() } }));

import { cachedDogName, loadCareNumbers, refreshCareNumbers, rememberDogNames, telHref } from "./care-cache";
import { api, setAccessToken } from "./api";
import { mapApi } from "@/app/map/api";

const me = api.getFeederMe as unknown as ReturnType<typeof vi.fn>;
const ward = mapApi.ward as unknown as ReturnType<typeof vi.fn>;

function place(id: string, phone: string | null) {
  return { id, name: `Clinic ${id}`, kind: "vet", wardId: "K-West", phoneE164: phone, is24x7: false };
}

let onLine: PropertyDescriptor | undefined;

beforeEach(() => {
  store.clear();
  setAccessToken("tok");
  onLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
});

afterEach(() => {
  vi.clearAllMocks();
  setAccessToken(null);
  if (onLine) Object.defineProperty(window.navigator, "onLine", onLine);
  else delete (window.navigator as { onLine?: boolean }).onLine;
});

describe("care-cache", () => {
  it("saves the numbers for each ward (with a phone, once each) and reads them back", async () => {
    me.mockResolvedValue({ wards: ["K-West", "H-West"], homeWard: null });
    ward.mockImplementation(async (id: string) => ({
      nearby: id === "K-West" ? [place("a", "+91 22 1"), place("b", null)] : [place("a", "+91 22 1"), place("c", "+91 22 3")],
    }));
    const saved = await refreshCareNumbers();
    expect(saved?.wards).toEqual(["K-West", "H-West"]);
    expect(saved?.numbers.map((n) => n.id)).toEqual(["a", "c"]);
    expect((await loadCareNumbers())?.numbers).toHaveLength(2);
  });

  it("falls back to the home ward, and skips a fresh copy", async () => {
    me.mockResolvedValue({ wards: [], homeWard: "K-West" });
    ward.mockResolvedValue({ nearby: [place("a", "+9122")] });
    await refreshCareNumbers();
    await refreshCareNumbers();
    expect(ward).toHaveBeenCalledTimes(1);
    await refreshCareNumbers({ force: true });
    expect(ward).toHaveBeenCalledTimes(2);
  });

  it("offline: no network, and what was saved comes back", async () => {
    me.mockResolvedValue({ wards: ["K-West"], homeWard: null });
    ward.mockResolvedValue({ nearby: [place("a", "+9122")] });
    await refreshCareNumbers();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    me.mockClear();
    const saved = await refreshCareNumbers({ force: true });
    expect(me).not.toHaveBeenCalled();
    expect(saved?.numbers[0]?.name).toBe("Clinic a");
  });

  it("a failing ward keeps what was saved", async () => {
    me.mockResolvedValue({ wards: ["K-West"], homeWard: null });
    ward.mockResolvedValueOnce({ nearby: [place("a", "+9122")] });
    await refreshCareNumbers();
    ward.mockRejectedValue(new Error("down"));
    const saved = await refreshCareNumbers({ force: true });
    expect(saved?.numbers.map((n) => n.id)).toEqual(["a"]);
  });

  it("remembers dog names", async () => {
    await rememberDogNames([{ slug: "kalu", name: "Kalu" }, { slug: "x", name: null }]);
    expect(await cachedDogName("kalu")).toBe("Kalu");
    expect(await cachedDogName("x")).toBeNull();
  });

  it("tel links", () => {
    expect(telHref("+91 22 2600-1234")).toBe("tel:+912226001234");
  });
});
