import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  API_BASE,
  getAccessToken,
  setAccessToken,
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

    const res = await api.requestOtp("+919876543210");

    expect(res.devCode).toBe("123456");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ phone: "+919876543210" });
  });
});
