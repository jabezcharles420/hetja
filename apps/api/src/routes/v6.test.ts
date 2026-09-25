/**
 * Design v6 API (docs/design/v6-handoff/CONTRACT.md, "API additions"): names
 * with the opt-out, the alerts pause, SOS outcomes and lifecycle, the case and
 * reporter pages, the dogless SOS, feed notes and batches, a dog's week,
 * registration fields and the map summary, with the abuse cases.
 *
 * Helpers and set-up are the same as v5.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { query, generateSlug, isValidSlug } from "@hetja/db";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { deviceTokenSubject, issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
import { publicName } from "../lib/public-name.js";
import { canRespond, wardAllows } from "../lib/sos-eligibility.js";
import {
  exportPerAccount,
  feederWritePerAccount,
  lookupGlobal,
  lookupPerSubject,
  photoPerSubject,
  reportPerSubject,
  scanPerSubject,
  sosAckPerAccount,
  tagReportPerDog,
  tagReportPerIp,
  tagReportPerSubject,
  wardDogsGlobal,
  wardDogsPerSubject,
  doglessReportPerIp,
  doglessReportPerSubject,
  unwellPushPerDog,
} from "../lib/rate-limit.js";
import { reportStatusLimiter, reportUpdatePerSubject } from "./sos.js";
import { photoGate } from "../lib/photo-gate.js";
import { dogCache } from "./dogs.js";
import { nearMisses, normaliseCode } from "./finding.js";

const config = loadConfig();

let app: FastifyInstance;
let storageDir: string;
const feeders: string[] = [];
const dogs: string[] = [];
const cases: string[] = [];

interface TestFeeder {
  id: string;
  auth: string;
  headers: { authorization: string };
}

async function insertFeeder(
  opts: {
    name?: string;
    role?: string;
    trust?: number;
    wards?: string[];
    sosOptIn?: boolean;
    alertsMode?: string | null;
  } = {},
): Promise<TestFeeder> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, wards, sos_opt_in, alerts_mode)
     VALUES ($1, $2, $3::feeder_role, $4, 'v1.0', $5, $6, $7) RETURNING id`,
    [
      `v5-${randomUUID()}`,
      opts.name ?? "Priya Sharma",
      opts.role ?? "feeder",
      opts.trust ?? 30,
      opts.wards ?? [],
      opts.sosOptIn ?? false,
      opts.alertsMode ?? null,
    ],
  );
  const id = res.rows[0].id;
  feeders.push(id);
  const auth = `Bearer ${signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`;
  return { id, auth, headers: { authorization: auth } };
}

async function insertDog(
  opts: {
    ward?: string;
    status?: string;
    name?: string;
    registeredBy?: string | null;
    registeredDevice?: string | null;
    coat?: string | null;
    geo?: boolean;
    slug?: string;
    sosEligible?: boolean;
    markings?: string[];
    sex?: string | null;
  } = {},
): Promise<{ id: string; slug: string }> {
  const slug = opts.slug ?? generateSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, status, registered_by, registered_at, registered_device_id, coat_pattern,
                       last_seen_geo, last_seen_at, sos_eligible_at, markings, sex)
     VALUES ($1, $2, $3, $4::dog_status, $5, CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END, $6, $7,
             CASE WHEN $8 THEN ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography END,
             CASE WHEN $8 THEN now() END, CASE WHEN $9 THEN now() END, $10, $11)
     RETURNING id`,
    [
      slug,
      opts.name ?? "Rani",
      opts.ward ?? "K-West",
      opts.status ?? "active",
      opts.registeredBy ?? null,
      opts.registeredDevice ?? null,
      opts.coat ?? null,
      opts.geo ?? true,
      opts.sosEligible ?? false,
      opts.markings ?? null,
      opts.sex ?? null,
    ],
  );
  dogs.push(res.rows[0].id);
  await query(`INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material) VALUES ($1, $2, 'x', 'test', 'test')`, [
    res.rows[0].id,
    slug,
  ]);
  return { id: res.rows[0].id, slug };
}

async function feed(dogId: string, feederId: string | null, opts: { geo?: boolean; capturedAt?: Date } = {}) {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, geo, captured_at, received_at, review_status)
     VALUES ($1, $2, 'feed', $3, CASE WHEN $4 THEN ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography END,
             $5, now(), 'pending')`,
    [dogId, randomUUID(), feederId, opts.geo ?? true, opts.capturedAt ?? new Date()],
  );
}

function device(): { token: string; subject: string } {
  const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
  return { token, subject: deviceTokenSubject(token, config.HETJA_DEVICE_SECRET) as string };
}

async function jobsFor(dogSlug: string, kind = "send_feeder_push") {
  const res = await query<{ payload: { feederIds: string[]; url: string } }>(
    `SELECT payload FROM jobs WHERE kind = $1 AND payload::text LIKE $2 ORDER BY id`,
    [kind, `%${dogSlug}%`],
  );
  return res.rows.map((r) => r.payload);
}

function jpeg(width: number, height: number, entropyBytes: number): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  const sof = Buffer.from([0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])),
    seg(0xc0, sof),
    seg(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0x00), Buffer.from([0x00])])),
    seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.alloc(entropyBytes, 0x31),
    Buffer.from([0xff, 0xd9]),
  ]);
}

beforeEach(async () => {
  for (const l of [
    exportPerAccount,
    feederWritePerAccount,
    lookupGlobal,
    lookupPerSubject,
    photoPerSubject,
    reportPerSubject,
    scanPerSubject,
    sosAckPerAccount,
    tagReportPerDog,
    tagReportPerIp,
    tagReportPerSubject,
    wardDogsGlobal,
    wardDogsPerSubject,
    doglessReportPerIp,
    doglessReportPerSubject,
    unwellPushPerDog,
    reportStatusLimiter,
    reportUpdatePerSubject,
  ]) {
    l.reset();
  }
  photoGate.reset();
  dogCache.clear();
  storageDir = await mkdtemp(join(tmpdir(), "hetja-v5-"));
  app = buildServer({ ...config, STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  for (const id of cases.splice(0)) {
    await query(`DELETE FROM jobs WHERE payload->>'caseId' = $1`, [id]);
    await query(`DELETE FROM sos_case_events WHERE case_id = $1`, [id]);
    await query(`DELETE FROM sos_notifications WHERE case_id = $1`, [id]);
    const scan = await query<{ scan_id: string }>(`DELETE FROM sos_cases WHERE id = $1 RETURNING scan_id`, [id]);
    if (scan.rows[0]) await query(`DELETE FROM scans WHERE id = $1`, [scan.rows[0].scan_id]);
  }
  for (const id of dogs.splice(0)) {
    const slug = (await query<{ slug: string }>(`SELECT slug FROM dogs WHERE id = $1`, [id])).rows[0]?.slug ?? "";
    await query(`DELETE FROM jobs WHERE payload::text LIKE $1 OR payload::text LIKE $2`, [`%${id}%`, `%${slug}%`]);
    await query(`DELETE FROM tag_reports WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM tag_prints WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dog_status_reports WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [id]);
    await query(`DELETE FROM sos_case_events WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [id]);
    await query(`DELETE FROM sos_cases WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM trust_events WHERE ref_scan_id IN (SELECT id FROM scans WHERE dog_id = $1)`, [id]);
    await query(`DELETE FROM scans WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM collars WHERE dog_id = $1`, [id]);
    try {
      await query(`DELETE FROM dogs WHERE id = $1`, [id]);
    } catch {
      // A dog with a medical record stays (INVARIANT 8: the ledger is append-only).
      await query(`UPDATE dogs SET verified_by = NULL, registered_by = NULL, status = 'relocated' WHERE id = $1`, [id]);
    }
  }
  for (const id of feeders.splice(0)) {
    await query(`DELETE FROM trust_events WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM sos_notifications WHERE feeder_id = $1`, [id]);
    await query(`UPDATE sos_cases SET acked_by = NULL WHERE acked_by = $1`, [id]);
    await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM push_subscriptions WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM refresh_tokens WHERE feeder_id = $1`, [id]);
    await query(`UPDATE dogs SET verified_by = NULL WHERE verified_by = $1`, [id]);
    await query(`UPDATE vets SET feeder_id = NULL WHERE feeder_id = $1`, [id]);
    try {
      await query(`DELETE FROM feeders WHERE id = $1`, [id]);
    } catch {
      /* referenced by an append-only row; harmless in a _test database */
    }
  }
  await rm(storageDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers for this file
// ---------------------------------------------------------------------------

async function sosCase(
  dogId: string | null,
  opts: { severity?: string; ackedBy?: string | null; device?: string | null; feederId?: string | null; ward?: string } = {},
): Promise<string> {
  const scan = await query<{ id: string }>(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at, device_token, feeder_id)
     VALUES ($1, $2, 'sos', now(), $3, $4) RETURNING id`,
    [dogId, randomUUID(), opts.device ?? null, opts.feederId ?? null],
  );
  const c = await query<{ id: string }>(
    `INSERT INTO sos_cases (scan_id, dog_id, severity, state, acked_by, acked_at, ward_id, geo)
     VALUES ($1, $2, $3::severity_t, CASE WHEN $4::uuid IS NULL THEN 'open' ELSE 'acked' END::case_state, $4,
             CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END, $5,
             CASE WHEN $2::uuid IS NULL THEN ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography END)
     RETURNING id`,
    [scan.rows[0].id, dogId, opts.severity ?? "serious", opts.ackedBy ?? null, opts.ward ?? "K-West"],
  );
  cases.push(c.rows[0].id);
  return c.rows[0].id;
}

async function page(caseId: string, feederId: string) {
  await query(`INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push')`, [caseId, feederId]);
}

// ---------------------------------------------------------------------------
// Names and the alerts pause (profile)
// ---------------------------------------------------------------------------

describe("v6 profile: showFirstName, sosPausedUntil", () => {
  it("defaults, writes and validates both", async () => {
    const me = await insertFeeder();
    const got = (await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers })).json().data;
    expect(got).toMatchObject({ showFirstName: true, sosPausedUntil: null });

    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: me.headers,
      payload: { showFirstName: false, sosPausedUntil: until },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ showFirstName: false, sosPausedUntil: until });
    const again = (await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers })).json().data;
    expect(again).toMatchObject({ showFirstName: false, sosPausedUntil: until });

    for (const sosPausedUntil of [new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 31 * 86_400_000).toISOString(), "tomorrow"]) {
      const bad = await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", headers: me.headers, payload: { sosPausedUntil } });
      expect(bad.statusCode).toBe(400);
    }
    const resume = await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", headers: me.headers, payload: { sosPausedUntil: null } });
    expect(resume.json().data).toEqual({ sosPausedUntil: null });
  });

  it("a paused feeder is not paged; an unpaused one in the same ward is", async () => {
    const dog = await insertDog({ ward: "E", sosEligible: true });
    const paused = await insertFeeder({ wards: ["E"], sosOptIn: true, trust: 70 });
    const awake = await insertFeeder({ wards: ["E"], sosOptIn: true, trust: 70 });
    await query(`UPDATE feeders SET sos_paused_until = now() + interval '1 day' WHERE id = $1`, [paused.id]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug: dog.slug, severity: "critical", deviceToken: device().token },
    });
    const caseId = res.json().data.caseId;
    cases.push(caseId);
    const paged = (await query<{ feeder_id: string }>(`SELECT feeder_id FROM sos_notifications WHERE case_id = $1`, [caseId])).rows.map((r) => r.feeder_id);
    expect(paged).toContain(awake.id);
    expect(paged).not.toContain(paused.id);
  });
});

describe("GET /api/v1/dogs/:slug v6 names", () => {
  it("names feeders by first name only, counts opted-out ones without naming them, and says who fed last", async () => {
    const priya = await insertFeeder({ name: "Priya Sharma" });
    const anil = await insertFeeder({ name: "Anil Kumar" });
    const dog = await insertDog({ registeredBy: priya.id });
    await query(`UPDATE feeders SET show_first_name = FALSE WHERE id = $1`, [anil.id]);
    await feed(dog.id, anil.id, { capturedAt: new Date(Date.now() - 3600_000) });
    await feed(dog.id, priya.id);
    await feed(dog.id, null, { capturedAt: new Date(Date.now() - 7200_000) });

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` });
    const d = res.json().data;
    expect(d.feeders).toEqual([{ firstName: "Priya" }, { firstName: null }]);
    expect(d.feederCount).toBe(2);
    expect(d.lastFedBy).toBe("Priya");
    expect(d.scanCount).toBe(3);
    for (const hidden of ["Sharma", "Anil", "Kumar", priya.id, anil.id]) expect(res.body).not.toContain(hidden);

    // Priya opts out: the next read no longer names her (the cache is dropped).
    await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", headers: priya.headers, payload: { showFirstName: false } });
    const after = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data;
    expect(after.feeders).toEqual([{ firstName: null }, { firstName: null }]);
    expect(after.lastFedBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SOS case lifecycle and page data
// ---------------------------------------------------------------------------

describe("SOS v6: resolve outcomes, release, arrived, close-by", () => {
  it("resolves with an outcome and a vet name; died opens the passed-away report", async () => {
    const dog = await insertDog();
    const acker = await insertFeeder();
    const c1 = await sosCase(dog.id, { ackedBy: acker.id });
    const bad = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${c1}/resolve`, headers: acker.headers, payload: { outcome: "eaten" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${c1}/resolve`,
      headers: acker.headers,
      payload: { outcome: "taken_to_vet", vetName: "Dr Mehta's clinic" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ state: "resolved", outcome: "taken_to_vet", resolution: "taken to vet" });
    const row = (await query(`SELECT outcome, vet_name FROM sos_cases WHERE id = $1`, [c1])).rows[0];
    expect(row).toEqual({ outcome: "taken_to_vet", vet_name: "Dr Mehta's clinic" });

    const c2 = await sosCase(dog.id, { ackedBy: acker.id });
    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${c2}/resolve`, headers: acker.headers, payload: { outcome: "died" } });
    const pending = await query(`SELECT reported_by FROM dog_status_reports WHERE dog_id = $1 AND kind = 'passed_away' AND confirmed_at IS NULL`, [dog.id]);
    expect(pending.rows).toEqual([{ reported_by: acker.id }]);
    expect((await query(`SELECT status FROM dogs WHERE id = $1`, [dog.id])).rows[0].status).toBe("active");
  });

  it("release puts the case back to open, keeps the escalation clock and re-pages; only the acker may act", async () => {
    const dog = await insertDog();
    const acker = await insertFeeder();
    const other = await insertFeeder();
    const caseId = await sosCase(dog.id, { ackedBy: acker.id });
    await page(caseId, acker.id);
    await page(caseId, other.id);

    for (const path of ["release", "arrived", "close-by"]) {
      const r = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/${path}`, headers: other.headers });
      expect(r.statusCode, path).toBe(403);
    }
    const close = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/close-by`, headers: acker.headers });
    expect(close.statusCode).toBe(200);
    const closeAt = close.json().data.closeByAt;
    expect((await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/close-by`, headers: acker.headers })).json().data.closeByAt).toBe(closeAt);
    const arrived = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/arrived`, headers: acker.headers });
    expect(arrived.statusCode).toBe(200);

    const rel = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/release`, headers: acker.headers });
    expect(rel.statusCode).toBe(200);
    expect(rel.json().data).toEqual({ id: caseId, state: "open" });
    const row = (await query(`SELECT state, acked_by, arrived_at, close_by_at, opened_at FROM sos_cases WHERE id = $1`, [caseId])).rows[0];
    expect(row).toMatchObject({ state: "open", acked_by: null, arrived_at: null, close_by_at: null });
    const esc = await query<{ run_after: Date }>(`SELECT run_after FROM jobs WHERE kind = 'escalate_sos' AND payload->>'caseId' = $1`, [caseId]);
    expect(esc.rowCount).toBe(1);
    // The original clock: opened + 8 minutes (the case was opened just now).
    expect(Math.abs(esc.rows[0].run_after.getTime() - (row.opened_at.getTime() + 8 * 60_000))).toBeLessThan(5_000);
    const repage = await query<{ payload: any }>(`SELECT payload FROM jobs WHERE kind = 'send_sos_push' AND payload->>'caseId' = $1`, [caseId]);
    expect(repage.rows[0].payload).toMatchObject({ repage: true, exclude: acker.id });
    // The releaser is no longer the acker.
    expect((await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/arrived`, headers: acker.headers })).statusCode).toBe(403);

    // Closed cases refuse lifecycle actions.
    const c2 = await sosCase(dog.id, { ackedBy: acker.id });
    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${c2}/resolve`, headers: acker.headers, payload: { outcome: "treated_on_spot" } });
    expect((await app.inject({ method: "POST", url: `/api/v1/sos/cases/${c2}/release`, headers: acker.headers })).statusCode).toBe(409);
  });

  it("serves the timeline, told counts, escalatesAt and a rounded distance to an eligible responder only", async () => {
    const dog = await insertDog();
    const responder = await insertFeeder({ trust: 70, sosOptIn: true, name: "Priya Sharma" });
    const admin = await insertFeeder({ role: "admin" });
    await feed(dog.id, responder.id); // at the dog's point
    const caseId = await sosCase(dog.id, { severity: "critical" });
    await page(caseId, responder.id);
    await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('escalate_sos', $1::jsonb, now() + interval '8 minutes')`, [
      JSON.stringify({ caseId, dogId: dog.id }),
    ]);

    const view = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: responder.headers })).json().data;
    expect(view.timeline.map((t: any) => t.kind)).toEqual(["raised", "told", "escalation_due"]);
    expect(view.feedersTold).toBe(1);
    expect(view.vetsTold).toBe(0);
    expect(view.escalatesAt).not.toBeNull();
    expect(view.distanceM).toBe(0);
    expect(view.location).toBeNull();

    const mod = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: admin.headers })).json().data;
    expect(mod.distanceM).toBeNull();

    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: responder.headers });
    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/arrived`, headers: responder.headers });
    const taken = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: responder.headers })).json().data;
    expect(taken.timeline.map((t: any) => t.kind)).toEqual(expect.arrayContaining(["taken", "arrived"]));
    expect(taken.timeline.find((t: any) => t.kind === "taken").detail).toBe("Priya");
    expect(taken.escalatesAt).toBeNull();
    expect(taken.location).not.toBeNull();
  });

  it("a feeder who may not see a case gets 403 with their own checklist (V22)", async () => {
    const dog = await insertDog({ ward: "A" });
    const newbie = await insertFeeder({ trust: 33, sosOptIn: true });
    const notIn = await insertFeeder({ trust: 33 });
    const caseId = await sosCase(dog.id, { severity: "critical", ward: "A" });
    const res = await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: newbie.headers });
    expect(res.statusCode).toBe(403);
    expect(res.json().data).toEqual({
      forbiddenReason: "not_enough_trust",
      checklist: { sosOptIn: true, paused: false, inMyWards: null, trustScore: 33, trustFloor: 60, feedsToGo: 27 },
    });
    expect(res.body).not.toContain(dog.slug);
    const r2 = await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: notIn.headers });
    expect(r2.json().data.forbiddenReason).toBe("not_opted_in");
  });
});

// ---------------------------------------------------------------------------
// The reporter's side
// ---------------------------------------------------------------------------

describe("reporter status, updates, left, openCase", () => {
  it("answers only the filing device, with first names and the opt-out respected", async () => {
    const dog = await insertDog();
    const d = device();
    const priya = await insertFeeder({ name: "Priya Sharma" });
    const hidden = await insertFeeder({ name: "Anil Kumar" });
    await query(`UPDATE feeders SET show_first_name = FALSE WHERE id = $1`, [hidden.id]);
    const caseId = await sosCase(dog.id, { device: d.subject, ackedBy: priya.id });
    await page(caseId, priya.id);
    await page(caseId, hidden.id);
    await query(`UPDATE sos_cases SET close_by_at = now() WHERE id = $1`, [caseId]);

    expect((await app.inject({ method: "GET", url: `/api/v1/reports/${caseId}/status` })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/reports/${caseId}/status`, headers: { "x-device-token": device().token } })).statusCode,
    ).toBe(404);

    const res = await app.inject({ method: "GET", url: `/api/v1/reports/${caseId}/status`, headers: { "x-device-token": d.token } });
    expect(res.statusCode).toBe(200);
    const s = res.json().data;
    expect(s).toMatchObject({
      responderFirstName: "Priya",
      feedersNotifiedNames: ["Priya"],
      feedersNotified: 2,
      vetsNotified: 0,
      updates: [],
      leftAt: null,
    });
    expect(s.takenAt).not.toBeNull();
    expect(s.closeByAt).not.toBeNull();
    for (const x of ["Sharma", "Anil", priya.id]) expect(res.body).not.toContain(x);
  });

  it("takes updates and 'I had to leave' from the reporter, shows them to the responder, and refuses a closed case", async () => {
    const dog = await insertDog();
    const d = device();
    const acker = await insertFeeder();
    const caseId = await sosCase(dog.id, { device: d.subject, ackedBy: acker.id });
    const h = { "x-device-token": d.token };

    expect((await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/updates`, headers: h, payload: { note: "" } })).statusCode).toBe(400);
    const up = await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/updates`, headers: h, payload: { note: "She moved under the bus stop" } });
    expect(up.statusCode).toBe(201);
    const left = await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/left`, headers: h });
    expect(left.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/left`, headers: h });
    expect(again.json().data.leftAt).toBe(left.json().data.leftAt);
    // Another device cannot write to it.
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/updates`, headers: { "x-device-token": device().token }, payload: { note: "x" } }))
        .statusCode,
    ).toBe(404);

    const status = (await app.inject({ method: "GET", url: `/api/v1/reports/${caseId}/status`, headers: h })).json().data;
    expect(status.updates.map((u: any) => u.note)).toEqual(["She moved under the bus stop"]);
    expect(status.leftAt).not.toBeNull();
    const view = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: acker.headers })).json().data;
    expect(view.reporterUpdates.map((u: any) => u.note)).toEqual(["She moved under the bus stop"]);
    expect(view.reporterLeftAt).not.toBeNull();
    expect(view.timeline.map((t: any) => t.kind)).toEqual(expect.arrayContaining(["reporter_update", "reporter_left"]));

    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/resolve`, headers: acker.headers, payload: { outcome: "not_found" } });
    expect((await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/updates`, headers: h, payload: { note: "still here" } })).statusCode).toBe(409);

    // Rate limited per device: burst 5.
    reportUpdatePerSubject.reset();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await app.inject({ method: "POST", url: `/api/v1/reports/${caseId}/left`, headers: h })).statusCode);
    }
    expect(statuses.filter((c) => c === 429)).toHaveLength(1);
  });

  it("a 429 on a dog this device already reported carries openCase", async () => {
    const dog = await insertDog();
    const d = device();
    const first = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: d.token } });
    const caseId = first.json().data.caseId;
    cases.push(caseId);
    let last;
    for (let i = 0; i < 6; i++) {
      last = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: d.token } });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json().data.openCase).toMatchObject({ caseId, responderFirstName: null, takenAt: null });
  });
});

// ---------------------------------------------------------------------------
// Dogless SOS
// ---------------------------------------------------------------------------

describe("dogless SOS (P8)", () => {
  const inKWest = { lat: 19.1325, lng: 72.8285 };

  it("needs a Mumbai location", async () => {
    const noGeo = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { severity: "critical", deviceToken: device().token } });
    expect(noGeo.statusCode).toBe(400);
    const delhi = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { severity: "critical", deviceToken: device().token, geo: { lat: 28.61, lng: 77.2 } },
    });
    expect(delhi.statusCode).toBe(400);
    expect(delhi.json().error.code).toBe("GEO_OUTSIDE_MUMBAI");
  });

  it("opens a ward case with no dog, pages the ward's feeders, and gives the point only to the acker", async () => {
    const wardFeeder = await insertFeeder({ wards: ["K-West"], sosOptIn: true, trust: 70 });
    const d = device();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { severity: "critical", deviceToken: d.token, geo: inKWest, note: "Hit by a bike" },
    });
    expect(res.statusCode).toBe(200);
    const { caseId, wardId } = res.json().data;
    cases.push(caseId);
    expect(wardId).toBe("K-West");
    expect(res.body).not.toContain("19.1325");
    const row = (await query(`SELECT dog_id, ward_id FROM sos_cases WHERE id = $1`, [caseId])).rows[0];
    expect(row).toEqual({ dog_id: null, ward_id: "K-West" });
    expect((await query(`SELECT 1 FROM sos_notifications WHERE case_id = $1 AND feeder_id = $2`, [caseId, wardFeeder.id])).rowCount).toBe(1);

    const view = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: wardFeeder.headers })).json().data;
    expect(view).toMatchObject({ dog: null, dogless: true, wardId: "K-West", note: "Hit by a bike", location: null });
    await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: wardFeeder.headers });
    const mine = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: wardFeeder.headers })).json().data;
    expect(mine.location).toEqual({ lat: expect.closeTo(19.1325, 4), lng: expect.closeTo(72.8285, 4) });

    // The same device in the same ward: the open case, not a second one.
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { severity: "serious", deviceToken: d.token, geo: inKWest },
    });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe("SOS_CASE_OPEN");
    expect(again.json().data.openCase.caseId).toBe(caseId);
    await query(`DELETE FROM jobs WHERE payload->>'caseId' = $1`, [caseId]);
  });

  it("is limited per device and per address", async () => {
    const d = device();
    const codes: number[] = [];
    // Different wards so the per-ward dedupe does not answer first.
    for (const geo of [{ lat: 18.918, lng: 72.828 }, { lat: 18.978, lng: 72.836 }, { lat: 19.06, lng: 72.83 }]) {
      const r = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { severity: "minor", deviceToken: d.token, geo }, remoteAddress: "198.51.100.40" });
      if (r.statusCode === 200) cases.push(r.json().data.caseId);
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);

    doglessReportPerSubject.reset();
    const ipCodes: number[] = [];
    for (const geo of [{ lat: 19.115, lng: 72.872 }, { lat: 19.072, lng: 72.884 }, { lat: 19.088, lng: 72.909 }, { lat: 19.19, lng: 72.85 }]) {
      const r = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { severity: "minor", deviceToken: device().token, geo }, remoteAddress: "198.51.100.41" });
      if (r.statusCode === 200) cases.push(r.json().data.caseId);
      ipCodes.push(r.statusCode);
    }
    expect(ipCodes).toEqual([200, 200, 200, 429]);
  });
});

// ---------------------------------------------------------------------------
// Feeding
// ---------------------------------------------------------------------------

describe("feeds: note, tell co-feeders, batch", () => {
  it("stores a note and tells the dog's other feeders once on an unwell feed; anonymous devices cannot", async () => {
    const reg = await insertFeeder();
    const me = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: me.headers,
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "feed",
        capturedAt: new Date().toISOString(),
        outcome: "unwell",
        note: "Limping on the back left leg",
        tellCoFeeders: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.coFeedersTold).toBe(1);
    expect((await query(`SELECT note FROM scans WHERE id = $1`, [res.json().data.scanId])).rows[0].note).toBe("Limping on the back left leg");
    const jobs = await jobsFor(dog.slug);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].feederIds).toEqual([reg.id]);

    const anon = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": device().token },
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "feed", capturedAt: new Date().toISOString(), outcome: "unwell", tellCoFeeders: true },
    });
    expect(anon.statusCode).toBe(200);
    expect(anon.json().data.coFeedersTold).toBeUndefined();
    expect(await jobsFor(dog.slug)).toHaveLength(1);

    const long = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: me.headers,
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "feed", capturedAt: new Date().toISOString(), note: "x".repeat(281) },
    });
    expect(long.statusCode).toBe(400);
  });

  it("batches up to 12 feeds with the single-feed rules, per item", async () => {
    const me = await insertFeeder();
    const a = await insertDog();
    const b = await insertDog();
    const ua = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans/batch",
      headers: me.headers,
      payload: {
        feeds: [
          { clientUuid: ua, dogSlug: a.slug, capturedAt: new Date().toISOString(), outcome: "ate_all" },
          { clientUuid: randomUUID(), dogSlug: b.slug, capturedAt: new Date().toISOString() },
          { clientUuid: randomUUID(), dogSlug: "notaslug", capturedAt: new Date().toISOString() },
          { clientUuid: randomUUID(), dogSlug: b.slug, capturedAt: new Date().toISOString(), photoBase64: "abc" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json().data.results;
    expect(r.map((x: any) => x.created)).toEqual([true, true, false, false]);
    expect(r[2].error.code).toBe("INVALID_SCAN");
    expect(res.json().data.streak).toBeDefined();
    // Replay is idempotent (INVARIANT 5).
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/scans/batch",
      headers: me.headers,
      payload: { feeds: [{ clientUuid: ua, dogSlug: a.slug, capturedAt: new Date().toISOString() }] },
    });
    expect(replay.json().data.results[0].created).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/scans/batch", headers: me.headers, payload: { feeds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/scans/batch", payload: { feeds: [{}] } })).statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Dog week, registrations, map
// ---------------------------------------------------------------------------

describe("GET /api/v1/dogs/:slug/week", () => {
  it("shows the last 7 days from everyone's logs to the dog's feeders only", async () => {
    const priya = await insertFeeder({ name: "Priya Sharma" });
    const stranger = await insertFeeder();
    const dog = await insertDog({ registeredBy: priya.id });
    await feed(dog.id, priya.id);
    await query(`UPDATE dogs SET vaccine_due_month = '2027-03' WHERE id = $1`, [dog.id]);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/week`, headers: stranger.headers })).statusCode).toBe(403);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/week`, headers: priya.headers });
    expect(res.statusCode).toBe(200);
    const w = res.json().data;
    expect(w.days).toHaveLength(7);
    expect(w.days[6]).toMatchObject({ fed: true, byFirstName: "Priya" });
    expect(w.days[0].fed).toBe(false);
    expect(w.feederNames).toEqual(["Priya"]);
    expect(w.rabiesDue).toEqual({ lastGiven: null, dueDate: "2027-03-01" });
    expect(w.vetRecordCount).toBe(0);
  });
});

describe("registrations v6", () => {
  it("adds the v6 fields and the budget holders, and checks a scanned tag", async () => {
    const reg = await insertFeeder({ role: "registrator" });
    const pending = await insertDog({ registeredBy: reg.id, status: "pending_activation", name: "Moti" });
    const live = await insertDog({ registeredBy: reg.id, name: "Rani" });
    await query(`INSERT INTO tag_prints (dog_id, printed_by, layout, paper, tag_count) VALUES ($1, $2, 'tags', 'a4', 6)`, [pending.id, reg.id]);
    await feed(live.id, reg.id);

    const list = (await app.inject({ method: "GET", url: "/api/v1/registrations", headers: reg.headers })).json().data;
    const p = list.registrations.find((r: any) => r.slug === pending.slug);
    expect(p).toMatchObject({ scanCount: 0, liveSince: null, feederNames: ["Priya"] });
    expect(p.printedAt).not.toBeNull();
    expect(p.daysLeft).toBeGreaterThan(0);
    expect(list.budget.holders).toEqual([{ slug: pending.slug, name: "Moti", printedAt: p.printedAt, daysLeft: p.daysLeft }]);
    const l = list.registrations.find((r: any) => r.slug === live.slug);
    expect(l.scanCount).toBe(1);
    expect(l.daysLeft).toBeNull();

    const detail = (await app.inject({ method: "GET", url: `/api/v1/registrations/${pending.slug}`, headers: reg.headers })).json().data;
    expect(detail.printedAt).toBe(p.printedAt);

    const url = `/api/v1/registrations/${pending.slug}/tag-check`;
    expect((await app.inject({ method: "POST", url, headers: reg.headers, payload: { code: `https://hetja.in/d/${pending.slug}?s=abc` } })).json().data).toEqual({ match: true });
    const wrong = (await app.inject({ method: "POST", url, headers: reg.headers, payload: { code: live.slug.toUpperCase() } })).json().data;
    expect(wrong).toEqual({ match: false, expected: { slug: pending.slug, name: "Moti" }, scanned: { slug: live.slug, name: "Rani" } });
    const otherPending = await insertDog({ status: "pending_activation", name: "Secret" });
    const hidden = (await app.inject({ method: "POST", url, headers: reg.headers, payload: { code: otherPending.slug } })).json().data;
    expect(hidden.scanned).toBeNull();
    const stranger = await insertFeeder();
    expect((await app.inject({ method: "POST", url, headers: stranger.headers, payload: { code: "x" } })).statusCode).toBe(403);
  });
});

describe("map v6", () => {
  it("adds the city summary and SOS rows with dog names, and the ward's dog names and not-logged dogs", async () => {
    const { clearMapCaches } = await import("./map.js");
    clearMapCaches();
    const dog = await insertDog({ ward: "G-South", name: "Tiger" });
    const fed = await insertDog({ ward: "G-South", name: "Bruno" });
    const f = await insertFeeder();
    await feed(fed.id, f.id);
    const acker = await insertFeeder();
    await sosCase(dog.id, { ackedBy: acker.id, ward: "G-South" });

    const city = (await app.inject({ method: "GET", url: "/api/v1/map/wards" })).json().data;
    expect(city.summary).toMatchObject({
      dogs: expect.any(Number),
      withCollars: expect.any(Number),
      feeders: expect.any(Number),
      fedToday: expect.any(Number),
      notLoggedToday: expect.any(Number),
    });
    const row = city.sos.find((s: any) => s.dogName === "Tiger");
    expect(row).toMatchObject({ wardId: "G-South", wardCode: "G/S", taken: true });
    expect(JSON.stringify(city.sos)).not.toMatch(/caseId|"lat"/);

    const ward = (await app.inject({ method: "GET", url: "/api/v1/map/wards/G-South" })).json().data;
    expect(ward.dogNames).toEqual(expect.arrayContaining(["Tiger", "Bruno"]));
    const notLogged = ward.notLoggedToday.map((d: any) => d.name);
    expect(notLogged).toContain("Tiger");
    expect(notLogged).not.toContain("Bruno");
    expect(ward.sos.find((s: any) => s.dogName === "Tiger").taken).toBe(true);
    clearMapCaches();
  });
});
