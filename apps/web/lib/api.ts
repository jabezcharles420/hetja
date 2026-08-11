/**
 * StrayNet Feeder API client.
 *
 * Typed fetch wrapper around the @straynet/api HTTP surface:
 *   - base URL from NEXT_PUBLIC_API_URL (default http://localhost:8080)
 *   - Bearer access token attached from localStorage when present
 *   - unwraps the `{ok: true, data}` envelope; throws ApiError on
 *     `{ok: false, error}` responses and transport failures
 *   - on 401 the stored token is cleared (session expired / invalid)
 */

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

export const ACCESS_TOKEN_KEY = "straynet.accessToken";

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

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
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
    });
  } catch (cause) {
    throw new ApiError("Could not reach StrayNet — check your connection.", {
      status: 0,
      code: "NETWORK_ERROR",
      cause,
    });
  }

  const payload: unknown = await res.json().catch(() => null);

  if (isErrorEnvelope(payload)) {
    if (res.status === 401) clearAccessToken();
    throw new ApiError(payload.error.message, { status: res.status, code: payload.error.code });
  }

  if (!res.ok) {
    if (res.status === 401) clearAccessToken();
    throw new ApiError(`Request failed (HTTP ${res.status})`, { status: res.status });
  }

  if (typeof payload !== "object" || payload === null || (payload as OkEnvelope<T>).ok !== true) {
    throw new ApiError("Unexpected API response", { status: res.status });
  }

  return (payload as OkEnvelope<T>).data;
}

// ---------------------------------------------------------------------------
// Domain types (mirror @straynet/api response shapes)
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
  return `${API_BASE}/${dog.photoKey}`;
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

  /** Request an OTP for a +91 e164 phone. Dev builds echo devCode. */
  requestOtp: (phone: string) =>
    request<OtpRequestResult>(`/auth/otp`, { method: "POST", body: { phone }, auth: false }),

  /** Verify the OTP and exchange it for JWT access/refresh tokens. */
  verifyOtp: (input: { phone: string; code: string; deviceToken: string; consentVersion: number; isMinor: boolean }) =>
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
