/**
 * Client for GET /api/v1/care?lat=&lng=&max_km= — the nearby-care directory.
 *
 * This endpoint is being built by another agent in parallel and may not
 * exist yet (404) or may error. Every function here degrades gracefully:
 * network failure, a 404, an unexpected shape, or an empty list all resolve
 * to `{ ok: false, providers: [] }` rather than throwing, so the caller can
 * always fall back to a clear message instead of a crash.
 */

export type CostTier = "free" | "subsidised" | "paid";

export interface CareProvider {
  name: string;
  kind?: string;
  costTier?: CostTier;
  phone?: string;
  phoneVerified: boolean;
  hasAmbulance: boolean;
  is24x7: boolean;
  distanceKm?: number;
  lat?: number;
  lng?: number;
  address?: string;
}

export interface CareResult {
  ok: boolean;
  providers: CareProvider[];
}

const CARE_TIMEOUT_MS = 6000;

export async function fetchNearbyCare(lat: number, lng: number, maxKm = 8): Promise<CareResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CARE_TIMEOUT_MS);
  try {
    const url = `/api/v1/care?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}&max_km=${encodeURIComponent(String(maxKm))}`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, providers: [] };
    const body: unknown = await res.json();
    return { ok: true, providers: normalizeList(body) };
  } catch {
    return { ok: false, providers: [] };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeList(body: unknown): CareProvider[] {
  return extractArray(body)
    .map(normalizeProvider)
    .filter((p): p is CareProvider => p !== null)
    .slice(0, 8);
}

function extractArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const d = (body as Record<string, unknown>).data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") {
      const providers = (d as Record<string, unknown>).providers;
      if (Array.isArray(providers)) return providers;
    }
  }
  return [];
}

function normalizeProvider(raw: unknown): CareProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null;
  const phone = str(r.phone) ?? str(r.phoneE164) ?? str(r.phone_e164);
  const verifiedAt = r.phoneVerifiedAt ?? r.phone_verified_at;
  return {
    name,
    kind: str(r.kind),
    costTier: normalizeCostTier(str(r.costTier) ?? str(r.cost_tier)),
    phone: phone ?? undefined,
    phoneVerified: typeof verifiedAt === "string" && verifiedAt.length > 0,
    hasAmbulance: bool(r.hasAmbulance ?? r.has_ambulance),
    is24x7: bool(r.is24x7 ?? r.is_24x7),
    distanceKm: distanceKmOf(r),
    lat: num(r.lat),
    lng: num(r.lng),
    address: str(r.address),
  };
}

function normalizeCostTier(v?: string): CostTier | undefined {
  return v === "free" || v === "subsidised" || v === "paid" ? v : undefined;
}

/** The live endpoint returns distance in metres as `distanceM`; a couple of
 * plausible alternate shapes are covered too since the contract was still
 * being built in parallel with this client. */
function distanceKmOf(r: Record<string, unknown>): number | undefined {
  const km = num(r.distanceKm ?? r.distance_km);
  if (km != null) return km;
  const m = num(r.distanceM ?? r.distance_m);
  return m != null ? m / 1000 : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function bool(v: unknown): boolean {
  return v === true;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Text-label eyebrow — never a colour swatch (WCAG 2.2 SC 1.4.1). */
export function eyebrow(p: CareProvider): string {
  const parts: string[] = [p.costTier ? p.costTier.toUpperCase() : "COST UNKNOWN"];
  if (p.hasAmbulance) parts.push("AMBULANCE");
  if (p.is24x7) parts.push("24×7");
  return parts.join(" · ");
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** geo: URI when we have coordinates, else a plain maps search URL. No map
 * library, no tiles enter the bundle either way. */
export function directionsHref(p: CareProvider): string {
  if (p.lat != null && p.lng != null) {
    return `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${encodeURIComponent(p.name)})`;
  }
  const q = encodeURIComponent(p.address ?? p.name);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function fmtDistance(km?: number): string {
  if (km == null) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function getPosition(timeoutMs = 6000): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
