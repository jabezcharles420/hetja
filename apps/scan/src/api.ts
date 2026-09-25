export interface VaccineStatus {
  /**
   * True when GET /api/v1/dogs/:slug returned a `vaccineStatus` at all, which
   * the route only builds from a VERIFIED medical_records row. It means "a
   * verified vaccination is on file", not "the course is still current"; the
   * date in `label` is what a reader judges currency from.
   */
  upToDate: boolean;
  /**
   * The route's own rendering ("Anti-Rabies · 2026-01-15"), shown verbatim.
   * Parsing it into rabies/DHPP fields loses names it cannot classify, so the
   * full string is kept as the primary display and the parsed fields are
   * secondary hints only.
   */
  label?: string;
  rabvLast?: string;
  dhppLast?: string;
  lastUpdatedAt: string;
}

export interface DogProfile {
  slug: string;
  name: string;
  sex?: string;
  approxAge?: number;
  coatPattern?: string;
  temperament?: string;
  vibe?: string;
  status: string;
  wardId: string;
  abcStatus?: string;
  vaccine?: VaccineStatus;
  microStory?: string;
  photoUrl?: string;
  lastSeenAt?: string;
  /** Locality name for the ward ("Andheri West"), from the API. */
  wardName?: string;
  /** Design v4 status fields. Absent on an older API: fall back to the legacy ones. */
  vaccinated?: "yes" | "unknown";
  sterilised?: "yes" | "no" | "unknown";
  /**
   * ISO time of the latest feed. `null` means the API says there has been no
   * feed; `undefined` means the API did not say at all, and the pill is then
   * left out rather than claiming "no feeds".
   */
  lastFedAt?: string | null;
  feederCount?: number;
  storyAuthorCount?: number;
  /**
   * Design v5 (DogProfileV5 in apps/web/lib/api.ts). `verified` false shows
   * the grey Unverified pill; undefined (an older API) shows nothing.
   */
  verified?: boolean;
  /** A "wrong dog" report is open. Feeds still log and SOS is never paused. */
  tagUnderReview?: boolean;
  /** Three tag reports in 7 days: the profile asks for a sturdier collar. */
  sturdierCollarSuggested?: boolean;
  /** Deceased dogs only: first name and initial of each feeder who fed them. */
  memorial?: { feederNames: string[] };
}

/** GET /dogs/:slug answered 404 (or 400): no dog has this code. */
export class NotFoundError extends Error {}

/** A dog as shown in a lookup (DogCard in apps/web/lib/api.ts). Ward level only. */
export interface DogCard {
  slug: string;
  name: string | null;
  wardId: string;
  wardCode: string;
  photoUrl: string | null;
}

export interface ProfileResult {
  profile: DogProfile;
  stale: boolean;
}

const API_BASE = (() => {
  const override = (globalThis as { __HETJA_API__?: string }).__HETJA_API__;
  return override ?? "/api/v1";
})();

/**
 * Origin dog photos hang off, derived from the same base the JSON client uses:
 * the same arithmetic as apps/web/lib/api.ts's dogPhotoUrl(), which builds
 * `${API_ORIGIN}/${photoKey}`. Storage keys are `photos/<uuid>.<ext>` served
 * from the site root (Caddy file_server), so with the default same-origin
 * base this is "" and a photo URL is simply "/photos/…". normalizeProfile used
 * to read `d.photoUrl`, a field the API has never sent, so the collar page
 * ALWAYS fell back to the initial-letter placeholder and no stranger has ever
 * seen a dog photo here.
 */
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");

export async function fetchDogProfile(slug: string, sig: string): Promise<ProfileResult> {
  const url = `${API_BASE}/dogs/${encodeURIComponent(slug)}${sig ? `?s=${encodeURIComponent(sig)}` : ""}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404 || res.status === 400) throw new NotFoundError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stale = res.headers.get("X-Hetja-Stale") === "1";
  const body: unknown = await res.json();
  return { profile: normalizeProfile(extractData(body)), stale };
}

/**
 * GET /dogs/lookup?code= (design v5, N8): dogs one swap or one character
 * away from a code that matched nothing. Any failure is an empty answer: the
 * not-found screen is already useful without it.
 */
export async function lookupCode(code: string): Promise<{ exact: DogCard | null; suggestions: DogCard[] }> {
  try {
    const res = await fetch(`${API_BASE}/dogs/lookup?code=${encodeURIComponent(code)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { exact: null, suggestions: [] };
    const d = extractData(await res.json());
    const list = Array.isArray(d.suggestions) ? d.suggestions.map(card).filter((c): c is DogCard => !!c) : [];
    return { exact: card(d.exact), suggestions: list.slice(0, 5) };
  } catch {
    return { exact: null, suggestions: [] };
  }
}

function card(v: unknown): DogCard | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const slug = optString(r.slug);
  if (!slug) return null;
  return {
    slug,
    name: optString(r.name) ?? null,
    wardId: optString(r.wardId) ?? "",
    wardCode: optString(r.wardCode) ?? "",
    photoUrl: optString(r.photoUrl) ?? null,
  };
}

function extractData(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && "data" in body) {
    const d = (body as { data?: unknown }).data;
    if (d && typeof d === "object") return d as Record<string, unknown>;
  }
  throw new Error("unexpected API response");
}

/**
 * Maps the API's DogPagePayload (apps/api/src/routes/dogs.ts) onto the shape
 * the collar page renders. The payload is: slug, name, status, wardId,
 * photoKey, abcStatus, vaccineStatus, microStory, lastSeenAt, geo.
 *
 * This used to read fields the API has never sent (`d.vaccine` as an object,
 * `d.photoUrl`, `d.sex`, `d.approxAge`, `d.coatPattern`, `d.vibe`), so the
 * photo never rendered and vaccination always read "Unknown" on exactly the
 * surface strangers actually use. Field names here must mirror dogs.ts; a
 * test pins the mapping against a real payload.
 *
 * sex is read when present (it picks "his"/"her" over the dog's name), but
 * the API does not send it today; approxAge/coatPattern are not read at all.
 * Inventing values would claim more than the system knows.
 */
function normalizeProfile(d: Record<string, unknown>): DogProfile {
  return {
    slug: String(d.slug ?? ""),
    name: optString(d.name) ?? "Unknown dog",
    status: optString(d.status) ?? "active",
    wardId: optString(d.wardId) ?? "",
    abcStatus: optString(d.abcStatus),
    vaccine: normalizeVaccine(optString(d.vaccineStatus)),
    microStory: optString(d.microStory),
    photoUrl: photoUrlFrom(optString(d.photoUrl), optString(d.photoKey)),
    lastSeenAt: optString(d.lastSeenAt),
    sex: optString(d.sex),
    wardName: optString(d.wardName),
    vaccinated: d.vaccinated === "yes" || d.vaccinated === "unknown" ? d.vaccinated : undefined,
    sterilised:
      d.sterilised === "yes" || d.sterilised === "no" || d.sterilised === "unknown" ? d.sterilised : undefined,
    lastFedAt: d.lastFedAt === null ? null : optString(d.lastFedAt),
    feederCount: optCount(d.feederCount),
    storyAuthorCount: optCount(d.storyAuthorCount),
    verified: typeof d.verified === "boolean" ? d.verified : undefined,
    tagUnderReview: d.tagUnderReview === true,
    sturdierCollarSuggested: d.sturdierCollarSuggested === true,
    memorial: memorialFrom(d.memorial),
  };
}

function memorialFrom(v: unknown): { feederNames: string[] } | undefined {
  const names = (v as { feederNames?: unknown } | null)?.feederNames;
  if (!Array.isArray(names)) return undefined;
  return { feederNames: names.filter((n): n is string => typeof n === "string" && n.length > 0) };
}

/**
 * The API's own `photoUrl` when it sends one (design v4 contract), otherwise
 * the same construction as apps/web/lib/api.ts's dogPhotoUrl(): origin + "/" + key.
 */
function photoUrlFrom(photoUrl?: string, photoKey?: string): string | undefined {
  if (photoUrl) return photoUrl;
  if (!photoKey) return undefined;
  return `${API_ORIGIN}/${photoKey}`;
}

function optCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/**
 * `vaccineStatus` is a display string ("Anti-Rabies · 2026-01-15") or null,
 * never the object this file once expected under `d.vaccine`. Presence of the
 * string already means a verified record exists (see VaccineStatus.upToDate);
 * what is left here is splitting off the date so speech and the parsed hints
 * have it.
 */
function normalizeVaccine(vaccineStatus?: string): VaccineStatus | undefined {
  if (!vaccineStatus) return undefined;
  const sep = vaccineStatus.indexOf("·");
  const name = sep >= 0 ? vaccineStatus.slice(0, sep).trim() : vaccineStatus;
  const date = sep >= 0 ? vaccineStatus.slice(sep + 1).trim() : "";
  return {
    upToDate: true,
    label: vaccineStatus,
    rabvLast: date && /rab/i.test(name) ? date : undefined,
    dhppLast: date && /dhpp/i.test(name) ? date : undefined,
    lastUpdatedAt: date,
  };
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
