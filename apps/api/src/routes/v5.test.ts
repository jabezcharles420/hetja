/**
 * Design v5 API (docs/design/v5-handoff/CONTRACT.md, "API additions"), route
 * by route, including the abuse cases: rate limits, dedupe, permission 403s,
 * anonymous callers never seeing a position, delete anonymising.
 *
 * The limiter singletons are module state shared by every test here, so each
 * test starts from reset. Rows are tracked and removed after each test; a dog
 * that gained a medical record cannot be deleted (INVARIANT 8) and is left.
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
} from "../lib/rate-limit.js";
import { photoGate } from "../lib/photo-gate.js";
import { dogCache } from "./dogs.js";
import { nearMisses, normaliseCode } from "./finding.js";

const config = loadConfig();

let app: FastifyInstance;
let storageDir: string;
const feeders: string[] = [];
const dogs: string[] = [];

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
  for (const id of dogs.splice(0)) {
    const slug = (await query<{ slug: string }>(`SELECT slug FROM dogs WHERE id = $1`, [id])).rows[0]?.slug ?? "";
    await query(`DELETE FROM jobs WHERE payload::text LIKE $1 OR payload::text LIKE $2`, [`%${id}%`, `%${slug}%`]);
    await query(`DELETE FROM tag_reports WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM tag_prints WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dog_status_reports WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [id]);
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
// Pure helpers
// ---------------------------------------------------------------------------

describe("helpers", () => {
  it("publicName is first name and initial, titles keep the surname, anonymised is null", () => {
    expect(publicName("Priya Sharma")).toBe("Priya S.");
    expect(publicName("Priya")).toBe("Priya");
    expect(publicName("Anil Kumar Rao")).toBe("Anil R.");
    expect(publicName("Dr Anil Mehta")).toBe("Dr Mehta");
    expect(publicName("  ")).toBeNull();
    expect(publicName("Priya Sharma", new Date())).toBeNull();
  });

  it("normaliseCode folds case, spaces, dashes and the confusable characters", () => {
    expect(normaliseCode("RNI-428 PQ7")).toBe("rni428pq7");
    expect(normaliseCode("r0l1abcd?")).toBe("roiiabcd?");
    expect(normaliseCode("ab__cd*ef")).toBe("ab??cd?ef");
    expect(normaliseCode("short")).toBeNull();
    expect(normaliseCode("abc!defgh")).toBeNull();
  });

  it("nearMisses are valid slugs one swap or one substitution away", () => {
    const slug = generateSlug();
    const near = nearMisses(slug);
    expect(near.length).toBeGreaterThan(0);
    expect(near).not.toContain(slug);
    for (const s of near) {
      expect(isValidSlug(s)).toBe(true);
      const diff = [...s].filter((c, i) => c !== slug[i]).length;
      expect(diff === 1 || diff === 2).toBe(true);
    }
  });

  it("the ward rule restricts only feeders who chose wards, and never lowers the trust floor", () => {
    expect(wardAllows([], "A")).toBe(true);
    expect(wardAllows(["A"], "A")).toBe(true);
    expect(wardAllows(["A"], "K-West")).toBe(false);
    const standing = { sosOptIn: true, trustScore: 45, wards: ["K-West"] };
    expect(canRespond(standing, "serious", "K-West")).toBe(true);
    expect(canRespond(standing, "serious", "A")).toBe(false);
    expect(canRespond(standing, "critical", "K-West")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

describe("GET/PATCH /api/v1/feeders/me (v5 profile)", () => {
  it("answers the v5 defaults", async () => {
    const me = await insertFeeder();
    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      wards: [],
      quietHours: null,
      alertsMode: "all",
      onboarded: false,
      publicName: "Priya S.",
    });
  });

  it("writes wards, quiet hours, alerts mode, onboarding and a new name, and reads them back", async () => {
    const me = await insertFeeder();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: me.headers,
      payload: {
        wards: ["K-West", "H-West"],
        quietHours: { start: "23:00", end: "06:00" },
        alertsMode: "all",
        onboarded: true,
        displayName: "Anil Mehta",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      wards: ["K-West", "H-West"],
      quietHours: { start: "23:00", end: "06:00" },
      alertsMode: "all",
      onboarded: true,
      displayName: "Anil Mehta",
      publicName: "Anil M.",
    });
    const row = await query(`SELECT quiet_start, quiet_end, onboarded_at FROM feeders WHERE id = $1`, [me.id]);
    expect(row.rows[0].quiet_start).toBe(23 * 60);
    expect(row.rows[0].quiet_end).toBe(6 * 60);
    expect(row.rows[0].onboarded_at).not.toBeNull();

    const got = (await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers })).json().data;
    expect(got).toMatchObject({ wards: ["K-West", "H-West"], quietHours: { start: "23:00", end: "06:00" }, alertsMode: "all", onboarded: true });

    const cleared = await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", headers: me.headers, payload: { quietHours: null, wards: [] } });
    expect(cleared.statusCode).toBe(200);
    const again = (await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers })).json().data;
    expect(again.quietHours).toBeNull();
    expect(again.wards).toEqual([]);
  });

  it("refuses bad values with 400 INVALID_FEEDER_PATCH and writes nothing", async () => {
    const me = await insertFeeder();
    for (const payload of [
      { wards: ["A", "B", "C", "D", "E", "L", "N"] },
      { wards: ["A", "A"] },
      { wards: ["K/W"] },
      { quietHours: { start: "23:00", end: "23:00" } },
      { quietHours: { start: "25:00", end: "06:00" } },
      { quietHours: { start: "23:00" } },
      { alertsMode: "everything" },
      { onboarded: false },
      { displayName: "x".repeat(41) },
      { lat: 19.1 },
    ]) {
      const res = await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", headers: me.headers, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe("INVALID_FEEDER_PATCH");
    }
    const row = await query(`SELECT wards, quiet_start, alerts_mode FROM feeders WHERE id = $1`, [me.id]);
    expect(row.rows[0]).toEqual({ wards: [], quiet_start: null, alerts_mode: null });
  });
});

describe("GET /api/v1/feeders/me/export", () => {
  it("downloads the caller's own data without identity_hmac or coordinates, and is rate limited", async () => {
    const me = await insertFeeder();
    const dog = await insertDog();
    await feed(dog.id, me.id);
    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/export", headers: me.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const data = res.json().data;
    expect(data.feederId).toBe(me.id);
    expect(data.profile.display_name).toBe("Priya Sharma");
    expect(data.feeds).toHaveLength(1);
    expect(data.feeds[0].slug).toBe(dog.slug);
    expect(res.body).not.toContain("identity_hmac");
    expect(res.body).not.toMatch(/"(lat|lng|geo)"/);

    await app.inject({ method: "GET", url: "/api/v1/feeders/me/export", headers: me.headers });
    await app.inject({ method: "GET", url: "/api/v1/feeders/me/export", headers: me.headers });
    const limited = await app.inject({ method: "GET", url: "/api/v1/feeders/me/export", headers: me.headers });
    expect(limited.statusCode).toBe(429);
  });
});

describe("DELETE /api/v1/feeders/me", () => {
  it("needs the literal confirmation", async () => {
    const me = await insertFeeder();
    for (const payload of [{}, { confirm: "delete" }, { confirm: true }]) {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/feeders/me", headers: me.headers, payload });
      expect(res.statusCode).toBe(400);
    }
    const row = await query(`SELECT deleted_at FROM feeders WHERE id = $1`, [me.id]);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it("anonymises: name, identity, consent, sessions and push go; dogs and feeds stay; a held case is released", async () => {
    const me = await insertFeeder({ sosOptIn: true, wards: ["K-West"], trust: 70 });
    const before = await query<{ identity_hmac: string }>(`SELECT identity_hmac FROM feeders WHERE id = $1`, [me.id]);
    const dog = await insertDog({ registeredBy: me.id });
    await feed(dog.id, me.id);
    await query(
      `INSERT INTO push_subscriptions (feeder_id, endpoint, p256dh, auth) VALUES ($1, $2, 'p', 'a')`,
      [me.id, `https://push.example/${randomUUID()}`],
    );
    await query(`INSERT INTO refresh_tokens (jti, feeder_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
      randomUUID(),
      me.id,
    ]);
    const scan = await query<{ id: string }>(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at) VALUES ($1, $2, 'sos', now()) RETURNING id`,
      [dog.id, randomUUID()],
    );
    const sosCase = await query<{ id: string }>(
      `INSERT INTO sos_cases (scan_id, dog_id, severity, state, acked_by, acked_at)
       VALUES ($1, $2, 'serious', 'acked', $3, now()) RETURNING id`,
      [scan.rows[0].id, dog.id, me.id],
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/feeders/me",
      headers: me.headers,
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ deleted: true });

    const row = (
      await query(
        `SELECT display_name, identity_hmac, sos_opt_in, wards, deleted_at FROM feeders WHERE id = $1`,
        [me.id],
      )
    ).rows[0];
    expect(row.display_name).toBe("Former feeder");
    expect(row.identity_hmac).not.toBe(before.rows[0].identity_hmac);
    expect(row.sos_opt_in).toBe(false);
    expect(row.wards).toEqual([]);
    expect(row.deleted_at).not.toBeNull();
    expect((await query(`SELECT 1 FROM push_subscriptions WHERE feeder_id = $1`, [me.id])).rowCount).toBe(0);
    expect((await query(`SELECT 1 FROM refresh_tokens WHERE feeder_id = $1`, [me.id])).rowCount).toBe(0);
    // Dogs and feed logs stay.
    expect((await query(`SELECT registered_by FROM dogs WHERE id = $1`, [dog.id])).rows[0].registered_by).toBe(me.id);
    expect((await query(`SELECT 1 FROM scans WHERE feeder_id = $1 AND scan_type = 'feed'`, [me.id])).rowCount).toBe(1);
    // The case they held is open again and escalation is re-queued now.
    const c = (await query(`SELECT state, acked_by FROM sos_cases WHERE id = $1`, [sosCase.rows[0].id])).rows[0];
    expect(c).toEqual({ state: "open", acked_by: null });
    expect(
      (await query(`SELECT 1 FROM jobs WHERE kind = 'escalate_sos' AND payload->>'caseId' = $1`, [sosCase.rows[0].id]))
        .rowCount,
    ).toBe(1);
    // The still-valid access token now reads as a gone account.
    const after = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: me.headers });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("FEEDER_GONE");
    await query(`DELETE FROM jobs WHERE payload->>'caseId' = $1`, [sosCase.rows[0].id]);
  });
});

// ---------------------------------------------------------------------------
// My dogs, alerts
// ---------------------------------------------------------------------------

describe("GET /api/v1/feeders/me/dogs (v5 shape)", () => {
  it("includes dogs I only registered, with attention, and who last fed a dog by public name", async () => {
    const me = await insertFeeder();
    const other = await insertFeeder({ name: "Anil Kumar" });
    const pending = await insertDog({ status: "pending_activation", registeredBy: me.id, name: "Moti" });
    const fed = await insertDog({ name: "Rani" });
    await feed(fed.id, me.id, { capturedAt: new Date(Date.now() - 60_000) });
    await feed(fed.id, other.id);
    await query(`INSERT INTO tag_reports (dog_id, kind, reporter_device) VALUES ($1, 'damaged', 'h')`, [fed.id]);

    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs", headers: me.headers });
    expect(res.statusCode).toBe(200);
    const list = res.json().data.dogs as Array<Record<string, any>>;
    expect(list.map((d) => d.slug)).toEqual([fed.slug, pending.slug]);
    expect(list[0]).toMatchObject({
      registeredByMe: false,
      lastFedByName: "Anil K.",
      verified: false,
      status: "active",
      attention: { kind: "tag", detail: "damaged" },
    });
    expect(list[1]).toMatchObject({
      registeredByMe: true,
      myLastFedAt: null,
      status: "pending_activation",
      attention: { kind: "new" },
    });
    expect(res.body).not.toMatch(/"(lat|lng|geo)"/);
  });
});

describe("GET /api/v1/feeders/me/alerts", () => {
  it("lists events on my dogs by others, newest first, public names only, never my own", async () => {
    const me = await insertFeeder({ wards: ["H-West"] });
    const other = await insertFeeder({ name: "Anil Kumar" });
    const mine = await insertDog({ registeredBy: me.id });
    const wardDog = await insertDog({ ward: "H-West" });
    const stranger = await insertDog({ ward: "A" });
    await feed(mine.id, other.id);
    await query(`INSERT INTO tag_reports (dog_id, kind, reporter_device) VALUES ($1, 'found_on_ground', 'h')`, [mine.id]);
    await query(`INSERT INTO tag_reports (dog_id, kind, reporter_feeder_id) VALUES ($1, 'damaged', $2)`, [mine.id, me.id]);
    await query(`INSERT INTO dog_status_reports (dog_id, kind, reported_by) VALUES ($1, 'not_seen', $2)`, [wardDog.id, other.id]);
    await query(`INSERT INTO dog_status_reports (dog_id, kind, reported_by) VALUES ($1, 'not_seen', $2)`, [stranger.id, other.id]);

    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/alerts", headers: me.headers });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<Record<string, any>>;
    const kinds = items.map((i) => `${i.kind}:${i.dog.slug}`);
    expect(kinds).toContain(`fed:${mine.slug}`);
    expect(kinds).toContain(`tag:${mine.slug}`);
    expect(kinds).toContain(`not_seen:${wardDog.slug}`);
    expect(kinds).not.toContain(`not_seen:${stranger.slug}`);
    // My own report is not an alert to me.
    expect(items.filter((i) => i.kind === "tag")).toHaveLength(1);
    const tag = items.find((i) => i.kind === "tag")!;
    expect(tag).toMatchObject({ actorName: null, detail: "found_on_ground", wardCode: "K/W", href: `/me/dogs/${mine.slug}/tag` });
    expect(items.find((i) => i.kind === "fed")!.actorName).toBe("Anil K.");
    const ats = items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(res.body).not.toContain("Anil Kumar");
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe("POST /api/v1/dogs/:slug/confirm", () => {
  it("only a second feeder with a feed of the dog, on another phone, may confirm", async () => {
    const reg = await insertFeeder();
    const regDevice = device();
    const dog = await insertDog({ registeredBy: reg.id, registeredDevice: regDevice.subject });
    const stranger = await insertFeeder();
    const second = await insertFeeder({ name: "Anil Kumar" });
    await feed(dog.id, second.id);
    await feed(dog.id, reg.id);

    const byReg = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/confirm`, headers: reg.headers });
    expect(byReg.statusCode).toBe(403);
    expect(byReg.json().error.code).toBe("REGISTRATOR_CANNOT_CONFIRM");

    const byStranger = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/confirm`, headers: stranger.headers });
    expect(byStranger.statusCode).toBe(403);

    const samePhone = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/confirm`,
      headers: { ...second.headers, "x-device-token": regDevice.token },
    });
    expect(samePhone.statusCode).toBe(403);
    expect(samePhone.json().error.code).toBe("SAME_DEVICE");

    const anon = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/confirm` });
    expect(anon.statusCode).toBe(401);

    const ok = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/confirm`, headers: second.headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ verified: true, via: "feeder" });
    const profile = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` });
    expect(profile.json().data.verified).toBe(true);
  });
});

describe("POST /api/v1/dogs/:slug/checkups", () => {
  it("vet accounts only; writes one verified ledger row on the chain and verifies the dog", async () => {
    const dog = await insertDog();
    const feeder = await insertFeeder();
    const vetFeeder = await insertFeeder({ role: "vet", name: "Dr Anil Mehta" });
    const payload = { rabies: "given_today", sterilised: true, nextVaccineDue: "2027-09", noteForFeeders: "Healthy", examined: true };

    const notVet = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/checkups`, headers: feeder.headers, payload });
    expect(notVet.statusCode).toBe(403);
    const unregistered = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/checkups`, headers: vetFeeder.headers, payload });
    expect(unregistered.statusCode).toBe(403);
    expect(unregistered.json().error.code).toBe("VET_NOT_REGISTERED");

    await query(
      `INSERT INTO vets (clinic_name, geo, signing_key_pub, feeder_id)
       VALUES ('V5 Test Clinic', ST_SetSRID(ST_MakePoint(72.83, 19.11), 4326)::geography, 'none', $1)`,
      [vetFeeder.id],
    );
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/checkups`,
      headers: vetFeeder.headers,
      payload: { ...payload, examined: false },
    });
    expect(bad.statusCode).toBe(400);

    const head = await query<{ hash_curr: string }>(
      `SELECT hash_curr FROM medical_records ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    const res = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/checkups`, headers: vetFeeder.headers, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toEqual({ verified: true, via: "vet" });

    const rec = await query(
      `SELECT record_type, vaccine_name, vaccine_date, abc_date, is_verified, hash_prev, treatment
         FROM medical_records WHERE dog_id = $1`,
      [dog.id],
    );
    expect(rec.rowCount).toBe(1);
    expect(rec.rows[0]).toMatchObject({ record_type: "vaccination", vaccine_name: "Anti-rabies", is_verified: true, treatment: "Healthy" });
    expect(rec.rows[0].abc_date).not.toBeNull();
    if (head.rows[0]) expect(rec.rows[0].hash_prev).toBe(head.rows[0].hash_curr);

    const d = (await query(`SELECT verified_via, vaccine_due_month FROM dogs WHERE id = $1`, [dog.id])).rows[0];
    expect(d).toEqual({ verified_via: "vet", vaccine_due_month: "2027-09" });
    const profile = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data;
    expect(profile).toMatchObject({ verified: true, vaccinated: "yes", sterilised: "yes" });

    // The dog's feeders see it in Alerts with what the vet recorded.
    await feed(dog.id, feeder.id);
    const alerts = (await app.inject({ method: "GET", url: "/api/v1/feeders/me/alerts", headers: feeder.headers })).json().data.items;
    expect(alerts.find((a: any) => a.kind === "verified")).toMatchObject({ actorName: "Dr Mehta", detail: "vaccinated,sterilised" });
  });
});

// ---------------------------------------------------------------------------
// Finding a dog
// ---------------------------------------------------------------------------

describe("GET /api/v1/dogs/lookup", () => {
  it("finds an exact code typed with spaces, dashes and capitals; no position; no-store", async () => {
    const dog = await insertDog({ markings: ["torn left ear"] });
    const typed = `${dog.slug.slice(0, 3).toUpperCase()}-${dog.slug.slice(3, 6)} ${dog.slug.slice(6)}`;
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=${encodeURIComponent(typed)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().data.exact).toMatchObject({ slug: dog.slug, wardId: "K-West", wardCode: "K/W", markings: ["torn left ear"] });
    expect(res.body).not.toMatch(/"(lat|lng|geo)"/);
  });

  it("matches a partial code and suggests near misses for a full miss; hides non-public dogs", async () => {
    const dog = await insertDog();
    const hidden = await insertDog({ status: "pending_activation" });
    const partial = `${dog.slug.slice(0, 5)}????`;
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=${partial}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.matches.map((c: any) => c.slug)).toContain(dog.slug);

    const hiddenPartial = `${hidden.slug.slice(0, 5)}????`;
    const res2 = await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=${hiddenPartial}` });
    expect(res2.json().data.matches.map((c: any) => c.slug)).not.toContain(hidden.slug);

    // One valid near miss of the dog's slug that is not itself a dog.
    const miss = nearMisses(dog.slug)[0];
    const res3 = await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=${miss}` });
    expect(res3.statusCode).toBe(200);
    expect(res3.json().data.exact).toBeNull();
    expect(res3.json().data.suggestions.map((c: any) => c.slug)).toContain(dog.slug);
  });

  it("needs 4 known characters and 9 in all", async () => {
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=abc??????` })).json().error.code).toBe(
      "TOO_FEW_KNOWN",
    );
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=abc` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/lookup` })).statusCode).toBe(400);
  });

  it("is rate limited per address without a device token, and separately per device", async () => {
    const url = `/api/v1/dogs/lookup?code=abcd?????`;
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "GET", url, remoteAddress: "203.0.113.7" });
      expect(r.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url, remoteAddress: "203.0.113.7" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    // Another address, and a device on the same address, have their own buckets.
    expect((await app.inject({ method: "GET", url, remoteAddress: "203.0.113.8" })).statusCode).toBe(200);
    const d = device();
    expect(
      (await app.inject({ method: "GET", url, remoteAddress: "203.0.113.7", headers: { "x-device-token": d.token } }))
        .statusCode,
    ).toBe(200);
  });
});

describe("GET /api/v1/wards/:wardId/dogs", () => {
  it("lists public dogs of a ward with colour counts, ward level only", async () => {
    const ward = "R-Central";
    const before = (await app.inject({ method: "GET", url: `/api/v1/wards/${ward}/dogs` })).json().data.total;
    const brown = await insertDog({ ward, coat: "Brown and white" });
    await insertDog({ ward, coat: "black" });
    const gone = await insertDog({ ward, coat: "brown", status: "deceased" });
    const res = await app.inject({ method: "GET", url: `/api/v1/wards/${ward}/dogs?colour=brown` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const data = res.json().data;
    expect(data.wardId).toBe(ward);
    expect(data.total).toBe(before + 2);
    expect(data.dogs.map((d: any) => d.slug)).toContain(brown.slug);
    expect(data.dogs.map((d: any) => d.slug)).not.toContain(gone.slug);
    expect(data.colourTotal).toBeGreaterThanOrEqual(1);
    expect(data.colourTotal).toBeLessThan(data.total + 1);
    expect(res.body).not.toMatch(/"(lat|lng|geo)"/);
  });

  it("refuses unknown wards and colours, and is rate limited", async () => {
    expect((await app.inject({ method: "GET", url: `/api/v1/wards/K%2FW/dogs` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/wards/A/dogs?colour=green` })).statusCode).toBe(400);
    wardDogsPerSubject.reset();
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: `/api/v1/wards/A/dogs`, remoteAddress: "198.51.100.9" });
    }
    expect((await app.inject({ method: "GET", url: `/api/v1/wards/A/dogs`, remoteAddress: "198.51.100.9" })).statusCode).toBe(
      429,
    );
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe("POST /api/v1/dogs/:slug/tag-reports", () => {
  it("needs a device token or an account", async () => {
    const dog = await insertDog();
    const res = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/tag-reports`, payload: { kind: "damaged" } });
    expect(res.statusCode).toBe(401);
  });

  it("files a report, pages the dog's feeders once, and deduplicates per device, dog and kind", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const fan = await insertFeeder();
    await feed(dog.id, fan.id);
    const d = device();

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/tag-reports`,
      headers: { "x-device-token": d.token },
      payload: { kind: "found_on_ground" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ feedersNotified: 2, wardCode: "K/W" });
    expect(first.body).not.toMatch(/"(lat|lng|geo)"/);
    const jobs = await jobsFor(dog.slug);
    expect(jobs).toHaveLength(1);
    expect([...jobs[0].feederIds].sort()).toEqual([reg.id, fan.id].sort());
    // feedersNotified counts exactly the feeders who get it: each has it in Alerts.
    for (const f of [reg, fan]) {
      const items = (await app.inject({ method: "GET", url: "/api/v1/feeders/me/alerts", headers: f.headers })).json().data.items;
      expect(items.filter((i: any) => i.kind === "tag" && i.dog.slug === dog.slug)).toHaveLength(1);
    }

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/tag-reports`,
      headers: { "x-device-token": d.token },
      payload: { kind: "found_on_ground" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.reportId).toBe(first.json().data.reportId);
    expect(again.json().data.feedersNotified).toBe(0);

    // Another device, same kind: recorded, but the feeders are not paged twice.
    const other = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/tag-reports`,
      payload: { kind: "found_on_ground", deviceToken: device().token },
    });
    expect(other.statusCode).toBe(201);
    expect(await jobsFor(dog.slug)).toHaveLength(1);

    const stored = await query(`SELECT reporter_device FROM tag_reports WHERE dog_id = $1`, [dog.id]);
    expect(stored.rowCount).toBe(2);
    for (const r of stored.rows) {
      expect(r.reporter_device).not.toBe(d.subject);
      expect(r.reporter_device).not.toContain(d.token);
    }
  });

  it("wrong_dog puts the tag under review: feeds earn no trust, SOS is untouched", async () => {
    const dog = await insertDog({ sosEligible: true });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/tag-reports`,
      headers: { "x-device-token": device().token },
      payload: { kind: "wrong_dog" },
    });
    expect(res.statusCode).toBe(201);
    const row = (await query(`SELECT tag_review_since, sos_eligible_at FROM dogs WHERE id = $1`, [dog.id])).rows[0];
    expect(row.tag_review_since).not.toBeNull();
    expect(row.sos_eligible_at).not.toBeNull();
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.tagUnderReview).toBe(true);

    const f = await insertFeeder();
    const scan = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: f.headers,
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "feed", capturedAt: new Date().toISOString() },
    });
    expect(scan.statusCode).toBe(200);
    expect((await query(`SELECT 1 FROM trust_events WHERE feeder_id = $1`, [f.id])).rowCount).toBe(0);

    // An anonymous SOS on the dog still opens a case.
    const sos = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token },
    });
    expect(sos.statusCode).toBe(200);
    expect(sos.json().data.created).toBe(true);
  });

  it("is rate limited per device, per address and per dog", async () => {
    const d = device();
    const dogsList = await Promise.all([1, 2, 3, 4, 5, 6].map(() => insertDog()));
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/dogs/${dogsList[i].slug}/tag-reports`,
        headers: { "x-device-token": d.token },
        payload: { kind: "damaged" },
        remoteAddress: "192.0.2.1",
      });
      expect(r.statusCode).toBe(201);
    }
    const perDevice = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dogsList[5].slug}/tag-reports`,
      headers: { "x-device-token": d.token },
      payload: { kind: "damaged" },
      remoteAddress: "192.0.2.2",
    });
    expect(perDevice.statusCode).toBe(429);

    tagReportPerSubject.reset();
    tagReportPerDog.reset();
    tagReportPerIp.reset();
    // Ten fresh devices from one address: the eleventh is refused by address.
    const target = dogsList[5];
    const kinds = ["damaged", "found_on_ground", "too_tight", "wrong_dog"] as const;
    let refused = 0;
    for (let i = 0; i < 11; i++) {
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/dogs/${target.slug}/tag-reports`,
        headers: { "x-device-token": device().token },
        payload: { kind: kinds[i % 4] },
        remoteAddress: "192.0.2.50",
      });
      if (r.statusCode === 429) refused++;
    }
    expect(refused).toBe(1);

    // Per dog: from many addresses, the eleventh report on one dog is refused.
    tagReportPerIp.reset();
    tagReportPerDog.reset();
    let dogRefused = 0;
    for (let i = 0; i < 11; i++) {
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/dogs/${dogsList[0].slug}/tag-reports`,
        headers: { "x-device-token": device().token },
        payload: { kind: "too_tight" },
        remoteAddress: `192.0.2.${100 + i}`,
      });
      if (r.statusCode === 429) dogRefused++;
    }
    expect(dogRefused).toBe(1);
  });
});

describe("GET /api/v1/dogs/:slug/tags, resolve, prints, collar", () => {
  it("feeders see open reports and history; strangers get 403; three reporters suggest a sturdier collar", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const stranger = await insertFeeder();
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: `/api/v1/dogs/${dog.slug}/tag-reports`,
        headers: { "x-device-token": device().token },
        payload: { kind: "found_on_ground" },
      });
    }
    const print = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/prints`,
      headers: reg.headers,
      payload: { layout: "tags", paper: "a4", tagCount: 6 },
    });
    expect(print.statusCode).toBe(201);

    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/tags` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/tags`, headers: stranger.headers })).statusCode).toBe(403);

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/tags`, headers: reg.headers });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.open).toHaveLength(3);
    expect(data.open[0].reporter).toBe("a passer-by");
    expect(data.reportsThisWeek).toBe(3);
    expect(data.sturdierCollarSuggested).toBe(true);
    expect(data.history.map((h: any) => h.kind)).toEqual(expect.arrayContaining(["reported", "printed", "registered"]));
    expect(data.history.find((h: any) => h.kind === "printed")).toMatchObject({ detail: "6 tags", byName: "Priya S." });
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.sturdierCollarSuggested).toBe(true);
  });

  it("resolving the last wrong_dog report ends the review; only a feeder may resolve", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const stranger = await insertFeeder();
    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/tag-reports`,
      headers: { "x-device-token": device().token },
      payload: { kind: "wrong_dog" },
    });
    const id = filed.json().data.reportId;
    const url = `/api/v1/dogs/${dog.slug}/tag-reports/${id}/resolve`;
    expect((await app.inject({ method: "POST", url, headers: stranger.headers, payload: { resolution: "checked_ok" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: reg.headers, payload: { resolution: "fixed" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url, headers: reg.headers, payload: { resolution: "checked_ok" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ id, resolution: "checked_ok" });
    expect((await query(`SELECT tag_review_since FROM dogs WHERE id = $1`, [dog.id])).rows[0].tag_review_since).toBeNull();
    // Idempotent.
    expect((await app.inject({ method: "POST", url, headers: reg.headers, payload: { resolution: "checked_ok" } })).statusCode).toBe(200);
  });

  it("serves a signed collar URL that verifies, to the registrator and feeders only; batches skip the rest", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const otherDog = await insertDog();
    const stranger = await insertFeeder();
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/collar`, headers: reg.headers });
    expect(res.statusCode).toBe(200);
    const { collarUrl } = res.json().data;
    const sig = new URL(collarUrl).searchParams.get("s")!;
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}?s=${encodeURIComponent(sig)}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/collar`, headers: stranger.headers })).statusCode).toBe(403);

    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/collars/batch",
      headers: reg.headers,
      payload: { slugs: [dog.slug, otherDog.slug, "notaslug"] },
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().data.dogs.map((d: any) => d.slug)).toEqual([dog.slug]);
    expect(batch.json().data.skipped).toEqual([otherDog.slug, "notaslug"]);
    const tooMany = await app.inject({
      method: "POST",
      url: "/api/v1/collars/batch",
      headers: reg.headers,
      payload: { slugs: Array.from({ length: 9 }, () => generateSlug()) },
    });
    expect(tooMany.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Dog status
// ---------------------------------------------------------------------------

describe("status reports", () => {
  it("not_seen marks the dog lost and asks the ward to look out; a view scan brings it back", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id, ward: "P-North" });
    const wardFeeder = await insertFeeder({ wards: ["P-North"] });
    const stranger = await insertFeeder();

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports`,
      headers: stranger.headers,
      payload: { kind: "not_seen" },
    });
    expect(denied.statusCode).toBe(403);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports`,
      headers: reg.headers,
      payload: { kind: "not_seen" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ status: "lost", needsConfirmation: false });
    const jobs = await jobsFor(dog.slug);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].feederIds).toContain(wardFeeder.id);
    expect(jobs[0].feederIds).not.toContain(reg.id);

    const view = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": device().token },
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "view", capturedAt: new Date().toISOString() },
    });
    expect(view.statusCode).toBe(200);
    expect((await query(`SELECT status FROM dogs WHERE id = $1`, [dog.id])).rows[0].status).toBe("active");
  });

  it("passed_away waits for a second feeder, then the profile keeps a memorial of public names", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const second = await insertFeeder({ name: "Anil Kumar" });
    await feed(dog.id, second.id);
    await feed(dog.id, reg.id);

    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports`,
      headers: reg.headers,
      payload: { kind: "passed_away" },
    });
    expect(filed.statusCode).toBe(201);
    expect(filed.json().data).toMatchObject({ status: "active", needsConfirmation: true });
    const reportId = filed.json().data.id;
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.memorial).toBeUndefined();

    const pending = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/status-reports`, headers: second.headers });
    expect(pending.json().data.reports).toEqual([
      expect.objectContaining({ id: reportId, kind: "passed_away", reportedByName: "Priya S.", mine: false }),
    ]);

    const self = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports/${reportId}/confirm`,
      headers: reg.headers,
    });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.code).toBe("SAME_REPORTER");

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports/${reportId}/confirm`,
      headers: second.headers,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ id: reportId, status: "deceased" });

    const profile = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data;
    expect(profile.status).toBe("deceased");
    // Since v6: first names only (opt-out respected).
    expect([...profile.memorial.feederNames].sort()).toEqual(["Anil", "Priya"]);
    expect(JSON.stringify(profile)).not.toContain("Anil Kumar");

    const after = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports`,
      headers: reg.headers,
      payload: { kind: "not_seen" },
    });
    expect(after.statusCode).toBe(409);
  });

  it("adopted applies at once", async () => {
    const reg = await insertFeeder();
    const dog = await insertDog({ registeredBy: reg.id });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/status-reports`,
      headers: reg.headers,
      payload: { kind: "adopted" },
    });
    expect(res.json().data).toMatchObject({ status: "adopted", needsConfirmation: false });
  });
});

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

describe("SOS v5: ward paging, case fields, decline", () => {
  it("pages a ward feeder without a nearby scan, and never pages a feeder whose wards exclude the dog", async () => {
    const dog = await insertDog({ ward: "M-East", sosEligible: true });
    const wardFeeder = await insertFeeder({ wards: ["M-East"], sosOptIn: true, trust: 70 });
    const elsewhere = await insertFeeder({ wards: ["A"], sosOptIn: true, trust: 70 });
    const nearby = await insertFeeder({ sosOptIn: true, trust: 70 });
    const lowTrust = await insertFeeder({ wards: ["M-East"], sosOptIn: true, trust: 45 });
    // `elsewhere` and `nearby` both scanned right next to the dog recently.
    const other = await insertDog({ ward: "M-East" });
    await feed(other.id, elsewhere.id);
    await feed(other.id, nearby.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug: dog.slug, severity: "critical", note: "Bleeding from a leg", deviceToken: device().token },
    });
    expect(res.statusCode).toBe(200);
    const caseId = res.json().data.caseId;
    const paged = (await query<{ feeder_id: string }>(`SELECT feeder_id FROM sos_notifications WHERE case_id = $1`, [caseId]))
      .rows.map((r) => r.feeder_id);
    expect(paged).toContain(wardFeeder.id);
    expect(paged).toContain(nearby.id);
    expect(paged).not.toContain(elsewhere.id);
    expect(paged).not.toContain(lowTrust.id);

    // A paged responder sees the case but not the exact spot.
    const view = await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: wardFeeder.headers });
    expect(view.statusCode).toBe(200);
    const c = view.json().data;
    expect(c).toMatchObject({
      note: "Bleeding from a leg",
      dog: { slug: dog.slug, name: "Rani" },
      respondingName: null,
      declinedByMe: false,
      location: null,
    });
    expect(c.respondersPaged).toBe(paged.length);
    expect(view.body).not.toMatch(/"lat"/);

    // Decline: marks the page, the case stays open and its escalation stays queued.
    const decline = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/decline`, headers: wardFeeder.headers });
    expect(decline.statusCode).toBe(200);
    expect(decline.json().data).toEqual({ declined: true });
    expect((await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: wardFeeder.headers })).json().data.declinedByMe).toBe(true);
    expect((await query(`SELECT state FROM sos_cases WHERE id = $1`, [caseId])).rows[0].state).toBe("open");
    expect((await query(`SELECT 1 FROM jobs WHERE kind = 'escalate_sos' AND payload->>'caseId' = $1`, [caseId])).rowCount).toBe(1);
    // Someone never paged cannot decline (or read) it.
    expect((await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/decline`, headers: elsewhere.headers })).statusCode).toBe(403);

    // The acker, and only the acker, gets the exact spot.
    const ack = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: nearby.headers });
    expect(ack.statusCode).toBe(200);
    const mine = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: nearby.headers })).json().data;
    expect(mine.location).toEqual({ lat: expect.closeTo(19.1197, 4), lng: expect.closeTo(72.8361, 4) });
    expect(mine.respondingName).toBe("Priya S.");
    const theirs = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: wardFeeder.headers })).json().data;
    expect(theirs.location).toBeNull();
    expect(theirs.respondingName).toBe("Priya S.");
    await query(`DELETE FROM jobs WHERE payload->>'caseId' = $1`, [caseId]);
  });

  it("a ward-restricted feeder cannot claim a case outside their wards by standing alone", async () => {
    const dog = await insertDog({ ward: "S" });
    const outside = await insertFeeder({ wards: ["A"], sosOptIn: true, trust: 70 });
    const scan = await query<{ id: string }>(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at) VALUES ($1, $2, 'sos', now()) RETURNING id`,
      [dog.id, randomUUID()],
    );
    const c = await query<{ id: string }>(
      `INSERT INTO sos_cases (scan_id, dog_id, severity) VALUES ($1, $2, 'serious') RETURNING id`,
      [scan.rows[0].id, dog.id],
    );
    const ack = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${c.rows[0].id}/ack`, headers: outside.headers });
    expect(ack.statusCode).toBe(403);
    expect(ack.json().error.code).toBe("SOS_ACK_FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Registration photo and markings
// ---------------------------------------------------------------------------

describe("POST /api/v1/registrations photoBase64 + markings", () => {
  it("stores the markings and the photo as the dog's portrait, and refuses a non-image", async () => {
    const reg = await insertFeeder({ role: "registrator" });
    const d = device();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { ...reg.headers, "x-device-token": d.token },
      payload: { wardId: "K-West", name: "Rani", markings: ["white chest", "torn left ear"], photoBase64: jpeg(16, 16, 32).toString("base64") },
    });
    expect(res.statusCode).toBe(201);
    const slug = res.json().data.slug;
    const dog = (await query<{ id: string; markings: string[] }>(`SELECT id, markings FROM dogs WHERE slug = $1`, [slug])).rows[0];
    dogs.push(dog.id);
    expect(dog.markings).toEqual(["white chest", "torn left ear"]);
    let key: string | null = null;
    for (let i = 0; i < 50 && !key; i++) {
      key = (await query<{ photo_s3_key: string | null }>(`SELECT photo_s3_key FROM scans WHERE dog_id = $1 AND scan_type = 'identify'`, [dog.id])).rows[0]?.photo_s3_key ?? null;
      if (!key) await new Promise((r) => setTimeout(r, 20));
    }
    expect(key).toMatch(/^photos\/.+\.jpg$/);
    // The registrator sees it as the portrait on their pending dog.
    const profile = await app.inject({ method: "GET", url: `/api/v1/dogs/${slug}`, headers: reg.headers });
    expect(profile.json().data.photoKey).toBe(key);
    // The photo scan cannot activate the registration.
    expect((await query(`SELECT status FROM dogs WHERE id = $1`, [dog.id])).rows[0].status).toBe("pending_activation");

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { ...reg.headers, "x-device-token": d.token },
      payload: { wardId: "K-West", photoBase64: Buffer.from("not an image at all, just text").toString("base64") },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("INVALID_PHOTO");

    const tooMany = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { ...reg.headers, "x-device-token": d.token },
      payload: { wardId: "K-West", markings: Array.from({ length: 9 }, (_, i) => `m${i}`) },
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it("refuses an unauthenticated photo upload before reading the body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      payload: { wardId: "K-West", photoBase64: jpeg(16, 16, 32).toString("base64") },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// sex and reporterAnonymous (copy pronouns, the N2 "passer-by" line)
// ---------------------------------------------------------------------------

describe("sex on every dog shape, reporterAnonymous on SOS cases", () => {
  it("normalises dogs.sex to male | female | null on the profile, My dogs, lookup and ward cards", async () => {
    const me = await insertFeeder();
    const rani = await insertDog({ sex: "female", registeredBy: me.id, ward: "N" });
    const moti = await insertDog({ sex: "Male", registeredBy: me.id, ward: "N" });
    const odd = await insertDog({ sex: "unknown", registeredBy: me.id, ward: "N" });

    const sexOf = async (slug: string) => (await app.inject({ method: "GET", url: `/api/v1/dogs/${slug}` })).json().data.sex;
    expect(await sexOf(rani.slug)).toBe("female");
    expect(await sexOf(moti.slug)).toBe("male");
    expect(await sexOf(odd.slug)).toBeNull();

    const mine = (await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs", headers: me.headers })).json().data.dogs;
    const bySlug = Object.fromEntries(mine.map((d: any) => [d.slug, d.sex]));
    expect(bySlug).toMatchObject({ [rani.slug]: "female", [moti.slug]: "male", [odd.slug]: null });

    const card = (await app.inject({ method: "GET", url: `/api/v1/dogs/lookup?code=${rani.slug}` })).json().data.exact;
    expect(card.sex).toBe("female");
    const ward = (await app.inject({ method: "GET", url: `/api/v1/wards/N/dogs` })).json().data.dogs;
    expect(ward.find((d: any) => d.slug === moti.slug).sex).toBe("male");
  });

  it("marks an SOS from a device token with no account as anonymous, and a signed-in one as not", async () => {
    const dog = await insertDog({ sex: "female", ward: "L" });
    const moderator = await insertFeeder({ role: "admin" });
    const reporter = await insertFeeder();

    const anon = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token },
    });
    const anonCase = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${anon.json().data.caseId}`, headers: moderator.headers })).json().data;
    expect(anonCase.reporterAnonymous).toBe(true);
    expect(anonCase.dog).toMatchObject({ slug: dog.slug, sex: "female" });
    expect(JSON.stringify(anonCase)).not.toMatch(/device|feederId/i);

    const signed = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: reporter.headers,
      payload: { dogSlug: dog.slug, severity: "minor" },
    });
    const signedCase = (await app.inject({ method: "GET", url: `/api/v1/sos/cases/${signed.json().data.caseId}`, headers: moderator.headers })).json().data;
    expect(signedCase.reporterAnonymous).toBe(false);
    expect(JSON.stringify(signedCase)).not.toContain(reporter.id);
  });
});
