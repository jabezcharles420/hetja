/**
 * Verifying a dog and updating its status (design v5: N3, N9, "Unverified").
 *
 * POST /api/v1/dogs/:slug/confirm                          second feeder confirms the dog
 * POST /api/v1/dogs/:slug/checkups                         vet checkup record (N3)
 * POST /api/v1/dogs/:slug/status-reports                   not_seen | adopted | passed_away (N9)
 * GET  /api/v1/dogs/:slug/status-reports                   the pending ones
 * POST /api/v1/dogs/:slug/status-reports/:id/confirm       a different feeder confirms
 *
 * Every route here is signed in, and every one but the checkup is for a
 * "feeder of the dog" (lib/dog-feeders.ts). Rate limited per account.
 *
 * VERIFICATION. A dog registered by one person is "Unverified" until either a
 * vet examines it (verified_via = 'vet') or a SECOND person who feeds it says
 * it is real (verified_via = 'feeder'). The second person must not be the
 * registrator, must not be on the phone the registration was filed from (when
 * the request presents a device token), and must have a non-rejected feed of
 * the dog in the window: a second email alias with no feed of the dog cannot
 * confirm it. What verification does NOT do: it gates no SOS, no paging and no
 * trust; it is a badge.
 *
 * THE CHECKUP WRITES THE LEDGER through appendMedicalRecord (routes/medical.ts),
 * the one chain writer, as ONE record per checkup. One, deliberately: every
 * append in a transaction shares that transaction's now() as created_at, and
 * the chain's head query orders by (created_at, id), so two appends in one
 * transaction could be chained in a different order than verification replays
 * them. The record is is_verified because its author is a vet account with a
 * vets registry row; it carries no clinic signature (vet_signature NULL), since
 * the N3 form has no signing key. POST /api/v1/medical_records keeps its
 * signature requirement for signed writes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { MedicalRecordInput, wardDisplay } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { deviceSubjectOf } from "../lib/anon-subject.js";
import { parseUuidParam } from "../lib/params.js";
import { firstName, publicName } from "../lib/public-name.js";
import { enforceLimits, feederWritePerAccount } from "../lib/rate-limit.js";
import { requireFeeder, type RoleAuth } from "../lib/require-role.js";
import {
  enqueueFeederPush,
  feederIdsOfDog,
  hasRecentFeed,
  isFeederOfDog,
  loadDogBySlug,
  type DogRef,
  type TxClient,
} from "../lib/dog-feeders.js";
import { appendMedicalRecord } from "./medical.js";
import { forgetDog } from "./dogs.js";

/** Advisory-lock key for one dog's status changes (namespace in routes/registrations.ts). */
const STATUS_LOCK_KEY = 420_031;

/** A passed_away report waits this long for a second feeder, then lapses. */
const PENDING_DAYS = 30;

const CheckupInput = z.strictObject({
  rabies: z.enum(["given_today", "up_to_date", "due"]),
  sterilised: z.boolean(),
  nextVaccineDue: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  noteForFeeders: z.string().trim().max(500).optional(),
  examined: z.literal(true),
});

const StatusInput = z.strictObject({ kind: z.enum(["not_seen", "adopted", "passed_away"]) });

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });

function budget(req: FastifyRequest, reply: FastifyReply, auth: RoleAuth): boolean {
  return enforceLimits(req.log, reply, [
    { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
  ]);
}

async function dogOf(req: FastifyRequest, reply: FastifyReply): Promise<DogRef | null> {
  const { slug } = req.params as { slug: string };
  const dog = isValidSlug(slug) ? await loadDogBySlug(slug) : null;
  if (!dog) {
    void notFound(reply);
    return null;
  }
  return dog;
}

/** YYYY-MM-DD and YYYY-MM in Asia/Kolkata. */
function kolkataDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/** Feeders who should hear a dog is missing: its own feeders plus everyone who chose its ward. */
async function lookoutRecipients(dog: DogRef, exclude: string, client: TxClient): Promise<string[]> {
  const own = await feederIdsOfDog(dog.id, exclude, client);
  const ward = await client.query<{ id: string }>(
    `SELECT id FROM feeders
      WHERE deleted_at IS NULL AND id <> $2 AND (wards @> ARRAY[$1]::text[] OR home_ward = $1)`,
    [dog.ward_id, exclude],
  );
  return [...new Set([...own, ...ward.rows.map((r) => r.id)])];
}

export default async function dogStatusRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/dogs/:slug/confirm", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!budget(req, reply, auth)) return reply;
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    // A pending or expired registration is invisible to the public; nobody
    // but its registrator knows it exists, and they may not confirm it.
    if (!["active", "lost"].includes(dog.status)) return notFound(reply);

    if (dog.registered_by === auth.feederId) {
      return reply.status(403).send({
        ok: false,
        error: { message: "the person who registered a dog cannot also confirm it", code: "REGISTRATOR_CANNOT_CONFIRM" },
      });
    }
    const device = deviceSubjectOf(req);
    if (device && dog.registered_device_id && device === dog.registered_device_id) {
      return reply.status(403).send({
        ok: false,
        error: { message: "this phone registered the dog; another feeder must confirm it", code: "SAME_DEVICE" },
      });
    }
    if (!(await hasRecentFeed(auth.feederId, dog.id))) {
      return reply.status(403).send({
        ok: false,
        error: { message: "log a feed of this dog before confirming it", code: "NOT_A_FEEDER_OF_DOG" },
      });
    }

    const res = await query<{ verified_via: string }>(
      `UPDATE dogs
          SET verified_at = COALESCE(verified_at, now()),
              verified_by = CASE WHEN verified_at IS NULL THEN $2::uuid ELSE verified_by END,
              verified_via = COALESCE(verified_via, 'feeder')
        WHERE id = $1
        RETURNING verified_via`,
      [dog.id, auth.feederId],
    );
    forgetDog(dog.slug);
    return { ok: true, data: { verified: true, via: res.rows[0]?.verified_via ?? "feeder" } };
  });

  app.post("/api/v1/dogs/:slug/checkups", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (auth.role !== "vet") {
      return reply.status(403).send({ ok: false, error: { message: "vet account required", code: "FORBIDDEN" } });
    }
    if (!budget(req, reply, auth)) return reply;
    const vet = await query<{ id: string }>(`SELECT id FROM vets WHERE feeder_id = $1 LIMIT 1`, [auth.feederId]);
    if (!vet.rows[0]) {
      return reply
        .status(403)
        .send({ ok: false, error: { message: "vet registry entry missing", code: "VET_NOT_REGISTERED" } });
    }
    const parsed = CheckupInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message:
            "body must be { rabies: given_today | up_to_date | due, sterilised: boolean, nextVaccineDue?: YYYY-MM, noteForFeeders?: string, examined: true }",
          code: "INVALID_CHECKUP",
        },
      });
    }
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    const c = parsed.data;

    const today = kolkataDate();
    const thisMonth = today.slice(0, 7);
    const nextYear = `${Number(thisMonth.slice(0, 4)) + 1}${thisMonth.slice(4)}`;
    const due =
      c.nextVaccineDue ?? (c.rabies === "due" ? thisMonth : c.rabies === "given_today" ? nextYear : null);
    const vaccinated = c.rabies !== "due";
    const record = MedicalRecordInput.safeParse({
      dogId: dog.id,
      recordType: vaccinated ? "vaccination" : "checkup",
      ...(vaccinated ? { vaccineName: "Anti-rabies" } : {}),
      ...(c.rabies === "given_today" ? { vaccineDate: today } : {}),
      // abc_date is the date the vet CONFIRMED sterilisation, not the date of
      // surgery (which the form does not ask). It is what makes the public
      // profile say Sterilised: a verified record with abc_date set.
      ...(c.sterilised ? { abcDate: today } : {}),
      diagnosis: [
        "Checkup: examined",
        `anti-rabies ${c.rabies.replace(/_/g, " ")}`,
        `sterilised ${c.sterilised ? "yes" : "no"}`,
        ...(due ? [`next vaccine due ${due}`] : []),
      ].join("; "),
      ...(c.noteForFeeders ? { treatment: c.noteForFeeders } : {}),
    });
    if (!record.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid checkup", code: "INVALID_CHECKUP" } });
    }

    await withTx(async (client) => {
      await appendMedicalRecord(client, {
        input: record.data,
        vetId: vet.rows[0].id,
        isVerified: true,
        vetSignature: null,
      });
      // verified_at = now() is this transaction's timestamp, the same value
      // the ledger row's created_at received, which is how the Alerts list
      // finds the record behind a "verified" alert.
      await client.query(
        `UPDATE dogs
            SET verified_at = now(), verified_by = $2, verified_via = 'vet',
                vaccine_due_month = COALESCE($3, vaccine_due_month),
                abc_status = $4
          WHERE id = $1`,
        [dog.id, auth.feederId, due, c.sterilised ? "sterilised" : "not_sterilised"],
      );
    });
    forgetDog(dog.slug);
    return reply.status(201).send({ ok: true, data: { verified: true, via: "vet" } });
  });

  /**
   * N9. not_seen marks the dog lost at once and asks its feeders and everyone
   * who chose its ward to look out; adopted applies at once; passed_away waits
   * for a second feeder (a different account). A feeder who files passed_away
   * while someone ELSE's report is pending has confirmed it, so the POST does
   * exactly that. Repeating your own pending report answers it again.
   */
  app.post("/api/v1/dogs/:slug/status-reports", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!budget(req, reply, auth)) return reply;
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" },
      });
    }
    const parsed = StatusInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "body must be { kind: not_seen | adopted | passed_away }", code: "INVALID_STATUS_REPORT" },
      });
    }
    const { kind } = parsed.data;
    const me = auth.feederId;

    const result = await withTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [STATUS_LOCK_KEY, dog.id]);
      const cur = await client.query<{ status: string }>(`SELECT status::text AS status FROM dogs WHERE id = $1`, [
        dog.id,
      ]);
      const status = cur.rows[0]?.status ?? dog.status;
      if (!["active", "lost"].includes(status)) return { conflict: status };
      const name = dog.name ?? "A dog";

      if (kind === "not_seen") {
        if (status === "lost") {
          const last = await client.query<{ id: string }>(
            `SELECT id FROM dog_status_reports WHERE dog_id = $1 AND kind = 'not_seen' ORDER BY created_at DESC LIMIT 1`,
            [dog.id],
          );
          if (last.rows[0]) return { id: last.rows[0].id, status: "lost", needsConfirmation: false };
        }
        const ins = await client.query<{ id: string }>(
          `INSERT INTO dog_status_reports (dog_id, kind, reported_by) VALUES ($1, 'not_seen', $2) RETURNING id`,
          [dog.id, me],
        );
        await client.query(`UPDATE dogs SET status = 'lost' WHERE id = $1`, [dog.id]);
        await enqueueFeederPush(client, await lookoutRecipients(dog, me, client), {
          kind: "not_seen",
          title: `Look out for ${name}`,
          body: `${name} has not been seen lately in ${wardDisplay(dog.ward_id).code}. Log a feed if you see them.`,
          url: `/dog/${dog.slug}`,
          tag: `not-seen-${dog.slug}`,
        });
        return { id: ins.rows[0].id, status: "lost", needsConfirmation: false };
      }

      if (kind === "adopted") {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO dog_status_reports (dog_id, kind, reported_by) VALUES ($1, 'adopted', $2) RETURNING id`,
          [dog.id, me],
        );
        await client.query(`UPDATE dogs SET status = 'adopted' WHERE id = $1`, [dog.id]);
        await enqueueFeederPush(client, await feederIdsOfDog(dog.id, me, client), {
          kind: "status",
          title: `${name} has a home`,
          body: `A feeder reported ${name} adopted or moved to a shelter.`,
          url: `/me/dogs/${dog.slug}/status`,
          tag: `status-${dog.slug}`,
        });
        return { id: ins.rows[0].id, status: "adopted", needsConfirmation: false };
      }

      // passed_away
      const pending = await client.query<{ id: string; reported_by: string | null }>(
        `SELECT id, reported_by FROM dog_status_reports
          WHERE dog_id = $1 AND kind = 'passed_away' AND confirmed_at IS NULL
            AND created_at >= now() - make_interval(days => $2)
          ORDER BY created_at DESC LIMIT 1`,
        [dog.id, PENDING_DAYS],
      );
      const p = pending.rows[0];
      if (p && p.reported_by === me) return { id: p.id, status, needsConfirmation: true };
      if (p) {
        await client.query(`UPDATE dog_status_reports SET confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [
          p.id,
          me,
        ]);
        await client.query(`UPDATE dogs SET status = 'deceased' WHERE id = $1`, [dog.id]);
        return { id: p.id, status: "deceased", needsConfirmation: false };
      }
      const ins = await client.query<{ id: string }>(
        `INSERT INTO dog_status_reports (dog_id, kind, reported_by) VALUES ($1, 'passed_away', $2) RETURNING id`,
        [dog.id, me],
      );
      await enqueueFeederPush(client, await feederIdsOfDog(dog.id, me, client), {
        kind: "status",
        title: `Is ${name} gone?`,
        body: `A feeder reported that ${name} has passed away. A second feeder needs to confirm.`,
        url: `/me/dogs/${dog.slug}/status`,
        tag: `status-${dog.slug}`,
      });
      return { id: ins.rows[0].id, status, needsConfirmation: true };
    });

    if ("conflict" in result) {
      return reply.status(409).send({
        ok: false,
        error: { message: `the dog is already ${result.conflict}`, code: "DOG_STATUS_FINAL" },
      });
    }
    forgetDog(dog.slug);
    return reply.status(201).send({ ok: true, data: result });
  });

  app.get("/api/v1/dogs/:slug/status-reports", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" },
      });
    }
    const res = await query<{
      id: string;
      kind: string;
      created_at: Date;
      reported_by: string | null;
      name: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT r.id, r.kind, r.created_at, r.reported_by, f.display_name AS name, f.deleted_at
         FROM dog_status_reports r LEFT JOIN feeders f ON f.id = r.reported_by
        WHERE r.dog_id = $1 AND r.kind = 'passed_away' AND r.confirmed_at IS NULL
          AND r.created_at >= now() - make_interval(days => $2)
        ORDER BY r.created_at DESC`,
      [dog.id, PENDING_DAYS],
    );
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      data: {
        reports: res.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          createdAt: r.created_at.toISOString(),
          reportedByName: publicName(r.name, r.deleted_at),
          mine: r.reported_by === auth.feederId,
        })),
      },
    };
  });

  /**
   * GET /api/v1/dogs/:slug/week (design v6, N15): a feeder's private view of
   * a dog's last 7 Asia/Kolkata days, from EVERYONE's logs: was she fed, the
   * last outcome that day, and who (first name only, opt-out respected). Plus
   * her feeders' first names, when the next rabies shot is due, and how many
   * vet records she has. Feeders of the dog only. No positions.
   */
  app.get("/api/v1/dogs/:slug/week", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" },
      });
    }
    const [days, feeders, vax, due, records] = await Promise.all([
      query<{ day: string; fed: boolean; outcome: string | null; name: string | null; show: boolean | null; deleted_at: Date | null }>(
        `SELECT to_char(g.day, 'YYYY-MM-DD') AS day, last.captured_at IS NOT NULL AS fed, last.feed_outcome AS outcome,
                last.display_name AS name, last.show_first_name AS show, last.deleted_at
           FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 6,
                                (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') AS g(day)
           LEFT JOIN LATERAL (
             SELECT s.captured_at, s.feed_outcome, f.display_name, f.show_first_name, f.deleted_at
               FROM scans s LEFT JOIN feeders f ON f.id = s.feeder_id
              WHERE s.dog_id = $1 AND s.scan_type = 'feed' AND s.review_status <> 'rejected'
                AND (s.captured_at AT TIME ZONE 'Asia/Kolkata')::date = g.day::date
              ORDER BY s.captured_at DESC LIMIT 1) last ON true
          ORDER BY g.day`,
        [dog.id],
      ),
      query<{ display_name: string; show_first_name: boolean }>(
        `SELECT f.display_name, f.show_first_name FROM feeders f
          WHERE f.id = ANY($1::uuid[]) ORDER BY f.created_at`,
        [await feederIdsOfDog(dog.id, null)],
      ),
      query<{ vaccine_date: Date | null }>(
        `SELECT vaccine_date FROM medical_records
          WHERE dog_id = $1 AND is_verified AND record_type IN ('vaccination', 'vaccine') AND vaccine_date IS NOT NULL
          ORDER BY vaccine_date DESC LIMIT 1`,
        [dog.id],
      ),
      query<{ vaccine_due_month: string | null }>(`SELECT vaccine_due_month FROM dogs WHERE id = $1`, [dog.id]),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM medical_records WHERE dog_id = $1 AND is_verified`, [dog.id]),
    ]);
    const lastGivenRaw = vax.rows[0]?.vaccine_date ?? null;
    const lastGiven = lastGivenRaw ? kolkataDate(new Date(lastGivenRaw.getTime() + 12 * 3600 * 1000)).slice(0, 10) : null;
    const dueMonth = due.rows[0]?.vaccine_due_month ?? null;
    const dueDate = dueMonth
      ? `${dueMonth}-01`
      : lastGiven
        ? `${Number(lastGiven.slice(0, 4)) + 1}${lastGiven.slice(4)}`
        : null;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      data: {
        days: days.rows.map((d) => ({
          date: d.day,
          fed: d.fed,
          outcome: d.outcome ?? null,
          byFirstName: d.fed ? firstName(d.name, d.show, d.deleted_at) : null,
        })),
        feederNames: feeders.rows
          .map((f) => firstName(f.display_name, f.show_first_name))
          .filter((n): n is string => n !== null),
        rabiesDue: dueDate ? { lastGiven, dueDate } : null,
        vetRecordCount: records.rows[0]?.n ?? 0,
      },
    };
  });

  app.post("/api/v1/dogs/:slug/status-reports/:id/confirm", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!budget(req, reply, auth)) return reply;
    const dog = await dogOf(req, reply);
    if (!dog) return reply;
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" },
      });
    }
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({ ok: false, error: { message: "report id must be a UUID", code: "INVALID_REPORT_ID" } });
    }

    const result = await withTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [STATUS_LOCK_KEY, dog.id]);
      const r = await client.query<{
        reported_by: string | null;
        confirmed_at: Date | null;
        kind: string;
        lapsed: boolean;
        dog_status: string;
      }>(
        `SELECT r.reported_by, r.confirmed_at, r.kind,
                r.created_at < now() - make_interval(days => $3) AS lapsed,
                (SELECT status::text FROM dogs WHERE id = r.dog_id) AS dog_status
           FROM dog_status_reports r WHERE r.id = $1 AND r.dog_id = $2`,
        [id, dog.id, PENDING_DAYS],
      );
      const row = r.rows[0];
      if (!row || row.kind !== "passed_away") return "not_found" as const;
      if (row.confirmed_at) return "done" as const;
      // A pending report lapses after PENDING_DAYS (it no longer shows in the
      // GET either), and a dog that is no longer active or lost (adopted,
      // already deceased) cannot be confirmed dead by it.
      if (row.lapsed) return "lapsed" as const;
      if (!["active", "lost"].includes(row.dog_status)) return "final" as const;
      if (row.reported_by === auth.feederId) return "same" as const;
      await client.query(`UPDATE dog_status_reports SET confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [
        id,
        auth.feederId,
      ]);
      await client.query(`UPDATE dogs SET status = 'deceased' WHERE id = $1`, [dog.id]);
      return "done" as const;
    });
    if (result === "not_found") {
      return reply.status(404).send({ ok: false, error: { message: "report not found", code: "REPORT_NOT_FOUND" } });
    }
    if (result === "lapsed") {
      return reply.status(410).send({
        ok: false,
        error: { message: "this report lapsed; file a new one if it is still true", code: "REPORT_LAPSED" },
      });
    }
    if (result === "final") {
      return reply.status(409).send({ ok: false, error: { message: "the dog's status has changed", code: "DOG_STATUS_FINAL" } });
    }
    if (result === "same") {
      return reply.status(403).send({
        ok: false,
        error: { message: "a second feeder must confirm", code: "SAME_REPORTER" },
      });
    }
    forgetDog(dog.slug);
    return { ok: true, data: { id, status: "deceased" } };
  });
}
