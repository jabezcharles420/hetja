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
// Design v6 types (docs/design/v6-handoff/CONTRACT.md, "API additions")
//
// Additions to existing shapes use interface merging, so every consumer of
// FeederMe / FeederPatch / DogProfileV5 sees them. All optional: an older
// server still type-checks, and absence means the v5 behaviour.
// ---------------------------------------------------------------------------

export interface FeederMe {
  /** Settings "Show my first name on dogs' pages" (default true). */
  showFirstName?: boolean;
  /** L1 alerts pause: not paged for SOS until this ISO time. null = not paused. */
  sosPausedUntil?: string | null;
}

export interface FeederPatch {
  showFirstName?: boolean;
  /** ISO time in the future (at most 30 days ahead), or null to resume. */
  sosPausedUntil?: string | null;
}

export interface DogProfileV5 {
  /** One entry per feeder of the dog; firstName null when they opted out. */
  feeders?: { firstName: string | null }[];
  /** First name of whoever fed her last, or null (anonymous, opted out). */
  lastFedBy?: string | null;
  /** Every scan of the dog that was not an SOS. */
  scanCount?: number;
}

/** P11 outcomes. `resolved` / `false_alarm` are the v5 values and still accepted. */
export type SosOutcome =
  | "taken_to_vet"
  | "treated_on_spot"
  | "not_found"
  | "died"
  | "resolved"
  | "false_alarm";

export interface ResolveSosInput {
  outcome: SosOutcome;
  /** Free text; defaults to the outcome when omitted. */
  resolution?: string;
  /** With taken_to_vet: the clinic or vet, <= 80 chars. */
  vetName?: string;
}

export type SosTimelineKind =
  | "raised"
  | "told"
  | "escalation_due"
  | "escalated"
  | "taken"
  | "close_by"
  | "arrived"
  | "reporter_update"
  | "reporter_left"
  | "released"
  | "resolved";

export interface SosTimelineEntry {
  at: string;
  kind: SosTimelineKind;
  /** e.g. "3 feeders", a first name, the reporter's note, the outcome. */
  detail: string | null;
}

/** Why the viewer cannot take the case (V22), most important first. */
export type SosForbiddenReason = "not_opted_in" | "paused" | "outside_wards" | "not_enough_trust" | "not_paged";

/** V22 checklist: the caller's OWN standing against lib/sos-eligibility.ts. */
export interface SosResponderChecklist {
  sosOptIn: boolean;
  paused: boolean;
  /** null when the feeder chose no wards (no ward restriction). */
  inMyWards: boolean | null;
  trustScore: number;
  /** Floor for this case's severity (40 minor/serious, 60 critical). */
  trustFloor: number;
  /** Credited feeds still needed to reach the floor (1 trust per feed). */
  feedsToGo: number;
}

/**
 * GET /sos/cases/:id, v6. A caller who may not see the case still gets 403
 * SOS_CASE_FORBIDDEN; its ApiError.data is `{ forbiddenReason, checklist }`
 * (SosCaseForbiddenData) so V22 can render.
 */
export interface SosCaseV6 extends SosCaseV5 {
  timeline?: SosTimelineEntry[];
  feedersTold?: number;
  vetsTold?: number;
  ngosTold?: number;
  /** When the escalation job is due (null once escalated or closed). */
  escalatesAt?: string | null;
  /** Caller's last geotagged scan to the dog, rounded to 100 m; eligible responders only. */
  distanceM?: number | null;
  outcome?: SosOutcome | null;
  vetName?: string | null;
  closeByAt?: string | null;
  arrivedAt?: string | null;
  /** Notes the reporter sent after raising it (L7), oldest first. */
  reporterUpdates?: { at: string; note: string }[];
  reporterLeftAt?: string | null;
  /** Dogless SOS (P8): the case has a ward and no dog; `dog` is null. */
  dogless?: boolean;
}

export interface SosCaseForbiddenData {
  forbiddenReason: SosForbiddenReason;
  /** The case's ward (V22 "This case went to feeders in H/W"). */
  wardId: string | null;
  wardCode: string | null;
  checklist: SosResponderChecklist;
}

/** GET /reports/:caseId/status (reporter's device token), v6. */
export interface ReportStatusV6 {
  state: SosCaseState;
  ackedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  responderFirstName: string | null;
  takenAt: string | null;
  closeByAt: string | null;
  arrivedAt: string | null;
  outcome: SosOutcome | null;
  vetName: string | null;
  /** First names of the feeders paged; opted-out feeders are counted, not named. */
  feedersNotifiedNames: string[];
  feedersNotified: number;
  vetsNotified: number;
  /** The reporter's own updates, oldest first. */
  updates: { at: string; note: string }[];
  leftAt: string | null;
}

/**
 * POST /reports 429 (per-dog cap or rate limit) when this device already has
 * an open case on the dog: ApiError.data.openCase.
 */
export interface OpenCaseRef {
  caseId: string;
  raisedAt: string;
  responderFirstName: string | null;
  takenAt: string | null;
}

/** POST /reports, v6: dogSlug optional (P8 dogless); geo REQUIRED when it is absent, Mumbai only. */
export interface CreateReportInputV6 {
  dogSlug?: string;
  severity: SosSeverity;
  note?: string;
  geo?: GeoPoint;
  photoBase64?: string;
}

export interface SosReportResultV6 extends SosReportResult {
  /** The case's ward (the dog's, or the one `geo` falls in for a dogless report). */
  wardId?: string | null;
}

/** POST /scans additions (L2). */
export interface ScanExtrasV6 {
  /** <= 280 chars, feeds only. */
  note?: string;
  /** With outcome "unwell": one push to the dog's other feeders. */
  tellCoFeeders?: true;
}

/** POST /scans, v6: the v5 input plus note / tellCoFeeders. */
export interface CreateScanInputV6 extends ScanExtrasV6 {
  clientUuid: string;
  dogSlug: string;
  type: "feed" | "retag" | "view";
  geo?: GeoPoint;
  photoBase64?: string;
  capturedAt: string;
  outcome?: FeedOutcomeValue;
}

/** POST /scans/batch (V11): up to 12 feeds, each with the single-feed rules. */
export interface ScanBatchItem {
  clientUuid: string;
  dogSlug: string;
  capturedAt: string;
  geo?: GeoPoint;
  outcome?: FeedOutcomeValue;
  note?: string;
}

export interface ScanBatchResult {
  results: {
    clientUuid: string;
    dogSlug: string;
    created: boolean;
    scanId?: string;
    /** Present when this feed was refused; the others still went in. */
    error?: { code: string; message: string };
  }[];
  streak?: { streakDays: number; lastFeedDate: string | null };
}

/** GET /dogs/:slug/week (N15, feeder of the dog). */
export interface DogWeek {
  /** Last 7 Asia/Kolkata days, oldest first. */
  days: { date: string; fed: boolean; outcome: FeedOutcomeValue | null; byFirstName: string | null }[];
  feederNames: string[];
  /** YYYY-MM-DD; dueDate is the first of the due month. */
  rabiesDue: { lastGiven: string | null; dueDate: string } | null;
  vetRecordCount: number;
}

/** GET /registrations and /registrations/:slug, v6 fields. */
export interface RegistrationV6Fields {
  printedAt?: string | null;
  /** Days until a pending registration expires; null once live. */
  daysLeft?: number | null;
  scanCount?: number;
  liveSince?: string | null;
  lastScanAt?: string | null;
  feederNames?: string[];
}

export interface RegistrationBudgetHolder {
  slug: string;
  name: string | null;
  printedAt: string | null;
  daysLeft: number;
}

export interface RegistrationsV6 {
  registrations: (RegistrationSummary & RegistrationV6Fields)[];
  /** The pending slots and which dogs hold them (P6). */
  budget: { pending: number; max: number; holders: RegistrationBudgetHolder[] };
}

/** POST /registrations/:slug/tag-check (P2): does the scanned code belong to this registration? */
export type TagCheckResult =
  | { match: true }
  | {
      match: false;
      expected: { slug: string; name: string | null };
      /** null when the scanned code is not a dog the caller may see. */
      scanned: { slug: string; name: string | null } | null;
    };

/** GET /map/wards, v6 additions (M1). Public and cached: no case ids here. */
export interface MapCitySummaryV6 {
  dogs: number;
  withCollars: number;
  feeders: number;
  fedToday: number;
  notLoggedToday: number;
}

export interface MapCitySosV6 {
  wardId: string;
  wardCode: string;
  severity: SosSeverity;
  raisedAt: string;
  dogName: string | null;
  /** Someone has taken it. */
  taken: boolean;
}

export interface MapWardsV6 {
  summary?: MapCitySummaryV6;
  sos?: MapCitySosV6[];
}

/** GET /map/wards/:wardId, v6 additions (M2, M6). Ward level only. */
export interface MapWardDetailV6 {
  dogNames?: string[];
  /** Names and times only: no slugs on this public, cached read. */
  notLoggedToday?: { name: string | null; lastLoggedAt: string | null }[];
}

/** v6 fields on each row of the ward detail's `sos` list (MapSos in app/map). */
export interface MapSosV6Fields {
  dogName?: string | null;
  taken?: boolean;
}

// ---------------------------------------------------------------------------
// Design v7 types (docs/design/v7-portals/CONTRACT.md, "API"): the Admin, Vet
// and NGO portals. Every route below is under /api/v1 with the usual
// { ok, data } envelope. Additions to existing shapes use interface merging
// and are optional, as in v6.
//
// Conventions: dates are YYYY-MM-DD, times are ISO strings, ward ids are the
// canonical "K-West" form (wardCode is the "K/W" form). Phone numbers of vets
// and NGOs are PUBLIC professional contacts (owner decision); feeders' contact
// details never appear anywhere (INVARIANT 3).
// ---------------------------------------------------------------------------

/** N5: a dog registered during an NGO collar drive is added to that drive. */
export interface CreateRegistrationInput {
  driveId?: string;
}

export type AdminRole = "owner" | "moderator" | "avatar_editor" | "ward_lead";

/**
 * What an admin's roles let them open (A6). The web portal shows a sidebar
 * section only when its permission is present; the API enforces the same map.
 *   owner          every permission
 *   moderator      vets, ngos, dogs, merge, feeders, collars, sos, reports, team_read, audit, settings
 *   avatar_editor  avatars, dogs (read, for matching), settings
 *   ward_lead      collars, sos, dogs (read), settings: in their wards only
 * "vets_remove", "ngos_remove" and "team" are the owner's alone.
 */
export type AdminPermission =
  | "vets"
  | "vets_remove"
  | "ngos"
  | "ngos_remove"
  | "dogs"
  | "merge"
  | "feeders"
  | "collars"
  | "sos"
  | "reports"
  | "avatars"
  | "team"
  /** Read Team and roles (moderators); writing it is "team" (owner). */
  | "team_read"
  | "audit"
  | "settings";

export interface AdminRoleGrant {
  role: AdminRole;
  /** Ward lead only: the wards it covers. Empty for the other roles. */
  wards: string[];
  grantedAt: string | null;
  grantedByName: string | null;
  /** "config": HETJA_OWNER_EMAILS; "legacy_admin": feeders.role = admin (treated as owner). */
  source: "granted" | "config" | "legacy_admin";
}

/** GET /admin/me. 403 ADMIN_REQUIRED for anyone without a role. */
export interface AdminMe {
  feederId: string;
  name: string;
  roles: AdminRoleGrant[];
  permissions: AdminPermission[];
  /** null = every ward (no ward lead restriction). */
  wards: string[] | null;
}

export type VetStatus = "invited" | "waiting" | "more_info" | "verified" | "suspended" | "declined" | "removed";
export type NgoStatus = "waiting" | "active" | "paused" | "removed";
export type NgoMemberRole = "coordinator" | "rescue" | "collars" | "volunteer";

/**
 * v7 fields on GET /feeders/me: what picks the tab bar (lib/tab-role.ts) and
 * the Me rows. vet: the caller's vet application, if any; ngo: their NGO
 * membership, if any (the NGO's status, and their role in it).
 */
export interface FeederMe {
  vet?: { status: VetStatus; regLabel: string | null } | null;
  ngo?: { id: string; name: string; status: NgoStatus; role: NgoMemberRole } | null;
  /** Roles in the admin portal; empty for almost everyone. */
  adminRoles?: AdminRole[];
}

// --- Documents (V1, N1) -----------------------------------------------------

export type DocumentKind = "certificate" | "photo_id" | "ngo_registration";
/** PDF up to 5 MB; images up to 2 MB (the photo gate's ceiling), EXIF stripped. */
export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** POST /documents: upload one file, then pass its id to /vet/apply or /ngo/register. */
export interface UploadDocumentInput {
  kind: DocumentKind;
  fileName: string;
  mime: DocumentMime;
  /** The file, base64 (a data: prefix is accepted). */
  base64: string;
}

export interface UploadedDocument {
  id: string;
  kind: DocumentKind;
  mime: DocumentMime;
  sizeBytes: number;
  uploadedAt: string;
}

/** Admin view of a document. The bytes stream from GET /admin/documents/:id (admins only, audited). */
export interface AdminDocument extends UploadedDocument {
  /** 30 days after the application was decided; null while it is undecided. */
  deleteAfter: string | null;
  deleted: boolean;
}

// --- Public: professionals, care directory, dogs ----------------------------

/** A verified vet as the public sees them. The phone is a public professional number. */
export interface PublicVet {
  feederId: string;
  name: string;
  council: string;
  regNo: string;
  /** "MSVC 5190". */
  regLabel: string;
  clinic: string | null;
  publicPhone: string | null;
  sosAvailable: boolean;
  sosHours: SosHours | null;
  /** Linked to a government directory entry: label "Government vet · free". */
  isGovernment: boolean;
  costTier: "free" | "subsidised" | "paid" | null;
}

export interface PublicNgo {
  id: string;
  name: string;
  publicPhone: string | null;
  hasAmbulance: boolean;
  ambulanceStatus: "in" | "out" | null;
  bedsFree: number | null;
  isGovernment: false;
}

/** Vets and NGOs covering one ward (GET /wards/:wardId/professionals, POST /reports, map ward detail). */
export interface WardProfessionals {
  vets: PublicVet[];
  ngos: PublicNgo[];
}

/** v7 fields on every care directory row (GET /care, nearbyCare on POST /reports). */
export interface NearbyCareProvider {
  /** Government vet or hospital: always free ("Government vet · free"). */
  isGovernment?: boolean;
  /** The row is a person (a vet), not a place. */
  isPerson?: boolean;
  regNo?: string | null;
  /** Same number as phoneE164: named for the v7 copy. */
  publicPhone?: string | null;
  wards?: string[];
}

export interface SosReportResultV6 {
  /** v7: verified vets and active NGOs covering the case's ward, with public phones. */
  professionals?: WardProfessionals;
}

export interface MapWardDetailV6 {
  professionals?: WardProfessionals;
}

/** v7 fields on GET /dogs/:slug. */
export interface DogProfileV5 {
  /** Published avatar (A3/A4) for pins, lists and share cards; the real photo stays the page's record. */
  avatarUrl?: string | null;
  /** Set when the slug asked for was merged into this dog (A5): the page is the kept dog's. */
  mergedFrom?: { slug: string; name: string | null } | null;
}

export interface DogCard {
  avatarUrl?: string | null;
}

export interface MyDogV5 {
  avatarUrl?: string | null;
}

export interface SosCaseV5 {
  /** v7: the dog's published avatar, beside dog.photoUrl. */
  dogAvatarUrl?: string | null;
}

/** GET /dogs/:slug/health (V4). Public; a Bearer is optional and only sets viewerIsVet. */
export type HealthRecordType =
  | "vaccination"
  | "sterilisation"
  | "treatment"
  | "deworming"
  | "checkup"
  | "other"
  | "withdrawal";

export interface HealthRecord {
  id: string;
  type: HealthRecordType;
  /** "Anti-rabies", "Sterilised", "Deworming", a treatment's title. Empty for a withdrawal. */
  title: string;
  status: "vet_signed" | "feeder_noted";
  /** YYYY-MM-DD, or YYYY-MM when only the month is known. */
  date: string | null;
  dueOn: string | null;
  note: string | null;
  /** isGovernment: the signer is a government vet ("Government vet · free"). */
  vet: { name: string; council: string | null; regNo: string | null; isGovernment?: boolean } | null;
  brand: string | null;
  batch: string | null;
  /** Feeder noted: who added it, public first name (opt-out respected). */
  addedBy: string | null;
  /** A correction: the id of the record it replaces (the old one stays in the list). */
  supersedes: string | null;
  /** A withdrawal (type "withdrawal"): the record it takes off the page. */
  withdraws: string | null;
  /** Set on a record a later withdrawal took off the page. */
  withdrawnAt: string | null;
  /** Correction or withdrawal reason. */
  reason: string | null;
  /** Sterilisation: ear notched. */
  earNotched: boolean | null;
  /** An admin flagged this vet's signatures for re-check (vet removed, "flag"). */
  flagged: boolean;
  /** Feeder noted with an open "Ask a vet to sign" request. */
  signRequestOpen: boolean;
  recordedAt: string;
  /** A vet-signed record that confirmed a feeder note: that note's id (it is also in supersedes). */
  confirms?: string | null;
  /** On a feeder note a vet confirmed: when. */
  confirmedAt?: string | null;
  /**
   * A private photo (the vaccine sticker) is attached. NOT public: fetch it
   * with downloadHealthPhoto (a verified vet, a feeder of the dog, or an admin).
   */
  hasPhoto?: boolean;
  photoPath?: string | null;
}

export interface DogHealth {
  /** Every record, oldest first, corrections and withdrawals included: clients show the current versions. */
  records: HealthRecord[];
  certificateUrl?: string;
  /** Only when the Bearer presented belongs to a verified, unsuspended vet. */
  viewerIsVet: boolean;
}

/** POST /dogs/:slug/health-notes: a feeder of the dog notes care ("Feeder noted"). */
export interface HealthNoteInput {
  type: "vaccination" | "sterilisation" | "treatment" | "deworming" | "other";
  /** Required for treatment/other; defaults from the type otherwise. */
  title?: string;
  date: string;
  vaccine?: string;
  brand?: string;
  batch?: string;
  dueOn?: string;
  note?: string;
}

/** The record a feeder asks a vet to sign, or a vet signs (V3). */
export interface VetRecordProposal {
  type: "vaccination" | "sterilisation" | "treatment";
  /** Vaccination: "Anti-rabies", "DHPPi", ... */
  vaccine?: string;
  brand?: string;
  batch?: string;
  givenOn: string;
  dueOn?: string | null;
  earNotched?: boolean;
  /** Treatment: what it was for / what was given. */
  diagnosis?: string;
  treatment?: string;
  note?: string;
}

/** POST /dogs/:slug/sign-requests (V4 "Ask a vet to sign"). Feeder of the dog. */
export interface SignRequestInput {
  /** The feeder-noted record to turn into a signed one, or a fresh proposal. */
  recordId?: string;
  proposed?: VetRecordProposal;
  /** A particular vet (from GET /dogs/:slug/vets); omitted = any verified vet covering the dog's ward. */
  vetFeederId?: string | null;
  /** The clinic slip, same limits as a scan photo. */
  evidencePhotoBase64?: string;
  note?: string;
}

export interface SignRequest {
  id: string;
  dog: { slug: string; name: string | null; photoUrl: string | null; avatarUrl: string | null };
  proposed: VetRecordProposal;
  recordId: string | null;
  /** First name of the feeder who asked (opt-out respected). */
  requestedBy: string | null;
  requestedAt: string;
  evidencePhotoUrl: string | null;
  note: string | null;
  status: "open" | "signed" | "declined" | "withdrawn";
}

// --- Vet portal (V1 to V5) --------------------------------------------------

export interface SosHours {
  /** "09:00" and "21:00", Mumbai time. A window may wrap midnight. */
  from: string;
  to: string;
}

/** POST /vet/apply (V1). Upload documents first (POST /documents). Mumbai wards only. */
export interface VetApplyInput {
  council: "MSVC";
  regNo: string;
  qualification?: string;
  clinic?: string | null;
  wards: string[];
  sosAvailable: boolean;
  sosHours?: SosHours | null;
  /** Public professional number (Indian, any format; stored E.164). */
  publicPhone: string;
  /** Applying through an NGO: arrives in A2 linked (vouched once a coordinator vouches). */
  ngoId?: string | null;
  documentIds: string[];
}

export interface VetProfile {
  id: string;
  feederId: string;
  name: string;
  council: string;
  regNo: string;
  regLabel: string;
  qualification: string | null;
  clinic: string | null;
  wards: string[];
  sosAvailable: boolean;
  sosHours: SosHours | null;
  publicPhone: string | null;
  status: VetStatus;
  appliedAt: string | null;
  decidedAt: string | null;
  /** The reason an admin typed for Ask for more / Decline / Suspend / Remove. */
  decisionReason: string | null;
  validTo: string | null;
  vouchedBy: { ngoId: string; name: string } | null;
  ngo: { id: string; name: string } | null;
  /** Linked to a government directory entry: "Government vet · free". */
  isGovernment?: boolean;
  careProviderId?: string | null;
}

export interface Passkey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** GET /vet/me. profile null = never applied. */
export interface VetMe {
  profile: VetProfile | null;
  /** Verified and not suspended, and holds a passkey. */
  canSign: boolean;
  canAcceptSos: boolean;
  passkeys: Passkey[];
  documents: UploadedDocument[];
}

/** PATCH /vet/me: profile edits (the registration number changes only by applying again). */
export interface VetPatch {
  clinic?: string | null;
  qualification?: string | null;
  wards?: string[];
  sosAvailable?: boolean;
  sosHours?: SosHours | null;
  publicPhone?: string;
}

/** Opaque WebAuthn JSON: pass options to @simplewebauthn/browser, send its result back as is. */
export type WebAuthnOptionsJSON = Record<string, unknown> & { challenge: string };
export type WebAuthnResponseJSON = Record<string, unknown> & { id: string; type: "public-key" };

export interface VetSosItem {
  caseId: string;
  dog: { slug: string; name: string | null; sex?: DogSex | null; photoUrl: string | null; avatarUrl: string | null } | null;
  wardId: string | null;
  wardCode: string | null;
  wardName: string | null;
  severity: SosSeverity;
  openedAt: string;
  note: string | null;
  /** Signed-in reporter's first name ("Sneha is with him"); null for a passer-by. */
  reporterName: string | null;
  taken: boolean;
  /** From the vet's own last geotagged scan, rounded to 100 m; null when unknown. */
  distanceM: number | null;
}

/** GET /vet/home (V2). 403 VET_NOT_VERIFIED unless verified or suspended. */
export interface VetHome {
  profile: VetProfile;
  canSign: boolean;
  canAcceptSos: boolean;
  sos: VetSosItem[];
  signRequests: SignRequest[];
  signRequestCount: number;
  dueSoon: { count: number; by: string };
}

export interface DueSoonDog {
  slug: string;
  name: string | null;
  wardId: string;
  wardCode: string;
  /** YYYY-MM (the vaccine due month) or YYYY-MM-DD. */
  due: string;
  lastLabel: string | null;
  photoUrl: string | null;
  avatarUrl: string | null;
}

/** GET /vet/dogs/:slug (V2b, V3 header). */
export interface VetDogView {
  dog: {
    slug: string;
    name: string | null;
    sex: DogSex | null;
    approxAge: number | null;
    status: string;
    wardId: string;
    wardCode: string;
    photoUrl: string | null;
    avatarUrl: string | null;
    collar: { code: string; batchNo: string | null } | null;
  };
  youFeed: boolean;
  lastFedAt: string | null;
  lastFedBy: string | null;
  health: DogHealth;
  /** Feeder-noted records a vet could confirm ("1 feeder note to confirm"). */
  notesToConfirm: HealthRecord[];
  openSignRequests: SignRequest[];
  canSign: boolean;
}

/** What a vet signs (V3), corrects (V5) or withdraws. The server hashes exactly this. */
export interface VetRecordDraft extends Partial<Omit<VetRecordProposal, "type">> {
  dogSlug: string;
  /** "withdrawal" takes a signed record off the page (supersedes + reason required). */
  type: VetRecordProposal["type"] | "withdrawal";
  /** Correction or withdrawal: the id of the vet's own signed record. */
  supersedes?: string;
  reason?: string;
  signRequestId?: string;
  /** N5: a vaccination logged during a drive checks the dog's "vaccinate" task. */
  driveDogId?: string;
  /** Confirm this feeder-noted record (signing a request made on a record does this by itself). */
  confirmsRecordId?: string;
  /** From uploadRecordPhoto: the vaccine sticker, private to the record. */
  photoId?: string;
  /** N5: signing from a drive (drive=<id>): ticks that dog's task on the drive, adding the dog if needed. */
  driveId?: string;
}

/** POST /vet/records/options: sign this. The passkey challenge IS recordHash. */
export interface SignOptions {
  challengeId: string;
  recordHash: string;
  options: WebAuthnOptionsJSON;
}

export interface SignedRecord {
  recordId: string;
  hash: string;
  recordHash: string;
  dogSlug: string;
  type: VetRecordDraft["type"];
  signedAt: string;
}

export interface MySignature {
  id: string;
  dog: { slug: string; name: string | null };
  type: HealthRecordType;
  title: string;
  date: string | null;
  batch: string | null;
  signedAt: string;
  status: "valid" | "corrected" | "withdrawn" | "flagged";
  supersedes: string | null;
  /** First name of the feeder whose request this signed, if any. */
  requestedBy?: string | null;
}

/** GET /vet/dogs?q= (verified or suspended vets): dogs in the vet's wards, ward level only. */
export interface VetDogCard {
  slug: string;
  name: string | null;
  sex: DogSex | null;
  wardId: string;
  wardCode: string;
  photoUrl: string | null;
  avatarUrl: string | null;
}

// --- NGO portal (N1 to N5) --------------------------------------------------

export type NgoRegType = "trust" | "society" | "section8" | "other";

export interface NgoOffers {
  ambulance: boolean;
  shelterBeds: boolean;
  sterilisation: boolean;
  collars: boolean;
}

/** POST /ngo/register (N1). Mumbai wards only. The caller becomes its coordinator. */
export interface NgoRegisterInput {
  name: string;
  regType: NgoRegType;
  regNo: string;
  since?: number | null;
  has80g?: boolean;
  wards: string[];
  offers: NgoOffers;
  contactName: string;
  publicPhone: string;
  documentIds: string[];
}

export interface NgoProfile {
  id: string;
  name: string;
  regType: NgoRegType;
  regNo: string;
  since: number | null;
  has80g: boolean;
  wards: string[];
  /** Covers every ward (A7 "Citywide"). */
  citywide: boolean;
  offers: NgoOffers;
  contactName: string | null;
  publicPhone: string | null;
  /** Opening hours ("9 am to 7 pm"), beside the ambulance's own hours. */
  hours?: string | null;
  status: NgoStatus;
  appliedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  ambulance: {
    count: number;
    hours: string | null;
    status: "in" | "out";
    outOnCase: { caseId: string; dogName: string | null } | null;
  };
  beds: { total: number; free: number };
}

/** GET /ngo/me. ngo null = not a member of any NGO. */
export interface NgoMe {
  ngo: NgoProfile | null;
  role: NgoMemberRole | null;
  hasTransport: boolean;
}

export interface NgoSosItem {
  caseId: string;
  dog: { slug: string; name: string | null; photoUrl: string | null; avatarUrl: string | null } | null;
  wardId: string | null;
  wardCode: string | null;
  wardName: string | null;
  severity: SosSeverity;
  openedAt: string;
  state: SosCaseState;
  /** Who is going (N2 "Dr. Pillai + ambulance · ETA 12 min"), or null ("nobody assigned"). */
  assigned: {
    dispatchId: string;
    name: string;
    kind: "vet" | "member";
    withAmbulance: boolean;
    etaMin: number | null;
    accepted: boolean;
  } | null;
  /** First name of whoever took the case, if anyone. */
  takenBy: string | null;
  /** N3 "If nobody accepts in 15 min, the case opens to all vets nearby." */
  opensToVetsAt: string | null;
}

/** GET /ngo/home (N2). 403 NGO_REQUIRED unless a member of an active or paused NGO. */
export interface NgoHome {
  ngo: NgoProfile;
  role: NgoMemberRole;
  sos: NgoSosItem[];
  team: { vets: number; volunteers: number };
  nextDrive: { id: string; title: string; startsAt: string; wardId: string } | null;
  dogs: { total: number; unsterilised: number };
}

/** PATCH /ngo/me (coordinator). */
export interface NgoPatch {
  contactName?: string;
  publicPhone?: string;
  offers?: Partial<NgoOffers>;
  ambulanceCount?: number;
  ambulanceHours?: string | null;
  has80g?: boolean;
  /** Mumbai BMC wards only. Audited; an admin sees the change in A7. */
  wards?: string[];
  hours?: string | null;
}

/** GET /ngo/sos/:caseId/candidates (N3 "Who's going to Moti?"). */
export interface DispatchCandidate {
  kind: "vet" | "member";
  feederId: string;
  name: string;
  /** Member role, or "vet". */
  role: NgoMemberRole | "vet";
  hasTransport: boolean;
  distanceM: number | null;
  /** N3 "Vet · 1.2 km · free": NGO vets are free to the caller. */
  free: boolean;
  busy: boolean;
  /** "Out on Laali's case". */
  busyWith: string | null;
}

export interface DispatchCandidates {
  candidates: DispatchCandidate[];
  ambulance: { available: boolean; busyWith: string | null };
  opensToVetsAt: string | null;
}

export interface NgoDispatchInput {
  feederId: string;
  withAmbulance?: boolean;
  etaMin?: number | null;
}

export interface Dispatch {
  id: string;
  caseId: string;
  ngoId: string | null;
  kind: "ngo_member" | "admin_vet";
  memberName: string;
  withAmbulance: boolean;
  etaMin: number | null;
  sentAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
}

/** GET /ngo/dispatches/mine: cases the caller was sent to. */
export interface MyDispatch extends Dispatch {
  dog: { slug: string; name: string | null } | null;
  wardId: string | null;
  severity: SosSeverity;
  openedAt: string;
  caseState: SosCaseState;
}

export interface NgoTeam {
  vets: { feederId: string; name: string; status: VetStatus; regLabel: string | null; vouchedAt: string | null }[];
  members: { feederId: string; name: string; role: NgoMemberRole; hasTransport: boolean; joinedAt: string }[];
  invites: { id: string; role: NgoMemberRole | "vet"; createdAt: string }[];
  /** Coordinators invite, remove and vouch (N4). */
  canManage: boolean;
}

/** POST /ngo/team/invite. The invite is claimed when that address signs in to Hetja. */
export interface NgoInviteInput {
  email: string;
  role: NgoMemberRole | "vet";
  hasTransport?: boolean;
}

export type DriveTask = "collar" | "vaccinate" | "sterilise";

export interface DriveDog {
  id: string;
  dog: { slug: string; name: string | null; photoUrl: string | null; avatarUrl: string | null };
  tasks: Record<DriveTask, boolean>;
  done: Record<DriveTask, boolean>;
  status: "todo" | "done" | "to_clinic" | "not_found";
  /** The dog's own status: "pending_activation" for one registered during the drive ("Print collar"), else "active". */
  registrationStatus?: string;
}

export interface DriveSummary {
  id: string;
  title: string;
  wardId: string;
  wardCode: string;
  startsAt: string;
  leadVet: { feederId: string; name: string } | null;
  volunteers: number;
  dogs: number;
  needSterilising: number;
  collarsPacked: number;
  startedAt: string | null;
  finishedAt?: string | null;
  state?: "planned" | "started" | "finished";
}

export interface DriveDetail extends DriveSummary {
  volunteerNames: string[];
  dogList: DriveDog[];
}

/** POST /ngo/drives (N5 "New drive"). Coordinator. */
export interface NewDriveInput {
  title?: string;
  wardId: string;
  date: string;
  /** "07:00", Mumbai time. */
  time: string;
  leadVetFeederId?: string | null;
  volunteerIds?: string[];
  collarsPacked?: number;
  dogs?: { slug: string; tasks: Partial<Record<DriveTask, boolean>> }[];
}

/** PATCH /ngo/drives/:id (coordinator). Moving the date re-sends the feeders' heads-up. */
export interface DrivePatch {
  title?: string;
  date?: string;
  time?: string;
  leadVetFeederId?: string | null;
  volunteerIds?: string[];
  collarsPacked?: number;
}

/** v7: POST /registrations during a drive (N5): the new dog joins the drive with the collar task. */
export interface CreateRegistrationInput {
  driveId?: string;
}

export interface CreateRegistrationResult {
  driveDogId?: string;
}

export interface NgoWardDog {
  slug: string;
  name: string | null;
  wardId: string;
  wardCode: string;
  photoUrl: string | null;
  avatarUrl: string | null;
  sterilised: "yes" | "no" | "unknown";
  vaccinated: "yes" | "unknown";
  lastFedAt: string | null;
}

// --- Report a problem (public) ----------------------------------------------

/** POST /dogs/:slug/problems. Device token or Bearer. Deduplicated per reporter, dog and kind for 24 h. */
export interface ProblemReportInput {
  kind: "duplicate" | "photo" | "other";
  /** duplicate: the other dog's code. */
  otherSlug?: string;
  note?: string;
}

/** GET /dogs/:slug/avatar-signoff (feeder of the dog): an avatar an admin asked them to check (A4). */
export interface AvatarSignoff {
  pending: { avatarId: string; imageUrl: string; photoUrl: string | null; requestedAt: string } | null;
}

// --- Admin portal (A1 to A7 and the designed sections) ----------------------

export interface AdminToday {
  /** Sidebar badges; they match the rows below so nothing hides. */
  sidebar: { vets: number; ngos: number; avatars: number; reports: number; sos: number };
  cards: {
    vetsToVerify: { count: number; oldestWaitingDays: number | null };
    avatarsToReview: { count: number; batchId: string | null; batchNumber: number | null; batchCreatedAt?: string | null };
    openSos: { count: number; unassigned: number; oldestUnassignedMin: number | null };
    reports: { count: number; duplicates: number; photos: number; other: number };
  };
  needsYou: NeedsYouItem[];
  week: {
    newDogs: number;
    vetSignedRecords: number;
    sosResolved: number;
    sosTotal: number;
    collarsIssued: number;
    vaccinationsDue14d: number;
  };
}

export type NeedsYouItem =
  | {
      kind: "sos";
      caseId: string;
      dogName: string | null;
      wardId: string | null;
      wardName: string | null;
      severity: SosSeverity;
      note: string | null;
      raisedBy: string | null;
      openedAt: string;
    }
  | { kind: "vet"; vetId: string; name: string; regLabel: string; appliedAt: string; documents: number; vouched: boolean }
  | {
      kind: "duplicate";
      reportId: string | null;
      a: { slug: string; name: string | null };
      b: { slug: string; name: string | null };
      reason: "report" | "similar_name";
      sameWard: boolean;
      differentFeeders: boolean;
    }
  | { kind: "avatars"; batchId: string; batchNumber: number; createdAt?: string; files: number; matched: number; needMatch: number }
  | { kind: "ngo"; ngoId: string; name: string; appliedAt: string }
  | { kind: "report"; reportId: string; reportKind: "photo" | "other"; dog: { slug: string; name: string | null }; createdAt: string };

export interface AdminDogRow {
  slug: string;
  name: string | null;
  wardId: string;
  wardCode: string;
  status: string;
  photoUrl: string | null;
  avatarUrl: string | null;
  collar: { code: string; batchNo: string | null } | null;
  createdAt: string;
  feeders: number;
  lastFedAt: string | null;
}

export interface AdminFeederRow {
  id: string;
  name: string;
  trust: number;
  wards: string[];
  createdAt: string;
  suspended: boolean;
  dogs: number;
  feeds30d: number;
}

export interface AdminVetRow {
  id: string;
  feederId: string;
  name: string;
  council: string;
  regNo: string;
  regLabel: string;
  clinic: string | null;
  status: VetStatus;
  appliedAt: string | null;
  vouched: boolean;
  registerChecked: boolean;
  /** An admin could not find them on the MSVC register (shown red); separate from Decline. */
  registerNotFound?: boolean;
  isGovernment?: boolean;
}

export interface AdminCollarRow {
  slug: string;
  /** "r4n-7kw-2ab". */
  code: string;
  dogName: string | null;
  wardId: string;
  batchNo: string | null;
  material: string;
  issuedAt: string;
  status: string;
  prints: number;
  reissues: number;
}

export interface AdminNgoRow {
  id: string;
  name: string;
  wards: string[];
  citywide: boolean;
  vets: number;
  dogs: number;
  sos30d: number;
  status: NgoStatus;
  appliedAt: string;
}

/** GET /admin/search?q= (the ⌘K box): dogs, feeders, vets, collar ids and NGOs. At most 8 of each. */
export interface AdminSearchResult {
  dogs: AdminDogRow[];
  feeders: AdminFeederRow[];
  vets: AdminVetRow[];
  collars: AdminCollarRow[];
  ngos: AdminNgoRow[];
}

export interface AdminVetDetail extends AdminVetRow {
  qualification: string | null;
  wards: string[];
  sosAvailable: boolean;
  sosHours: SosHours | null;
  publicPhone: string | null;
  /** "+91 98•••• 4410". */
  publicPhoneMasked: string | null;
  registerCheckedAt: string | null;
  registerCheckedBy: string | null;
  validTo: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  vouchedBy: { ngoId: string; name: string } | null;
  ngo: { id: string; name: string } | null;
  documents: AdminDocument[];
  signatures: number;
  signaturesFlagged: boolean;
  careProviderId: string | null;
  /** The council's public register, for the "Checked on the MSVC register" checklist item. */
  registerUrl: string;
}

export interface AdminVetList {
  counts: Record<VetStatus, number>;
  vets: AdminVetRow[];
}

/** POST /admin/vets/:id/verify. The admin ticks "Checked on the MSVC register" (adapted A2). */
export interface VetVerifyInput {
  registerChecked: true;
  /** "YYYY-MM", as read off the register. */
  validTo?: string | null;
  note?: string;
}

/** POST /admin/vets/:id/remove (owner). */
export interface VetRemoveInput {
  reason: string;
  signatures: "keep" | "flag";
}

/** POST /admin/vets/invite and POST /admin/team: an email is HMAC'd at once and never stored. */
export interface AdminInviteInput {
  email: string;
  name?: string;
  ngoId?: string | null;
}

export type AvatarMatch = "id" | "collar" | "manual" | "none";
export type AvatarStatus = "draft" | "published" | "retired" | "rejected";

export interface AvatarTile {
  id: string;
  batchId: string | null;
  fileName: string;
  imageUrl: string;
  match: AvatarMatch;
  dog: {
    slug: string;
    name: string | null;
    /** The real photo on record, shown next to the avatar. */
    photoUrl: string | null;
    photoBy: string | null;
    photoAt: string | null;
    collarBatchNo: string | null;
  } | null;
  /** The dog already has a published avatar this one would replace. */
  replacesExisting: boolean;
  status: AvatarStatus;
  uploadedAt: string;
  publishedAt: string | null;
  signoff: { requestedAt: string; feederName: string | null; answer: "looks_right" | "redo" | null } | null;
}

export interface AvatarBatch {
  id: string;
  number: number;
  createdAt: string;
  createdBy: string | null;
  files: number;
  matched: number;
  published: number;
  status: "open" | "published";
}

export interface AvatarBatchDetail {
  batch: AvatarBatch;
  tiles: AvatarTile[];
  counts: { all: number; byId: number; byCollar: number; manual: number; noMatch: number; replaces: number };
}

/** POST /admin/avatars/batches/:id/files: one file per call. File names match by dog ID or collar batch number. */
export interface AvatarUploadInput {
  fileName: string;
  imageBase64: string;
}

export interface AvatarVersion {
  id: string;
  imageUrl: string;
  status: AvatarStatus;
  publishedAt: string | null;
  retiredAt: string | null;
  /** A retired avatar can be restored until this time (30 days). */
  restorableUntil: string | null;
}

export interface AdminDogDetail extends AdminDogRow {
  registeredBy: { feederId: string; name: string } | null;
  registeredAt: string | null;
  verified: boolean;
  tagUnderReview: boolean;
  sex: DogSex | null;
  markings: string[];
  photos: { scanId: string; url: string; at: string; byName: string | null; hidden: boolean }[];
  avatar: { current: AvatarVersion | null; history: AvatarVersion[] };
  health: DogHealth;
  feedsTotal: number;
  feederList: { feederId: string; name: string }[];
  mergedFrom: { slug: string; name: string | null; mergedAt: string }[];
  mergedInto: { slug: string; name: string | null } | null;
  openReports: AdminReportRow[];
  sos: { caseId: string; severity: SosSeverity; state: SosCaseState; openedAt: string }[];
}

export interface DuplicateDog {
  slug: string;
  name: string | null;
  wardId: string;
  addedAt: string;
  addedBy: string | null;
  collar: string | null;
  feeds: number;
  signedRecords: number;
  photoUrl: string | null;
  feederNames: string[];
}

export interface DuplicateCandidate {
  a: DuplicateDog;
  b: DuplicateDog;
  reason: "report" | "similar_name";
  reportId: string | null;
  /** Name similarity 0..1 for similar_name; null for a report. */
  score: number | null;
}

/** POST /admin/dogs/merge (A5). */
export interface MergeInput {
  keepSlug: string;
  mergeSlug: string;
  /** The name to keep; default the kept dog's own. */
  name?: string | null;
  reportId?: string | null;
}

export interface MergeResult {
  keptSlug: string;
  mergedSlug: string;
  feeds: number;
  signedRecords: number;
  feedersAdded: number;
}

export interface AdminFeederDetail extends AdminFeederRow {
  role: string;
  trustEvents: { at: string; type: string; delta: number; reason: string }[];
  dogList: { slug: string; name: string | null }[];
  recentFeeds: { scanId: string; dog: { slug: string; name: string | null }; at: string; photoUrl: string | null; hidden: boolean }[];
  reportsAgainst: number;
  suspension: { at: string; reason: string | null; byName: string | null } | null;
  /** Opaque references to devices this account used, for Block device. Never the device id itself. */
  devices: { deviceRef: string; lastSeenAt: string; blocked: boolean }[];
  vet: { status: VetStatus } | null;
  ngo: { name: string; role: NgoMemberRole } | null;
}

/** POST /admin/devices/block: one of the four references, and a reason. */
export interface BlockDeviceInput {
  deviceRef?: string;
  scanId?: string;
  caseId?: string;
  reason: string;
}

export interface AdminCollarDetail extends AdminCollarRow {
  printList: { at: string; layout: string; paper: string; tagCount: number; byName: string | null }[];
  reissueList: { at: string; previousBatchNo: string; newBatchNo: string; reason: string | null; byName: string | null }[];
}

export interface AdminSosRow {
  id: string;
  dog: { slug: string; name: string | null } | null;
  wardId: string | null;
  wardCode: string | null;
  severity: SosSeverity;
  state: SosCaseState;
  openedAt: string;
  ackedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  raisedBy: string | null;
  responder: string | null;
  /** Minutes open with nobody taking it; null once taken or closed. */
  unassignedMin: number | null;
  ngo: { id: string; name: string } | null;
  assignedVet: { feederId: string; name: string } | null;
}

export interface AdminSosDetail extends AdminSosRow {
  note: string | null;
  outcome: SosOutcome | null;
  timeline: SosTimelineEntry[];
  told: { feeders: number; vets: number; ngos: number };
  dispatches: Dispatch[];
}

/** GET /admin/sos/:id/vets: who "Assign a vet" can page. */
export interface AssignableVet {
  feederId: string;
  name: string;
  regLabel: string;
  clinic: string | null;
  wards: string[];
  coversWard: boolean;
  sosAvailable: boolean;
  inHours: boolean;
  publicPhone: string | null;
}

export interface AdminReportRow {
  id: string;
  /** "tag" rows are tag reports (fake tags, wrong dog); resolve those from the dog. */
  source: "report" | "tag";
  kind: "duplicate_dog" | "photo" | "other" | TagProblemKind;
  dog: { slug: string; name: string | null; photoUrl: string | null };
  otherDog: { slug: string; name: string | null } | null;
  note: string | null;
  reporter: string | null;
  createdAt: string;
  status: "open" | "resolved";
  outcome: string | null;
  /** Photo reports: the photo that was on the page when reported (take it down with hidePhoto(scanId)). */
  scanId?: string | null;
  photoUrl?: string | null;
  photoHidden?: boolean;
}

/** POST /admin/tag-reports/:id/resolve (Reports, "fake tags"). */
export type TagReportAdminOutcome = "reprinted" | "spare" | "checked_ok" | "fake_tag" | "no_action";

export interface ReportResolveInput {
  outcome: "merged" | "different" | "photo_removed" | "no_action" | "fixed";
  note?: string;
}

export interface AdminTeam {
  members: { feederId: string; name: string; roles: AdminRoleGrant[] }[];
  invites: { id: string; role: AdminRole; wards: string[]; createdAt: string; invitedBy: string | null }[];
}

/** POST /admin/team (owner): grant to an existing account, or invite an address. */
export interface TeamAddInput {
  email: string;
  role: AdminRole;
  wards?: string[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string | null; name: string | null; kind: "admin" | "vet" | "ngo" | "feeder" | "system" };
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  /** One line, e.g. "verified Dr. Arjun Deshmukh". Never contact details or document contents. */
  summary: string;
  detail: Record<string, unknown>;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass as ?before= for the next page; null at the end. */
  nextBefore: string | null;
}

export interface AdminNgoDetail extends NgoProfile {
  vetCount: number;
  dogCount: number;
  sos30d: number;
  members: number;
  vetList: { feederId: string; name: string; status: VetStatus; vouched: boolean }[];
  documents: AdminDocument[];
  careProviderId: string | null;
}

export interface AdminNgoList {
  counts: Record<NgoStatus, number>;
  ngos: AdminNgoRow[];
}

/** POST /admin/ngos ("Add an NGO"): created active; the coordinator is invited by email. */
export interface AdminNgoCreateInput extends Omit<NgoRegisterInput, "documentIds"> {
  coordinatorEmail?: string;
  citywide?: boolean;
}

export type AdminNgoPatch = Partial<Omit<AdminNgoCreateInput, "coordinatorEmail">>;

/** GET /admin/care?q=: directory entries to link a vet or NGO to. */
export interface CareDirectoryEntry {
  id: string;
  name: string;
  kind: string;
  isPerson: boolean;
  isGovernment: boolean;
  regNo: string | null;
  wards: string[];
  phoneE164: string | null;
  listed: boolean;
}

/** GET /admin/settings: the rules, read-only. */
export interface AdminSettings {
  sos: {
    escalateAfterMin: number;
    ngoWindowMin: number;
    trustFloors: Record<SosSeverity, number>;
    maxOpenAcks: number;
    dailyCap: number;
    weeklyCap: number;
    maxPaged: number;
  };
  retention: { photoDays: number; documentDaysAfterDecision: number; avatarPreviousDays: number };
  budgets: { scanPageKb: number; feedTrustDailyCap: number };
  limits: { name: string; rule: string }[];
}

/**
 * Admin downloads that are not JSON: a document (A2, A7) or the audit CSV
 * (A6). Same session and one refresh as request(); errors arrive as ApiError.
 */
export async function downloadBlob(path: string, afterRefresh = false): Promise<{ blob: Blob; fileName: string | null }> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
  } catch (cause) {
    throw new ApiError("Could not reach Hetja. Check your connection.", { status: 0, code: "NETWORK_ERROR", cause });
  }
  if (res.status === 401 && token && !afterRefresh && (await refreshSession())) return downloadBlob(path, true);
  if (!res.ok) {
    const payload: unknown = await res.json().catch(() => null);
    const message = isErrorEnvelope(payload) ? payload.error.message : `Request failed (HTTP ${res.status})`;
    const code = isErrorEnvelope(payload) ? payload.error.code : undefined;
    throw new ApiError(message, { status: res.status, code });
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(disposition);
  return { blob: await res.blob(), fileName: m ? m[1] : null };
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

  // -------------------------------------------------------------------------
  // Design v6 endpoints (docs/design/v6-handoff/CONTRACT.md). Profile fields
  // (showFirstName, sosPausedUntil) go through patchFeederMe above.
  // -------------------------------------------------------------------------

  /** P11: close a taken case with an outcome. `died` also opens the N9 passed-away report. */
  resolveSosCaseV6: (id: string, input: ResolveSosInput) =>
    request<{ id: string; state: SosCaseState; resolvedAt: string; resolution: string; outcome: SosOutcome }>(
      `/sos/cases/${encodeURIComponent(id)}/resolve`,
      { method: "POST", body: input },
    ),

  /** P10 "I can't make it after all": back to open, re-pages; escalation clock unchanged. */
  releaseSosCase: (id: string) =>
    request<{ id: string; state: "open" }>(`/sos/cases/${encodeURIComponent(id)}/release`, { method: "POST" }),

  /** V21 "With Rani". Acker only. */
  arrivedSosCase: (id: string) =>
    request<{ id: string; arrivedAt: string }>(`/sos/cases/${encodeURIComponent(id)}/arrived`, { method: "POST" }),

  /** "Tell the reporter you're close". Acker only. */
  closeBySosCase: (id: string) =>
    request<{ id: string; closeByAt: string }>(`/sos/cases/${encodeURIComponent(id)}/close-by`, { method: "POST" }),

  /** P9 / L4 / L5 / V21 case page. 403 carries SosCaseForbiddenData for V22. */
  getSosCaseV6: (id: string) => request<SosCaseV6>(`/sos/cases/${encodeURIComponent(id)}`),

  /**
   * POST /reports v6: dogless when dogSlug is absent (geo required, Mumbai
   * only). A 429 may carry `data.openCase` (OpenCaseRef) and `data.nearbyCare`.
   */
  createReportV6: async (input: CreateReportInputV6) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<SosReportResultV6>(`/reports`, {
      method: "POST",
      body: deviceToken ? { ...input, deviceToken } : input,
    });
  },

  /** N10 / N11 / V19 / L7: the reporter's view; needs the device token that filed it (or the account). */
  getReportStatus: async (caseId: string) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<ReportStatusV6>(`/reports/${encodeURIComponent(caseId)}/status`, { deviceToken });
  },

  /** L7 "Send Priya an update" / "Add an update": <= 280 chars. */
  postReportUpdate: async (caseId: string, note: string) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<{ at: string }>(`/reports/${encodeURIComponent(caseId)}/updates`, {
      method: "POST",
      body: { note },
      deviceToken,
    });
  },

  /** "I had to leave". */
  reportLeft: async (caseId: string) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<{ leftAt: string }>(`/reports/${encodeURIComponent(caseId)}/left`, {
      method: "POST",
      deviceToken,
    });
  },

  /** L2 single feed with a note / tell co-feeders (same route as createScan). */
  createScanV6: (
    input: CreateScanInputV6,
    opts: { deviceToken?: string } = {},
  ) => request<ScanResult & { coFeedersTold?: number }>(`/scans`, { method: "POST", body: input, deviceToken: opts.deviceToken }),

  /** V11 round: up to 12 feeds in one call. */
  createScanBatch: (feeds: ScanBatchItem[], opts: { deviceToken?: string } = {}) =>
    request<ScanBatchResult>(`/scans/batch`, { method: "POST", body: { feeds }, deviceToken: opts.deviceToken }),

  /** N16 "Save story": a new story version (moderated before it shows). 429 after 5 a day. */
  createStory: (slug: string, paragraph: string) =>
    request<Story>(`/dogs/${encodeURIComponent(slug)}/stories`, { method: "POST", body: { paragraph } }),

  /** N15 a dog's week (feeder of the dog). */
  getDogWeek: (slug: string) => request<DogWeek>(`/dogs/${encodeURIComponent(slug)}/week`),

  /** P6 / V12: registrations with v6 fields and the budget holders. */
  getRegistrationsV6: () => request<RegistrationsV6>(`/registrations`),

  getRegistrationV6: (slug: string) =>
    request<RegistrationDetail & RegistrationV6Fields>(`/registrations/${encodeURIComponent(slug)}`),

  /** P2: check a scanned code against the registration before activating. */
  checkRegistrationTag: (slug: string, code: string) =>
    request<TagCheckResult>(`/registrations/${encodeURIComponent(slug)}/tag-check`, {
      method: "POST",
      body: { code },
    }),
  // -------------------------------------------------------------------------
  // Design v7 endpoints (docs/design/v7-portals/CONTRACT.md). Shapes are the
  // "Design v7 types" block above. Admin downloads (documents, the audit CSV)
  // use downloadBlob below, not request(), because they are not JSON.
  // -------------------------------------------------------------------------

  // Public
  /** V4 health list. Bearer optional (only sets viewerIsVet); a bad token is ignored. */
  getDogHealth: (slug: string) => request<DogHealth>(`/dogs/${encodeURIComponent(slug)}/health`),
  /** Vets and NGOs covering a ward, public numbers. */
  getWardProfessionals: (wardId: string) =>
    request<WardProfessionals>(`/wards/${encodeURIComponent(wardId)}/professionals`, { auth: false }),
  /** Verified vets covering the dog's ward, for "Ask a vet to sign". */
  getDogVets: (slug: string) => request<{ vets: PublicVet[] }>(`/dogs/${encodeURIComponent(slug)}/vets`),
  /** "Report a problem" (duplicate, photo, other). */
  reportProblem: async (slug: string, input: ProblemReportInput) => {
    const deviceToken = await bestEffortDeviceToken();
    return request<{ id: string; created: boolean }>(`/dogs/${encodeURIComponent(slug)}/problems`, {
      method: "POST",
      body: input,
      deviceToken,
    });
  },

  // Feeder side of signing (V4)
  addHealthNote: (slug: string, input: HealthNoteInput) =>
    request<{ recordId: string }>(`/dogs/${encodeURIComponent(slug)}/health-notes`, { method: "POST", body: input }),
  askVetToSign: (slug: string, input: SignRequestInput) =>
    request<{ id: string }>(`/dogs/${encodeURIComponent(slug)}/sign-requests`, { method: "POST", body: input }),
  getAvatarSignoff: (slug: string) => request<AvatarSignoff>(`/dogs/${encodeURIComponent(slug)}/avatar-signoff`),
  answerAvatarSignoff: (slug: string, avatarId: string, answer: "looks_right" | "redo") =>
    request<{ answered: true }>(`/dogs/${encodeURIComponent(slug)}/avatar-signoff`, {
      method: "POST",
      body: { avatarId, answer },
    }),

  // Documents (V1, N1)
  uploadDocument: (input: UploadDocumentInput) =>
    request<UploadedDocument>(`/documents`, { method: "POST", body: input, timeoutMs: 60_000 }),

  // Vet (V1 to V5)
  getVetMe: () => request<VetMe>(`/vet/me`),
  applyAsVet: (input: VetApplyInput) => request<VetProfile>(`/vet/apply`, { method: "POST", body: input }),
  patchVetMe: (input: VetPatch) => request<VetProfile>(`/vet/me`, { method: "PATCH", body: input }),
  getVetHome: () => request<VetHome>(`/vet/home`),
  getVetDueSoon: () => request<{ dogs: DueSoonDog[]; by: string }>(`/vet/due-soon`),
  getVetDog: (slug: string) => request<VetDogView>(`/vet/dogs/${encodeURIComponent(slug)}`),
  getVetSignRequests: () => request<{ requests: SignRequest[] }>(`/vet/sign-requests`),
  /** V3 "I didn't give this". */
  declineSignRequest: (id: string, reason?: string) =>
    request<{ declined: true }>(`/vet/sign-requests/${encodeURIComponent(id)}/decline`, {
      method: "POST",
      body: reason ? { reason } : {},
    }),
  /** Passkey setup: options for navigator.credentials.create (via @simplewebauthn/browser startRegistration). */
  passkeyRegistrationOptions: () => request<WebAuthnOptionsJSON>(`/vet/passkeys/options`, { method: "POST", body: {} }),
  registerPasskey: (response: WebAuthnResponseJSON, label?: string) =>
    request<Passkey>(`/vet/passkeys`, { method: "POST", body: { response, label } }),
  removePasskey: (id: string) =>
    request<{ removed: true }>(`/vet/passkeys/${encodeURIComponent(id)}/remove`, { method: "POST", body: {} }),
  /** V3/V5 step 1: the server hashes the draft; the passkey signs that hash (startAuthentication). */
  signOptions: (record: VetRecordDraft) =>
    request<SignOptions>(`/vet/records/options`, { method: "POST", body: { record } }),
  /** V3/V5 step 2: the same draft, byte for byte, and the assertion. */
  signRecord: (challengeId: string, record: VetRecordDraft, assertion: WebAuthnResponseJSON) =>
    request<SignedRecord>(`/vet/records`, { method: "POST", body: { challengeId, record, assertion } }),
  getMySignatures: () => request<{ signatures: MySignature[] }>(`/vet/signatures`),
  getMySignature: (id: string) => request<MySignature>(`/vet/signatures/${encodeURIComponent(id)}`),
  getVetSignRequest: (id: string) => request<SignRequest>(`/vet/sign-requests/${encodeURIComponent(id)}`),
  /** V2 "Or search by name or ID": dogs in the vet's wards. */
  searchVetDogs: (q: string) => request<{ dogs: VetDogCard[] }>(`/vet/dogs?q=${encodeURIComponent(q)}`),
  /** V3 vaccine sticker: upload first, then pass photoId in the draft. Private to the record. */
  uploadRecordPhoto: (base64: string) =>
    request<{ photoId: string }>(`/vet/record-photos`, { method: "POST", body: { base64 }, timeoutMs: 60_000 }),
  /** A record's private photo (HealthRecord.photoPath), for vets, the dog's feeders and admins. */
  downloadHealthPhoto: (photoPath: string) => downloadBlob(photoPath),

  // NGO (N1 to N5)
  registerNgo: (input: NgoRegisterInput) => request<NgoProfile>(`/ngo/register`, { method: "POST", body: input }),
  getNgoMe: () => request<NgoMe>(`/ngo/me`),
  patchNgoMe: (input: NgoPatch) => request<NgoProfile>(`/ngo/me`, { method: "PATCH", body: input }),
  getNgoHome: () => request<NgoHome>(`/ngo/home`),
  /** N2 "Mark back" / out on a case. */
  setAmbulance: (status: "in" | "out", caseId?: string | null) =>
    request<NgoProfile["ambulance"]>(`/ngo/ambulance`, { method: "POST", body: { status, caseId: caseId ?? null } }),
  /** N2 "Update" shelter beds. */
  setBeds: (free: number, total?: number) =>
    request<NgoProfile["beds"]>(`/ngo/beds`, { method: "POST", body: total === undefined ? { free } : { free, total } }),
  getDispatchCandidates: (caseId: string) =>
    request<DispatchCandidates>(`/ngo/sos/${encodeURIComponent(caseId)}/candidates`),
  /** N3 "Send Dr. Qureshi": pages that member; their accept takes the case as them. */
  dispatch: (caseId: string, input: NgoDispatchInput) =>
    request<Dispatch>(`/ngo/sos/${encodeURIComponent(caseId)}/dispatch`, { method: "POST", body: input }),
  /** N3 "We can't take this one": opens the case to every vet nearby now. */
  passSos: (caseId: string) =>
    request<{ passed: true }>(`/ngo/sos/${encodeURIComponent(caseId)}/pass`, { method: "POST", body: {} }),
  getMyDispatches: () => request<{ dispatches: MyDispatch[] }>(`/ngo/dispatches/mine`),
  acceptDispatch: (id: string) =>
    request<{ caseId: string; ackedAt: string }>(`/ngo/dispatches/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: {},
    }),
  declineDispatch: (id: string) =>
    request<{ declined: true }>(`/ngo/dispatches/${encodeURIComponent(id)}/decline`, { method: "POST", body: {} }),
  getNgoTeam: () => request<NgoTeam>(`/ngo/team`),
  inviteToNgo: (input: NgoInviteInput) =>
    request<{ id: string; joined: boolean }>(`/ngo/team/invite`, { method: "POST", body: input }),
  updateNgoMember: (feederId: string, input: { role?: NgoMemberRole; hasTransport?: boolean }) =>
    request<{ updated: true }>(`/ngo/team/${encodeURIComponent(feederId)}`, { method: "PATCH", body: input }),
  removeNgoMember: (feederId: string) =>
    request<{ removed: true }>(`/ngo/team/${encodeURIComponent(feederId)}/remove`, { method: "POST", body: {} }),
  /** N4 "Vouch for her". */
  vouchForVet: (vetFeederId: string) =>
    request<{ vouchedAt: string }>(`/ngo/vets/${encodeURIComponent(vetFeederId)}/vouch`, { method: "POST", body: {} }),
  getNgoDogs: (filter?: "unsterilised" | "unvaccinated") =>
    request<{ dogs: NgoWardDog[]; total: number }>(`/ngo/dogs${filter ? `?filter=${filter}` : ""}`),
  getDrives: () => request<{ drives: DriveSummary[] }>(`/ngo/drives`),
  createDrive: (input: NewDriveInput) => request<DriveDetail>(`/ngo/drives`, { method: "POST", body: input }),
  getDrive: (id: string) => request<DriveDetail>(`/ngo/drives/${encodeURIComponent(id)}`),
  addDriveDog: (id: string, slug: string, tasks: Partial<Record<DriveTask, boolean>>) =>
    request<DriveDog>(`/ngo/drives/${encodeURIComponent(id)}/dogs`, { method: "POST", body: { slug, tasks } }),
  /** N5 "tap to check off". */
  updateDriveDog: (
    id: string,
    driveDogId: string,
    input: { done?: Partial<Record<DriveTask, boolean>>; status?: DriveDog["status"] },
  ) =>
    request<DriveDog>(`/ngo/drives/${encodeURIComponent(id)}/dogs/${encodeURIComponent(driveDogId)}`, {
      method: "PATCH",
      body: input,
    }),
  patchDrive: (id: string, input: DrivePatch) =>
    request<DriveDetail>(`/ngo/drives/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  /** N5 finish: state "finished", audited. */
  finishDrive: (id: string) =>
    request<{ state: "finished"; finishedAt: string }>(`/ngo/drives/${encodeURIComponent(id)}/finish`, {
      method: "POST",
      body: {},
    }),
  startDrive: (id: string) =>
    request<{ startedAt: string }>(`/ngo/drives/${encodeURIComponent(id)}/start`, { method: "POST", body: {} }),

  // Admin (A1 to A7 and the designed sections). Every write is audited.
  getAdminMe: () => request<AdminMe>(`/admin/me`),
  getAdminToday: () => request<AdminToday>(`/admin/today`),
  adminSearch: (q: string) => request<AdminSearchResult>(`/admin/search?q=${encodeURIComponent(q)}`),

  getAdminVets: (status?: VetStatus) =>
    request<AdminVetList>(`/admin/vets${status ? `?status=${status}` : ""}`),
  getAdminVet: (id: string) => request<AdminVetDetail>(`/admin/vets/${encodeURIComponent(id)}`),
  verifyVet: (id: string, input: VetVerifyInput) =>
    request<AdminVetDetail>(`/admin/vets/${encodeURIComponent(id)}/verify`, { method: "POST", body: input }),
  /** "ask-more" | "decline" | "suspend" take { reason }; "reinstate" takes {}. */
  decideVet: (id: string, action: "ask-more" | "decline" | "suspend" | "reinstate", reason?: string) =>
    request<AdminVetDetail>(`/admin/vets/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: reason ? { reason } : {},
    }),
  /** A2 "Not found" on the MSVC register (found: true clears it; Verify clears it too). */
  markNotOnRegister: (id: string, input: { note?: string; found?: boolean } = {}) =>
    request<AdminVetDetail>(`/admin/vets/${encodeURIComponent(id)}/not-on-register`, { method: "POST", body: input }),
  removeVet: (id: string, input: VetRemoveInput) =>
    request<AdminVetDetail>(`/admin/vets/${encodeURIComponent(id)}/remove`, { method: "POST", body: input }),
  inviteVet: (input: AdminInviteInput) =>
    request<{ id: string; existingAccount: boolean }>(`/admin/vets/invite`, { method: "POST", body: input }),
  linkVetCare: (id: string, careProviderId: string | null) =>
    request<{ careProviderId: string | null }>(`/admin/vets/${encodeURIComponent(id)}/link-care`, {
      method: "POST",
      body: { careProviderId },
    }),

  getAdminNgos: (status?: NgoStatus) => request<AdminNgoList>(`/admin/ngos${status ? `?status=${status}` : ""}`),
  getAdminNgo: (id: string) => request<AdminNgoDetail>(`/admin/ngos/${encodeURIComponent(id)}`),
  createAdminNgo: (input: AdminNgoCreateInput) => request<AdminNgoDetail>(`/admin/ngos`, { method: "POST", body: input }),
  patchAdminNgo: (id: string, input: AdminNgoPatch) =>
    request<AdminNgoDetail>(`/admin/ngos/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  /** "approve" | "resume" take {}; "pause" | "remove" take { reason }. */
  decideNgo: (id: string, action: "approve" | "pause" | "resume" | "remove", reason?: string) =>
    request<AdminNgoDetail>(`/admin/ngos/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: reason ? { reason } : {},
    }),
  linkNgoCare: (id: string, careProviderId: string | null) =>
    request<{ careProviderId: string | null }>(`/admin/ngos/${encodeURIComponent(id)}/link-care`, {
      method: "POST",
      body: { careProviderId },
    }),
  searchCare: (q: string) => request<{ entries: CareDirectoryEntry[] }>(`/admin/care?q=${encodeURIComponent(q)}`),

  getAvatarBatches: () => request<{ batches: AvatarBatch[] }>(`/admin/avatars/batches`),
  createAvatarBatch: () => request<AvatarBatch>(`/admin/avatars/batches`, { method: "POST", body: {} }),
  getAvatarBatch: (id: string) => request<AvatarBatchDetail>(`/admin/avatars/batches/${encodeURIComponent(id)}`),
  uploadAvatar: (batchId: string, input: AvatarUploadInput) =>
    request<AvatarTile>(`/admin/avatars/batches/${encodeURIComponent(batchId)}/files`, {
      method: "POST",
      body: input,
      timeoutMs: 60_000,
    }),
  /** Publish every matched draft in the batch. */
  publishAvatarBatch: (batchId: string) =>
    request<{ published: number }>(`/admin/avatars/batches/${encodeURIComponent(batchId)}/publish`, {
      method: "POST",
      body: {},
    }),
  getAvatar: (id: string) => request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}`),
  /** Pick the dog (no-match tile) or clear it ("Wrong dog": dogSlug null). */
  matchAvatar: (id: string, dogSlug: string | null) =>
    request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}/match`, { method: "POST", body: { dogSlug } }),
  /** A4 "Approve": publish this one now. */
  publishAvatar: (id: string) =>
    request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}/publish`, { method: "POST", body: {} }),
  /** A4 "Upload a different file". */
  replaceAvatarFile: (id: string, input: AvatarUploadInput) =>
    request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}/file`, { method: "POST", body: input, timeoutMs: 60_000 }),
  /** A4 "Ask Priya". */
  askAvatarSignoff: (id: string) =>
    request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}/ask-feeder`, { method: "POST", body: {} }),
  /** Put a retired avatar back (within 30 days). */
  restoreAvatar: (id: string) =>
    request<AvatarTile>(`/admin/avatars/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} }),

  getAdminDogs: (params: { q?: string; ward?: string; status?: string } = {}) =>
    request<{ dogs: AdminDogRow[] }>(`/admin/dogs?${new URLSearchParams(params as Record<string, string>).toString()}`),
  getAdminDog: (slug: string) => request<AdminDogDetail>(`/admin/dogs/${encodeURIComponent(slug)}`),
  setAdminDogStatus: (slug: string, status: "active" | "lost" | "adopted" | "deceased" | "relocated", reason: string) =>
    request<{ status: string }>(`/admin/dogs/${encodeURIComponent(slug)}/status`, { method: "POST", body: { status, reason } }),
  getDuplicates: () => request<{ candidates: DuplicateCandidate[] }>(`/admin/duplicates`),
  mergeDogs: (input: MergeInput) => request<MergeResult>(`/admin/dogs/merge`, { method: "POST", body: input }),
  /** A5 "They're different dogs". */
  dismissDuplicate: (aSlug: string, bSlug: string, reportId?: string | null) =>
    request<{ dismissed: true }>(`/admin/duplicates/dismiss`, { method: "POST", body: { aSlug, bSlug, reportId: reportId ?? null } }),
  /** D13: take a photo off the dog's page (the scan and the feed stay). */
  hidePhoto: (scanId: string, reason: string) =>
    request<{ hidden: true }>(`/admin/photos/${encodeURIComponent(scanId)}/hide`, { method: "POST", body: { reason } }),

  getAdminFeeders: (q?: string) =>
    request<{ feeders: AdminFeederRow[] }>(`/admin/feeders${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getAdminFeeder: (id: string) => request<AdminFeederDetail>(`/admin/feeders/${encodeURIComponent(id)}`),
  suspendFeeder: (id: string, reason: string) =>
    request<{ suspended: true }>(`/admin/feeders/${encodeURIComponent(id)}/suspend`, { method: "POST", body: { reason } }),
  unsuspendFeeder: (id: string, reason?: string) =>
    request<{ suspended: false }>(`/admin/feeders/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
      body: reason ? { reason } : {},
    }),
  blockDevice: (input: BlockDeviceInput) =>
    request<{ blocked: true; deviceRef: string }>(`/admin/devices/block`, { method: "POST", body: input }),
  unblockDevice: (deviceRef: string) =>
    request<{ blocked: false }>(`/admin/devices/unblock`, { method: "POST", body: { deviceRef } }),

  getAdminCollars: (params: { q?: string; ward?: string } = {}) =>
    request<{ collars: AdminCollarRow[] }>(`/admin/collars?${new URLSearchParams(params as Record<string, string>).toString()}`),
  getAdminCollar: (slug: string) => request<AdminCollarDetail>(`/admin/collars/${encodeURIComponent(slug)}`),
  /** Set the printed batch number ("HJ-0412"). */
  setCollarBatchNo: (slug: string, batchNo: string) =>
    request<AdminCollarRow>(`/admin/collars/${encodeURIComponent(slug)}`, { method: "PATCH", body: { batchNo } }),

  getAdminSos: (state: "open" | "unassigned" | "escalated" | "closed" | "all" = "open") =>
    request<{ cases: AdminSosRow[] }>(`/admin/sos?state=${state}`),
  getAdminSosCase: (id: string) => request<AdminSosDetail>(`/admin/sos/${encodeURIComponent(id)}`),
  getAssignableVets: (id: string) => request<{ vets: AssignableVet[] }>(`/admin/sos/${encodeURIComponent(id)}/vets`),
  /** A1 "Assign a vet": pages that vet; their I'm going takes the case. */
  assignVet: (id: string, vetFeederId: string) =>
    request<Dispatch>(`/admin/sos/${encodeURIComponent(id)}/assign-vet`, { method: "POST", body: { vetFeederId } }),
  resolveAdminSos: (id: string, input: ResolveSosInput) =>
    request<{ id: string; state: SosCaseState; outcome: SosOutcome }>(`/admin/sos/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: input,
    }),

  getAdminReports: (status: "open" | "resolved" | "all" = "open") =>
    request<{ reports: AdminReportRow[] }>(`/admin/reports?status=${status}`),
  /** Reports: close a tag report (source "tag"), including "fake_tag". */
  adminResolveTagReport: (id: string, outcome: TagReportAdminOutcome, note?: string) =>
    request<{ id: string; status: "resolved"; outcome: TagReportAdminOutcome }>(
      `/admin/tag-reports/${encodeURIComponent(id)}/resolve`,
      { method: "POST", body: note ? { outcome, note } : { outcome } },
    ),
  resolveReport: (id: string, input: ReportResolveInput) =>
    request<AdminReportRow>(`/admin/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: input }),

  getAdminTeam: () => request<AdminTeam>(`/admin/team`),
  addTeamMember: (input: TeamAddInput) =>
    request<{ granted: boolean; invited: boolean }>(`/admin/team`, { method: "POST", body: input }),
  /** A6: change someone's role (revokes their other roles). */
  setTeamRole: (feederId: string, role: AdminRole, wards?: string[]) =>
    request<{ roles: AdminRoleGrant[] }>(`/admin/team/${encodeURIComponent(feederId)}/role`, {
      method: "POST",
      body: { role, wards: wards ?? [] },
    }),
  removeTeamMember: (feederId: string, reason?: string) =>
    request<{ removed: true }>(`/admin/team/${encodeURIComponent(feederId)}/remove`, {
      method: "POST",
      body: reason ? { reason } : {},
    }),
  getAudit: (params: { before?: string; limit?: number; action?: string; subjectId?: string } = {}) =>
    request<AuditPage>(
      `/admin/audit?${new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
      ).toString()}`,
    ),
  /** A6 "Export CSV". */
  downloadAuditCsv: () => downloadBlob(`/admin/audit.csv`),
  /** A2 / A7 documents: admins only, every open is audited. */
  downloadDocument: (id: string) => downloadBlob(`/admin/documents/${encodeURIComponent(id)}`),
  getAdminSettings: () => request<AdminSettings>(`/admin/settings`),
};
