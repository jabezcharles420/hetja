/**
 * Hetja Feeder API client.
 *
 * Typed fetch wrapper around the @hetja/api HTTP surface:
 *   - origin from NEXT_PUBLIC_API_URL (default http://localhost:8080); every
 *     JSON endpoint is served under the /api/v1 prefix
 *   - Bearer access token attached from localStorage when present
 *   - unwraps the `{ok: true, data}` envelope; throws ApiError on
 *     `{ok: false, error}` responses and transport failures
 *   - on 401 the stored token is cleared, but only for requests that actually
 *     sent it (see `sessionRejected` in `request`)
 */
import type { PowChallenge, PowSolution } from "@hetja/pow";


/**
 * Origin of the API, no path component. Asset URLs (dog photos) hang off this
 * directly. NEXT_PUBLIC_API_URL is inlined at build time, so it has to be set
 * before `next build` runs -- setting it only at runtime has no effect.
 */
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");

/** Versioned base for JSON endpoints -- the API registers everything under /api/v1. */
export const API_BASE = `${API_ORIGIN}/api/v1`;

export const ACCESS_TOKEN_KEY = "hetja.accessToken";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, opts: { status: number; code?: string; cause?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export function getAccessToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — auth simply won't persist */
  }
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

/**
 * Default request deadline. Long enough that a slow-but-working 4G round trip
 * with a photo attached still completes, short enough that a stalled socket
 * surfaces as an error while the user is still looking at the screen.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
  /** Override the deadline. `0` disables it — use only where a caller imposes its own. */
  timeoutMs?: number;
}

interface ErrorEnvelope {
  ok: false;
  error: { message: string; code?: string };
}

interface OkEnvelope<T> {
  ok: true;
  data: T;
}

function isErrorEnvelope(payload: unknown): payload is ErrorEnvelope {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { ok?: unknown }).ok === false &&
    typeof (payload as ErrorEnvelope).error?.message === "string"
  );
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // `fetch` does NOT time out on its own. A refused connection rejects
      // quickly, but a socket that opens and then stalls — the normal failure on
      // a congested cell network, rather than a clean refusal — hangs until the
      // browser's own limit, which is minutes. On the SOS modal that meant the
      // button sat disabled reading "Sending SOS…" indefinitely, on the one
      // screen where the user has to learn it failed so they can phone a vet
      // instead.
      //
      // AbortError is mapped to status 408 below so the offline queue's
      // `isRetryable` already classifies it correctly as transient.
      signal: opts.timeoutMs === 0 ? undefined : AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    throw new ApiError(
      timedOut
        ? "Hetja took too long to respond — try again."
        : "Could not reach Hetja — check your connection.",
      {
        status: timedOut ? 408 : 0,
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        cause,
      },
    );
  }

  const payload: unknown = await res.json().catch(() => null);

  // A 401 only tells us something about the stored session if this request
  // actually presented it. `auth: false` endpoints 401 for reasons that have
  // nothing to do with the access token -- `/devices/token` answers 401 for
  // BAD_POW and CHALLENGE_EXPIRED, and `/auth/verify` answers 401 for
  // BAD_DEVICE_TOKEN -- and wiping the session on those would silently sign a
  // feeder out because an unrelated proof-of-work expired.
  const sessionRejected = res.status === 401 && auth;

  if (isErrorEnvelope(payload)) {
    if (sessionRejected) clearAccessToken();
    throw new ApiError(payload.error.message, { status: res.status, code: payload.error.code });
  }

  if (!res.ok) {
    if (sessionRejected) clearAccessToken();
    throw new ApiError(`Request failed (HTTP ${res.status})`, { status: res.status });
  }

  if (typeof payload !== "object" || payload === null || (payload as OkEnvelope<T>).ok !== true) {
    throw new ApiError("Unexpected API response", { status: res.status });
  }

  return (payload as OkEnvelope<T>).data;
}

// ---------------------------------------------------------------------------
// Domain types (mirror @hetja/api response shapes)
// ---------------------------------------------------------------------------

export type DogStatus = "active" | "lost" | "deceased" | "adopted" | "relocated";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface DogProfile {
  slug: string;
  name: string | null;
  status: DogStatus;
  wardId: string;
  photoKey: string | null;
  abcStatus: string | null;
  vaccineStatus: string | null;
  microStory: string | null;
  lastSeenAt: string | null;
  geo: GeoPoint | null;
}

export interface MedicalRecord {
  record_type: string;
  vaccine_name: string | null;
  vaccine_date: string | null;
  abc_date: string | null;
  diagnosis: string | null;
  treatment: string | null;
  severity: string | null;
  created_at: string;
  hash_curr: string;
}

export interface Story {
  id: string;
  version: number;
  paragraph: string;
  moderatedAt: string | null;
  createdAt: string;
}

/** What `POST /api/v1/devices/challenge` answers. `difficulty` is the effective
 * leading-zero-bit count the server rounded the configured DEVICE_POW_DIFFICULTY
 * up to; the solver only needs `challenge.parameters.keyPrefix`, so it is carried
 * here for diagnostics rather than for the solve. */
export interface DeviceChallengeResult {
  challenge: PowChallenge;
  difficulty: number;
}

export interface DeviceTokenResult {
  deviceToken: string;
}

export interface OtpRequestResult {
  expiresAt: string;
  devCode?: string;
}

export interface VerifyResult {
  accessToken: string;
  refreshToken: string;
  feeder: {
    displayName: string;
    trustScore: number;
    role: string;
    homeWard?: string;
  };
}

export interface ScanResult {
  created: boolean;
  scanId?: string;
}

export type SosSeverity = "minor" | "serious" | "critical";

export interface SosReportResult {
  created: boolean;
  caseId: string;
  tier: number;
}

export interface StreakData {
  trustScore: number;
  streakDays: number;
  badges: string[];
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export function dogPhotoUrl(dog: Pick<DogProfile, "photoKey">): string | null {
  if (!dog.photoKey) return null;
  return `${API_ORIGIN}/${dog.photoKey}`;
}

export const api = {
  /** Anonymous public profile for a QR collar slug + HMAC signature. */
  getDog: (slug: string, sig: string) =>
    request<DogProfile>(
      `/dogs/${encodeURIComponent(slug)}?s=${encodeURIComponent(sig)}`,
      { auth: false },
    ),

  /** Anonymous verified medical records for a dog. */
  getDogMedical: (slug: string) =>
    request<{ records: MedicalRecord[] }>(`/dogs/${encodeURIComponent(slug)}/medical`, { auth: false }),

  /** Anonymous moderated micro-stories for a dog. */
  getDogStories: (slug: string) =>
    request<{ stories: Story[] }>(`/dogs/${encodeURIComponent(slug)}/stories`, { auth: false }),

  /**
   * Ask for an ALTCHA proof-of-work challenge to attest this device.
   *
   * `auth: false` and no body: the route is deliberately unauthenticated (it is
   * how a browser with no session at all gets its first credential), and it
   * ignores the request body entirely.
   */
  requestDeviceChallenge: () =>
    request<DeviceChallengeResult>(`/devices/challenge`, { method: "POST", auth: false }),

  /**
   * Exchange a solved challenge for an attested device token.
   *
   * 401s here are about the proof of work, not about any session: BAD_POW,
   * CHALLENGE_EXPIRED, CHALLENGE_REUSED. The challenge must be handed back
   * byte-identical to what the server issued — it carries an HMAC over its own
   * parameters, so re-serialising a mutated copy fails with BAD_CHALLENGE.
   */
  requestDeviceToken: (input: { challenge: PowChallenge; solution: PowSolution }) =>
    request<DeviceTokenResult>(`/devices/token`, { method: "POST", body: input, auth: false }),

  /** Request an OTP for an email address. Dev builds echo devCode. */
  requestOtp: (email: string) =>
    request<OtpRequestResult>(`/auth/otp`, { method: "POST", body: { email }, auth: false }),

  /** Verify the OTP and exchange it for JWT access/refresh tokens. */
  verifyOtp: (input: { email: string; code: string; deviceToken: string; consentVersion: number; isMinor: boolean }) =>
    request<VerifyResult>(`/auth/verify`, { method: "POST", body: input, auth: false }),

  /** POST a feed scan. Idempotent on the server by clientUuid. */
  createScan: (input: { clientUuid: string; dogSlug: string; type: "feed"; geo?: GeoPoint; photoBase64?: string; capturedAt: string }) =>
    request<ScanResult>(`/scans`, { method: "POST", body: input }),

  /** Open an SOS report (minor / serious / critical). */
  createReport: (input: { dogSlug: string; severity: SosSeverity; note?: string }) =>
    request<SosReportResult>(`/reports`, { method: "POST", body: input }),

  /** Feeder self-service: trust score, streak days and badges. */
  getStreak: () => request<StreakData>(`/feeders/me/streak`),
};
