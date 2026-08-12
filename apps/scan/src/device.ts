/**
 * Anon-attested device token client (browser half of INVARIANT 6/7).
 *
 * The API previously had no `/api/v1/devices/*` route at all, so anonymous
 * POST /api/v1/reports always 401'd -- sheet.ts filed the report without a
 * device token and just showed "Couldn't confirm the report automatically
 * -- please also call below." on failure. This module gets a real token so
 * that degrade path stops firing on every single report.
 *
 * Obtained *lazily*: getDeviceToken() is only called from a write path that
 * actually needs one (sheet.ts's fileReport, on first severity tap) -- never
 * from main.ts's page-load path -- so the hot-path budget (this app's 40KB
 * gzipped gate) never pays a network round-trip or a PoW solve just for
 * loading a dog's profile. Once minted, the token is cached in localStorage
 * so later reports from the same browser reuse it instantly.
 *
 * The PoW solve runs in small batches of concurrent Web Crypto digests,
 * yielding to the event loop (setTimeout) between batches, so a slow solve
 * on an underpowered device degrades gracefully instead of freezing the tap
 * that just opened the emergency sheet.
 *
 * Every failure mode here (network, no challenge, no PoW solution within
 * the time budget, a bad response shape) resolves to `undefined` rather
 * than throwing -- callers keep the existing graceful fallback instead of a
 * crash.
 */

const TOKEN_KEY = "straynet.deviceToken.v1";
const SOLVE_TIMEOUT_MS = 12_000;
const SOLVE_BATCH = 48;

let inFlight: Promise<string | undefined> | undefined;

export function getCachedDeviceToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function cacheDeviceToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode / quota) -- token is still returned
     * to the caller for this call, just not persisted for next time. */
  }
}

/**
 * Returns a usable device token: the cached one if present, otherwise mints
 * one via the challenge/PoW round-trip. Concurrent callers within the same
 * page share a single in-flight mint rather than each solving their own PoW.
 */
export async function getDeviceToken(): Promise<string | undefined> {
  const cached = getCachedDeviceToken();
  if (cached) return cached;
  if (!inFlight) {
    inFlight = mintDeviceToken().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

interface ChallengeData {
  challenge: string;
  difficulty: number;
}

async function mintDeviceToken(): Promise<string | undefined> {
  const challengeData = await postJson<ChallengeData>("/api/v1/devices/challenge");
  if (!challengeData || typeof challengeData.challenge !== "string" || typeof challengeData.difficulty !== "number") {
    return undefined;
  }

  const nonce = await solvePoW(challengeData.challenge, challengeData.difficulty, SOLVE_TIMEOUT_MS);
  if (nonce == null) return undefined;

  const tokenData = await postJson<{ deviceToken: string }>("/api/v1/devices/token", {
    challenge: challengeData.challenge,
    nonce,
  });
  if (!tokenData || typeof tokenData.deviceToken !== "string" || !tokenData.deviceToken) return undefined;

  cacheDeviceToken(tokenData.deviceToken);
  return tokenData.deviceToken;
}

async function postJson<T>(url: string, body?: unknown): Promise<T | undefined> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return undefined;
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return undefined;
    return (parsed as { data?: T }).data;
  } catch {
    return undefined;
  }
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

/** Mirrors apps/api/src/lib/device.ts verifyPoW bit-for-bit: true iff the
 * digest starts with `difficulty` zero bits. */
function meetsDifficulty(digest: Uint8Array, difficulty: number): boolean {
  if (difficulty > digest.length * 8) return false;
  const fullBytes = Math.floor(difficulty / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (digest[i] !== 0) return false;
  }
  const remaining = difficulty % 8;
  if (remaining === 0) return true;
  const mask = (1 << remaining) - 1;
  return ((digest[fullBytes] ?? 0xff) & ~mask) === 0;
}

/**
 * Brute-forces a nonce whose SHA-256(challenge + nonce) has `difficulty`
 * leading zero bits. Runs in batches of SOLVE_BATCH concurrent Web Crypto
 * digests, then yields via setTimeout(0) before the next batch -- a chunked
 * loop rather than a single synchronous spin, so a slow solve never blocks
 * the main thread for longer than one batch's worth of hashing.
 */
async function solvePoW(challenge: string, difficulty: number, timeoutMs: number): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  const deadline = Date.now() + timeoutMs;
  let next = 0;
  while (Date.now() < deadline) {
    const base = next;
    const digests = await Promise.all(
      Array.from({ length: SOLVE_BATCH }, (_, k) => sha256Bytes(`${challenge}${base + k}`)),
    );
    for (let k = 0; k < digests.length; k++) {
      if (meetsDifficulty(digests[k]!, difficulty)) return String(base + k);
    }
    next = base + SOLVE_BATCH;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return undefined;
}
