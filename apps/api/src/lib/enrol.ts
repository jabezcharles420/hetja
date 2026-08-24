/**
 * Shared collar-minting primitives for the two write paths into the register:
 *
 *   * routes/enrolment.ts    — admin enrolment (`POST /api/v1/dogs`)
 *   * routes/registrations.ts— self-serve registration (`POST /api/v1/registrations`)
 *
 * They were extracted from enrolment.ts rather than copied because these two
 * paths MUST NOT DRIFT: both mint the physical identifier that gets etched onto
 * a tag and glued to an animal. If the public path ever started signing with a
 * different origin, a different slug alphabet, or a different collar-row shape
 * than the admin path, the failure would be discovered by a stranger scanning a
 * tag that resolves wrong — not by any test that compares the two files.
 *
 * THE SLUG RACE THIS FILE FIXES. The old admin-only helper was
 * `mintUnusedSlug`: SELECT 1 FROM dogs WHERE slug = $1, return if absent, then
 * let the caller INSERT later. That check-then-act gap was tolerable while the
 * only caller was an authenticated operator (a collision needs two writers to
 * draw the same 40 random bits at nearly the same moment), but wave 6 makes
 * minting a PUBLIC path: unauthenticated volume against the check window turns
 * "remote" into "schedulable", and the failure mode of a duplicate slug is two
 * physical collars resolving to one dog row. The fix here is structural rather
 * than cosmetic: the slug is minted INSIDE the insert —
 * `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING id`, retried with a fresh
 * draw on collision — so uniqueness is enforced by the UNIQUE constraint itself
 * instead of by a SELECT racing ahead of it. There is deliberately no separate
 * `mintUnusedSlug` export anymore: keeping the broken shape around is how it
 * comes back.
 */
import { generateSlug } from "@hetja/db";
import { signSlug } from "./hmac.js";

/** Minimal structural view of the pg client so helpers avoid a `pg` import. */
interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * The public origin a collar URL points at.
 *
 * Deliberately NOT derived from the request's Host header: a collar is etched
 * once and glued to an animal, so the URL must be the canonical public origin
 * regardless of which hostname the operator happened to call the API on. An
 * admin who ran this against `127.0.0.1:8080` would otherwise print a thousand
 * tags pointing at loopback.
 */
export const PUBLIC_ORIGIN = (process.env.HETJA_PUBLIC_ORIGIN ?? "https://hetja.in").replace(/\/+$/, "");

export function collarUrl(slug: string, sig: string): string {
  return `${PUBLIC_ORIGIN}/d/${slug}?s=${encodeURIComponent(sig)}`;
}

/**
 * Pending registrations allowed per account — and, separately, per device.
 * Both bind (routes/registrations.ts); activation consumes the budget.
 * Lives here so the route that enforces it and the `/feeders/me` readout that
 * displays it cannot disagree about the number.
 */
export const REGISTRATION_BUDGET_MAX = 2;

/**
 * How long a pending registration may sit unattached before it counts as dead.
 *
 * Chosen so the wave's own worked example holds: a registrator who prints on
 * day 1 must still be able to attach on day 30. Past this horizon the tag goes
 * to 'expired' (worker sweep, via dogs_pending_expiry_ix) — though expiry is
 * not oblivion: a scan of an expired tag reactivates the same row, because
 * "never reused" forbids reassigning a slug to a DIFFERENT dog, not the same
 * dog catching up a month late. Wave 9 owns the sweep; the constant lives here
 * because the route that stamps registered_at is the one place the horizon
 * must agree with.
 */
export const PENDING_REGISTRATION_TTL_DAYS = 30;

export interface NewDog {
  name: string | null;
  sex: string | null;
  approxAge: number | null;
  coatPattern: string | null;
  temperament: string | null;
  wardId: string;
  /** 'active' for admin enrolment; 'pending_activation' for self-serve. */
  status: "active" | "pending_activation";
  /** Self-serve only: the registering account (INVARIANT 11: erasure sets NULL). */
  registeredBy: string | null;
  /** Self-serve only: canonical deviceTokenSubject() value, never the token. */
  registeredDeviceId: string | null;
}

export interface NewCollar {
  batchNo: string;
  material: string;
}

export interface MintedCollar {
  dogId: string;
  slug: string;
  /** HMAC over the slug under HETJA_QR_SECRET — encode THIS in the QR. */
  sig: string;
}

/**
 * Mints one dog row plus its active collar row inside the caller's
 * transaction, drawing slugs until the UNIQUE constraint accepts one.
 *
 * One transaction, because a dog without a collar is an unreachable row, and a
 * collar without a dog violates its foreign key: either both exist or neither
 * does. The signature is ALSO stored in collars.hmac_sig, which verification
 * consults first, so a collar minted here keeps working even if HETJA_QR_SECRET
 * is later lost or rotated.
 */
export async function createDogWithCollar(
  client: TxClient,
  dog: NewDog,
  collar: NewCollar,
  qrSecret: string,
): Promise<MintedCollar> {
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const slug = generateSlug();
    // ON CONFLICT (slug) DO NOTHING RETURNING: the constraint is the arbiter.
    // Zero rows means another writer won this slug between our draw and our
    // insert — draw again, inside the same transaction.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO dogs (slug, name, sex, approx_age, coat_pattern, temperament, ward_id, status,
                         registered_by, registered_at, registered_device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        slug,
        dog.name,
        dog.sex,
        dog.approxAge,
        dog.coatPattern,
        dog.temperament,
        dog.wardId,
        dog.status,
        dog.registeredBy,
        dog.registeredBy === null ? null : new Date(),
        dog.registeredDeviceId,
      ],
    );
    if ((inserted.rowCount ?? 0) !== 1) continue;

    const dogId = inserted.rows[0].id;
    const sig = signSlug(slug, qrSecret);
    await client.query(
      `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material)
       VALUES ($1, $2, $3, $4, $5)`,
      [dogId, slug, sig, collar.batchNo, collar.material],
    );
    return { dogId, slug, sig };
  }
  throw new Error(`could not mint an unused slug in ${attempts} attempts`);
}
