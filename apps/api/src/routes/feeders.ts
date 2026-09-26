/**
 * GET /api/v1/feeders/me: the caller's own account, as the server sees it.
 * PATCH /api/v1/feeders/me { sosOptIn?, displayName?, homeWard?, wards?, quietHours?,
 *   alertsMode?, onboarded? }: SOS consent + profile (v5 fields: N1, N6).
 * GET /api/v1/feeders/me/dogs, /alerts, /export and DELETE /api/v1/feeders/me:
 *   design v5 (docs/design/v5-handoff/CONTRACT.md), documented at each route.
 *
 * WHY THIS EXISTS. The client learns its role exactly once today (in the
 * /auth/verify response) and throws it away, so after a refresh or a page
 * load the web app has no way to know which surface to land on. The
 * registrator flow ("fill a form, print a sheet, walk outside, scan a tag")
 * needs the app to route on capability at any moment, not only at login.
 *
 * Everything here is a LIVE read (requireFeeder re-reads feeders.role; the
 * profile SELECT reads what the database says NOW). Deliberately no caching
 * and no role claim in the JWT: grant-admin.ts --revoke and DPDP erasure
 * both work by the next request seeing the database's truth. See
 * lib/require-role.ts for the full reasoning.
 *
 * registrationBudget is the live number now that the write path exists
 * (routes/registrations.ts): pending counts this account's INERT
 * ('pending_activation') registrations against REGISTRATION_BUDGET_MAX:
 * attaching tags consumes the budget, so the number falls as tags go on.
 * `canRegister` is the AND of the role's capability and the operator-side
 * `can_register` flag: the flag is the real kill switch (the role is
 * self-elected, so removing it would be a preference the account re-sets),
 * and /me must say "no" when either half says no.
 *
 * sosOptIn is the consent half of the SOS fan-out (routes/sos.ts). Paging
 * someone's phone requires it, and until wave 7 NOTHING could set it: the
 * column existed in 0001, the fan-out filtered on it, and every feeder row
 * therefore answered FALSE forever. That was one half of why the fan-out never
 * notified anyone. The PATCH accepts exactly one field, deliberately: the
 * old design expected feeders.last_known_geo to ride along with consent,
 * which would have turned a consent checkbox into a location-tracking
 * surface. Proximity is now derived from scan history instead (sos.ts), so
 * consent stays consent and carries no position.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BMC_WARD_CODES, wardDisplay, wardName } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { requireFeeder } from "../lib/require-role.js";
import { capabilitiesFor } from "../lib/require-role.js";
import { REGISTRATION_BUDGET_MAX, REGISTRATION_WEEKLY_CAP } from "../lib/enrol.js";
import { FEEDER_WINDOW_DAYS, dogSex } from "../lib/dog-feeders.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { claimInvites, loadAdmin } from "../lib/admin.js";
import { ngoMembership, regLabel, vetStanding } from "../lib/professionals.js";
import { FORMER_FEEDER_NAME, publicName } from "../lib/public-name.js";
import { exportPerAccount, logRateLimited } from "../lib/rate-limit.js";
import { forgetAllDogs } from "./dogs.js";
import { releaseCase } from "./sos.js";

interface MyDogRow {
  id: string;
  slug: string;
  name: string | null;
  ward_id: string;
  status: string;
  verified_at: Date | null;
  registered_by: string | null;
  registered_at: Date | null;
  vaccine_due_month: string | null;
  my_last_fed_at: Date | null;
  last_fed_at: Date | null;
  last_fed_by_name: string | null;
  last_fed_by_deleted: Date | null;
  last_fed_by_id: string | null;
  photo_key: string | null;
  avatar_key: string | null;
  sos_since: Date | null;
  tag_since: Date | null;
  tag_kind: string | null;
  not_seen_at: Date | null;
  sex: string | null;
}

/** Upper bound on GET /feeders/me/dogs. A feeder with more is an NGO, and a page of 50 is plenty for a home screen. */
const MY_DOGS_LIMIT = 50;

interface MeRow {
  display_name: string;
  trust_score: number;
  verification_tier: string;
  home_ward: string | null;
  can_register: boolean;
  sos_opt_in: boolean;
  wards: string[];
  quiet_start: number | null;
  quiet_end: number | null;
  alerts_mode: string | null;
  onboarded_at: Date | null;
  show_first_name: boolean;
  sos_paused_until: Date | null;
}

/** "HH:MM" for minutes after midnight. */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOf(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function quietHoursOf(start: number | null, end: number | null): { start: string; end: string } | null {
  return start == null || end == null ? null : { start: hhmm(start), end: hhmm(end) };
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** "YYYY-MM" for a Date, in Asia/Kolkata. */
function monthInKolkata(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .format(d)
    .slice(0, 7);
}

type AttentionKind = "sos" | "tag" | "missing" | "vet" | "new";

/**
 * What a dog on N4 "My dogs" needs from the caller, most urgent first. One
 * item, because the row has room for one: an open SOS outranks a tag problem,
 * which outranks a missing dog, which outranks a vaccine falling due within a
 * month, which outranks a tag that has not been switched on yet.
 */
function attentionOf(
  row: MyDogRow,
  registeredByMe: boolean,
  now: Date,
): { kind: AttentionKind; since: string; detail: string | null } | null {
  if (row.sos_since) return { kind: "sos", since: iso(row.sos_since)!, detail: null };
  if (row.tag_since) return { kind: "tag", since: iso(row.tag_since)!, detail: row.tag_kind };
  if (row.status === "lost") {
    return { kind: "missing", since: iso(row.not_seen_at ?? row.registered_at ?? now)!, detail: null };
  }
  if (row.vaccine_due_month) {
    const horizon = monthInKolkata(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    if (row.vaccine_due_month <= horizon) {
      return { kind: "vet", since: `${row.vaccine_due_month}-01T00:00:00.000Z`, detail: row.vaccine_due_month };
    }
  }
  if (registeredByMe && row.status === "pending_activation" && row.registered_at) {
    return { kind: "new", since: iso(row.registered_at)!, detail: null };
  }
  return null;
}

/** The longest alerts pause (L1): a pause is a holiday, not a way out of consent. */
const SOS_PAUSE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const FeederPatchSchema = z
  .strictObject({
    sosOptIn: z.boolean().optional(),
    // 1 to 40 since design v5 (was 64): the name is shown to others only as
    // publicName(), but the stored form is what export and Settings show.
    displayName: z.string().trim().min(1).max(40).optional(),
    homeWard: z.enum(BMC_WARD_CODES).nullable().optional(),
    wards: z
      .array(z.enum(BMC_WARD_CODES))
      .max(6)
      .refine((w) => new Set(w).size === w.length, { message: "wards must not repeat" })
      .optional(),
    quietHours: z
      .strictObject({ start: HHMM, end: HHMM })
      .refine((q) => q.start !== q.end, { message: "quiet hours must not start and end at the same time" })
      .nullable()
      .optional(),
    alertsMode: z.enum(["sos_only", "all"]).optional(),
    onboarded: z.literal(true).optional(),
    // Design v6: "Show my first name on dogs' pages", and the L1 alerts
    // pause (an ISO time at most 30 days ahead, or null to resume).
    showFirstName: z.boolean().optional(),
    sosPausedUntil: z
      .string()
      .datetime({ offset: true })
      .refine(
        (v) => {
          const t = Date.parse(v);
          return t > Date.now() && t <= Date.now() + SOS_PAUSE_MAX_MS;
        },
        { message: "sosPausedUntil must be in the future and at most 30 days ahead" },
      )
      .nullable()
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "body must contain at least one field",
  });

export default async function feederRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // requireFeeder already proved the row exists (FEEDER_GONE otherwise), so
    // this SELECT cannot come back empty barring a concurrent erasure, in
    // which case answering FEEDER_GONE is again the honest response.
    const res = await query<MeRow>(
      `SELECT display_name, trust_score, verification_tier, home_ward, can_register, sos_opt_in,
              wards, quiet_start, quiet_end, alerts_mode, onboarded_at, show_first_name, sos_paused_until
         FROM feeders WHERE id = $1 AND deleted_at IS NULL`,
      [auth.feederId],
    );
    const feeder = res.rows[0];
    if (!feeder) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
    }

    const capabilities = [...capabilitiesFor(auth.role)].sort();
    const holdsRegister = capabilities.includes("register");
    // Design v7: an invitation addressed to this account (vet, NGO member,
    // admin team) is claimed on this read, then the portals it opens are
    // reported for the tab bar (vet / ngo) and the Me rows.
    await claimInvites(auth.feederId);
    const [vet, ngo, admin] = await Promise.all([
      vetStanding(auth.feederId),
      ngoMembership(auth.feederId),
      loadAdmin(auth.feederId, app.config),
    ]);

    // The budget is only meaningful for accounts that can file registrations;
    // everyone else reports a truthful zero without spending the query.
    const counts = holdsRegister
      ? (
          await query<{ pending: number; weekly: number }>(
            `SELECT count(*) FILTER (WHERE status = 'pending_activation')::int AS pending,
                    count(*) FILTER (WHERE registered_at >= now() - interval '7 days')::int AS weekly
               FROM dogs WHERE registered_by = $1`,
            [auth.feederId],
          )
        ).rows[0]
      : undefined;
    const pending = counts?.pending ?? 0;
    // `weekly` (hardening batch 1, T9): this account's registrations of any
    // status in the rolling last 7 days, against REGISTRATION_WEEKLY_CAP. The
    // per-device half of the cap is enforced on POST /registrations but has no
    // device to report on here.
    const weeklyUsed = counts?.weekly ?? 0;

    return {
      ok: true,
      data: {
        feederId: auth.feederId,
        displayName: feeder.display_name,
        role: auth.role,
        capabilities,
        trustScore: feeder.trust_score,
        verificationTier: feeder.verification_tier,
        homeWard: feeder.home_ward ?? null,
        canRegister: holdsRegister && feeder.can_register,
        registrationBudget: {
          pending,
          max: REGISTRATION_BUDGET_MAX,
          weekly: { used: weeklyUsed, max: REGISTRATION_WEEKLY_CAP },
        },
        sosOptIn: feeder.sos_opt_in,
        // Design v5 (N1, N6).
        wards: feeder.wards ?? [],
        quietHours: quietHoursOf(feeder.quiet_start, feeder.quiet_end),
        alertsMode: feeder.alerts_mode === "sos_only" ? "sos_only" : "all",
        onboarded: feeder.onboarded_at !== null,
        publicName: publicName(feeder.display_name) ?? "",
        // Design v6.
        showFirstName: feeder.show_first_name,
        sosPausedUntil:
          feeder.sos_paused_until && feeder.sos_paused_until.getTime() > Date.now()
            ? feeder.sos_paused_until.toISOString()
            : null,
        // Design v7.
        vet: vet ? { status: vet.status, regLabel: regLabel(vet.council, vet.regNo) } : null,
        ngo: ngo ? { id: ngo.ngoId, name: ngo.name, status: ngo.status, role: ngo.role } : null,
        adminRoles: admin ? [...new Set(admin.roles.map((r) => r.role))] : [],
      },
    };
  });

  /**
   * GET /api/v1/feeders/me/dogs: N4 "My dogs" (design v5 shape).
   *
   * Every dog the caller REGISTERED (any status, so a pending tag shows as
   * "new") or FED in the last 60 days (server time, the "feeder of a dog"
   * window in lib/dog-feeders.ts). Those they fed come first by their own
   * latest feed; dogs they only registered sort by registration time. At most
   * MY_DOGS_LIMIT. Each carries:
   *
   *   lastFedAt       the dog's latest non-rejected feed by ANYONE
   *   lastFedByName   who that was, as a public name only (lib/public-name.ts);
   *                   null for an anonymous feed or an anonymised account
   *   myLastFedAt     this caller's own latest feed of the dog, or null when
   *                   they registered it and have not fed it
   *   attention       the one thing the dog needs (attentionOf above)
   *
   * No coordinates of any kind, not even coarsened: the ward is enough to
   * find a dog you already know, and a list of where one person's dogs are is
   * a list of where that person goes (INVARIANT 2's reasoning).
   */
  app.get("/api/v1/feeders/me/dogs", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const res = await query<MyDogRow>(
      `WITH mine AS (
         SELECT s.dog_id, max(s.captured_at) AS my_last_fed_at
           FROM scans s
          WHERE s.feeder_id = $1 AND s.scan_type = 'feed'
            AND s.received_at >= now() - make_interval(days => $3)
          GROUP BY s.dog_id
       ), ids AS (
         SELECT dog_id FROM mine
         UNION
         -- v7: a dog this feeder registered that was merged shows as the kept dog.
         SELECT COALESCE(merged_into, id) FROM dogs WHERE registered_by = $1
       )
       SELECT d.id, d.slug, d.name, d.ward_id, d.status::text AS status, d.verified_at, d.registered_by,
              d.registered_at, d.vaccine_due_month, d.sex, mine.my_last_fed_at,
              lf.captured_at AS last_fed_at, lf.display_name AS last_fed_by_name,
              lf.deleted_at AS last_fed_by_deleted, lf.feeder_id AS last_fed_by_id,
              ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
              (SELECT min(c.opened_at) FROM sos_cases c
                WHERE c.dog_id = d.id AND c.resolved_at IS NULL
                  AND c.state IN ('open', 'acked', 'escalated')) AS sos_since,
              (SELECT min(t.created_at) FROM tag_reports t
                WHERE t.dog_id = d.id AND t.resolved_at IS NULL) AS tag_since,
              (SELECT t.kind FROM tag_reports t
                WHERE t.dog_id = d.id AND t.resolved_at IS NULL
                ORDER BY t.created_at DESC LIMIT 1) AS tag_kind,
              (SELECT max(r.created_at) FROM dog_status_reports r
                WHERE r.dog_id = d.id AND r.kind = 'not_seen') AS not_seen_at
         FROM ids
         JOIN dogs d ON d.id = ids.dog_id
         LEFT JOIN mine ON mine.dog_id = d.id
         LEFT JOIN LATERAL (
           SELECT a.captured_at, a.feeder_id, f.display_name, f.deleted_at
             FROM scans a LEFT JOIN feeders f ON f.id = a.feeder_id
            WHERE a.dog_id = d.id AND a.scan_type = 'feed' AND a.review_status <> 'rejected'
            ORDER BY a.captured_at DESC LIMIT 1
         ) lf ON true
        ORDER BY (mine.my_last_fed_at IS NULL), COALESCE(mine.my_last_fed_at, d.registered_at) DESC NULLS LAST, d.slug
        LIMIT $2`,
      [auth.feederId, MY_DOGS_LIMIT, FEEDER_WINDOW_DAYS],
    );

    const now = new Date();
    return {
      ok: true,
      data: {
        dogs: res.rows.map((r) => {
          const registeredByMe = r.registered_by === auth.feederId;
          return {
            slug: r.slug,
            name: r.name ?? null,
            wardId: r.ward_id,
            wardName: wardName(r.ward_id),
            lastFedAt: iso(r.last_fed_at),
            myLastFedAt: iso(r.my_last_fed_at),
            photoUrl: photoUrlFor(req, r.photo_key),
            avatarUrl: photoUrlFor(req, r.avatar_key),
            status: r.status,
            sex: dogSex(r.sex),
            verified: r.verified_at !== null,
            registeredByMe,
            lastFedByName: r.last_fed_by_id ? publicName(r.last_fed_by_name, r.last_fed_by_deleted) : null,
            attention: attentionOf(r, registeredByMe, now),
          };
        }),
      },
    };
  });

  /**
   * GET /api/v1/feeders/me/alerts: N5 Alerts. Newest first, last 14 days, at
   * most 50, assembled from what already happened rather than from a
   * notifications table, so nothing needs writing when an event occurs and an
   * alert cannot disagree with its source row:
   *
   *   sos       a case this caller was PAGED for (sos_notifications, push)
   *   tag       a tag report on a dog they feed, by someone else
   *   verified  a dog they feed was verified, by someone else
   *   fed       someone else fed a dog they feed (at most 20, so feeds cannot
   *             crowd out the rest)
   *   not_seen  a dog they feed, or any dog in one of their wards, was
   *             reported not seen (the ward look-out)
   *   status    a dog they feed was reported adopted or passed away
   *
   * "Dogs they feed" is the lib/dog-feeders.ts rule: registered by them, or fed
   * by them in the last 60 days. Other people appear by public name only.
   */
  app.get("/api/v1/feeders/me/alerts", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    reply.header("Cache-Control", "no-store");

    const me = auth.feederId;
    const myDogs = `(SELECT id FROM dogs WHERE registered_by = $1
                     UNION
                     SELECT s.dog_id FROM scans s
                      WHERE s.feeder_id = $1 AND s.scan_type = 'feed' AND s.review_status <> 'rejected'
                        AND s.received_at >= now() - make_interval(days => ${FEEDER_WINDOW_DAYS}))`;
    const since = `now() - interval '14 days'`;

    interface Row {
      id: string;
      at: Date;
      slug: string | null;
      name: string | null;
      ward_id: string | null;
      actor: string | null;
      actor_deleted: Date | null;
      detail: string | null;
    }
    const [sos, tags, verified, fed, notSeen, status] = await Promise.all([
      query<Row>(
        // LEFT JOIN: a dogless SOS (design v6) has a ward and no dog.
        `SELECT c.id::text AS id, n.sent_at AS at, d.slug, d.name, COALESCE(c.ward_id, d.ward_id) AS ward_id,
                NULL::text AS actor, NULL::timestamptz AS actor_deleted, c.severity::text AS detail
           FROM sos_notifications n
           JOIN sos_cases c ON c.id = n.case_id
           LEFT JOIN dogs d ON d.id = c.dog_id
          WHERE n.feeder_id = $1 AND n.channel = 'push' AND n.sent_at >= ${since}
          ORDER BY n.sent_at DESC LIMIT 50`,
        [me],
      ),
      query<Row>(
        `SELECT t.id::text AS id, t.created_at AS at, d.slug, d.name, d.ward_id,
                f.display_name AS actor, f.deleted_at AS actor_deleted, t.kind AS detail
           FROM tag_reports t
           JOIN dogs d ON d.id = t.dog_id
           LEFT JOIN feeders f ON f.id = t.reporter_feeder_id
          WHERE t.dog_id IN ${myDogs} AND t.created_at >= ${since}
            AND t.reporter_feeder_id IS DISTINCT FROM $1
          ORDER BY t.created_at DESC LIMIT 50`,
        [me],
      ),
      query<Row>(
        `SELECT d.id::text AS id, d.verified_at AS at, d.slug, d.name, d.ward_id,
                f.display_name AS actor, f.deleted_at AS actor_deleted,
                CASE WHEN d.verified_via = 'vet' THEN
                  concat_ws(',',
                    CASE WHEN m.record_type IN ('vaccination', 'vaccine') THEN 'vaccinated' END,
                    CASE WHEN m.abc_date IS NOT NULL THEN 'sterilised' END)
                END AS detail
           FROM dogs d
           LEFT JOIN feeders f ON f.id = d.verified_by
           LEFT JOIN LATERAL (
             SELECT mr.record_type, mr.abc_date FROM medical_records mr
              WHERE mr.dog_id = d.id AND mr.is_verified AND mr.created_at = d.verified_at
              LIMIT 1) m ON true
          WHERE d.id IN ${myDogs} AND d.verified_at >= ${since}
            AND d.verified_by IS DISTINCT FROM $1
          ORDER BY d.verified_at DESC LIMIT 50`,
        [me],
      ),
      query<Row>(
        `SELECT s.id::text AS id, s.captured_at AS at, d.slug, d.name, d.ward_id,
                f.display_name AS actor, f.deleted_at AS actor_deleted, s.feed_outcome AS detail
           FROM scans s
           JOIN dogs d ON d.id = s.dog_id
           JOIN feeders f ON f.id = s.feeder_id
          WHERE s.dog_id IN ${myDogs} AND s.scan_type = 'feed' AND s.review_status <> 'rejected'
            AND s.feeder_id <> $1 AND s.received_at >= ${since}
          ORDER BY s.captured_at DESC LIMIT 20`,
        [me],
      ),
      query<Row>(
        `SELECT r.id::text AS id, r.created_at AS at, d.slug, d.name, d.ward_id,
                f.display_name AS actor, f.deleted_at AS actor_deleted, NULL::text AS detail
           FROM dog_status_reports r
           JOIN dogs d ON d.id = r.dog_id
           LEFT JOIN feeders f ON f.id = r.reported_by
          WHERE r.kind = 'not_seen' AND r.created_at >= ${since}
            AND r.reported_by IS DISTINCT FROM $1
            AND (r.dog_id IN ${myDogs}
                 OR d.ward_id = ANY ((SELECT wards FROM feeders WHERE id = $1)::text[]))
          ORDER BY r.created_at DESC LIMIT 50`,
        [me],
      ),
      query<Row>(
        `SELECT r.id::text AS id, COALESCE(r.confirmed_at, r.created_at) AS at, d.slug, d.name, d.ward_id,
                f.display_name AS actor, f.deleted_at AS actor_deleted,
                CASE WHEN r.confirmed_at IS NOT NULL THEN r.kind || '_confirmed' ELSE r.kind END AS detail
           FROM dog_status_reports r
           JOIN dogs d ON d.id = r.dog_id
           LEFT JOIN feeders f ON f.id = r.reported_by
          WHERE r.kind IN ('adopted', 'passed_away') AND r.created_at >= ${since}
            AND r.reported_by IS DISTINCT FROM $1
            AND r.dog_id IN ${myDogs}
          ORDER BY r.created_at DESC LIMIT 50`,
        [me],
      ),
    ]);

    const make = (kind: string, rows: Row[], href: (r: Row) => string) =>
      rows.map((r) => ({
        id: `${kind}:${r.id}`,
        kind,
        at: new Date(r.at).toISOString(),
        dog: r.slug ? { slug: r.slug, name: r.name ?? null } : null,
        wardCode: r.ward_id ? wardDisplay(r.ward_id).code : null,
        actorName: publicName(r.actor, r.actor_deleted),
        detail: r.detail || null,
        href: href(r),
      }));

    const items = [
      ...make("sos", sos.rows, (r) => `/sos/${r.id}`),
      ...make("tag", tags.rows, (r) => `/me/dogs/${r.slug}/tag`),
      ...make("verified", verified.rows, (r) => `/dog/${r.slug}`),
      ...make("fed", fed.rows, (r) => `/dog/${r.slug}`),
      ...make("not_seen", notSeen.rows, (r) => `/dog/${r.slug}`),
      ...make("status", status.rows, (r) => `/me/dogs/${r.slug}/status`),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 50);

    return { ok: true, data: { items } };
  });

  /**
   * GET /api/v1/feeders/me/export: N6 "Download my data". The caller's own
   * rows as JSON, in the usual envelope (the web client parses every response
   * as one) with a Content-Disposition so a browser saves it as a file.
   *
   * What is NOT in it, deliberately: identity_hmac (a keyed hash of the email,
   * meaningless to its owner and useful only to someone attacking the pepper),
   * and coordinates. A feeder's geotags are their own data, but an export is
   * the one response that would hand a complete location history to whoever
   * holds a 15-minute access token. Each feed carries its dog's ward instead.
   * Rate limited per account.
   */
  app.get("/api/v1/feeders/me/export", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const budget = exportPerAccount.consume(`acct:${auth.feederId}`);
    if (!budget.allowed) {
      logRateLimited(req.log, "exportPerAccount", "account");
      return reply
        .status(429)
        .header("retry-after", String(budget.retryAfterSec))
        .send({ ok: false, error: { message: "too many exports; try again later", code: "RATE_LIMITED" } });
    }
    const me = auth.feederId;

    const [profile, feeds, registrations, stories, tagReports, statusReports, prints, sosReports, sosPages, trust] =
      await Promise.all([
        query(
          `SELECT display_name, role, trust_score, verification_tier, home_ward, wards, quiet_start, quiet_end,
                  alerts_mode, sos_opt_in, onboarded_at, show_first_name, sos_paused_until,
                  consent_version, is_minor, streak_days, badges,
                  last_feed_date, created_at
             FROM feeders WHERE id = $1`,
          [me],
        ),
        query(
          `SELECT d.slug, d.ward_id, s.scan_type, s.feed_outcome, s.captured_at, s.received_at, s.review_status
             FROM scans s JOIN dogs d ON d.id = s.dog_id
            WHERE s.feeder_id = $1 AND s.scan_type <> 'sos'
            ORDER BY s.captured_at DESC`,
          [me],
        ),
        query(
          `SELECT slug, name, ward_id, status, registered_at, activated_at, markings
             FROM dogs WHERE registered_by = $1 ORDER BY registered_at DESC NULLS LAST`,
          [me],
        ),
        query(
          `SELECT d.slug, ds.paragraph, ds.version, ds.moderated_at, ds.created_at
             FROM dog_stories ds JOIN dogs d ON d.id = ds.dog_id
            WHERE ds.author_feeder_id = $1 ORDER BY ds.created_at DESC`,
          [me],
        ),
        query(
          `SELECT d.slug, t.kind, t.created_at, t.resolved_at, t.resolution
             FROM tag_reports t JOIN dogs d ON d.id = t.dog_id
            WHERE t.reporter_feeder_id = $1 ORDER BY t.created_at DESC`,
          [me],
        ),
        query(
          `SELECT d.slug, r.kind, r.created_at, r.confirmed_at
             FROM dog_status_reports r JOIN dogs d ON d.id = r.dog_id
            WHERE r.reported_by = $1 ORDER BY r.created_at DESC`,
          [me],
        ),
        query(
          `SELECT d.slug, p.layout, p.paper, p.tag_count, p.printed_at
             FROM tag_prints p JOIN dogs d ON d.id = p.dog_id
            WHERE p.printed_by = $1 ORDER BY p.printed_at DESC`,
          [me],
        ),
        query(
          `SELECT d.slug, COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity, c.state, c.note, c.outcome,
                  c.opened_at, c.resolved_at
             FROM sos_cases c JOIN scans s ON s.id = c.scan_id LEFT JOIN dogs d ON d.id = c.dog_id
            WHERE s.scan_type = 'sos' AND s.feeder_id = $1 ORDER BY c.opened_at DESC`,
          [me],
        ),
        query(
          `SELECT n.case_id, n.sent_at, n.delivered_at, n.acked_at, n.declined_at, n.stood_down
             FROM sos_notifications n WHERE n.feeder_id = $1 ORDER BY n.sent_at DESC`,
          [me],
        ),
        query(
          `SELECT event_type, delta, reason, dispute_state, created_at
             FROM trust_events WHERE feeder_id = $1 ORDER BY created_at DESC`,
          [me],
        ),
      ]);

    reply.header("Cache-Control", "no-store");
    reply.header("Content-Disposition", 'attachment; filename="hetja-my-data.json"');
    return {
      ok: true,
      data: {
        exportedAt: new Date().toISOString(),
        feederId: me,
        profile: profile.rows[0] ?? null,
        feeds: feeds.rows,
        registrations: registrations.rows,
        stories: stories.rows,
        tagReports: tagReports.rows,
        statusReports: statusReports.rows,
        prints: prints.rows,
        sosReports: sosReports.rows,
        sosPages: sosPages.rows,
        trustEvents: trust.rows,
      },
    };
  });

  /**
   * DELETE /api/v1/feeders/me { confirm: "DELETE" }: N6 "Delete my account".
   *
   * ANONYMISE, NOT DELETE. The copy promises "Deleting keeps the dogs you
   * registered and their feed logs, with your name removed", and the rows
   * those reference (dogs.registered_by, scans.feeder_id, dog_stories,
   * trust_events) are evidence other people rely on. So the feeders row stays
   * and loses everything that identifies or reaches the person:
   *
   *   display_name   -> "Former feeder" (publicName() returns null for it)
   *   identity_hmac  -> a random value, so signing in with the same email
   *                     makes a NEW account and nothing links back
   *   sos_opt_in off, wards / quiet hours / alerts mode / home ward cleared
   *   push subscriptions and refresh tokens deleted, OTP rows for the old
   *   identity deleted, deleted_at stamped (every auth check: FEEDER_GONE)
   *
   * An SOS case the person had acknowledged and not resolved is RELEASED back
   * to 'open' through the same path as "I can't make it after all"
   * (releaseCase: event, re-page, escalation on the original clock, now if it
   * is past): otherwise their claim would keep stopping the case's escalation
   * after the only person holding it had left.
   *
   * 200 { deleted: true }, not 204: the web client parses every response.
   */
  app.delete("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const parsed = z.strictObject({ confirm: z.literal("DELETE") }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: 'body must be { "confirm": "DELETE" }', code: "CONFIRMATION_REQUIRED" },
      });
    }
    const me = auth.feederId;

    const released = await withTx(async (client) => {
      const old = await client.query<{ identity_hmac: string }>(
        `SELECT identity_hmac FROM feeders WHERE id = $1 FOR UPDATE`,
        [me],
      );
      await client.query(
        `UPDATE feeders
            SET display_name = $2,
                identity_hmac = 'erased:' || gen_random_uuid()::text,
                sos_opt_in = FALSE, wards = '{}', quiet_start = NULL, quiet_end = NULL,
                alerts_mode = NULL, home_ward = NULL, deleted_at = now()
          WHERE id = $1`,
        [me, FORMER_FEEDER_NAME],
      );
      if (old.rows[0]) {
        await client.query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [old.rows[0].identity_hmac]);
      }
      await client.query(`DELETE FROM push_subscriptions WHERE feeder_id = $1`, [me]);
      await client.query(`DELETE FROM refresh_tokens WHERE feeder_id = $1`, [me]);
      // The same release path as POST /sos/cases/:id/release (routes/sos.ts
      // releaseCase): a 'released' event on the timeline, the other paged
      // responders paged again, escalation on the case's original clock.
      const cases = await client.query<{ id: string }>(
        `SELECT id FROM sos_cases
          WHERE acked_by = $1 AND resolved_at IS NULL AND state IN ('acked', 'escalated')
          FOR UPDATE`,
        [me],
      );
      for (const c of cases.rows) await releaseCase(client, c.id, me);
      return cases.rowCount ?? 0;
    });

    req.log.info({ event: "feeder_anonymised", releasedCases: released }, "account deleted (anonymised)");
    return { ok: true, data: { deleted: true } };
  });

  /**
   * PATCH /api/v1/feeders/me: SOS consent and the profile.
   *
   * HISTORY. This route began as `{ sosOptIn: boolean }` and nothing else,
   * THE consent surface for being paged (routes/sos.ts filters the fan-out on
   * feeders.sos_opt_in), deliberately NOT location-shaped: the old design
   * wanted opt-in to carry the feeder's position, and wave 7 removed that
   * (proximity derives from scan history). It then gained displayName (BUGS
   * P2-11: every account was "Hetja Feeder") and homeWard (map screen 19).
   *
   * Design v5 adds, all optional:
   *   wards        0 to 6 canonical BMC ward ids, no repeats. Non-empty limits
   *                SOS pages to dogs in them (lib/sos-eligibility.ts). A ward,
   *                never a position, so INVARIANT 2 is not engaged.
   *   quietHours   { start, end } "HH:MM" Asia/Kolkata, or null to clear.
   *   alertsMode   "all" (the default, NULL reads as it) | "sos_only": whether
   *                non-SOS pushes are sent at all.
   *   onboarded    true only; stamps onboarded_at once (N1 completed).
   *   displayName  now 1 to 40 characters.
   *
   * Still strict: an unknown field is a 400, never a silent no-op, and at
   * least one field must be present. Error codes (docs/BUGS.md, B-11):
   * INVALID_SOS_OPT_IN when `sosOptIn` itself failed (kept exactly for
   * existing clients), INVALID_FEEDER_PATCH for everything else.
   *
   * Idempotent by nature: re-asserting the current value is a successful
   * no-op. The response echoes what was written, in GET /feeders/me's shape.
   */
  app.patch("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const parsed = FeederPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const sosOptInFailed = parsed.error.issues.some((i) => i.path[0] === "sosOptIn");
      return reply.status(400).send({
        ok: false,
        error: {
          message:
            "body must contain at least one of { sosOptIn, displayName (1..40), homeWard, wards (0..6 BMC ward ids), quietHours { start, end } | null, alertsMode, onboarded: true, showFirstName, sosPausedUntil (ISO, <= 30 days ahead) | null } and no unknown fields",
          code: sosOptInFailed ? "INVALID_SOS_OPT_IN" : "INVALID_FEEDER_PATCH",
        },
      });
    }
    const p = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [auth.feederId];
    const set = (col: string, value: unknown) => {
      vals.push(value);
      sets.push(`${col} = $${vals.length}`);
    };
    if (p.sosOptIn !== undefined) set("sos_opt_in", p.sosOptIn);
    if (p.displayName !== undefined) set("display_name", p.displayName);
    if (p.homeWard !== undefined) set("home_ward", p.homeWard);
    if (p.wards !== undefined) set("wards", p.wards);
    if (p.quietHours !== undefined) {
      set("quiet_start", p.quietHours ? minutesOf(p.quietHours.start) : null);
      set("quiet_end", p.quietHours ? minutesOf(p.quietHours.end) : null);
    }
    if (p.alertsMode !== undefined) set("alerts_mode", p.alertsMode);
    if (p.onboarded) sets.push(`onboarded_at = COALESCE(onboarded_at, now())`);
    if (p.showFirstName !== undefined) set("show_first_name", p.showFirstName);
    if (p.sosPausedUntil !== undefined) set("sos_paused_until", p.sosPausedUntil);
    await query(`UPDATE feeders SET ${sets.join(", ")} WHERE id = $1`, vals);

    const out: Record<string, unknown> = {};
    if (p.sosOptIn !== undefined) out.sosOptIn = p.sosOptIn;
    if (p.displayName !== undefined) {
      out.displayName = p.displayName;
      out.publicName = publicName(p.displayName) ?? "";
    }
    if (p.homeWard !== undefined) out.homeWard = p.homeWard;
    if (p.wards !== undefined) out.wards = p.wards;
    if (p.quietHours !== undefined) out.quietHours = p.quietHours;
    if (p.alertsMode !== undefined) out.alertsMode = p.alertsMode;
    if (p.onboarded) out.onboarded = true;
    if (p.showFirstName !== undefined) out.showFirstName = p.showFirstName;
    if (p.sosPausedUntil !== undefined) {
      out.sosPausedUntil = p.sosPausedUntil ? new Date(p.sosPausedUntil).toISOString() : null;
    }
    // Names on public pages are cached for 5 s (routes/dogs.ts); an opt-out
    // must not wait for that.
    if (p.showFirstName !== undefined || p.displayName !== undefined) forgetAllDogs();
    return { ok: true, data: out };
  });

  /**
   * POST /api/v1/feeders/me/surface { surface: "register" }: self-election.
   *
   * Becoming a registrator is a PREFERENCE the account sets, not a privilege
   * anyone grants: the abuse control is physical-world binding plus the
   * two-sided budget (see routes/registrations.ts), so there is nothing to
   * review here. That is exactly why `can_register` exists separately: it is
   * the operator's actual control over one account's registration surface,
   * while this route stays open.
   *
   * Electable ONLY from 'feeder'. An admin/vet/bmc_officer already holds the
   * register capability; letting them "elect" would DEMOTE them to
   * registrator and silently strip moderation/enrolment. A 409 with the truth
   * is cheaper than that surprise. Re-electing as an existing registrator is
   * idempotent success, because a double-tap is not an error the client needs
   * to distinguish from success.
   */
  app.post("/api/v1/feeders/me/surface", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const parsed = z.object({ surface: z.enum(["register"]) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "unknown surface", code: "UNKNOWN_SURFACE" },
      });
    }

    if (auth.role === "feeder") {
      await query(`UPDATE feeders SET role = 'registrator' WHERE id = $1`, [auth.feederId]);
    } else if (auth.role !== "registrator") {
      return reply.status(409).send({
        ok: false,
        error: {
          message: `${auth.role} already holds the registration capability; electing would be a demotion`,
          code: "ROLE_NOT_ELECTABLE",
        },
      });
    }

    const role = auth.role === "feeder" ? "registrator" : auth.role;
    return {
      ok: true,
      data: { role, capabilities: [...capabilitiesFor(role)].sort() },
    };
  });
}
