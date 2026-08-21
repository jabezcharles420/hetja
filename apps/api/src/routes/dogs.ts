import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { coarsenToWard, type DogStatus } from "@hetja/contracts";
import { timingSafeEqual } from "node:crypto";
import { query, isValidSlug } from "@hetja/db";
import { verifySlugSig } from "../lib/hmac.js";

interface DogRow {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  ward_id: string;
  abc_status: string | null;
  last_seen_at: string | null;
  lat: number | null;
  lng: number | null;
}

interface StoryRow {
  paragraph: string;
}

interface VaccineRow {
  vaccine_name: string | null;
  vaccine_date: string | null;
}

interface PhotoRow {
  photo_s3_key: string | null;
}

/**
 * Render a pg DATE as YYYY-MM-DD.
 *
 * node-postgres returns DATE as a JS Date at local midnight, so string
 * interpolation yields the full "Wed Aug 12 2026 00:00:00 GMT+0530 (India
 * Standard Time)" form. toISOString() is not the fix either: local midnight in
 * IST is the previous day in UTC, so it would report the wrong date. Use the
 * local getters, which preserve the calendar date pg stored.
 */
function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ ok: false, error: { message: "not found", code: "NOT_FOUND" } });

interface DogPagePayload {
  slug: string;
  name: string | null;
  status: DogStatus;
  wardId: string;
  photoKey: string | null;
  abcStatus: string | null;
  vaccineStatus: string | null;
  microStory: string | null;
  lastSeenAt: string | null;
  geo: { lat: number; lng: number } | null;
}

// In-process TTL cache (enhancement stack §M.1/M.16): a dog page's payload
// (identity, ABC/vaccine status, micro-story, latest photo) only changes
// when a feeder updates the dog or a new scan lands — both slow compared to
// a 5s TTL — so a short read-through cache absorbs the burst of scans that
// follows every collar deployment without going stale enough to mislead.
// Only SUCCESSFUL payloads are stored: signature failures and unknown-slug
// 404s fall through to the database every time, and SOS state is never
// cached (see sos.ts).
export const dogCache = new LRUCache<string, DogPagePayload>({
  max: 2000,
  ttl: 5_000,
});

/**
 * Verifies a collar signature, accepting EITHER the value stored on the collar
 * row OR a fresh HMAC over the current secret.
 *
 * WHY BOTH, AND WHY THE STORED ONE FIRST.
 *
 * `HETJA_QR_SECRET` is the single most dangerous value in this system. It is
 * HMAC'd into the URL etched on every collar already glued to an animal, and
 * verification used to be purely stateless — recompute the HMAC, compare. That
 * made the secret load-bearing forever: lose it, and every collar in the field
 * stops resolving. Not degraded — stops. Rotate it, and the same. AGENTS.md
 * documents this at length as a hazard to be careful around.
 *
 * It did not have to be a hazard. `collars.hmac_sig` has existed since
 * migration 0001 and held the correct signature for every collar the whole
 * time — and no code in the API ever read it. Consulting it converts a
 * catastrophic loss into an inconvenience: an operator who loses the secret can
 * still serve every collar already in the field, and can mint a new secret for
 * new collars without invalidating the old ones. That is also what makes
 * rotation possible at all, which today it is not at any price.
 *
 * SECURITY IS UNCHANGED. The threat this defends against is a stranger
 * fabricating collar URLs to enumerate the register — "in one political
 * climate a tool for protection, in another a targeting list". A forged
 * signature still fails: matching the stored value requires a row this
 * operator inserted, and matching the computed value requires the secret.
 * Neither is guessable, and the comparison stays constant-time.
 *
 * Stored first because it is the branch that survives a lost or rotated
 * secret; the recompute is the fallback for collars minted since, whose row
 * may not carry a signature yet.
 */
async function verifyCollarSignature(slug: string, sig: string, secret: string): Promise<boolean> {
  const row = await query<{ hmac_sig: string }>(
    `SELECT c.hmac_sig FROM collars c JOIN dogs d ON d.id = c.dog_id WHERE d.slug = $1 LIMIT 1`,
    [slug],
  );
  const stored = row.rows[0]?.hmac_sig;
  if (stored) {
    const a = Buffer.from(stored);
    const b = Buffer.from(sig);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return verifySlugSig(slug, sig, secret);
}

/**
 * TYPED COLLAR CODES: a signature-less lookup is accepted when the slug's
 * check character validates.
 *
 * THE PROBLEM. The landing hero and the /scan page advertise typing the code
 * printed on the collar, and that is the path that matters when the QR is
 * scratched off. But `?s=` is an HMAC under HETJA_QR_SECRET, so the CLIENT
 * cannot compute it — by design (INVARIANT 1; see enrolment.ts' header). A
 * typed code therefore cannot be turned into a signed URL client-side, and
 * every typed entry 404'd. QrScanner forwards the signature fine; only typing
 * was broken.
 *
 * THE CHOICE, of the two shapes available:
 *
 *   (a) this — accept a signature-less lookup on the SAME endpoint when
 *       isValidSlug(slug) passes, i.e. the slug is well-formed AND its check
 *       character matches the body;
 *   (b) a separate /resolve endpoint with its own rate limit.
 *
 * (a) was chosen. The reasoning has to start from what `?s=` actually buys,
 * because it is less than it looks like:
 *
 * - INVARIANT 1's concern is ENUMERATION, not authentication. Nothing here
 *   authenticates a reader — the QR URL is printed on a public collar and any
 *   stranger can scan it. What the system must never allow is walking the
 *   register dog by dog. That protection comes from the slug itself: 40 random
 *   bits (INVARIANT 1: "40 random bits + a check character closes that off").
 *   The HMAC adds provenance — proof this URL came off a collar WE etched,
 *   which defeats pattern-crawling around one leaked link — but it adds no
 *   entropy against guessing slugs, and the slug is only ever as secret as the
 *   plate it is printed on.
 * - A typed code comes from a human reading that same plate. Whoever can type
 *   the code correctly is standing in front of (or photographing) the collar —
 *   they already had everything the signature would have attested. Requiring
 *   ?s= on the typed path protects nothing a scanner-based reader doesn't
 *   already have.
 * - The check character is doing real work on this path: a mistyped or
 *   fabricated candidate fails isValidSlug 31 times out of 32 BEFORE any
 *   database work, so typo-driven enumeration dies cheaply, exactly as
 *   INVARIANT 1 says it should ("the check character exists purely to catch a
 *   mistyped collar entry before it becomes a query for the wrong dog"). A
 *   presented-but-WRONG signature still fails hard below — only ABSENCE of
 *   ?s= falls back to the check-character path, so a tampered link gains
 *   nothing.
 *
 * WHAT THIS DOES NOT PROTECT, stated plainly:
 * - Bulk online guessing. Valid slugs remain ~2^40 apart, but nothing here
 *   rate-limits the guesses. INVARIANT 6 forbids per-IP limits (carrier CGNAT
 *   puts hundreds of real subscribers behind one address), and gating a READ
 *   of a public profile behind device attestation would put a proof-of-work
 *   solve between a stranger and an injured dog's vaccination record. At pilot
 *   scale (thousands of dogs) hitting even one live profile by brute force
 *   takes on the order of 2^40/10^4 ≈ 10^8 requests; that is the honest margin,
 *   not a proof of safety. If abuse is ever observed in the logs, the fix is a
 *   measured decision for a human, not a silent tightening here.
 * - It widens "who can read a profile" from whoever holds the etched URL to
 *   whoever knows the exact slug. Given the slug is stamped next to the QR on
 *   the collar itself, the marginal exposure is small — but it is not zero, and
 *   this comment exists so the widening is a recorded decision rather than an
 *   accident.
 * - The payload returned is identical either way: ward-level geo only
 *   (INVARIANT 2), no contact information anywhere (INVARIANT 3), moderated
 *   stories only.
 */
export default async function dogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/dogs/:slug", async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const { s: sig } = req.query as { s?: string };
    // An EMPTY sig counts as absent: apps/web's dog page sends `?s=` verbatim
    // when its URL carried no signature (the typed-entry case), and treating
    // "" as a presented-and-failed credential would keep that path broken.
    if (sig) {
      if (!(await verifyCollarSignature(slug, sig, app.config.HETJA_QR_SECRET))) {
        return notFound(reply);
      }
    } else if (!isValidSlug(slug)) {
      // Typed path: no signature to verify, so the check character is the
      // gate. Failing candidates are rejected before the DB and before the
      // cache (which stores successes only).
      return notFound(reply);
    }

    // 5s read-through cache keyed on the slug (the payload is identical for
    // any valid signature on the same slug, and identical again for the
    // signature-less typed path). A signature failure above — and every 404
    // below — skips the cache entirely, so errors are never cached.
    const cached = dogCache.get(slug);
    if (cached) return { ok: true, data: cached };

    const dogRes = await query<DogRow>(
      `SELECT d.id, d.slug, d.name, d.status, d.ward_id, d.abc_status, d.last_seen_at,
              ST_Y(d.last_seen_geo::geometry) AS lat,
              ST_X(d.last_seen_geo::geometry) AS lng
       FROM dogs d
       WHERE d.slug = $1`,
      [slug],
    );
    const dog = dogRes.rows[0];
    if (!dog) return notFound(reply);

    const [storyRes, vaccineRes, photoRes] = await Promise.all([
      query<StoryRow>(
        // MODERATED only — same rule as GET /api/v1/dogs/:slug/stories
        // (stories.ts: "New stories start UNMODERATED and stay hidden from the
        // public feed until a moderator approves them"). This query used to
        // omit the filter, which made the moderation queue bypassable by
        // reading the profile instead of the stories list: any authenticated
        // feeder could POST a 2000-char paragraph to any dog (stories have no
        // ownership check) and it appeared here on a public, unauthenticated
        // endpoint immediately. The profile and the stories list are two doors
        // into the same table; they must enforce one policy.
        `SELECT paragraph FROM dog_stories WHERE dog_id = $1 AND moderated_at IS NOT NULL ORDER BY created_at DESC, version DESC LIMIT 1`,
        [dog.id],
      ),
      query<VaccineRow>(
        `SELECT vaccine_name, vaccine_date FROM medical_records
         WHERE dog_id = $1 AND record_type IN ('vaccination', 'vaccine') AND is_verified
         ORDER BY created_at DESC LIMIT 1`,
        [dog.id],
      ),
      query<PhotoRow>(
        `SELECT photo_s3_key FROM scans
         WHERE dog_id = $1 AND photo_s3_key IS NOT NULL
         ORDER BY received_at DESC LIMIT 1`,
        [dog.id],
      ),
    ]);

    const story = storyRes.rows[0];
    const vaccine = vaccineRes.rows[0];
    const photo = photoRes.rows[0];
    const geo = dog.lat != null && dog.lng != null ? coarsenToWard(dog.lat, dog.lng) : undefined;

    const payload: DogPagePayload = {
      slug: dog.slug,
      name: dog.name ?? null,
      status: dog.status as DogStatus,
      wardId: dog.ward_id,
      photoKey: photo?.photo_s3_key ?? null,
      abcStatus: dog.abc_status ?? null,
      vaccineStatus:
        vaccine?.vaccine_name || vaccine?.vaccine_date
          ? [vaccine.vaccine_name, isoDate(vaccine.vaccine_date)].filter(Boolean).join(" · ")
          : null,
      microStory: story?.paragraph ?? null,
      lastSeenAt: dog.last_seen_at ?? null,
      geo: geo ?? null,
    };
    dogCache.set(slug, payload);

    return { ok: true, data: payload };
  });
}
