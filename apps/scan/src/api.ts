export interface VaccineStatus {
  /**
   * True when GET /api/v1/dogs/:slug returned a `vaccineStatus` at all — which
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
 * Origin dog photos hang off, derived from the same base the JSON client uses
 * — the same arithmetic as apps/web/lib/api.ts's dogPhotoUrl(), which builds
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stale = res.headers.get("X-Hetja-Stale") === "1";
  const body: unknown = await res.json();
  return { profile: normalizeProfile(extractData(body)), stale };
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
 * This used to read fields the API has never sent — `d.vaccine` (object),
 * `d.photoUrl`, `d.sex`, `d.approxAge`, `d.coatPattern`, `d.vibe` — so the
 * photo never rendered and vaccination always read "Unknown" on exactly the
 * surface strangers actually use. Field names here must mirror dogs.ts; a
 * test pins the mapping against a real payload.
 *
 * sex/approxAge/coatPattern stay optional on DogProfile for ui.ts's "Full
 * record" line and speech output, but nothing populates them today: the API
 * does not send them, and inventing values would claim more than it knows.
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
    photoUrl: photoUrlFromKey(optString(d.photoKey)),
    lastSeenAt: optString(d.lastSeenAt),
  };
}

/** Same construction as apps/web/lib/api.ts's dogPhotoUrl(): origin + "/" + key. */
function photoUrlFromKey(photoKey?: string): string | undefined {
  if (!photoKey) return undefined;
  return `${API_ORIGIN}/${photoKey}`;
}

/**
 * `vaccineStatus` is a display string ("Anti-Rabies · 2026-01-15") or null —
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
