/**
 * Finding a dog without a working QR (design v5: F2 partial code, N8 typed-code
 * miss, F3 "Find by ward and photo", R3 duplicate check).
 *
 * GET /api/v1/dogs/lookup?code=<9 chars, ? for unknown>
 * GET /api/v1/wards/:wardId/dogs?colour=brown|black|white|spotted
 *
 * Both are anonymous reads a stranger makes standing over a dog, so both return
 * DogCards only: slug, name, ward, portrait, markings and a last-seen TIME.
 * Never a position of any precision (INVARIANT 2), never who feeds the dog
 * (INVARIANT 3). Active and lost dogs only: a pending registration stays
 * invisible to every public surface (routes/registrations.ts), and a deceased
 * or adopted dog is not one a stranger is looking for.
 *
 * ENUMERATION, stated plainly (INVARIANT 1's concern). These reads hand out
 * slugs by design: a partial code with four known characters, or a ward and a
 * colour, is exactly what the F2/F3 screens exist to turn into a dog. What
 * bounds walking the register through them is the rate limiting, not the
 * query: per device (or per IP without one: the pages call these with no
 * credential) and a single global bucket each (lib/rate-limit.ts). At most 5
 * cards per lookup list and 30 per ward page. Both answer Cache-Control:
 * no-store (Caddy's /api/v1/* catch-all agrees), so no shared cache can serve
 * one person's answer to another or outlive a dog going missing.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BMC_WARD_CODES, isBmcWardCode, wardDisplay } from "@hetja/contracts";
import { isValidSlug, query } from "@hetja/db";
import { anonSubject } from "../lib/anon-subject.js";
import { dogSex } from "../lib/dog-feeders.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import {
  GLOBAL_SUBJECT,
  enforceLimits,
  lookupGlobal,
  lookupPerSubject,
  wardDogsGlobal,
  wardDogsPerSubject,
} from "../lib/rate-limit.js";

/** Every character a slug may contain (the validator's alphabet, packages/db/src/slugs.ts). */
const SLUG_CHARS = "abcdefghijkmnopqrstuvwxyz23456789";
const MIN_KNOWN = 4;
const LIST_LIMIT = 5;
const WARD_LIMIT = 30;
const COLOURS = ["brown", "black", "white", "spotted"] as const;

/**
 * Normalise a typed or partly-read collar code: case folded, spaces and
 * dashes dropped (the tag prints the code in groups of three), `0` read as
 * `o`, `1` and `l` read as `i` (the alphabet has no `0`, `1` or `l`), and `?`,
 * `_` or `*` as an unknown character. Returns null unless the result is
 * exactly nine characters from the alphabet or `?`.
 */
export function normaliseCode(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/0/g, "o")
    .replace(/[1l]/g, "i")
    .replace(/[_*]/g, "?");
  if (s.length !== 9) return null;
  for (const c of s) if (c !== "?" && !SLUG_CHARS.includes(c)) return null;
  return s;
}

/**
 * Every valid slug one swap (any two positions) or one substitution away from
 * `code`, minus `code` itself. ~300 candidates, of which the check character
 * lets through about one in 32, before any database work.
 */
export function nearMisses(code: string): string[] {
  const out = new Set<string>();
  const chars = [...code];
  for (let i = 0; i < 9; i++) {
    for (let j = i + 1; j < 9; j++) {
      if (chars[i] === chars[j]) continue;
      const c = [...chars];
      [c[i], c[j]] = [c[j], c[i]];
      out.add(c.join(""));
    }
    for (const ch of SLUG_CHARS) {
      if (ch === chars[i]) continue;
      const c = [...chars];
      c[i] = ch;
      out.add(c.join(""));
    }
  }
  out.delete(code);
  return [...out].filter(isValidSlug);
}

interface CardRow {
  slug: string;
  name: string | null;
  ward_id: string;
  markings: string[] | null;
  last_seen_at: Date | null;
  photo_key: string | null;
  avatar_key: string | null;
  sex: string | null;
}

const CARD_COLUMNS = `d.slug, d.name, d.sex, d.ward_id, d.markings, d.last_seen_at, ${PORTRAIT_SQL} AS photo_key,
  ${AVATAR_SQL} AS avatar_key`;
const PUBLIC_STATUS = `d.status IN ('active', 'lost')`;

function toCard(req: FastifyRequest, r: CardRow) {
  return {
    slug: r.slug,
    name: r.name ?? null,
    sex: dogSex(r.sex),
    wardId: r.ward_id,
    wardCode: wardDisplay(r.ward_id).code,
    photoUrl: photoUrlFor(req, r.photo_key),
    avatarUrl: photoUrlFor(req, r.avatar_key),
    markings: r.markings ?? [],
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
  };
}

export default async function findingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/dogs/lookup", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const subject = anonSubject(req);
    if (
      !enforceLimits(req.log, reply, [
        { limiter: lookupPerSubject, key: subject.key, name: "lookupPerSubject", kind: subject.kind },
        { limiter: lookupGlobal, key: GLOBAL_SUBJECT, name: "lookupGlobal", kind: "global" },
      ])
    ) {
      return reply;
    }

    const raw = (req.query as { code?: unknown }).code;
    const code = typeof raw === "string" ? normaliseCode(raw) : null;
    if (!code) {
      return reply.status(400).send({
        ok: false,
        error: { message: "code must be 9 characters, with ? for any you cannot read", code: "INVALID_CODE" },
      });
    }
    const known = [...code].filter((c) => c !== "?").length;
    if (known < MIN_KNOWN) {
      return reply.status(400).send({
        ok: false,
        error: { message: `at least ${MIN_KNOWN} characters must be known`, code: "TOO_FEW_KNOWN" },
      });
    }

    if (!code.includes("?")) {
      // A full code. The check character is the gate before the database, as
      // on GET /dogs/:slug: an invalid one cannot be a real slug.
      if (isValidSlug(code)) {
        const exact = await query<CardRow>(
          `SELECT ${CARD_COLUMNS} FROM dogs d WHERE d.slug = $1 AND ${PUBLIC_STATUS}`,
          [code],
        );
        if (exact.rows[0]) {
          return { ok: true, data: { exact: toCard(req, exact.rows[0]), matches: [], suggestions: [] } };
        }
      }
      const candidates = nearMisses(code);
      const near =
        candidates.length === 0
          ? { rows: [] as CardRow[] }
          : await query<CardRow>(
              `SELECT ${CARD_COLUMNS} FROM dogs d
                WHERE d.slug = ANY($1::text[]) AND ${PUBLIC_STATUS}
                ORDER BY d.last_seen_at DESC NULLS LAST, d.slug
                LIMIT $2`,
              [candidates, LIST_LIMIT],
            );
      return { ok: true, data: { exact: null, matches: [], suggestions: near.rows.map((r) => toCard(req, r)) } };
    }

    // A partial code: `?` is any one character. The code is already reduced
    // to [a-km-z2-9?], so the LIKE pattern cannot carry a wildcard or escape
    // the caller did not mean.
    const pattern = code.replace(/\?/g, "_");
    const matches = await query<CardRow>(
      `SELECT ${CARD_COLUMNS} FROM dogs d
        WHERE d.slug LIKE $1 AND ${PUBLIC_STATUS}
        ORDER BY d.last_seen_at DESC NULLS LAST, d.slug
        LIMIT $2`,
      [pattern, LIST_LIMIT],
    );
    return { ok: true, data: { exact: null, matches: matches.rows.map((r) => toCard(req, r)), suggestions: [] } };
  });

  app.get("/api/v1/wards/:wardId/dogs", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const subject = anonSubject(req);
    if (
      !enforceLimits(req.log, reply, [
        { limiter: wardDogsPerSubject, key: subject.key, name: "wardDogsPerSubject", kind: subject.kind },
        { limiter: wardDogsGlobal, key: GLOBAL_SUBJECT, name: "wardDogsGlobal", kind: "global" },
      ])
    ) {
      return reply;
    }

    const { wardId } = req.params as { wardId: string };
    if (!isBmcWardCode(wardId)) {
      return reply.status(404).send({
        ok: false,
        error: { message: `unknown ward; expected one of ${BMC_WARD_CODES.join(", ")}`, code: "WARD_NOT_FOUND" },
      });
    }
    const colourRaw = (req.query as { colour?: unknown }).colour;
    const colour =
      colourRaw === undefined || colourRaw === ""
        ? null
        : (COLOURS as readonly unknown[]).includes(colourRaw)
          ? (colourRaw as string)
          : undefined;
    if (colour === undefined) {
      return reply.status(400).send({
        ok: false,
        error: { message: `colour must be one of ${COLOURS.join(", ")}`, code: "INVALID_COLOUR" },
      });
    }

    // coat_pattern is the registrator's free text ("brown and white"), so the
    // colour filter is a substring match on it: a two-colour dog is found by
    // either colour, which is what someone describing it would try.
    const [counts, dogs] = await Promise.all([
      query<{ total: number; colour_total: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE $2::text IS NULL OR d.coat_pattern ILIKE '%' || $2 || '%')::int AS colour_total
           FROM dogs d WHERE d.ward_id = $1 AND ${PUBLIC_STATUS}`,
        [wardId, colour],
      ),
      query<CardRow>(
        `SELECT ${CARD_COLUMNS} FROM dogs d
          WHERE d.ward_id = $1 AND ${PUBLIC_STATUS}
            AND ($2::text IS NULL OR d.coat_pattern ILIKE '%' || $2 || '%')
          ORDER BY d.last_seen_at DESC NULLS LAST, d.slug
          LIMIT $3`,
        [wardId, colour, WARD_LIMIT],
      ),
    ]);

    return {
      ok: true,
      data: {
        wardId,
        total: counts.rows[0]?.total ?? 0,
        colourTotal: counts.rows[0]?.colour_total ?? 0,
        dogs: dogs.rows.map((r) => toCard(req, r)),
      },
    };
  });
}
