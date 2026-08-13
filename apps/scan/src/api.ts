export interface VaccineStatus {
  upToDate: boolean;
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

function normalizeProfile(d: Record<string, unknown>): DogProfile {
  return {
    slug: String(d.slug ?? ""),
    name: optString(d.name) ?? "Unknown dog",
    sex: optString(d.sex),
    approxAge: typeof d.approxAge === "number" ? d.approxAge : undefined,
    coatPattern: optString(d.coatPattern),
    temperament: optString(d.temperament),
    vibe: optString(d.vibe),
    status: optString(d.status) ?? "active",
    wardId: optString(d.wardId) ?? "",
    abcStatus: optString(d.abcStatus),
    vaccine: normalizeVaccine(d.vaccine),
    microStory: optString(d.microStory) ?? optString(d.story),
    photoUrl: optString(d.photoUrl),
    lastSeenAt: optString(d.lastSeenAt),
  };
}

function normalizeVaccine(d: unknown): VaccineStatus | undefined {
  if (!d || typeof d !== "object") return undefined;
  const v = d as Record<string, unknown>;
  return {
    upToDate: v.upToDate === true,
    rabvLast: optString(v.rabvLast),
    dhppLast: optString(v.dhppLast),
    lastUpdatedAt: optString(v.lastUpdatedAt) ?? "",
  };
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
