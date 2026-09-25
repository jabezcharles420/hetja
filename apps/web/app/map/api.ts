/**
 * The map's own small API client (screen 19). Same origin rule as lib/api.ts
 * (NEXT_PUBLIC_API_URL, everything under /api/v1, the `{ok, data}` envelope)
 * and the same session keys in localStorage.
 *
 * One thing is borrowed rather than copied: refreshSession() from lib/api.
 * Refresh tokens are one-time-use on the server, and presenting one twice is
 * treated as theft and revokes every session the feeder holds. The offline
 * queue in the root layout can refresh on page load too, so this page must
 * share lib/api's single-flight refresh instead of racing it with its own.
 */
import { parseRetryAfter, refreshSession, type MapWardDetailV6, type MapWardsV6, type SosCaseV6 } from "@/lib/api";
import type { MapPlace, MapSos, MapWard, Severity } from "@/components/map/logic";

export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api/v1`;
const ACCESS_TOKEN_KEY = "hetja.accessToken";
const TIMEOUT_MS = 15_000;

export class MapApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** Seconds from `retry-after` (429 RATE_LIMITED on the ack), when sent. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "MapApiError";
  }
}

function token(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  return !!token();
}

async function call<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH"; body?: unknown; auth?: boolean; retried?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const t = opts.auth ? token() : null;
  if (t) headers.authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MapApiError("Could not reach Hetja.", 0, "NETWORK_ERROR");
  }
  if (res.status === 401 && t && !opts.retried && (await refreshSession())) {
    return call<T>(path, { ...opts, retried: true });
  }
  const payload = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { message: string; code?: string } }
    | null;
  if (!payload || payload.ok !== true) {
    const err = payload && payload.ok === false ? payload.error : null;
    throw new MapApiError(
      err?.message ?? `HTTP ${res.status}`,
      res.status,
      err?.code,
      parseRetryAfter(res.headers?.get?.("retry-after")),
    );
  }
  return payload.data;
}

/** GET /map/wards/:id, with the v6 additions (dogNames, notLoggedToday). */
export interface WardDetail extends MapWard, MapWardDetailV6 {
  sos: MapSos[];
  nearby: MapPlace[];
  viewer: { sosOptIn: boolean; trustScore: number; canRespond: Severity[] } | null;
}

export interface Me {
  displayName: string;
  homeWard: string | null;
  sosOptIn: boolean;
  trustScore: number;
  /** v5: the wards the feeder is alerted for. */
  wards?: string[];
}

/** The bits of GET /sos/cases/:id the map uses after taking a case (M4). */
export type TakenCase = Pick<SosCaseV6, "id" | "dog" | "location" | "distanceM">;

export const mapApi = {
  /** v6 adds `summary` and `sos` (M1); an older API sends only the wards. */
  wards: () => call<{ wards: MapWard[] } & MapWardsV6>("/map/wards"),
  /** Sends the session when there is one: an eligible responder gets case ids. */
  ward: (id: string) => call<WardDetail>(`/map/wards/${encodeURIComponent(id)}`, { auth: true }),
  places: (bbox: string, kind: "vet" | "ngo" | null) =>
    call<{ places: MapPlace[]; truncated: boolean }>(
      `/map/places?bbox=${bbox}${kind ? `&kind=${kind}` : ""}`,
    ),
  me: () => call<Me>("/feeders/me", { auth: true }),
  /**
   * Take a case. The server decides: 403 SOS_ACK_FORBIDDEN, 409
   * SOS_TOO_MANY_OPEN_ACKS / SOS_ALREADY_ACKED / SOS_CASE_CLOSED, 429
   * RATE_LIMITED. Worded by lib/sos-ack.ts, the same as the case page.
   */
  ack: (caseId: string) =>
    call<{ id: string; ackedAt: string }>(`/sos/cases/${encodeURIComponent(caseId)}/ack`, {
      method: "POST",
      auth: true,
    }),
  /** M4: the taken case, for its exact spot (acker only) and the distance. */
  takenCase: (caseId: string) => call<TakenCase>(`/sos/cases/${encodeURIComponent(caseId)}`, { auth: true }),
};
