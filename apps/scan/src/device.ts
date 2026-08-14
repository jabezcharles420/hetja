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
 * The proof-of-work is an ALTCHA v2 SHA-256 challenge (the ALTCHA widget is
 * ~112 KB minified and would blow the 40 KB budget, so scan solves the
 * challenge natively with Web Crypto -- the server does not care which client
 * solves it). The solve runs in small batches of concurrent Web Crypto
 * digests, yielding to the event loop (setTimeout) between batches, so a slow
 * solve on an underpowered device degrades gracefully instead of freezing the
 * tap that just opened the emergency sheet.
 *
 * Every failure mode here (network, no challenge, no PoW solution within
 * the time budget, a bad response shape) resolves to `undefined` rather
 * than throwing -- callers keep the existing graceful fallback instead of a
 * crash.
 */

const TOKEN_KEY = "hetja.deviceToken.v1";
const SOLVE_TIMEOUT_MS = 20_000;
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

/** ALTCHA v2 challenge as issued by POST /api/v1/devices/challenge. */
interface AltchaChallenge {
  parameters: {
    algorithm: string;
    nonce: string;
    salt: string;
    cost: number;
    keyLength: number;
    keyPrefix: string;
  };
  signature?: string;
}

interface AltchaSolution {
  counter: number;
  derivedKey: string;
}

interface ChallengeData {
  challenge: AltchaChallenge;
  difficulty: number;
}

function isValidChallenge(c: unknown): c is AltchaChallenge {
  if (!c || typeof c !== "object") return false;
  const p = (c as AltchaChallenge).parameters;
  return (
    !!p &&
    typeof p.algorithm === "string" &&
    typeof p.nonce === "string" &&
    typeof p.salt === "string" &&
    typeof p.cost === "number" &&
    typeof p.keyLength === "number" &&
    typeof p.keyPrefix === "string"
  );
}

async function mintDeviceToken(): Promise<string | undefined> {
  const challengeData = await postJson<ChallengeData>("/api/v1/devices/challenge");
  if (!challengeData || !isValidChallenge(challengeData.challenge)) return undefined;

  const solution = await solveAltchaPoW(challengeData.challenge, SOLVE_TIMEOUT_MS);
  if (solution == null) return undefined;

  const tokenData = await postJson<{ deviceToken: string }>("/api/v1/devices/token", {
    challenge: challengeData.challenge,
    solution,
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

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

/** True iff the lowercase hex encoding of `bytes` starts with `hex` -- the
 * same check altcha-lib's verifySolution applies to the derived key. Handles
 * odd-length prefixes (a trailing nibble compares against the high bits). */
function hexStartsWith(bytes: Uint8Array<ArrayBuffer>, hex: string): boolean {
  const fullBytes = Math.floor(hex.length / 2);
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== parseInt(hex.slice(i * 2, i * 2 + 2), 16)) return false;
  }
  if (hex.length % 2 === 1) {
    const nibble = parseInt(hex[fullBytes * 2]!, 16);
    if ((bytes[fullBytes]! >> 4) !== nibble) return false;
  }
  return true;
}

async function sha256(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

/**
 * ALTCHA v2 SHA-256 key derivation (matches altcha-lib/algorithms/sha):
 * derivedKey = SHA-256^cost(salt || nonce || counter_uint32BE), truncated to
 * keyLength bytes. `counter` is the raw 32-bit big-endian value.
 */
async function deriveKey(
  params: AltchaChallenge["parameters"],
  counter: number,
): Promise<{ counter: number; key: Uint8Array<ArrayBuffer> }> {
  const nonceBytes = hexToBytes(params.nonce);
  const saltBytes = hexToBytes(params.salt);
  const password = new Uint8Array(nonceBytes.length + 4);
  password.set(nonceBytes, 0);
  new DataView(password.buffer).setUint32(nonceBytes.length, counter, false);

  const input = new Uint8Array(saltBytes.length + password.length);
  input.set(saltBytes, 0);
  input.set(password, saltBytes.length);

  let data = await sha256(input);
  for (let i = 1; i < params.cost; i++) data = await sha256(data);
  return { counter, key: data.slice(0, params.keyLength) };
}

/**
 * Brute-forces an ALTCHA v2 SHA-256 solution: finds a counter whose derived
 * key hex encoding starts with challenge.parameters.keyPrefix. Runs in batches
 * of SOLVE_BATCH concurrent Web Crypto digests, then yields via setTimeout(0)
 * before the next batch -- a chunked loop rather than a single synchronous
 * spin, so a slow solve never blocks the main thread for longer than one
 * batch's worth of hashing.
 */
async function solveAltchaPoW(challenge: AltchaChallenge, timeoutMs: number): Promise<AltchaSolution | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  if (challenge.parameters.algorithm !== "SHA-256") return undefined;

  const deadline = Date.now() + timeoutMs;
  let next = 0;
  while (Date.now() < deadline) {
    const base = next;
    const results = await Promise.all(
      Array.from({ length: SOLVE_BATCH }, (_, k) => deriveKey(challenge.parameters, base + k)),
    );
    for (const r of results) {
      if (hexStartsWith(r.key, challenge.parameters.keyPrefix)) {
        return { counter: r.counter, derivedKey: bytesToHex(r.key) };
      }
    }
    next = base + SOLVE_BATCH;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return undefined;
}
