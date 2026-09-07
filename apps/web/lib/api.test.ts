import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  API_BASE,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  setSession,
  type DogProfile,
} from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lib/api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("unwraps the {ok, data} envelope", async () => {
    const dog: DogProfile = {
      slug: "abc234567",
      name: "Bella",
      status: "active",
      wardId: "W-12",
      photoKey: null,
      abcStatus: "done",
      vaccineStatus: "RABV · 2026-01-01",
      microStory: null,
      lastSeenAt: null,
      geo: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: dog }));

    await expect(api.getDog("abc234567", "sig123")).resolves.toEqual(dog);
  });

  it("attaches the Bearer token from localStorage when present", async () => {
    setAccessToken("tok-abc");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { records: [] } }));

    await api.getStreak();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/feeders/me/streak`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-abc");
  });

  it("sends no Authorization header for anon endpoints", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { records: [] } }));

    await api.getDogStories("abc234567");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("throws ApiError with code + message on an error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { ok: false, error: { message: "not found", code: "NOT_FOUND" } }),
    );

    await expect(api.getDog("abc234567", "s")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "NOT_FOUND",
      message: "not found",
    });
  });

  it("clears the stored token and throws on a 401", async () => {
    setAccessToken("tok-abc");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { ok: false, error: { message: "invalid token", code: "BAD_ACCESS_TOKEN" } }),
    );

    await expect(api.getStreak()).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
  });

  /**
   * The server had a refresh route and a one-time-use token store (migration
   * 0017) built for exactly this; the client stored only the access token and
   * never called it, so every session died after JWT_ACCESS_TTL. The 401 that
   * used to sign the feeder out is now the trigger for one exchange + retry.
   */
  it("refreshes the session once on a 401 and retries the request with the new token", async () => {
    setSession({ accessToken: "stale-access", refreshToken: "refresh-1" });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          data: { accessToken: "fresh-access", refreshToken: "refresh-2", feeder: { displayName: "F", trustScore: 30, role: "feeder" } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { trustScore: 31, streakDays: 2, badges: [] } }));

    const streak = await api.getStreak();
    expect(streak.streakDays).toBe(2);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toBe(`${API_BASE}/auth/refresh`);
    expect(refreshInit.method).toBe("POST");
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: "refresh-1" });
    // The refresh token IS the credential: no Authorization header rides along.
    expect(refreshInit.headers).not.toHaveProperty("authorization");

    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>).authorization).toBe("Bearer fresh-access");
    // The rotated pair is what is stored now.
    expect(getAccessToken()).toBe("fresh-access");
    expect(getRefreshToken()).toBe("refresh-2");
  });

  it("clears both tokens and throws when the refresh is refused", async () => {
    setSession({ accessToken: "stale-access", refreshToken: "refresh-used" });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, { ok: false, error: { message: "refresh token already used", code: "REFRESH_REUSED" } }),
      );

    await expect(api.getStreak()).rejects.toMatchObject({ status: 401, code: "BAD_ACCESS_TOKEN" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("does not loop: a 401 on the retried request signs out instead of refreshing again", async () => {
    setSession({ accessToken: "stale-access", refreshToken: "refresh-1" });
    const denied = () =>
      jsonResponse(401, { ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
    fetchMock
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, data: { accessToken: "fresh-access", refreshToken: "refresh-2" } }),
      )
      .mockResolvedValueOnce(denied());

    await expect(api.getStreak()).rejects.toMatchObject({ code: "FEEDER_GONE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("does not refresh for a 401 on a request that sent no session", async () => {
    // e.g. /devices/token answering BAD_POW while a refresh token happens to be stored.
    setRefreshToken("refresh-1");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { ok: false, error: { message: "proof of work invalid", code: "BAD_POW" } }),
    );
    await expect(
      api.requestDeviceToken({ challenge: { parameters: {} as never }, solution: { counter: 1, derivedKey: "x" } }),
    ).rejects.toMatchObject({ code: "BAD_POW" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRefreshToken()).toBe("refresh-1");
  });

  it("throws on HTTP errors without a JSON envelope", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(api.getStreak()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Request failed (HTTP 500)",
    });
  });

  it("throws ApiError with NETWORK_ERROR on transport failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("failed to fetch"));

    await expect(api.getStreak()).rejects.toMatchObject({
      name: "ApiError",
      code: "NETWORK_ERROR",
    });
  });

  it("POSTs the OTP request body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, data: { expiresAt: "2026-08-12T10:00:00.000Z", devCode: "123456" } }),
    );

    const res = await api.requestOtp("feeder@example.com");

    expect(res.devCode).toBe("123456");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "feeder@example.com" });
  });
});

/**
 * `fetch` has no built-in timeout. A refused connection rejects fast, but a
 * socket that opens and then stalls — the ordinary congested-cell-network
 * failure — hung until the browser's own multi-minute limit. On the SOS modal
 * that left the button disabled reading "Sending SOS…" indefinitely, on the one
 * screen where the user needs to know it failed so they can call a vet instead.
 */
describe("lib/api request deadline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("passes an abort signal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { ok: true } }));
    await api.getDog("abc234567", "sig");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a timeout to a retryable 408 rather than hanging", async () => {
    // What AbortSignal.timeout produces when it fires.
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));

    const err = await api.getDog("abc234567", "sig").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    // 408 matters specifically: the offline queue's isRetryable treats it as
    // transient, so a timed-out feed is retried instead of being dropped as a
    // permanent 4xx.
    expect((err as ApiError).status).toBe(408);
    expect((err as ApiError).code).toBe("TIMEOUT");
  });

  it("still reports an unreachable network as status 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await api.getDog("abc234567", "sig").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe("NETWORK_ERROR");
  });
});
