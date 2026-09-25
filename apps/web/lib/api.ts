/**
 * Hetja Feeder API client.
 *
 * Typed fetch wrapper around the @hetja/api HTTP surface:
 *   - origin from NEXT_PUBLIC_API_URL (default http://localhost:8080); every
 *     JSON endpoint is served under the /api/v1 prefix
 *   - Bearer access token attached from localStorage when present
 *   - unwraps the `{ok: true, data}` envelope; throws ApiError on
 *     `{ok: false, error}` responses and transport failures
 *   - on 401 for a request that actually sent the session, the refresh token
 *     is exchanged ONCE at POST /auth/refresh and the request retried with the
 *     new access token; only when there is no refresh token, or the exchange
 *     is refused, is the session cleared (see `sessionRejected` in `request`)
 *
 * THE REFRESH FLOW EXISTED ONLY ON THE SERVER. Migration 0017 and
 * POST /api/v1/auth/refresh were built precisely because "the registrator flow
 * silently 401s when the 15-minute access token dies mid-form with no way to
 * renew it". And then the login page stored only the access token and threw
 * the refresh token away, and nothing in this client ever called the route.
 * Every web session therefore died after JWT_ACCESS_TTL (15 minutes in
 * production): the next authenticated call 401'd, this module wiped the token,
 * and the feeder was signed out mid-task with no explanation. Fixed here: the
 * pair is stored at login, and a 401 is a reason to refresh before it is a
 * reason to sign out.
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
export const REFRESH_TOKEN_KEY = "hetja.refreshToken";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Seconds from the `retry-after` header (429 RATE_LIMITED, 503 PHOTO_BUSY), when the server sent one. */
  readonly retryAfterSec: number | undefined;
  /**
   * The error envelope's `data`, when the server attached one. The one user
   * today: POST /reports 429 carries `data.nearbyCare`, so a capped reporter
   * still gets numbers to call.
   */
  readonly data: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: string; cause?: unknown; retryAfterSec?: number; data?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryAfterSec = opts.retryAfterSec;
    this.data = opts.data;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * `retry-after` as whole seconds. Accepts delta-seconds and an HTTP date;
 * anything else (absent, garbage, negative) is undefined.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
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
    /* storage unavailable (private mode); auth simply won't persist */
  }
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function getRefreshToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode); the session simply won't persist */
  }
}

/** Store a fresh pair, as returned by /auth/verify or /auth/refresh. */
export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  setAccessToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
}

/** Sign out locally: both halves of the session go together. */
export function clearSession(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

/** Shared by concurrent 401s so one expired access token costs one exchange. */
let refreshInFlight: Promise<boolean> | undefined;

/**
 * Exchange the stored refresh token for a fresh pair. Resolves true when the
 * session was renewed and stored, false when it could not be: no refresh
 * token, the server refused it (REFRESH_REUSED, BAD_REFRESH_TOKEN, FEEDER_GONE),
 * or the network failed. Never throws.
 *
 * Raw fetch rather than `request()`: the route takes no Authorization header
 * (the refresh token IS the credential), and routing it through `request`
 * would re-enter this very 401 handling.
 *
 * Single-flight: several requests can fail on the same expired access token in
 * the same tick (the /me page fires two). Each refresh token is one-time-use
 * on the server (presenting it twice is treated as theft and revokes every
 * session the feeder holds), so the second caller must WAIT for the first
 * exchange, not race it with the same token.
 */
export async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        const payload: unknown = await res.json().catch(() => null);
        const data = (payload as { ok?: unknown; data?: { accessToken?: unknown; refreshToken?: unknown } } | null)
          ?.data;
        if (
          !res.ok ||
          (payload as { ok?: unknown } | null)?.ok !== true ||
          typeof data?.accessToken !== "string" ||
          typeof data?.refreshToken !== "string"
        ) {
          return false;
        }
        setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
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
  /** Override the deadline. `0` disables it; use only where a caller imposes its own. */
  timeoutMs?: number;
  /** Sent as `x-device-token` for endpoints that accept device attestation. */
  deviceToken?: string;
  /** Internal: set on the one retry after a successful refresh, so a 401 on
   * the retried request signs out instead of refreshing forever. */
  afterRefresh?: boolean;
}

/**
 * An attested device token, or undefined if one cannot be minted right now.
 *
 * Never throws and never blocks the caller's action. Minting involves a network
 * round trip and a proof-of-work solve that can legitimately time out on a slow
 * handset; when that happens the request proceeds without a token and the
 * server's own 401 handling applies. Failing the user's feed or emergency report
 * because a puzzle did not finish would be a worse outcome than an honest
 * server-side rejection.
 *
 * Imported lazily so that `lib/api` stays usable in contexts (tests, SSR) where
 * the device module's browser dependencies are absent.
 *
 * Exported since the capture-time attestation fix: the feed screen needs exactly
 * this best-effort semantics when a feed is captured offline (never throw,
 * never block, undefined on failure), and duplicating the lazy-import dance
 * would drift from it.
 */
export async function bestEffortDeviceToken(): Promise<string | undefined> {
  try {
    const { getDeviceToken } = await import("./device");
    const outcome = await getDeviceToken();
    return outcome.ok ? outcome.token : undefined;
  } catch {
    return undefined;
  }
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
  const { method = "GET", body, auth = true, deviceToken } = opts;

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  let sentSession = false;
  if (auth) {
    const token = getAccessToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
      sentSession = true;
    }
  }
  // The API accepts a feeder Bearer token OR an attested device token. Sending
  // both is harmless (the route prefers the Bearer), and it means a signed-in
  // feeder whose access token has expired still gets the anonymous path rather
  // than a hard 401.
  if (deviceToken) headers["x-device-token"] = deviceToken;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // `fetch` does NOT time out on its own. A refused connection rejects
      // quickly, but a socket that opens and then stalls (the normal failure on
      // a congested cell network, rather than a clean refusal) hangs until the
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
        ? "Hetja took too long to respond. Try again."
        : "Could not reach Hetja. Check your connection.",
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
  const sessionRejected = res.status === 401 && auth && sentSession;

  if (sessionRejected && !opts.afterRefresh && (await refreshSession())) {
    // The access token was stale, the refresh token was good, the pair is
    // stored: run the original request once more with the new session. A 401
    // on THAT attempt falls through to the sign-out below.
    return request<T>(path, { ...opts, afterRefresh: true });
  }

  const retryAfterSec = parseRetryAfter(res.headers?.get?.("retry-after"));

  if (isErrorEnvelope(payload)) {
    if (sessionRejected) clearSession();
    // `data` sits beside `error` in the envelope; `error.data` is accepted too.
    const data =
      (payload as { data?: unknown }).data ?? (payload.error as { data?: unknown }).data ?? undefined;
    throw new ApiError(payload.error.message, {
      status: res.status,
      code: payload.error.code,
      retryAfterSec,
      data,
    });
  }

  if (!res.ok) {
    if (sessionRejected) clearSession();
    throw new ApiError(`Request failed (HTTP ${res.status})`, { status: res.status, retryAfterSec });
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
  // Design-v4 additions (routes/dogs.ts). Optional so a cached older payload
  // still type-checks: every consumer must tolerate their absence.
  /** Locality of the ward, e.g. "Andheri West". Ward level only (INVARIANT 2). */
  wardName?: string | null;
  /** Vet-verified only: "unknown" is the honest default, never "no". */
  vaccinated?: "yes" | "unknown";
  sterilised?: "yes" | "no" | "unknown";
  /** Latest non-rejected feed by anyone. A time, never who. */
  lastFedAt?: string | null;
  feederCount?: number;
  storyAuthorCount?: number;
  /** Absolute photo URL, or null. */
  photoUrl?: string | null;
}

/** One of the 24 BMC wards (GET /api/v1/wards). */
export interface Ward {
  /** Canonical id stored on the dog, e.g. "K-West". */
  id: string;
  /** Short slash form, e.g. "K/W". */
  code: string;
  /** Locality, e.g. "Andheri West". */
  name: string;
}

/** A dog the signed-in feeder has fed (GET /api/v1/feeders/me/dogs). */
export interface MyDog {
  slug: string;
  name: string | null;
  wardId: string;
  wardName: string | null;
  /** Latest feed of this dog by ANYONE. */
  lastFedAt: string | null;
  /** This feeder's own latest feed of it. */
  myLastFedAt: string;
}

/** How the dog ate, as the feeder saw it (scans.feed_outcome, migration 0024). */
export type FeedOutcomeValue = "ate_all" | "ate_some" | "didnt_eat" | "unwell";

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
  /** Signed-in feeds only: the streak after this feed. */
  streak?: { streakDays: number; lastFeedDate: string | null };
  /**
   * false when the feed was logged but the photo was not kept (the daily
   * photo allowance ran out). Absent on older servers: treat as kept.
   */
  photoAccepted?: boolean;
  /** false when the sent location was outside Mumbai and ignored. Absent when no geo was sent. */
  geoAccepted?: boolean;
}

export type SosSeverity = "minor" | "serious" | "critical";

export interface SosReportResult {
  created: boolean;
  caseId: string;
  tier: number;
  /** "responders" when the responder fan-out ran for this case, "escalated"
   * when the escalation channel owns notification (routes/sos.ts). */
  fanout?: "responders" | "escalated";
  /** Nearby listed care providers, so the reporter has a number to call now. */
  nearbyCare?: NearbyCareProvider[];
}

export type SosCaseState = "open" | "acked" | "escalated" | "resolved" | "false_alarm";

/**
 * GET /api/v1/sos/cases/:id. Readable by the acker, the responders paged for
 * the case, and moderators; anyone else gets 403 SOS_CASE_FORBIDDEN or 404.
 * wardId / wardName arrived with the /sos/[caseId] page (hardening T15).
 * `mine` / `ackedBy` are read when a server sends them; neither is promised.
 */
export interface SosCase {
  id: string;
  severity: SosSeverity;
  state: SosCaseState;
  tier: number;
  openedAt: string;
  ackedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  wardId?: string | null;
  wardName?: string | null;
  mine?: boolean;
  ackedBy?: string | null;
}

export interface NearbyCareProvider {
  id: string;
  name: string;
  kind: string;
  costTier: string;
  phoneE164: string | null;
  altPhoneE164: string | null;
  hasAmbulance: boolean;
  is24x7: boolean;
  hoursNote: string | null;
  handlesWildlife: boolean;
  phoneVerifiedAt: string | null;
  geoPrecision: "exact" | "locality";
  locality: string | null;
  lat: number;
  lng: number;
  distanceM: number | null;
}

export interface StreakData {
  trustScore: number;
  streakDays: number;
  badges: string[];
  /** Asia/Kolkata calendar day (YYYY-MM-DD) of the last feed, or null. */
  lastFeedDate?: string | null;
  nextBadgeHint?: unknown;
  /** First day (YYYY-MM-DD) of the current run; null with no live streak. */
  streakStart?: string | null;
  trustLevel?: TrustLevel;
}

export interface TrustLevel {
  /** "New feeder" | "Trusted feeder". */
  name: string;
  level: number;
  /** Trust score that reaches the next level; null at the top. */
  nextThreshold: number | null;
}

export type RegistrationStatus = "pending_activation" | "active" | "expired" | "lost" | "deceased" | "adopted" | "relocated";

export interface RegistrationSummary {
  slug: string;
  name?: string | null;
  status: string;
  wardId: string;
  registeredAt?: string;
  expiresAt?: string;
}

export interface RegistrationDetail {
  slug: string;
  /** The dog's name as registered (null when none was given). */
  name?: string | null;
  status: string;
  wardId: string;
  registeredAt: string | null;
  expiresAt?: string;
  collarUrl: string;
}

export interface CreateRegistrationInput {
  wardId: string;
  name?: string;
  sex?: "male" | "female" | "unknown";
  approxAge?: number;
  coatPattern?: string;
  temperament?: string;
  batchNo?: string;
  material?: string;
  /**
   * The registrator's own word on medical status (migration 0025). Stored as
   * a self-report only: the public profile never shows these as Vaccinated /
   * Sterilised, only vet-verified records do ("Vets can confirm medical
   * status later").
   */
  vaccinatedReported?: boolean;
  sterilisedReported?: boolean;
  /** v5 R2: the face photo, base64 JPEG/WebP; becomes the dog's portrait. */
  photoBase64?: string;
  /** v5 R4 "How to spot her": at most 8 short strings. */
  markings?: string[];
}

export interface CreateRegistrationResult {
  slug: string;
  status: RegistrationStatus;
  wardId: string;
  registeredAt: string;
  expiresAt: string;
  collarUrl: string;
  budget: { pending: number; max: number };
}

export interface FeederMe {
  feederId: string;
  displayName: string;
  role: string;
  trustScore: number;
  verificationTier: string;
  homeWard: string | null;
  canRegister: boolean;
  registrationBudget: { pending: number; max: number };
  capabilities: string[];
  /** SOS responder consent: the ONLY gate on being paged (routes/sos.ts fan-out). */
  sosOptIn: boolean;
  // Design v5 additions (docs/design/v5-handoff/CONTRACT.md). Optional so an
  // older server still type-checks: treat absence as the default.
  /** BMC ward ids the feeder feeds in; pages are limited to these when set. */
  wards?: string[];
  /** Pushes other than SOS are held back in this window (Asia/Kolkata). */
  quietHours?: QuietHours | null;
  alertsMode?: AlertsMode;
  /** False until N1 (/welcome) has been completed. */
  onboarded?: boolean;
  /** First name and initial, e.g. "Priya S." */
  publicName?: string;
}

// ---------------------------------------------------------------------------
// Design v5 types (docs/design/v5-handoff/CONTRACT.md)
// ---------------------------------------------------------------------------

export interface QuietHours {
  /** "HH:MM", 24-hour, Asia/Kolkata. */
  start: string;
  end: string;
}

export type AlertsMode = "sos_only" | "all";

export interface FeederPatch {
  sosOptIn?: boolean;
  displayName?: string;
  wards?: string[];
  quietHours?: QuietHours | null;
  alertsMode?: AlertsMode;
  onboarded?: true;
}

export type AlertKind = "sos" | "tag" | "verified" | "fed" | "not_seen" | "status";

export interface Alert {
  id: string;
  kind: AlertKind;
  at: string;
  dog: { slug: string; name: string | null } | null;
  wardCode: string | null;
  /** Public names only ("Anil", "Dr Mehta"). */
  actorName: string | null;
  detail: string | null;
  /** Web route to open. */
  href: string;
}

export type AttentionKind = "sos" | "tag" | "missing" | "vet" | "new";

/** A dog the caller registered or fed in the last 60 days (v5 shape of MyDog). */
export interface MyDogV5 extends Omit<MyDog, "myLastFedAt"> {
  myLastFedAt: string | null;
  photoUrl?: string | null;
  status?: DogStatus | "pending_activation" | "expired";
  verified?: boolean;
  registeredByMe?: boolean;
  lastFedByName?: string | null;
  attention?: { kind: AttentionKind; since: string; detail: string | null } | null;
  /** For pronouns in copy; null when not recorded. */
  sex?: DogSex | null;
}

export type DogSex = "male" | "female";

/** A dog as shown in a lookup or ward list: ward level only. */
export interface DogCard {
  slug: string;
  name: string | null;
  wardId: string;
  wardCode: string;
  photoUrl: string | null;
  markings: string[];
  lastSeenAt: string | null;
  sex?: DogSex | null;
}

export interface DogLookupResult {
  exact: DogCard | null;
  matches: DogCard[];
  suggestions: DogCard[];
}

export type CoatColour = "brown" | "black" | "white" | "spotted";

export interface WardDogsResult {
  wardId: string;
  total: number;
  colourTotal: number;
  dogs: DogCard[];
}

export type TagProblemKind = "damaged" | "found_on_ground" | "wrong_dog" | "too_tight";

export interface TagReport {
  id: string;
  kind: TagProblemKind;
  createdAt: string;
  /** "a passer-by" or a public name. */
  reporter: string;
}

export interface TagEvent {
  kind: "reported" | "printed" | "registered" | "resolved";
  at: string;
  detail: string | null;
  byName: string | null;
}

export interface DogTags {
  open: TagReport[];
  history: TagEvent[];
  reportsThisWeek: number;
  sturdierCollarSuggested: boolean;
}

export type PrintLayout = "tags" | "notice" | "batch";
export type PaperSize = "a4" | "letter";

export interface CollarForPrint {
  slug: string;
  name: string | null;
  wardId: string;
  collarUrl: string;
}

export type StatusReportKind = "not_seen" | "adopted" | "passed_away";

export interface StatusReport {
  id: string;
  kind: StatusReportKind;
  createdAt: string;
  reportedByName: string | null;
  mine: boolean;
}

export type RabiesChoice = "given_today" | "up_to_date" | "due";

export interface CheckupInput {
  rabies: RabiesChoice;
  sterilised: boolean;
  /** "YYYY-MM" */
  nextVaccineDue?: string;
  noteForFeeders?: string;
  examined: true;
}

/** v5 fields on GET /sos/cases/:id. `location` is filled only for the acker. */
export interface SosCaseV5 extends SosCase {
  dog?: { slug: string; name: string | null; photoUrl: string | null; sex?: DogSex | null } | null;
  /** True when the SOS came from a device with no account. */
  reporterAnonymous?: boolean;
  reporterPhotoUrl?: string | null;
  note?: string | null;
  respondingName?: string | null;
  respondersPaged?: number;
  nearestCare?: { name: string; phoneE164: string | null } | null;
  declinedByMe?: boolean;
  location?: GeoPoint | null;
}

/** v5 fields on GET /dogs/:slug. */
export interface DogProfileV5 extends DogProfile {
  verified?: boolean;
  tagUnderReview?: boolean;
  sturdierCollarSuggested?: boolean;
  memorial?: { feederNames: string[] } | null;
  sex?: DogSex | null;
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export function dogPhotoUrl(dog: Pick<DogProfile, "photoKey">): string | null {
  if (!dog.photoKey) return null;
  return `${API_ORIGIN}/${dog.photoKey}`;
}

export const api = {
  /**
   * Anonymous public profile for a collar slug. With a QR signature the API
   * verifies it; without one (a typed code) the slug's check character is the
   * gate. Either way an unknown code is a 404 DOG_NOT_FOUND.
   */
  getDog: (slug: string, sig?: string | null) =>
    request<DogProfile>(
      `/dogs/${encodeURIComponent(slug)}${sig ? `?s=${encodeURIComponent(sig)}` : ""}`,
      { auth: false },
    ),

  /** The 24 BMC wards, for the registration ward picker. Public. */
  getWards: () => request<{ wards: Ward[] }>(`/wards`, { auth: false }),

  /** Dogs this feeder has fed, most recent first (Me screen). */
  getMyDogs: () => request<{ dogs: MyDog[] }>(`/feeders/me/dogs`),

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
   * byte-identical to what the server issued: it carries an HMAC over its own
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
  /**
   * Log a feed.
   *
   * The server accepts a feeder Bearer OR an `x-device-token` header
   * (apps/api/src/routes/scans.ts). This client used to send ONLY the Bearer,
   * so an ANONYMOUS feed returned 401 UNAUTHENTICATED_DEVICE, and because the
   * offline queue treated that as retryable, every queued record re-uploaded
   * its photo bytes on every app open, forever, and was never accepted once.
   *
   * FIXED at CAPTURE time, exactly as this comment long prescribed: the Log a
   * feed screen (app/feed) mints a device token when the feed is captured (bestEffortDeviceToken),
   * enqueueFeed persists it with the queued record (IndexedDB schema v2), and
   * flush replays it via `opts.deviceToken`. Minting here, on the REPLAY path,
   * would still be the wrong shape (a proof-of-work round trip per queued
   * record per flush), so the replay only ever presents what capture stored.
   * Tokenless records queued before schema v2 cannot be retroactively
   * attested; offline-queue drops them through recordDroppedFeed instead of
   * retrying them forever. See lib/offline-queue.ts and app/feed/FeedScreen.tsx.
   */
  createScan: (
    input: {
      clientUuid: string;
      dogSlug: string;
      type: "feed" | "retag";
      geo?: GeoPoint;
      photoBase64?: string;
      capturedAt: string;
      /** Feeds only; the API ignores it on other scan types. */
      outcome?: FeedOutcomeValue;
    },
    opts: { deviceToken?: string } = {},
  ) => request<ScanResult>(`/scans`, { method: "POST", body: input, deviceToken: opts.deviceToken }),

  /**
   * Open an SOS report (minor / serious / critical).
   *
   * `deviceToken` in the body is REQUIRED for an anonymous caller
   * (apps/api/src/routes/sos.ts returns 401 UNAUTHENTICATED_DEVICE without it).
   * This client never sent one, so the single primary action on the dog page,
   * "This dog needs help", failed for exactly the persona the page exists for:
   * a stranger with no account. The user was shown the raw server string
   * "attested device token required", on a screen that deliberately strips all
   * navigation, so there was not even a way to sign in from there.
   *
   * apps/scan/src/sheet.ts has always done this correctly; apps/web simply never
   * implemented it.
   */
  createReport: async (input: { dogSlug: string; severity: SosSeverity; note?: string }) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<SosReportResult>(`/reports`, {
      method: "POST",
      body: deviceToken ? { ...input, deviceToken } : input,
    });
  },

  /** One SOS case, for the responder page /sos/[caseId]. */
  getSosCase: (id: string) => request<SosCase>(`/sos/cases/${encodeURIComponent(id)}`),

  /**
   * Take a case ("I can go and help"). The server decides who may: 403
   * SOS_ACK_FORBIDDEN (not a trusted responder for this severity), 409
   * SOS_TOO_MANY_OPEN_ACKS (two cases already held), 409 SOS_ALREADY_ACKED /
   * SOS_CASE_CLOSED, 429 RATE_LIMITED. A retry by the same responder is 200.
   */
  ackSosCase: (id: string) =>
    request<{ id: string; ackedBy?: string; ackedAt: string }>(`/sos/cases/${encodeURIComponent(id)}/ack`, {
      method: "POST",
    }),

  /** Close a case the caller holds (or any, for a moderator). */
  resolveSosCase: (id: string, input: { resolution: string; outcome?: "resolved" | "false_alarm" }) =>
    request<{ id: string; state: SosCaseState; resolvedAt: string; resolution: string }>(
      `/sos/cases/${encodeURIComponent(id)}/resolve`,
      { method: "POST", body: input },
    ),

  /** Feeder self-service: trust score, streak days and badges. */
  getStreak: () => request<StreakData>(`/feeders/me/streak`),

  /** Registration: create a new dog registration (needs x-device-token). */
  createRegistration: (input: CreateRegistrationInput, deviceToken?: string) =>
    request<CreateRegistrationResult>(`/registrations`, {
      method: "POST",
      body: input,
      deviceToken,
    }),

  /** Caller’s own registrations (ward + status). */
  getRegistrations: () => request<{ registrations: RegistrationSummary[] }>(`/registrations`),

  /** One registration including the signed collar URL (behind auth, ownership-checked). */
  getRegistration: (slug: string) =>
    request<RegistrationDetail>(`/registrations/${encodeURIComponent(slug)}`),

  /** Feeder self (role, canRegister, budgets). */
  getFeederMe: () =>
    request<FeederMe>(`/feeders/me`),

  /**
   * Update own profile. `PATCH /api/v1/feeders/me` is strict: at least one of
   * the two fields, nothing else. `sosOptIn` is THE consent surface for the SOS
   * fan-out: `feeders.sos_opt_in` defaults to false and nothing else writes
   * it, so until the web exposed this no feeder could ever be paged.
   */
  updateFeederMe: (input: { sosOptIn?: boolean; displayName?: string }) =>
    request<{ sosOptIn?: boolean; displayName?: string }>(`/feeders/me`, { method: "PATCH", body: input }),

  /** Self-elect the registrator surface. */
  electRegisterSurface: () =>
    request<{ role: string }>(`/feeders/me/surface`, {
      method: "POST",
      body: { surface: "register" },
    }),

  // -------------------------------------------------------------------------
  // Design v5 endpoints (docs/design/v5-handoff/CONTRACT.md). If you add one,
  // add it in this block and keep the contract doc in step.
  // -------------------------------------------------------------------------

  /** Profile, wards, quiet hours, alerts mode, onboarding (N1, N6). */
  patchFeederMe: (input: FeederPatch) =>
    request<Partial<FeederMe>>(`/feeders/me`, { method: "PATCH", body: input }),

  /** N6 "Download my data": the caller's own data as JSON. */
  exportMyData: () => request<Record<string, unknown>>(`/feeders/me/export`),

  /** N6 "Delete my account". Registered dogs and feed logs stay, name removed. */
  deleteMyAccount: () =>
    request<{ deleted: true }>(`/feeders/me`, { method: "DELETE", body: { confirm: "DELETE" } }),

  /** N5 Alerts. */
  getAlerts: () => request<{ items: Alert[] }>(`/feeders/me/alerts`),

  /** N4 My dogs (v5 shape). */
  getMyDogsV5: () => request<{ dogs: MyDogV5[] }>(`/feeders/me/dogs`),

  /** Second-feeder confirmation of a dog (Unverified until confirmed). */
  // The device token lets the API refuse a confirmation from the phone that
  // registered the dog. `via` is the dog's actual verification ("vet" if a vet
  // got there first).
  confirmDog: async (slug: string) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<{ verified: true; via: "feeder" | "vet" }>(`/dogs/${encodeURIComponent(slug)}/confirm`, {
      method: "POST",
      deviceToken,
    });
  },

  /** N3 Vet checkup record; verifies the dog. Vet accounts only. */
  createCheckup: (slug: string, input: CheckupInput) =>
    request<{ verified: true; via: "vet" }>(`/dogs/${encodeURIComponent(slug)}/checkups`, {
      method: "POST",
      body: input,
    }),

  /** F2 / N8: partial code ("?" for unknown characters), or a full-code miss. */
  lookupDogs: (code: string) =>
    request<DogLookupResult>(`/dogs/lookup?code=${encodeURIComponent(code)}`, { auth: false }),

  /** F3 / R3: dogs in a ward, optionally by coat colour. */
  getWardDogs: (wardId: string, colour?: CoatColour) =>
    request<WardDogsResult>(
      `/wards/${encodeURIComponent(wardId)}/dogs${colour ? `?colour=${colour}` : ""}`,
      { auth: false },
    ),

  /** F1 "Send SOS anyway" with no dog: nearest listed vets and NGOs (GET /care, public). */
  getCare: (lat: number, lng: number, maxKm = 8) =>
    request<{ providers: NearbyCareProvider[] }>(`/care?lat=${lat}&lng=${lng}&max_km=${maxKm}`, { auth: false }),

  /** F6 tag history and open reports (feeders of the dog). */
  getDogTags: (slug: string) => request<DogTags>(`/dogs/${encodeURIComponent(slug)}/tags`),

  resolveTagReport: (slug: string, reportId: string, resolution: "reprinted" | "spare" | "checked_ok") =>
    request<{ id: string; resolution: string }>(
      `/dogs/${encodeURIComponent(slug)}/tag-reports/${encodeURIComponent(reportId)}/resolve`,
      { method: "POST", body: { resolution } },
    ),

  /** Record a print for the tag history. */
  recordPrint: (slug: string, input: { layout: PrintLayout; paper: PaperSize; tagCount: number }) =>
    request<{ id: string }>(`/dogs/${encodeURIComponent(slug)}/prints`, { method: "POST", body: input }),

  /** Signed collar URL for reprinting (registrator or feeder of the dog). */
  getCollar: (slug: string) => request<CollarForPrint>(`/dogs/${encodeURIComponent(slug)}/collar`),

  /** R8 batch sheet: signed collar URLs for up to 8 dogs. */
  getCollarBatch: (slugs: string[]) =>
    request<{ dogs: CollarForPrint[]; skipped: string[] }>(`/collars/batch`, { method: "POST", body: { slugs } }),

  /** N9 status update. */
  createStatusReport: (slug: string, kind: StatusReportKind) =>
    request<{ id: string; status: string; needsConfirmation: boolean }>(
      `/dogs/${encodeURIComponent(slug)}/status-reports`,
      { method: "POST", body: { kind } },
    ),

  getStatusReports: (slug: string) =>
    request<{ reports: StatusReport[] }>(`/dogs/${encodeURIComponent(slug)}/status-reports`),

  confirmStatusReport: (slug: string, reportId: string) =>
    request<{ id: string; status: string }>(
      `/dogs/${encodeURIComponent(slug)}/status-reports/${encodeURIComponent(reportId)}/confirm`,
      { method: "POST" },
    ),

  /** N2 v5 case shape. */
  getSosCaseV5: (id: string) => request<SosCaseV5>(`/sos/cases/${encodeURIComponent(id)}`),

  /** N2 "I can't go right now". Never affects escalation. */
  declineSosCase: (id: string) =>
    request<{ declined: true }>(`/sos/cases/${encodeURIComponent(id)}/decline`, { method: "POST" }),
};
