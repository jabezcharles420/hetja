/**
 * Tests for the collar page's profile mapping.
 *
 * Why this file exists: normalizeProfile read fields the API has never sent
 * (`d.vaccine` as an object, `d.photoUrl`, `d.sex`, `d.approxAge`,
 * `d.coatPattern`, `d.vibe`) while GET /api/v1/dogs/:slug returns `photoKey`
 * and `vaccineStatus`. Net effect on the live page: no dog photo ever
 * rendered and vaccination always read "Unknown" — on the zero-framework
 * surface strangers actually use, while apps/web (which reads the correct
 * names) looked fine. Nothing failed loudly; the payload simply mapped to
 * empty strings. These tests feed the EXACT payload dogs.ts builds — field
 * names copied from DogPagePayload, not paraphrased — so any drift between
 * the two files fails here instead of silently blanking the page again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDogProfile } from "./api.js";

/** Verbatim shape of apps/api/src/routes/dogs.ts's DogPagePayload. */
function realApiPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    ok: true,
    data: {
      slug: "c3di5esh8",
      name: "Rosie",
      status: "active",
      wardId: "K-West",
      photoKey: "photos/9f2c1e4a-7.jpg",
      abcStatus: "abc_done",
      vaccineStatus: "Anti-Rabies · 2026-01-15",
      microStory: "Friendly soul with a happy tail.",
      lastSeenAt: "2026-08-20T09:30:00.000Z",
      geo: { lat: 18.97, lng: 72.82 },
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

const originalApiOverride = (globalThis as { __HETJA_API__?: string }).__HETJA_API__;

describe("apps/scan profile mapping (real API contract)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __HETJA_API__?: string }).__HETJA_API__ = "/api/v1";
  });

  afterEach(() => {
    (globalThis as { __HETJA_API__?: string }).__HETJA_API__ = originalApiOverride;
  });

  it("maps every field of a real dogs.ts payload", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");

    expect(profile.slug).toBe("c3di5esh8");
    expect(profile.name).toBe("Rosie");
    expect(profile.status).toBe("active");
    expect(profile.wardId).toBe("K-West");
    expect(profile.abcStatus).toBe("abc_done");
    expect(profile.microStory).toBe("Friendly soul with a happy tail.");
    expect(profile.lastSeenAt).toBe("2026-08-20T09:30:00.000Z");
  });

  it("builds photoUrl from photoKey like apps/web's dogPhotoUrl()", async () => {
    // Same-origin default: API_BASE is "/api/v1", so the origin part is ""
    // and Caddy's /photos/* handler serves the key from the site root.
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");
    expect(profile.photoUrl).toBe("/photos/9f2c1e4a-7.jpg");
  });

  it("renders no photo when photoKey is null (no invented URL)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload({ photoKey: null })));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");
    expect(profile.photoUrl).toBeUndefined();
  });

  it("maps vaccineStatus onto the vaccine display state", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");
    expect(profile.vaccine).toBeDefined();
    // A returned vaccineStatus means a VERIFIED record exists.
    expect(profile.vaccine!.upToDate).toBe(true);
    // Shown verbatim, so neither the vaccine name nor its date is lost.
    expect(profile.vaccine!.label).toBe("Anti-Rabies · 2026-01-15");
    expect(profile.vaccine!.rabvLast).toBe("2026-01-15");
    expect(profile.vaccine!.dhppLast).toBeUndefined();
    expect(profile.vaccine!.lastUpdatedAt).toBe("2026-01-15");
  });

  it("leaves vaccination Unknown when vaccineStatus is null", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload({ vaccineStatus: null })));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");
    expect(profile.vaccine).toBeUndefined();
  });

  it("does not populate sex/age/coat fields the API never sends", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(realApiPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { profile } = await fetchDogProfile("c3di5esh8", "sig");
    // ui.ts renders their absence; inventing values would claim more than the
    // system knows.
    expect(profile.sex).toBeUndefined();
    expect(profile.approxAge).toBeUndefined();
    expect(profile.coatPattern).toBeUndefined();
  });

  it("propagates the X-Hetja-Stale header as the stale flag", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(realApiPayload(), { "X-Hetja-Stale": "1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { stale } = await fetchDogProfile("c3di5esh8", "sig");
    expect(stale).toBe(true);
  });
});
