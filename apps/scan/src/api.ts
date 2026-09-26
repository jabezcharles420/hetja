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
  /**
   * Design v6: first names of the dog's feeders who show them (the API sends
   * `feeders: { firstName: string | null }[]`, null for an opt-out; those are
   * counted in feederCount and never named).
   */
  feederNames?: string[];
  /** First name of whoever logged the latest feed, or null (opted out, or nobody). */
  lastFedBy?: string | null;
  /** When the saved copy was fetched, for an offline (stale) profile (V17). */
  savedAt?: string;
}

/**
 * Design v7 (V4): one row of the dog's public health list, as the page uses
 * it (the API's HealthRecord, apps/web/lib/api.ts "Design v7 types", with the
 * vet line and brand-batch already joined). "Vet signed" rows carry the
 * signing vet (name, council and registration number) and the vaccine's
 * brand and batch; "Feeder noted" rows say who added them.
 */
export interface HealthRecord {
  id: string;
  title: string;
  signed: boolean;
  date?: string;
  dueOn?: string;
  note?: string;
  vet?: string;
  batch?: string;
  addedBy?: string;
  /** An admin flagged this vet's signatures for re-check. */
  flagged?: boolean;
  /** Feeder noted, and a vet has already been asked to sign it. */
  asked?: boolean;
  /** A correction: the id of the record it replaces. */
  supersedes?: string;
  /** A withdrawal: the id of the record it takes off the page. */
  withdraws?: string;
  withdrawn?: boolean;
}

export interface Health {
  records: HealthRecord[];
  certificateUrl?: string;
  /** Only when the session presented belongs to a verified, unsuspended vet. */
  viewerIsVet: boolean;
}

/** GET /dogs/:slug answered 404 (or 400): no dog has this code. */
export class NotFoundError extends Error {}


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
  const profile = normalizeProfile(extractData(body));
  const date = res.headers.get("date");
  if (stale && date && Number.isFinite(Date.parse(date))) profile.savedAt = new Date(date).toISOString();
  return { profile, stale };
}

/**
 * GET /dogs/:slug/health (design v7, V4). Public. A signed-in browser also
 * sends its session so the API can say whether the viewer is a verified vet
 * (the "Open vet view" link); the API ignores a bad token. Any failure is
 * undefined: the health list is extra, never in the way.
 */
export async function fetchHealth(slug: string, token?: string): Promise<Health | undefined> {
  try {
    const res = await fetch(`${API_BASE}/dogs/${encodeURIComponent(slug)}/health`, {
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return undefined;
    const d = extractData(await res.json());
    const list = Array.isArray(d.records) ? (d.records as Record<string, unknown>[]) : [];
    return {
      // Kept in the API's order (oldest first), as the V4 mock lists them.
      records: currentHealth(list.map(healthRecord)),
      certificateUrl: optString(d.certificateUrl),
      viewerIsVet: d.viewerIsVet === true,
    };
  } catch {
    return undefined;
  }
}

function healthRecord(r: Record<string, unknown>): HealthRecord {
  const vet = r.vet as { name?: string; council?: string | null; regNo?: string | null } | null;
  const signed = r.status === "vet_signed";
  const join = (a: unknown[], s: string): string | undefined => a.filter(Boolean).join(s) || undefined;
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    signed,
    date: optString(r.date),
    dueOn: optString(r.dueOn),
    note: join([r.earNotched === true && "ear notched", r.note], " · "),
    vet: signed && vet ? join([vet.name, join([vet.council, vet.regNo], " ")], " · ") : undefined,
    batch: join([r.brand, r.batch], " "),
    addedBy: optString(r.addedBy),
    flagged: r.flagged === true,
    asked: r.signRequestOpen === true,
    supersedes: optString(r.supersedes),
    withdraws: optString(r.withdraws),
    withdrawn: r.type === "withdrawal" || !!r.withdrawnAt,
  };
}

/**
 * What the page shows: the current version of each record. A correction
 * hides the record it supersedes (V5 keeps the old one struck through only
 * in the vet's own view); a withdrawal hides itself and its target.
 */
export function currentHealth(list: HealthRecord[]): HealthRecord[] {
  const gone = new Set<string>();
  for (const r of list) {
    if (r.supersedes) gone.add(r.supersedes);
    if (r.withdraws) gone.add(r.withdraws);
  }
  return list.filter((r) => !r.withdrawn && !gone.has(r.id));
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
    feederNames: Array.isArray(d.feeders)
      ? d.feeders.map((f) => optString((f as { firstName?: unknown } | null)?.firstName)).filter((n): n is string => !!n)
      : undefined,
    lastFedBy: optString(d.lastFedBy) ?? (d.lastFedBy === null ? null : undefined),
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
