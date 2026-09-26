/**
 * Design v7 API (docs/design/v7-portals/CONTRACT.md): admin roles and the
 * append-only audit log, owner bootstrap, documents, vets and passkey
 * signing, the health list, NGOs and SOS routing, dispatch, drives, avatars,
 * merges, reports, and the D13 moderation tools, with the abuse cases.
 *
 * Passkeys are exercised end to end with a software authenticator (P-256,
 * "none" attestation) built below, against the real @simplewebauthn/server.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { generateSlug, openCaseToVets, query, withTx } from "@hetja/db";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { deviceTokenSubject, issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
import { identityHmac } from "../lib/hmac.js";
import { canonicalEmailAddress } from "../lib/email.js";
import { ROLE_PERMISSIONS } from "../lib/admin.js";
import { mayAck, pageIsGround } from "../lib/sos-eligibility.js";
import { decryptDocument, encryptDocument } from "../lib/documents.js";
import { scrubDetail } from "../lib/audit.js";
import { maskPhone } from "../lib/professionals.js";
import { recordHash } from "../lib/webauthn.js";
import {
  V7_LIMITERS,
  feederWritePerAccount,
  reportPerSubject,
  scanPerSubject,
  sosAckPerAccount,
  tagReportPerDog,
  tagReportPerIp,
  tagReportPerSubject,
} from "../lib/rate-limit.js";
import { photoGate } from "../lib/photo-gate.js";
import { forgetDeviceBlocks } from "../lib/moderation-state.js";
import { dogCache } from "./dogs.js";
import { fileStem, nameSimilarity, normaliseName } from "./admin-content.js";

const OWNER_EMAIL = "aarti.owner@example.com";
const DOCS_KEY = randomBytes(32).toString("base64");
const ORIGIN = "http://localhost:3000";
const baseConfig = loadConfig();

let app: FastifyInstance;
let storageDir: string;
let docsDir: string;
const feeders: string[] = [];
const dogs: string[] = [];
const ngos: string[] = [];

interface TestFeeder {
  id: string;
  headers: { authorization: string };
}

const config = {
  ...baseConfig,
  HETJA_OWNER_EMAILS: OWNER_EMAIL,
  HETJA_DOCS_KEY: DOCS_KEY,
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_ORIGINS: ORIGIN,
  PUBLIC_WEB_ORIGIN: "https://hetja.in",
};

async function insertFeeder(
  opts: { name?: string; role?: string; trust?: number; wards?: string[]; sosOptIn?: boolean; hmac?: string } = {},
): Promise<TestFeeder> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, wards, sos_opt_in)
     VALUES ($1, $2, $3::feeder_role, $4, 'v1.0', $5, $6) RETURNING id`,
    [opts.hmac ?? `v7-${randomUUID()}`, opts.name ?? "Priya Sharma", opts.role ?? "feeder", opts.trust ?? 30, opts.wards ?? [], opts.sosOptIn ?? false],
  );
  const id = res.rows[0].id;
  feeders.push(id);
  return { id, headers: { authorization: `Bearer ${signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}` } };
}

async function insertOwner(): Promise<TestFeeder> {
  // Whatever an earlier run left under this identity is renamed away first.
  await query(`UPDATE feeders SET identity_hmac = identity_hmac || '-old-' || id WHERE identity_hmac = $1`, [
    identityHmac(canonicalEmailAddress(OWNER_EMAIL), config.HETJA_HMAC_PEPPER),
  ]);
  return insertFeeder({ name: "Aarti Shah", hmac: identityHmac(canonicalEmailAddress(OWNER_EMAIL), config.HETJA_HMAC_PEPPER) });
}

async function insertDog(opts: { ward?: string; name?: string; registeredBy?: string | null; slug?: string; batchNo?: string } = {}) {
  const slug = opts.slug ?? generateSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, status, registered_by, last_seen_geo, last_seen_at, sos_eligible_at)
     VALUES ($1, $2, $3, 'active', $4, ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography, now(), now())
     RETURNING id`,
    [slug, opts.name ?? "Rani", opts.ward ?? "K-West", opts.registeredBy ?? null],
  );
  dogs.push(res.rows[0].id);
  await query(`INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material) VALUES ($1, $2, 'x', $3, 'test')`, [
    res.rows[0].id,
    slug,
    opts.batchNo ?? `test-${randomUUID().slice(0, 8)}`,
  ]);
  return { id: res.rows[0].id, slug };
}

async function feed(dogId: string, feederId: string, photoKey: string | null = null) {
  const r = await query<{ id: string }>(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, geo, captured_at, received_at, review_status, photo_s3_key)
     VALUES ($1, $2, 'feed', $3, ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography, now(), now(), 'pending', $4)
     RETURNING id`,
    [dogId, randomUUID(), feederId, photoKey],
  );
  return r.rows[0].id;
}

function device(): { token: string; subject: string } {
  const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
  return { token, subject: deviceTokenSubject(token, config.HETJA_DEVICE_SECRET) as string };
}

function jpeg(width = 16, height = 16, entropyBytes = 64): Buffer {
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

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

// ---------------------------------------------------------------------------
// A software WebAuthn authenticator (P-256, ES256, "none" attestation).
// ---------------------------------------------------------------------------

function cbor(value: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const s = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, s.length), s]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    const parts: Buffer[] = [head(5, value.size)];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Buffer.concat(parts);
  }
  if (value && typeof value === "object") return cbor(new Map(Object.entries(value)));
  throw new Error("cbor: unsupported");
}

const b64u = (b: Buffer) => b.toString("base64url");

class SoftAuthenticator {
  readonly credId = randomBytes(16);
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject };
  private counter = 0;
  constructor() {
    this.key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  }
  private rpIdHash() {
    return createHash("sha256").update("localhost").digest();
  }
  register(options: { challenge: string }) {
    const jwk = this.key.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const cose = new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([0x45]), // UP | UV | AT
      Buffer.alloc(4),
      Buffer.alloc(16),
      idLen,
      this.credId,
      cbor(cose),
    ]);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
  assert(challenge: string, opts: { uv?: boolean } = {}) {
    this.counter++;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([this.rpIdHash(), Buffer.from([opts.uv === false ? 0x01 : 0x05]), count]);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
    const sig = cryptoSign("sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), this.key.privateKey);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: "public-key",
      response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(sig) },
      clientExtensionResults: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Set-up and clean-up
// ---------------------------------------------------------------------------

beforeEach(async () => {
  for (const l of [...V7_LIMITERS, feederWritePerAccount, reportPerSubject, scanPerSubject, sosAckPerAccount, tagReportPerDog, tagReportPerIp, tagReportPerSubject]) {
    l.reset();
  }
  photoGate.reset();
  dogCache.clear();
  forgetDeviceBlocks();
  storageDir = await mkdtemp(join(tmpdir(), "hetja-v7-photos-"));
  docsDir = await mkdtemp(join(tmpdir(), "hetja-v7-docs-"));
  app = buildServer({ ...config, STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir, DOCS_LOCAL_DIR: docsDir });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  const F = feeders.splice(0);
  const D = dogs.splice(0);
  const N = ngos.splice(0);
  const cases = (
    await query<{ id: string; scan_id: string }>(
      `SELECT id, scan_id FROM sos_cases WHERE dog_id = ANY($1::uuid[])
          OR scan_id IN (SELECT id FROM scans WHERE feeder_id = ANY($2::uuid[]) OR device_token IS NOT NULL AND dog_id = ANY($1::uuid[]))`,
      [D, F],
    )
  ).rows;
  const C = cases.map((c) => c.id);
  await query(`DELETE FROM jobs WHERE payload->>'caseId' = ANY($1::text[])`, [C]);
  await query(`DELETE FROM jobs WHERE kind IN ('send_feeder_push') AND (payload::text LIKE ANY($1::text[]))`, [F.map((f) => `%${f}%`)]);
  await query(`DELETE FROM sos_dispatches WHERE case_id = ANY($1::uuid[]) OR member_feeder_id = ANY($2::uuid[])`, [C, F]);
  await query(`DELETE FROM sos_case_events WHERE case_id = ANY($1::uuid[])`, [C]);
  await query(`DELETE FROM sos_notifications WHERE case_id = ANY($1::uuid[]) OR feeder_id = ANY($2::uuid[])`, [C, F]);
  await query(`DELETE FROM sos_cases WHERE id = ANY($1::uuid[])`, [C]);
  await query(`DELETE FROM sign_requests WHERE dog_id = ANY($1::uuid[]) OR requested_by = ANY($2::uuid[])`, [D, F]);
  await query(`DELETE FROM drive_dogs WHERE dog_id = ANY($1::uuid[]) OR drive_id IN (SELECT id FROM drives WHERE ngo_id = ANY($2::uuid[]))`, [D, N]);
  await query(`DELETE FROM drives WHERE ngo_id = ANY($1::uuid[])`, [N]);
  await query(`DELETE FROM dog_avatars WHERE dog_id = ANY($1::uuid[]) OR uploaded_by = ANY($2::uuid[])`, [D, F]);
  await query(`DELETE FROM avatar_batches WHERE created_by = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM reports WHERE dog_id = ANY($1::uuid[]) OR other_dog_id = ANY($1::uuid[])`, [D]);
  await query(`DELETE FROM duplicate_dismissals WHERE dog_a = ANY($1::uuid[]) OR dog_b = ANY($1::uuid[])`, [D]);
  await query(`DELETE FROM dog_merges WHERE kept_dog_id = ANY($1::uuid[]) OR merged_dog_id = ANY($1::uuid[])`, [D]);
  await query(`DELETE FROM documents WHERE uploaded_by = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM webauthn_challenges WHERE feeder_id = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM webauthn_credentials WHERE feeder_id = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM ngo_vets WHERE ngo_id = ANY($1::uuid[]) OR vet_feeder_id = ANY($2::uuid[])`, [N, F]);
  await query(`DELETE FROM ngo_members WHERE ngo_id = ANY($1::uuid[]) OR feeder_id = ANY($2::uuid[])`, [N, F]);
  await query(`DELETE FROM vet_profiles WHERE feeder_id = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM invites WHERE invited_by = ANY($1::uuid[]) OR ngo_id = ANY($2::uuid[])`, [F, N]);
  await query(`DELETE FROM ngos WHERE id = ANY($1::uuid[]) OR applied_by = ANY($2::uuid[])`, [N, F]);
  await query(`DELETE FROM admin_roles WHERE feeder_id = ANY($1::uuid[]) OR granted_by = ANY($1::uuid[])`, [F]);
  await query(`DELETE FROM blocked_devices WHERE blocked_by = ANY($1::uuid[])`, [F]);
  await query(`UPDATE dogs SET merged_into = NULL WHERE id = ANY($1::uuid[])`, [D]);
  for (const id of D) {
    await query(`DELETE FROM tag_reports WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM trust_events WHERE ref_scan_id IN (SELECT id FROM scans WHERE dog_id = $1 OR merged_from_dog_id = $1)`, [id]);
    await query(`DELETE FROM scans WHERE dog_id = $1 OR merged_from_dog_id = $1`, [id]);
    await query(`DELETE FROM collars WHERE dog_id = $1`, [id]);
    try {
      await query(`DELETE FROM dogs WHERE id = $1`, [id]);
    } catch {
      await query(`UPDATE dogs SET registered_by = NULL, verified_by = NULL, status = 'relocated' WHERE id = $1`, [id]);
    }
  }
  for (const id of F) {
    await query(`DELETE FROM trust_events WHERE feeder_id = $1`, [id]);
    await query(`UPDATE sos_cases SET acked_by = NULL WHERE acked_by = $1`, [id]);
    await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
    await query(`UPDATE dogs SET verified_by = NULL, registered_by = NULL WHERE verified_by = $1 OR registered_by = $1`, [id]);
    await query(`UPDATE feeders SET suspended_by = NULL WHERE suspended_by = $1`, [id]);
    try {
      await query(`DELETE FROM feeders WHERE id = $1`, [id]);
    } catch {
      await query(`UPDATE feeders SET deleted_at = now(), identity_hmac = 'gone-' || id WHERE id = $1`, [id]);
    }
  }
  await rm(storageDir, { recursive: true, force: true });
  await rm(docsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

async function upload(f: TestFeeder, kind: string, bytes: Buffer, mime: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: f.headers,
    payload: { kind, fileName: "x", mime, base64: bytes.toString("base64") },
  });
}

async function applyVet(f: TestFeeder, over: Record<string, unknown> = {}) {
  const cert = (await upload(f, "certificate", PDF, "application/pdf")).json().data.id;
  const pid = (await upload(f, "photo_id", jpeg(), "image/jpeg")).json().data.id;
  return app.inject({
    method: "POST",
    url: "/api/v1/vet/apply",
    headers: f.headers,
    payload: {
      council: "MSVC",
      regNo: "5190",
      clinic: "Paws Clinic, Versova",
      wards: ["K-West", "K-East"],
      sosAvailable: true,
      sosHours: null,
      publicPhone: "+91 98200 44410",
      documentIds: [cert, pid],
      ...over,
    },
  });
}

/** A verified vet with a registered passkey. */
async function verifiedVet(owner: TestFeeder, name = "Dr Farhan Qureshi") {
  const vet = await insertFeeder({ name });
  const applied = await applyVet(vet);
  expect(applied.statusCode).toBe(201);
  const ok = await app.inject({
    method: "POST",
    url: `/api/v1/admin/vets/${applied.json().data.id}/verify`,
    headers: owner.headers,
    payload: { registerChecked: true, validTo: "2029-03" },
  });
  expect(ok.statusCode).toBe(200);
  const auth = new SoftAuthenticator();
  const opts = await app.inject({ method: "POST", url: "/api/v1/vet/passkeys/options", headers: vet.headers, payload: {} });
  expect(opts.statusCode).toBe(200);
  const reg = await app.inject({
    method: "POST",
    url: "/api/v1/vet/passkeys",
    headers: vet.headers,
    payload: { response: auth.register(opts.json().data), label: "Phone" },
  });
  expect(reg.statusCode).toBe(201);
  return { ...vet, profileId: applied.json().data.id as string, auth };
}

async function signRecord(vet: TestFeeder & { auth: SoftAuthenticator }, record: Record<string, unknown>) {
  const o = await app.inject({ method: "POST", url: "/api/v1/vet/records/options", headers: vet.headers, payload: { record } });
  if (o.statusCode !== 200) return o;
  const { challengeId, options } = o.json().data;
  return app.inject({
    method: "POST",
    url: "/api/v1/vet/records",
    headers: vet.headers,
    payload: { challengeId, record, assertion: vet.auth.assert(options.challenge) },
  });
}

async function activeNgo(owner: TestFeeder, coordinator: TestFeeder, wards = ["K-West"]) {
  const doc = (await upload(coordinator, "ngo_registration", PDF, "application/pdf")).json().data.id;
  const reg = await app.inject({
    method: "POST",
    url: "/api/v1/ngo/register",
    headers: coordinator.headers,
    payload: {
      name: `Andheri Paws Trust ${randomUUID().slice(0, 6)}`,
      regType: "trust",
      regNo: "E-21904",
      wards,
      offers: { ambulance: true, shelterBeds: true, sterilisation: false, collars: true },
      contactName: "Kavita Nair",
      publicPhone: "+91 98200 02231",
      documentIds: [doc],
    },
  });
  expect(reg.statusCode).toBe(201);
  const id = reg.json().data.id as string;
  ngos.push(id);
  const ap = await app.inject({ method: "POST", url: `/api/v1/admin/ngos/${id}/approve`, headers: owner.headers, payload: {} });
  expect(ap.statusCode).toBe(200);
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("audit_log is append-only for everyone", () => {
  it("refuses UPDATE, DELETE and TRUNCATE", async () => {
    await query(`INSERT INTO audit_log (actor_kind, action, summary) VALUES ('system', 'test.row', 'a test row')`);
    await expect(query(`UPDATE audit_log SET summary = 'x' WHERE action = 'test.row'`)).rejects.toThrow();
    await expect(query(`DELETE FROM audit_log WHERE action = 'test.row'`)).rejects.toThrow();
    await expect(query(`TRUNCATE audit_log`)).rejects.toThrow();
  });

  it("scrubs contact data, positions and bytes from the detail", () => {
    expect(scrubDetail({ email: "a@b", phone: "+91", lat: 1, base64: "x", ok: "yes", n: 2 })).toEqual({ ok: "yes", n: 2 });
  });
});

describe("pure helpers", () => {
  it("documents round-trip under AES-256-GCM and are bound to their id", () => {
    const key = randomBytes(32);
    const blob = encryptDocument(key, "11111111-1111-1111-1111-111111111111", PDF);
    expect(blob.includes(PDF)).toBe(false);
    expect(decryptDocument(key, "11111111-1111-1111-1111-111111111111", blob).equals(PDF)).toBe(true);
    expect(() => decryptDocument(key, "22222222-2222-2222-2222-222222222222", blob)).toThrow();
  });

  it("matches avatar file names and similar dog names", () => {
    expect(fileStem("R4N-7KW-2AB.png")).toBe("r4n-7kw-2ab");
    expect(normaliseName("Kaalu")).toBe(normaliseName("Kalu"));
    expect(nameSimilarity("Kalu", "Kaalu")).toBe(1);
    expect(nameSimilarity("Rani", "Moti")).toBeLessThan(0.5);
  });

  it("masks a public phone for the admin panel and hashes records deterministically", () => {
    expect(maskPhone("+919820044410")).toBe("+91 98•••• 4410");
    expect(recordHash("a", { b: 1, a: 2 })).toBe(recordHash("a", { a: 2, b: 1 }));
    expect(recordHash("a", { a: 1 })).not.toBe(recordHash("b", { a: 1 }));
  });

  it("one routing rule: a suspended vet's vet pages are no ground; suspension beats every ground", () => {
    expect(pageIsGround({ notifyOnly: false, route: "vet_escalation" }, true)).toBe(false);
    expect(pageIsGround({ notifyOnly: false, route: "ngo_dispatch" }, true)).toBe(true);
    expect(pageIsGround({ notifyOnly: true, route: null }, false)).toBe(false);
    const g = { sosOptIn: true, trustScore: 90, notified: true, moderator: true };
    expect(mayAck({ ...g, suspended: true }, "critical")).toBe(false);
    expect(mayAck({ sosOptIn: false, trustScore: 0, notified: false, moderator: false, vetCoversWard: true }, "critical")).toBe(true);
  });

  it("roles: the owner holds everything; an avatar editor holds avatars, not vets", () => {
    expect(ROLE_PERMISSIONS.owner).toContain("team");
    expect(ROLE_PERMISSIONS.moderator).toContain("team_read");
    expect(ROLE_PERMISSIONS.moderator).not.toContain("team");
    expect(ROLE_PERMISSIONS.avatar_editor).not.toContain("vets");
  });
});

describe("admin access", () => {
  it("HETJA_OWNER_EMAILS makes that account Owner; everyone else is refused", async () => {
    const owner = await insertOwner();
    const me = await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: owner.headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.roles[0]).toMatchObject({ role: "owner", source: "config" });
    const feeder = await insertFeeder();
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: feeder.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/today" })).statusCode).toBe(401);
    const today = await app.inject({ method: "GET", url: "/api/v1/admin/today", headers: owner.headers });
    expect(today.statusCode).toBe(200);
    expect(today.json().data).toHaveProperty("week.newDogs");
  });

  it("role checks answer 403 ADMIN_FORBIDDEN; moderators read the team but cannot change it", async () => {
    const editor = await insertFeeder();
    await query(`INSERT INTO admin_roles (feeder_id, role) VALUES ($1, 'avatar_editor')`, [editor.id]);
    const r = await app.inject({ method: "GET", url: "/api/v1/admin/vets", headers: editor.headers });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("ADMIN_FORBIDDEN");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/avatars/batches", headers: editor.headers })).statusCode).toBe(200);
    const mod = await insertFeeder();
    await query(`INSERT INTO admin_roles (feeder_id, role) VALUES ($1, 'moderator')`, [mod.id]);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/team", headers: mod.headers })).statusCode).toBe(200);
    const add = await app.inject({ method: "POST", url: "/api/v1/admin/team", headers: mod.headers, payload: { email: "x@example.com", role: "moderator" } });
    expect(add.statusCode).toBe(403);
  });

  it("a ward lead sees SOS cases in their wards only", async () => {
    const lead = await insertFeeder();
    await query(`INSERT INTO admin_roles (feeder_id, role, wards) VALUES ($1, 'ward_lead', '{K-East}')`, [lead.id]);
    const dog = await insertDog({ ward: "K-West" });
    const d = device();
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: d.token } });
    expect(rep.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/sos?state=all", headers: lead.headers });
    expect(list.json().data.cases.map((c: { id: string }) => c.id)).not.toContain(rep.json().data.caseId);
    const one = await app.inject({ method: "GET", url: `/api/v1/admin/sos/${rep.json().data.caseId}`, headers: lead.headers });
    expect(one.statusCode).toBe(404);
  });

  it("team: an invite by email is claimed when that address's account signs in, and audited", async () => {
    const owner = await insertOwner();
    const email = `rohan.${randomUUID().slice(0, 6)}@example.com`;
    const add = await app.inject({ method: "POST", url: "/api/v1/admin/team", headers: owner.headers, payload: { email, role: "moderator" } });
    expect(add.statusCode).toBe(201);
    expect(add.json().data).toEqual({ granted: false, invited: true });
    const rohan = await insertFeeder({ name: "Rohan Iyer", hmac: identityHmac(canonicalEmailAddress(email), config.HETJA_HMAC_PEPPER) });
    const me = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: rohan.headers });
    expect(me.json().data.adminRoles).toEqual(["moderator"]);
    const log = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'team.invite' AND actor_id = $1`, [owner.id]);
    expect(log.rows[0].n).toBeGreaterThan(0);
    const del = await app.inject({ method: "POST", url: `/api/v1/admin/team/${rohan.id}/remove`, headers: owner.headers, payload: { reason: "left" } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: rohan.headers })).statusCode).toBe(403);
    // The email itself is never stored.
    const leak = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE summary LIKE $1 OR detail::text LIKE $1`, [`%${email}%`]);
    expect(leak.rows[0].n).toBe(0);
  });

  it("audit CSV exports and neutralises spreadsheet formulas", async () => {
    const owner = await insertOwner();
    await query(`INSERT INTO audit_log (actor_kind, action, summary) VALUES ('system', 'test.csv', '=HYPERLINK(1)')`);
    const r = await app.inject({ method: "GET", url: "/api/v1/admin/audit.csv", headers: owner.headers });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.body).toContain("'=HYPERLINK(1)");
    const page = await app.inject({ method: "GET", url: "/api/v1/admin/audit?limit=2", headers: owner.headers });
    expect(page.json().data.entries.length).toBe(2);
  });
});

describe("documents", () => {
  it("encrypts at rest, streams only to admins, audits every open, refuses other types", async () => {
    const owner = await insertOwner();
    const vet = await insertFeeder({ name: "Dr Leena Pillai" });
    const up = await upload(vet, "certificate", PDF, "application/pdf");
    expect(up.statusCode).toBe(201);
    const id = up.json().data.id;
    // On disk: ciphertext only.
    const file = await readFile(join(docsDir, "documents", `${id}.bin`));
    expect(file.includes(Buffer.from("%PDF"))).toBe(false);
    const bad = await upload(vet, "certificate", Buffer.from("<html>not a pdf</html>"), "application/pdf");
    expect(bad.statusCode).toBe(400);
    const applied = await applyVet(vet);
    expect(applied.statusCode).toBe(201);
    const docs = (await app.inject({ method: "GET", url: `/api/v1/admin/vets/${applied.json().data.id}`, headers: owner.headers })).json().data.documents;
    const cert = docs.find((d: { kind: string }) => d.kind === "certificate");
    expect((await app.inject({ method: "GET", url: `/api/v1/admin/documents/${cert.id}`, headers: vet.headers })).statusCode).toBe(403);
    const got = await app.inject({ method: "GET", url: `/api/v1/admin/documents/${cert.id}`, headers: owner.headers });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("application/pdf");
    expect(got.rawPayload.equals(PDF)).toBe(true);
    const log = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'document.view' AND subject_id = $1`, [cert.id]);
    expect(log.rows[0].n).toBe(1);
  });

  it("answers 503 when HETJA_DOCS_KEY is not set", async () => {
    await app.close();
    app = buildServer({ ...config, HETJA_DOCS_KEY: "", STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir, DOCS_LOCAL_DIR: docsDir });
    await app.ready();
    const f = await insertFeeder();
    const r = await upload(f, "certificate", PDF, "application/pdf");
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("DOCUMENTS_UNAVAILABLE");
  });
});

describe("vets: apply, verify, sign with a passkey, correct, withdraw", () => {
  it("an application needs both documents; verify needs the register ticked", async () => {
    const owner = await insertOwner();
    const vet = await insertFeeder();
    const cert = (await upload(vet, "certificate", PDF, "application/pdf")).json().data.id;
    const noId = await app.inject({
      method: "POST",
      url: "/api/v1/vet/apply",
      headers: vet.headers,
      payload: { council: "MSVC", regNo: "5190", wards: ["K-West"], sosAvailable: false, publicPhone: "+91 98200 44410", documentIds: [cert] },
    });
    expect(noId.json().error.code).toBe("DOCUMENTS_REQUIRED");
    const thane = await applyVet(vet, { wards: ["Thane"] });
    expect(thane.json().error.code).toBe("INVALID_WARDS");
    const ok = await applyVet(vet);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.status).toBe("waiting");
    for (const l of V7_LIMITERS) l.reset();
    const again = await applyVet(vet);
    expect(again.statusCode).toBe(409);
    const noTick = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${ok.json().data.id}/verify`, headers: owner.headers, payload: {} });
    expect(noTick.json().error.code).toBe("REGISTER_CHECK_REQUIRED");
    const nf = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${ok.json().data.id}/not-on-register`, headers: owner.headers, payload: {} });
    expect(nf.json().data.registerNotFound).toBe(true);
    const v = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${ok.json().data.id}/verify`, headers: owner.headers, payload: { registerChecked: true } });
    expect(v.json().data).toMatchObject({ status: "verified", registerChecked: true, registerNotFound: false });
    // Documents are now on the 30-day deletion clock.
    const docs = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM documents WHERE owner_id = $1 AND delete_after > now() + interval '29 days'`,
      [ok.json().data.id],
    );
    expect(docs.rows[0].n).toBe(2);
    const me = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: vet.headers });
    expect(me.json().data.vet).toEqual({ status: "verified", regLabel: "MSVC 5190" });
  });

  it("signs a vaccination; the public list shows it vet signed with name, council and batch", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog({ ward: "K-West" });
    const r = await signRecord(vet, {
      dogSlug: dog.slug,
      type: "vaccination",
      vaccine: "Anti-rabies",
      brand: "Raksharab",
      batch: "RB2409",
      givenOn: "2026-09-12",
      dueOn: "2027-09-12",
    });
    expect(r.statusCode).toBe(201);
    const recordId = r.json().data.recordId;
    const row = await query<{ record_source: string; signed_by: string; record_hash: string; assertion: unknown }>(
      `SELECT record_source, signed_by, record_hash, assertion FROM medical_records WHERE id = $1`,
      [recordId],
    );
    expect(row.rows[0]).toMatchObject({ record_source: "vet_signed", signed_by: vet.id, record_hash: r.json().data.recordHash });
    expect(row.rows[0].assertion).toBeTruthy();
    const health = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` });
    expect(health.statusCode).toBe(200);
    expect(health.json().data.viewerIsVet).toBe(false);
    expect(health.json().data.certificateUrl).toBe(`https://hetja.in/vet/${dog.slug}/certificate`);
    expect(health.json().data.records[0]).toMatchObject({
      id: recordId,
      type: "vaccination",
      title: "Anti-rabies",
      status: "vet_signed",
      date: "2026-09-12",
      dueOn: "2027-09-12",
      brand: "Raksharab",
      batch: "RB2409",
      vet: { name: "Dr Farhan Qureshi", council: "MSVC", regNo: "5190" },
    });
    // A bad token is ignored, not a 401; a vet's token says viewerIsVet.
    const bad = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health`, headers: { authorization: "Bearer nope" } });
    expect(bad.statusCode).toBe(200);
    const asVet = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health`, headers: vet.headers });
    expect(asVet.json().data.viewerIsVet).toBe(true);
    const profile = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` });
    expect(profile.json().data.vaccinated).toBe("yes");
  });

  it("a changed draft, a reused challenge and another vet's record are all refused", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const other = await verifiedVet(owner, "Dr Leena Pillai");
    const dog = await insertDog();
    const record = { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", batch: "RB2409", givenOn: "2026-09-12" };
    const o = (await app.inject({ method: "POST", url: "/api/v1/vet/records/options", headers: vet.headers, payload: { record } })).json().data;
    const assertion = vet.auth.assert(o.options.challenge);
    const swapped = await app.inject({
      method: "POST",
      url: "/api/v1/vet/records",
      headers: vet.headers,
      payload: { challengeId: o.challengeId, record: { ...record, batch: "RB9999" }, assertion },
    });
    expect(swapped.json().error.code).toBe("CHALLENGE_MISMATCH");
    const ok = await app.inject({ method: "POST", url: "/api/v1/vet/records", headers: vet.headers, payload: { challengeId: o.challengeId, record, assertion } });
    expect(ok.statusCode).toBe(201);
    const replay = await app.inject({ method: "POST", url: "/api/v1/vet/records", headers: vet.headers, payload: { challengeId: o.challengeId, record, assertion } });
    expect(replay.statusCode).toBe(400);
    const correctOther = await signRecord(other, { ...record, batch: "RB2419", supersedes: ok.json().data.recordId, reason: "typo" });
    expect(correctOther.statusCode).toBe(403);
    // An assertion without user verification does not verify.
    const o2 = (await app.inject({ method: "POST", url: "/api/v1/vet/records/options", headers: vet.headers, payload: { record: { ...record, batch: "B2" } } })).json().data;
    const noUv = await app.inject({
      method: "POST",
      url: "/api/v1/vet/records",
      headers: vet.headers,
      payload: { challengeId: o2.challengeId, record: { ...record, batch: "B2" }, assertion: vet.auth.assert(o2.options.challenge, { uv: false }) },
    });
    expect(noUv.json().error.code).toBe("BAD_SIGNATURE");
  });

  it("corrections append with supersedes; a withdrawal takes the badge off; nothing is updated", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog();
    const first = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", batch: "RB2409", givenOn: "2026-09-12" });
    const firstId = first.json().data.recordId;
    const fix = await signRecord(vet, {
      dogSlug: dog.slug,
      type: "vaccination",
      vaccine: "Anti-rabies",
      batch: "RB2419",
      givenOn: "2026-09-12",
      supersedes: firstId,
      reason: "Typo in batch number. Checked the vial box.",
    });
    expect(fix.statusCode).toBe(201);
    const twice = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", batch: "X", givenOn: "2026-09-12", supersedes: firstId, reason: "again" });
    expect(twice.statusCode).toBe(409);
    const w = await signRecord(vet, { dogSlug: dog.slug, type: "withdrawal", supersedes: fix.json().data.recordId, reason: "Not vaccinated by me." });
    expect(w.statusCode).toBe(201);
    const recs = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data.records;
    expect(recs.map((r: { type: string }) => r.type)).toEqual(["vaccination", "vaccination", "withdrawal"]);
    expect(recs[1]).toMatchObject({ supersedes: firstId, reason: "Typo in batch number. Checked the vial box." });
    expect(recs[1].withdrawnAt).not.toBeNull();
    expect(recs[2].withdraws).toBe(fix.json().data.recordId);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.vaccinated).toBe("unknown");
    const mine = (await app.inject({ method: "GET", url: "/api/v1/vet/signatures", headers: vet.headers })).json().data.signatures;
    expect(mine.map((s: { status: string }) => s.status).sort()).toEqual(["corrected", "valid", "withdrawn"]);
    const one = await app.inject({ method: "GET", url: `/api/v1/vet/signatures/${firstId}`, headers: vet.headers });
    expect(one.json().data.status).toBe("corrected");
    const audits = await query<{ action: string }>(`SELECT action FROM audit_log WHERE actor_id = $1 AND action LIKE 'vet.%' ORDER BY at`, [vet.id]);
    expect(audits.rows.map((a) => a.action)).toEqual(expect.arrayContaining(["vet.sign", "vet.correct", "vet.withdraw"]));
  });

  it("a suspended vet cannot sign, and their vet page is no ground to take a case", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const s = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/suspend`, headers: owner.headers, payload: { reason: "registration lapsed" } });
    expect(s.json().data.status).toBe("suspended");
    const dog = await insertDog();
    const sign = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", givenOn: "2026-09-12" });
    expect(sign.json().error.code).toBe("VET_NOT_VERIFIED");
    const d = device();
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: d.token } });
    const caseId = rep.json().data.caseId;
    await query(`INSERT INTO sos_notifications (case_id, feeder_id, channel, route) VALUES ($1, $2, 'push', 'vet_escalation')`, [caseId, vet.id]);
    const ack = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: vet.headers });
    expect(ack.statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/reinstate`, headers: owner.headers, payload: {} });
    const ack2 = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: vet.headers });
    expect(ack2.statusCode).toBe(200);
  });

  it("removal can flag past signatures for re-check; a moderator cannot remove", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog();
    await signRecord(vet, { dogSlug: dog.slug, type: "sterilisation", givenOn: "2026-04-01", earNotched: true });
    const mod = await insertFeeder();
    await query(`INSERT INTO admin_roles (feeder_id, role) VALUES ($1, 'moderator')`, [mod.id]);
    const byMod = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/remove`, headers: mod.headers, payload: { reason: "fraud", signatures: "flag" } });
    expect(byMod.statusCode).toBe(403);
    const rm = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/remove`, headers: owner.headers, payload: { reason: "fraud", signatures: "flag" } });
    expect(rm.json().data).toMatchObject({ status: "removed", signaturesFlagged: true });
    const recs = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data.records;
    expect(recs[0]).toMatchObject({ status: "vet_signed", flagged: true, earNotched: true });
  });

  it("feeder notes, 'Ask a vet to sign', and signing the request confirms the note", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const priya = await insertFeeder({ name: "Priya Sharma" });
    const dog = await insertDog({ registeredBy: priya.id });
    const stranger = await insertFeeder();
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/health-notes`, headers: stranger.headers, payload: { type: "deworming", date: "2026-08-03" } })).statusCode,
    ).toBe(403);
    const note = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/health-notes`,
      headers: priya.headers,
      payload: { type: "vaccination", vaccine: "Anti-rabies", date: "2026-09-12" },
    });
    expect(note.statusCode).toBe(201);
    const recordId = note.json().data.recordId;
    const ask = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/sign-requests`, headers: priya.headers, payload: { recordId, vetFeederId: vet.id } });
    expect(ask.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/sign-requests`, headers: priya.headers, payload: { recordId } });
    expect(dup.statusCode).toBe(409);
    const home = await app.inject({ method: "GET", url: "/api/v1/vet/home", headers: vet.headers });
    expect(home.json().data.signRequests[0]).toMatchObject({ id: ask.json().data.id, requestedBy: "Priya", proposed: { type: "vaccination", givenOn: "2026-09-12" } });
    const view = await app.inject({ method: "GET", url: `/api/v1/vet/dogs/${dog.slug}`, headers: vet.headers });
    expect(view.json().data.notesToConfirm[0].id).toBe(recordId);
    const signed = await signRecord(vet, {
      dogSlug: dog.slug,
      type: "vaccination",
      vaccine: "Anti-rabies",
      batch: "RB2409",
      givenOn: "2026-09-12",
      signRequestId: ask.json().data.id,
    });
    expect(signed.statusCode).toBe(201);
    const recs = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data.records;
    const noteRow = recs.find((r: { id: string }) => r.id === recordId);
    const vetRow = recs.find((r: { id: string }) => r.id === signed.json().data.recordId);
    expect(noteRow).toMatchObject({ status: "feeder_noted", addedBy: "Priya" });
    expect(noteRow.confirmedAt).not.toBeNull();
    expect(vetRow).toMatchObject({ confirms: recordId, supersedes: recordId });
    const req = await app.inject({ method: "GET", url: `/api/v1/vet/sign-requests/${ask.json().data.id}`, headers: vet.headers });
    expect(req.json().data.status).toBe("signed");
    const push = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE kind = 'send_feeder_push' AND payload->>'title' = 'Signed by a vet' AND payload::text LIKE $1`,
      [`%${priya.id}%`],
    );
    expect(push.rows[0].n).toBe(1);
  });

  it("a vaccine sticker photo is private to the record", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const priya = await insertFeeder();
    const dog = await insertDog({ registeredBy: priya.id });
    const up = await app.inject({ method: "POST", url: "/api/v1/vet/record-photos", headers: vet.headers, payload: { base64: jpeg().toString("base64") } });
    expect(up.statusCode).toBe(201);
    const s = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "DHPPi", givenOn: "2026-09-20", photoId: up.json().data.photoId });
    expect(s.statusCode).toBe(201);
    const rec = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data.records[0];
    expect(rec.hasPhoto).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/v1/api${rec.photoPath}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1${rec.photoPath}` })).statusCode).toBe(401);
    const stranger = await insertFeeder();
    expect((await app.inject({ method: "GET", url: `/api/v1${rec.photoPath}`, headers: stranger.headers })).statusCode).toBe(403);
    const mine = await app.inject({ method: "GET", url: `/api/v1${rec.photoPath}`, headers: priya.headers });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["content-type"]).toBe("image/jpeg");
  });

  it("vet search stays in the vet's wards", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const name = `Moti${randomUUID().slice(0, 4)}`;
    await insertDog({ ward: "K-West", name });
    await insertDog({ ward: "A", name });
    const r = await app.inject({ method: "GET", url: `/api/v1/vet/dogs?q=${name}`, headers: vet.headers });
    expect(r.json().data.dogs.map((d: { wardId: string }) => d.wardId)).toEqual(["K-West"]);
    const feeder = await insertFeeder();
    expect((await app.inject({ method: "GET", url: `/api/v1/vet/dogs?q=${name}`, headers: feeder.headers })).statusCode).toBe(403);
  });
});

describe("professionals are public; government is free", () => {
  it("a verified vet's public number shows in the ward list and on the SOS answer", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const cp = await query<{ id: string }>(
      `INSERT INTO care_providers (name, kind, cost_tier, phone_e164, geo, source, is_government, is_person, reg_no, wards)
       VALUES ($1, 'govt', 'free', NULL, ST_SetSRID(ST_MakePoint(72.83, 19.12), 4326)::geography, 'test-v7', TRUE, TRUE, '5190', '{K-West}')
       RETURNING id`,
      [`Govt Vet ${randomUUID().slice(0, 6)}`],
    );
    const link = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/link-care`, headers: owner.headers, payload: { careProviderId: cp.rows[0].id } });
    expect(link.statusCode).toBe(200);
    const pros = await app.inject({ method: "GET", url: "/api/v1/wards/K-West/professionals" });
    const me = pros.json().data.vets.find((v: { feederId: string }) => v.feederId === vet.id);
    expect(me).toMatchObject({ publicPhone: "+919820044410", regLabel: "MSVC 5190", isGovernment: true, costTier: "free" });
    const dog = await insertDog();
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } });
    expect(rep.json().data.professionals.vets.some((v: { feederId: string }) => v.feederId === vet.id)).toBe(true);
    const care = await app.inject({ method: "GET", url: "/api/v1/care?lat=19.12&lng=72.83&max_km=3" });
    const row = care.json().data.providers.find((p: { id: string }) => p.id === cp.rows[0].id);
    expect(row).toMatchObject({ isGovernment: true, isPerson: true, regNo: "5190", costTier: "free" });
    await query(`UPDATE vet_profiles SET care_provider_id = NULL WHERE care_provider_id = $1`, [cp.rows[0].id]);
    await query(`DELETE FROM care_providers WHERE id = $1`, [cp.rows[0].id]);
  });
});

describe("NGOs and SOS routing", () => {
  it("routes an SOS to the NGO's coordinators, queues the vets' turn, and a dispatched member takes it with the ordinary ack", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder({ name: "Kavita Nair" });
    const ngoId = await activeNgo(owner, kavita);
    const rahul = await insertFeeder({ name: "Rahul M" });
    await query(`INSERT INTO ngo_members (ngo_id, feeder_id, role, has_transport) VALUES ($1, $2, 'rescue', TRUE)`, [ngoId, rahul.id]);
    const dog = await insertDog({ ward: "K-West" });
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } });
    const caseId = rep.json().data.caseId;
    const n = await query<{ feeder_id: string; route: string }>(`SELECT feeder_id, route FROM sos_notifications WHERE case_id = $1 AND route IS NOT NULL`, [caseId]);
    expect(n.rows).toEqual([{ feeder_id: kavita.id, route: "ngo_coordinator" }]);
    const job = await query<{ mins: number }>(
      `SELECT round(extract(epoch FROM run_after - now()) / 60)::int AS mins FROM jobs WHERE kind = 'sos_open_to_vets' AND payload->>'caseId' = $1`,
      [caseId],
    );
    expect(job.rows[0].mins).toBeGreaterThanOrEqual(14);
    const home = await app.inject({ method: "GET", url: "/api/v1/ngo/home", headers: kavita.headers });
    expect(home.json().data.sos.map((s: { caseId: string }) => s.caseId)).toContain(caseId);
    const cands = await app.inject({ method: "GET", url: `/api/v1/ngo/sos/${caseId}/candidates`, headers: kavita.headers });
    const rahulRow = cands.json().data.candidates.find((c: { feederId: string }) => c.feederId === rahul.id);
    expect(rahulRow).toMatchObject({ hasTransport: true, kind: "member" });
    expect(JSON.stringify(cands.json())).not.toMatch(/"lat"|"lng"/);
    // A volunteer cannot dispatch.
    expect((await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: rahul.headers, payload: { feederId: rahul.id } })).statusCode).toBe(403);
    const stranger = await insertFeeder();
    const notMember = await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: stranger.id } });
    expect(notMember.json().error.code).toBe("NOT_A_MEMBER");
    const d = await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: rahul.id, withAmbulance: true } });
    expect(d.statusCode).toBe(201);
    // The case page lets Rahul in on the dispatch, and the normal ack works (trust 30 would not).
    expect((await app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: rahul.headers })).statusCode).toBe(200);
    const ack = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: rahul.headers });
    expect(ack.statusCode).toBe(200);
    const disp = await query<{ accepted_at: Date | null }>(`SELECT accepted_at FROM sos_dispatches WHERE id = $1`, [d.json().data.id]);
    expect(disp.rows[0].accepted_at).not.toBeNull();
    const ngo = (await app.inject({ method: "GET", url: "/api/v1/ngo/me", headers: kavita.headers })).json().data.ngo;
    expect(ngo.ambulance.status).toBe("out");
    // Once taken, the vets' turn does nothing.
    const paged = await withTx((c) => openCaseToVets(c, caseId));
    expect(paged).toBe(0);
  });

  it("a paused NGO gets no routing; passing opens the case to vets at once", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    await app.inject({ method: "POST", url: `/api/v1/admin/ngos/${ngoId}/pause`, headers: owner.headers, payload: { reason: "paperwork" } });
    const vet = await verifiedVet(owner);
    const dog = await insertDog({ ward: "K-West" });
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } });
    const caseId = rep.json().data.caseId;
    const coord = await query(`SELECT 1 FROM sos_notifications WHERE case_id = $1 AND route = 'ngo_coordinator'`, [caseId]);
    expect(coord.rowCount).toBe(0);
    await app.inject({ method: "POST", url: `/api/v1/admin/ngos/${ngoId}/resume`, headers: owner.headers, payload: {} });
    const pass = await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/pass`, headers: kavita.headers, payload: {} });
    expect(pass.statusCode).toBe(200);
    const v = await query<{ route: string }>(`SELECT route FROM sos_notifications WHERE case_id = $1 AND feeder_id = $2`, [caseId, vet.id]);
    expect(v.rows[0].route).toBe("vet_escalation");
  });

  it("team: invite, vouch, role changes; registration needs the certificate and Mumbai wards", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/ngo/register",
      headers: kavita.headers,
      payload: {
        name: "Thane Street Dogs",
        regType: "trust",
        regNo: "T-1",
        wards: ["Thane"],
        offers: { ambulance: false, shelterBeds: false, sterilisation: false, collars: false },
        contactName: "X",
        publicPhone: "+91 98200 00000",
        documentIds: [randomUUID()],
      },
    });
    expect(bad.json().error.code).toBe("INVALID_WARDS");
    const ngoId = await activeNgo(owner, kavita);
    const email = `imran.${randomUUID().slice(0, 6)}@example.com`;
    const inv = await app.inject({ method: "POST", url: "/api/v1/ngo/team/invite", headers: kavita.headers, payload: { email, role: "collars" } });
    expect(inv.statusCode).toBe(201);
    const imran = await insertFeeder({ hmac: identityHmac(canonicalEmailAddress(email), config.HETJA_HMAC_PEPPER) });
    const me = await app.inject({ method: "GET", url: "/api/v1/ngo/me", headers: imran.headers });
    expect(me.json().data).toMatchObject({ role: "collars", ngo: { id: ngoId } });
    const vet = await insertFeeder();
    const applied = await applyVet(vet, { ngoId });
    expect(applied.statusCode).toBe(201);
    const vouch = await app.inject({ method: "POST", url: `/api/v1/ngo/vets/${vet.id}/vouch`, headers: kavita.headers, payload: {} });
    expect(vouch.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/vets?status=waiting", headers: owner.headers });
    expect(list.json().data.vets.find((v: { feederId: string }) => v.feederId === vet.id).vouched).toBe(true);
    const lastCoord = await app.inject({ method: "PATCH", url: `/api/v1/ngo/team/${kavita.id}`, headers: kavita.headers, payload: { role: "volunteer" } });
    expect(lastCoord.json().error.code).toBe("LAST_COORDINATOR");
    const wards = await app.inject({ method: "PATCH", url: "/api/v1/ngo/me", headers: kavita.headers, payload: { wards: ["K-West", "K-East"], hours: "9 am to 7 pm" } });
    expect(wards.json().data).toMatchObject({ wards: ["K-West", "K-East"], hours: "9 am to 7 pm" });
    const log = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ngo.edit' AND subject_id = $1`, [ngoId]);
    expect(log.rows[0].n).toBeGreaterThan(0);
  });

  it("drives: create with collars packed, add dogs, vaccination is checked off only by a signature, finish", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    const vet = await verifiedVet(owner);
    await query(`INSERT INTO ngo_vets (ngo_id, vet_feeder_id) VALUES ($1, $2)`, [ngoId, vet.id]);
    const dog = await insertDog({ ward: "K-West" });
    const drive = await app.inject({
      method: "POST",
      url: "/api/v1/ngo/drives",
      headers: kavita.headers,
      payload: { title: "Aram Nagar drive", wardId: "K-West", date: "2026-09-27", time: "07:00", leadVetFeederId: vet.id, collarsPacked: 12, dogs: [{ slug: dog.slug, tasks: { collar: true, vaccinate: true } }] },
    });
    expect(drive.statusCode).toBe(201);
    const d = drive.json().data;
    expect(d).toMatchObject({ collarsPacked: 12, dogs: 1, state: "planned" });
    const dd = d.dogList[0].id;
    const tick = await app.inject({ method: "PATCH", url: `/api/v1/ngo/drives/${d.id}/dogs/${dd}`, headers: kavita.headers, payload: { done: { vaccinate: true } } });
    expect(tick.json().error.code).toBe("VACCINATION_NEEDS_VET");
    const collar = await app.inject({ method: "PATCH", url: `/api/v1/ngo/drives/${d.id}/dogs/${dd}`, headers: kavita.headers, payload: { done: { collar: true } } });
    expect(collar.json().data.done.collar).toBe(true);
    const s = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", givenOn: "2026-09-20", driveDogId: dd });
    expect(s.statusCode).toBe(201);
    const after = await app.inject({ method: "GET", url: `/api/v1/ngo/drives/${d.id}`, headers: kavita.headers });
    expect(after.json().data.dogList[0].done).toEqual({ collar: true, vaccinate: true, sterilise: false });
    const fin = await app.inject({ method: "POST", url: `/api/v1/ngo/drives/${d.id}/finish`, headers: kavita.headers, payload: {} });
    expect(fin.json().data.state).toBe("finished");
  });
});

describe("drives: registration during a drive, signing from the drive page", () => {
  it("a member registers a dog into the drive (collar task, pending); a stranger cannot; signing with driveId ticks vaccinate", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    const vet = await verifiedVet(owner);
    await query(`INSERT INTO ngo_vets (ngo_id, vet_feeder_id) VALUES ($1, $2)`, [ngoId, vet.id]);
    const drive = (
      await app.inject({ method: "POST", url: "/api/v1/ngo/drives", headers: kavita.headers, payload: { wardId: "K-West", date: "2026-09-27", time: "07:00" } })
    ).json().data;
    await query(`UPDATE feeders SET role = 'registrator' WHERE id = ANY($1::uuid[])`, [[kavita.id]]);
    const outsider = await insertFeeder({ role: "registrator" });
    const dev = device();
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { ...outsider.headers, "x-device-token": dev.token },
      payload: { wardId: "K-West", name: "Golu", driveId: drive.id },
    });
    expect(refused.json().error.code).toBe("NOT_DRIVE_MEMBER");
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { ...kavita.headers, "x-device-token": device().token },
      payload: { wardId: "K-West", name: "Golu", driveId: drive.id },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().data.driveDogId).toBeTruthy();
    const slug = reg.json().data.slug;
    dogs.push((await query<{ id: string }>(`SELECT id FROM dogs WHERE slug = $1`, [slug])).rows[0].id);
    const d1 = (await app.inject({ method: "GET", url: `/api/v1/ngo/drives/${drive.id}`, headers: kavita.headers })).json().data;
    expect(d1.dogList[0]).toMatchObject({ tasks: { collar: true, vaccinate: false }, registrationStatus: "pending_activation" });
    // A public dog signed from the drive page: added to the drive and ticked.
    const sheru = await insertDog({ ward: "K-West", name: "Sheru" });
    const s = await signRecord(vet, { dogSlug: sheru.slug, type: "vaccination", vaccine: "Anti-rabies", givenOn: "2026-09-20", driveId: drive.id });
    expect(s.statusCode).toBe(201);
    const d2 = (await app.inject({ method: "GET", url: `/api/v1/ngo/drives/${drive.id}`, headers: kavita.headers })).json().data;
    const row = d2.dogList.find((x: { dog: { slug: string } }) => x.dog.slug === sheru.slug);
    expect(row).toMatchObject({ tasks: { vaccinate: true }, done: { vaccinate: true }, registrationStatus: "active" });
    const outsiderVet = await verifiedVet(owner, "Dr Other");
    const no = await signRecord(outsiderVet, { dogSlug: sheru.slug, type: "vaccination", vaccine: "DHPPi", givenOn: "2026-09-20", driveId: drive.id });
    expect(no.json().error.code).toBe("INVALID_DRIVE");
  });

  it("the dispatch accept endpoint takes the case as the member; a second accept elsewhere is refused", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    const rahul = await insertFeeder({ name: "Rahul" });
    await query(`INSERT INTO ngo_members (ngo_id, feeder_id, role) VALUES ($1, $2, 'rescue')`, [ngoId, rahul.id]);
    const dog = await insertDog({ ward: "K-West" });
    const caseId = (await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } })).json().data.caseId;
    const d = (await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: rahul.id, etaMin: 12 } })).json().data;
    const mine = await app.inject({ method: "GET", url: "/api/v1/ngo/dispatches/mine", headers: rahul.headers });
    expect(mine.json().data.dispatches[0]).toMatchObject({ id: d.id, etaMin: 12, caseState: "open" });
    expect((await app.inject({ method: "POST", url: `/api/v1/ngo/dispatches/${d.id}/accept`, headers: kavita.headers, payload: {} })).statusCode).toBe(404);
    const acc = await app.inject({ method: "POST", url: `/api/v1/ngo/dispatches/${d.id}/accept`, headers: rahul.headers, payload: {} });
    expect(acc.statusCode).toBe(200);
    const c = await query<{ acked_by: string }>(`SELECT acked_by FROM sos_cases WHERE id = $1`, [caseId]);
    expect(c.rows[0].acked_by).toBe(rahul.id);
    const home = await app.inject({ method: "GET", url: "/api/v1/ngo/home", headers: kavita.headers });
    expect(home.json().data.sos.find((x: { caseId: string }) => x.caseId === caseId)).toMatchObject({ assigned: { accepted: true, etaMin: 12 }, takenBy: "Rahul" });
  });
});

describe("avatars", () => {
  it("matches by dog ID or collar batch number, publishes, replaces and restores", async () => {
    const owner = await insertOwner();
    const rani = await insertDog({ name: "Rani" });
    const batchNo = `HJ-${Math.floor(Math.random() * 90000) + 10000}`;
    const kalu = await insertDog({ name: "Kalu", batchNo });
    const batch = (await app.inject({ method: "POST", url: "/api/v1/admin/avatars/batches", headers: owner.headers, payload: {} })).json().data;
    const up = (fileName: string) =>
      app.inject({ method: "POST", url: `/api/v1/admin/avatars/batches/${batch.id}/files`, headers: owner.headers, payload: { fileName, imageBase64: jpeg().toString("base64") } });
    const a = await up(`${rani.slug.slice(0, 3)}-${rani.slug.slice(3, 6)}-${rani.slug.slice(6)}.PNG`);
    expect(a.json().data).toMatchObject({ match: "id", dog: { slug: rani.slug } });
    const b = await up(`${batchNo}.png`);
    expect(b.json().data).toMatchObject({ match: "collar", dog: { slug: kalu.slug } });
    const c = await up("IMG_2231.png");
    expect(c.json().data).toMatchObject({ match: "none", dog: null });
    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/avatars/batches/${batch.id}`, headers: owner.headers });
    expect(detail.json().data.counts).toMatchObject({ all: 3, byId: 1, byCollar: 1, noMatch: 1 });
    const pub = await app.inject({ method: "POST", url: `/api/v1/admin/avatars/batches/${batch.id}/publish`, headers: owner.headers, payload: {} });
    expect(pub.json().data.published).toBe(2);
    const page = await app.inject({ method: "GET", url: `/api/v1/dogs/${rani.slug}` });
    expect(page.json().data.avatarUrl).toMatch(/photos\//);
    // A second avatar for Rani replaces the first, which can be restored.
    const batch2 = (await app.inject({ method: "POST", url: "/api/v1/admin/avatars/batches", headers: owner.headers, payload: {} })).json().data;
    const again = await app.inject({ method: "POST", url: `/api/v1/admin/avatars/batches/${batch2.id}/files`, headers: owner.headers, payload: { fileName: `${rani.slug}.png`, imageBase64: jpeg().toString("base64") } });
    expect(again.json().data.replacesExisting).toBe(true);
    await app.inject({ method: "POST", url: `/api/v1/admin/avatars/${again.json().data.id}/publish`, headers: owner.headers, payload: {} });
    const restore = await app.inject({ method: "POST", url: `/api/v1/admin/avatars/${a.json().data.id}/restore`, headers: owner.headers, payload: {} });
    expect(restore.json().data.status).toBe("published");
    const live = await query<{ n: number }>(`SELECT count(*)::int AS n FROM dog_avatars WHERE dog_id = $1 AND status = 'published'`, [rani.id]);
    expect(live.rows[0].n).toBe(1);
  });
});

describe("merging duplicate dogs", () => {
  it("redirects the merged slug, moves feeds, keeps both ledgers, makes the registrator a feeder", async () => {
    const owner = await insertOwner();
    const priya = await insertFeeder({ name: "Priya" });
    const imran = await insertFeeder({ name: "Imran" });
    const kalu = await insertDog({ name: "Kalu", registeredBy: priya.id });
    const kaalu = await insertDog({ name: "Kaalu", registeredBy: imran.id });
    await feed(kalu.id, priya.id);
    await feed(kaalu.id, imran.id);
    const note = await app.inject({ method: "POST", url: `/api/v1/dogs/${kaalu.slug}/health-notes`, headers: imran.headers, payload: { type: "deworming", date: "2026-08-03" } });
    expect(note.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: `/api/v1/dogs/${kalu.slug}/problems`, headers: priya.headers, payload: { kind: "duplicate", otherSlug: kaalu.slug } });
    expect(dup.statusCode).toBe(201);
    const cands = await app.inject({ method: "GET", url: "/api/v1/admin/duplicates", headers: owner.headers });
    expect(cands.json().data.candidates.some((c: { reason: string; a: { slug: string } }) => c.reason === "report" && c.a.slug === kalu.slug)).toBe(true);
    const m = await app.inject({ method: "POST", url: "/api/v1/admin/dogs/merge", headers: owner.headers, payload: { keepSlug: kalu.slug, mergeSlug: kaalu.slug } });
    expect(m.statusCode).toBe(200);
    expect(m.json().data).toMatchObject({ feeds: 2, feedersAdded: 1 });
    const page = await app.inject({ method: "GET", url: `/api/v1/dogs/${kaalu.slug}` });
    expect(page.json().data).toMatchObject({ slug: kalu.slug, name: "Kalu", mergedFrom: { slug: kaalu.slug, name: "Kaalu" } });
    const health = (await app.inject({ method: "GET", url: `/api/v1/dogs/${kalu.slug}/health` })).json().data.records;
    expect(health.map((r: { id: string }) => r.id)).toContain(note.json().data.recordId);
    // Imran is a feeder of Kalu now: he may note care on it.
    const imranNote = await app.inject({ method: "POST", url: `/api/v1/dogs/${kalu.slug}/health-notes`, headers: imran.headers, payload: { type: "other", title: "Limp", date: "2026-09-01" } });
    expect(imranNote.statusCode).toBe(201);
    const again = await app.inject({ method: "POST", url: "/api/v1/admin/dogs/merge", headers: owner.headers, payload: { keepSlug: kalu.slug, mergeSlug: kaalu.slug } });
    expect(again.statusCode).toBe(409);
    const reportState = await query<{ outcome: string }>(`SELECT outcome FROM reports WHERE id = $1`, [dup.json().data.id]);
    expect(reportState.rows[0].outcome).toBe("merged");
  });

  it("'They're different dogs' dismisses the pair", async () => {
    const owner = await insertOwner();
    const a = await insertDog({ name: `Sheru${randomUUID().slice(0, 3)}`, ward: "T" });
    const b = await insertDog({ name: "Sheruu", ward: "T" });
    const r = await app.inject({ method: "POST", url: "/api/v1/admin/duplicates/dismiss", headers: owner.headers, payload: { aSlug: a.slug, bSlug: b.slug } });
    expect(r.statusCode).toBe(200);
    const c = await app.inject({ method: "GET", url: "/api/v1/admin/duplicates", headers: owner.headers });
    expect(c.json().data.candidates.some((x: { a: { slug: string }; b: { slug: string } }) => [x.a.slug, x.b.slug].includes(a.slug) && [x.a.slug, x.b.slug].includes(b.slug))).toBe(false);
  });
});

describe("reports and the D13 moderation tools", () => {
  it("Report a problem: device token, 24 h dedupe, per-subject limit; a photo report can take the photo down", async () => {
    const owner = await insertOwner();
    const priya = await insertFeeder();
    const dog = await insertDog({ registeredBy: priya.id });
    const scanId = await feed(dog.id, priya.id, "photos/test-rani.jpg");
    const d = device();
    const h = { "x-device-token": d.token };
    const first = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/problems`, headers: h, payload: { kind: "photo", note: "not her" } });
    expect(first.statusCode).toBe(201);
    const repeat = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/problems`, headers: h, payload: { kind: "photo" } });
    expect(repeat.json().data).toEqual({ id: first.json().data.id, created: false });
    expect((await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/problems`, payload: { kind: "other" } })).statusCode).toBe(401);
    for (let i = 0; i < 3; i++) await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/problems`, headers: h, payload: { kind: "other" } });
    const limited = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/problems`, headers: h, payload: { kind: "other" } });
    expect(limited.statusCode).toBe(429);
    const reports = await app.inject({ method: "GET", url: "/api/v1/admin/reports", headers: owner.headers });
    const row = reports.json().data.reports.find((r: { id: string }) => r.id === first.json().data.id);
    expect(row).toMatchObject({ kind: "photo", scanId });
    const hide = await app.inject({ method: "POST", url: `/api/v1/admin/photos/${scanId}/hide`, headers: owner.headers, payload: { reason: "wrong dog" } });
    expect(hide.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.photoKey).toBeNull();
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/reports/${first.json().data.id}/resolve`, headers: owner.headers, payload: { outcome: "photo_removed" } });
    expect(res.json().data.status).toBe("resolved");
  });

  it("an admin closes a tag report as a fake tag, and the tag review lifts", async () => {
    const owner = await insertOwner();
    const dog = await insertDog();
    await query(`UPDATE dogs SET tag_review_since = now() WHERE id = $1`, [dog.id]);
    const t = await query<{ id: string }>(`INSERT INTO tag_reports (dog_id, kind) VALUES ($1, 'wrong_dog') RETURNING id`, [dog.id]);
    const r = await app.inject({ method: "POST", url: `/api/v1/admin/tag-reports/${t.rows[0].id}/resolve`, headers: owner.headers, payload: { outcome: "fake_tag" } });
    expect(r.json().data.outcome).toBe("fake_tag");
    const d = await query<{ tag_review_since: Date | null }>(`SELECT tag_review_since FROM dogs WHERE id = $1`, [dog.id]);
    expect(d.rows[0].tag_review_since).toBeNull();
  });

  it("suspending an account refuses its writes, keeps its reads, and releases its cases", async () => {
    const owner = await insertOwner();
    const f = await insertFeeder({ trust: 90, sosOptIn: true });
    const dog = await insertDog();
    const s = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${f.id}/suspend`, headers: owner.headers, payload: { reason: "spam" } });
    expect(s.statusCode).toBe(200);
    const scan = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: f.headers,
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "feed", capturedAt: new Date().toISOString() },
    });
    expect(scan.json().error.code).toBe("ACCOUNT_SUSPENDED");
    const note = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/health-notes`, headers: f.headers, payload: { type: "deworming", date: "2026-08-03" } });
    expect(note.json().error.code).toBe("ACCOUNT_SUSPENDED");
    expect((await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: f.headers })).statusCode).toBe(200);
    const self = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${owner.id}/suspend`, headers: owner.headers, payload: { reason: "oops" } });
    expect(self.statusCode).toBe(409);
    const un = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${f.id}/unsuspend`, headers: owner.headers, payload: { reason: "appealed" } });
    expect(un.json().data.suspended).toBe(false);
  });

  it("a blocked device files no tag or problem reports, and its SOS pages nobody but still gets numbers", async () => {
    const owner = await insertOwner();
    const priya = await insertFeeder({ trust: 90, sosOptIn: true, wards: ["K-West"] });
    const dog = await insertDog({ registeredBy: priya.id });
    const d = device();
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "minor", deviceToken: d.token } });
    const caseId = rep.json().data.caseId;
    const block = await app.inject({ method: "POST", url: "/api/v1/admin/devices/block", headers: owner.headers, payload: { caseId, reason: "abuse" } });
    expect(block.statusCode).toBe(200);
    const tag = await app.inject({ method: "POST", url: `/api/v1/dogs/${dog.slug}/tag-reports`, headers: { "x-device-token": d.token }, payload: { kind: "damaged" } });
    expect(tag.json().error.code).toBe("DEVICE_BLOCKED");
    const dog2 = await insertDog({ registeredBy: priya.id });
    const second = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog2.slug, severity: "critical", deviceToken: d.token } });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.fanout).toBe("escalated");
    const told = await query<{ n: number }>(`SELECT count(*)::int AS n FROM sos_notifications WHERE case_id = $1`, [second.json().data.caseId]);
    expect(told.rows[0].n).toBe(0);
    const ref = block.json().data.deviceRef;
    const un = await app.inject({ method: "POST", url: "/api/v1/admin/devices/unblock", headers: owner.headers, payload: { deviceRef: ref } });
    expect(un.statusCode).toBe(200);
  });

  it("assign a vet from A1: the vet is paged and can take the case", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog({ ward: "A" });
    const rep = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } });
    const caseId = rep.json().data.caseId;
    const vets = await app.inject({ method: "GET", url: `/api/v1/admin/sos/${caseId}/vets`, headers: owner.headers });
    expect(vets.json().data.vets.find((v: { feederId: string }) => v.feederId === vet.id).coversWard).toBe(false);
    const as = await app.inject({ method: "POST", url: `/api/v1/admin/sos/${caseId}/assign-vet`, headers: owner.headers, payload: { vetFeederId: vet.id } });
    expect(as.statusCode).toBe(201);
    const ack = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack`, headers: vet.headers });
    expect(ack.statusCode).toBe(200);
    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/sos/${caseId}`, headers: owner.headers });
    expect(detail.json().data).toMatchObject({ state: "acked", assignedVet: { feederId: vet.id } });
  });
});


// ---------------------------------------------------------------------------
// Pre-deploy review (2026-09-27): privilege, privacy, audit and pause fixes.
// ---------------------------------------------------------------------------

async function auditCount(action: string, actorId: string): Promise<number> {
  const r = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1 AND actor_id = $2`, [action, actorId]);
  return r.rows[0].n;
}

async function withRole(role: string, wards: string[] = []): Promise<TestFeeder> {
  const f = await insertFeeder();
  await query(`INSERT INTO admin_roles (feeder_id, role, wards) VALUES ($1, $2, $3)`, [f.id, role, wards]);
  return f;
}

describe("review 1: privilege on accounts that hold admin roles", () => {
  it("a moderator cannot suspend the Owner, another moderator, or block an admin's device; can suspend a feeder", async () => {
    const owner = await insertOwner();
    const mod = await withRole("moderator");
    const mod2 = await withRole("moderator");
    const s1 = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${owner.id}/suspend`, headers: mod.headers, payload: { reason: "takeover" } });
    expect(s1.statusCode).toBe(403);
    expect(s1.json().error.code).toBe("OWNER_REQUIRED");
    const s2 = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${mod2.id}/suspend`, headers: mod.headers, payload: { reason: "rivalry" } });
    expect(s2.json().error.code).toBe("OWNER_REQUIRED");
    const self = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${mod.id}/suspend`, headers: mod.headers, payload: { reason: "oops" } });
    expect(self.json().error.code).toBe("CANNOT_TARGET_SELF");
    // The Owner still works after all of that.
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: owner.headers })).statusCode).toBe(200);
    // A moderator's own device, reached through a scan, cannot be blocked by another moderator.
    const dog = await insertDog();
    const d = device();
    const scan = await query<{ id: string }>(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, device_token, captured_at) VALUES ($1, $2, 'view', $3, $4, now()) RETURNING id`,
      [dog.id, randomUUID(), mod2.id, d.subject],
    );
    const blk = await app.inject({ method: "POST", url: "/api/v1/admin/devices/block", headers: mod.headers, payload: { scanId: scan.rows[0].id, reason: "abuse" } });
    expect(blk.json().error.code).toBe("OWNER_REQUIRED");
    const feeder = await insertFeeder();
    const ok = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${feeder.id}/suspend`, headers: mod.headers, payload: { reason: "spam" } });
    expect(ok.statusCode).toBe(200);
  });

  it("an Owner can suspend a moderator; a configured Owner can never be suspended or removed through the API", async () => {
    const config = await insertOwner();
    const granted = await withRole("owner");
    const mod = await withRole("moderator");
    const s = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${mod.id}/suspend`, headers: granted.headers, payload: { reason: "left" } });
    expect(s.statusCode).toBe(200);
    const c1 = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${config.id}/suspend`, headers: granted.headers, payload: { reason: "x" } });
    expect(c1.json().error.code).toBe("CONFIG_OWNER");
    const c2 = await app.inject({ method: "POST", url: `/api/v1/admin/team/${config.id}/remove`, headers: granted.headers, payload: {} });
    expect(c2.json().error.code).toBe("CONFIG_OWNER");
    // An Owner demoting another Owner is allowed while an active Owner remains.
    const other = await withRole("owner");
    const demote = await app.inject({ method: "POST", url: `/api/v1/admin/team/${other.id}/role`, headers: granted.headers, payload: { role: "moderator" } });
    expect(demote.statusCode).toBe(200);
    // An admin cannot suspend their own vet profile's account either.
    const selfSuspend = await app.inject({ method: "POST", url: `/api/v1/admin/feeders/${granted.id}/suspend`, headers: granted.headers, payload: { reason: "x" } });
    expect(selfSuspend.json().error.code).toBe("CANNOT_TARGET_SELF");
  });
});

describe("review 2 and 3: private photos", () => {
  it("a clinic slip is encrypted, never in the photos dir, private, audited, and on a 30-day clock once decided", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const priya = await insertFeeder({ name: "Priya" });
    const dog = await insertDog({ registeredBy: priya.id });
    const ask = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${dog.slug}/sign-requests`,
      headers: priya.headers,
      payload: { proposed: { type: "sterilisation", givenOn: "2026-04-01" }, vetFeederId: vet.id, evidencePhotoBase64: jpeg().toString("base64") },
    });
    expect(ask.statusCode).toBe(201);
    const photos = await readdir(join(storageDir, "photos")).catch(() => []);
    expect(photos).toEqual([]);
    const req = (await app.inject({ method: "GET", url: `/api/v1/vet/sign-requests/${ask.json().data.id}`, headers: vet.headers })).json().data;
    expect(req).toMatchObject({ hasEvidencePhoto: true });
    expect(req.evidencePhotoPath).toBe(`/sign-requests/${ask.json().data.id}/evidence`);
    const stranger = await insertFeeder();
    expect((await app.inject({ method: "GET", url: `/api/v1${req.evidencePhotoPath}`, headers: stranger.headers })).statusCode).toBe(403);
    const editor = await withRole("avatar_editor");
    expect((await app.inject({ method: "GET", url: `/api/v1${req.evidencePhotoPath}`, headers: editor.headers })).statusCode).toBe(403);
    const byVet = await app.inject({ method: "GET", url: `/api/v1${req.evidencePhotoPath}`, headers: vet.headers });
    expect(byVet.statusCode).toBe(200);
    expect(byVet.headers["content-type"]).toBe("image/jpeg");
    expect((await app.inject({ method: "GET", url: `/api/v1${req.evidencePhotoPath}`, headers: priya.headers })).statusCode).toBe(200);
    expect(await auditCount("document.view", vet.id)).toBeGreaterThan(0);
    const dec = await app.inject({ method: "POST", url: `/api/v1/vet/sign-requests/${ask.json().data.id}/decline`, headers: vet.headers, payload: { reason: "not me" } });
    expect(dec.statusCode).toBe(200);
    expect(await auditCount("sign_request.decline", vet.id)).toBe(1);
    const doc = await query<{ days: number }>(
      `SELECT round(extract(epoch FROM delete_after - now()) / 86400)::int AS days FROM documents
        WHERE owner_kind = 'sign_request' AND owner_id = $1`,
      [ask.json().data.id],
    );
    expect(doc.rows[0].days).toBe(30);
  });

  it("a record photo opens for moderating admins only (not an avatar editor), is audited, and has a 30-day retention", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog();
    const up = await app.inject({ method: "POST", url: "/api/v1/vet/record-photos", headers: vet.headers, payload: { base64: jpeg().toString("base64") } });
    const s = await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "DHPPi", givenOn: "2026-09-20", photoId: up.json().data.photoId });
    const path = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data.records[0].photoPath;
    const editor = await withRole("avatar_editor");
    expect((await app.inject({ method: "GET", url: `/api/v1${path}`, headers: editor.headers })).statusCode).toBe(403);
    const mod = await withRole("moderator");
    expect((await app.inject({ method: "GET", url: `/api/v1${path}`, headers: mod.headers })).statusCode).toBe(200);
    expect(await auditCount("document.view", mod.id)).toBe(1);
    const doc = await query<{ days: number }>(
      `SELECT round(extract(epoch FROM delete_after - now()) / 86400)::int AS days FROM documents WHERE owner_kind = 'medical_record' AND owner_id = $1`,
      [s.json().data.recordId],
    );
    expect(doc.rows[0].days).toBe(30);
  });
});

describe("review 4: a taken-down photo's file is deleted at once", () => {
  it("removes the file from the public photos directory", async () => {
    const owner = await insertOwner();
    const f = await insertFeeder();
    const dog = await insertDog({ registeredBy: f.id });
    const { mkdir, writeFile, stat } = await import("node:fs/promises");
    await mkdir(join(storageDir, "photos"), { recursive: true });
    const key = `photos/${randomUUID()}.jpg`;
    await writeFile(join(storageDir, key), jpeg());
    const scanId = await feed(dog.id, f.id, key);
    const hide = await app.inject({ method: "POST", url: `/api/v1/admin/photos/${scanId}/hide`, headers: owner.headers, payload: { reason: "not the dog" } });
    expect(hide.statusCode).toBe(200);
    await expect(stat(join(storageDir, key))).rejects.toThrow();
    const row = await query<{ photo_s3_key: string | null; photo_hidden_at: Date | null }>(`SELECT photo_s3_key, photo_hidden_at FROM scans WHERE id = $1`, [scanId]);
    expect(row.rows[0].photo_s3_key).toBeNull();
    expect(row.rows[0].photo_hidden_at).not.toBeNull();
    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/dogs/${dog.slug}`, headers: owner.headers });
    expect(detail.json().data.photos[0]).toMatchObject({ scanId, hidden: true, url: null });
  });
});

describe("review 5 and 6: audit gaps; a paused NGO sends nobody", () => {
  it("audits avatar uploads, ambulance, beds, dispatch accept and decline, drive edits and vet profile edits", async () => {
    const owner = await insertOwner();
    const batch = (await app.inject({ method: "POST", url: "/api/v1/admin/avatars/batches", headers: owner.headers, payload: {} })).json().data;
    await app.inject({ method: "POST", url: `/api/v1/admin/avatars/batches/${batch.id}/files`, headers: owner.headers, payload: { fileName: "x.png", imageBase64: jpeg().toString("base64") } });
    expect(await auditCount("avatar.upload", owner.id)).toBe(1);
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    await app.inject({ method: "POST", url: "/api/v1/ngo/ambulance", headers: kavita.headers, payload: { status: "out" } });
    await app.inject({ method: "POST", url: "/api/v1/ngo/beds", headers: kavita.headers, payload: { free: 3, total: 12 } });
    expect(await auditCount("ngo.ambulance", kavita.id)).toBe(1);
    expect(await auditCount("ngo.beds", kavita.id)).toBe(1);
    const rahul = await insertFeeder();
    await query(`INSERT INTO ngo_members (ngo_id, feeder_id, role) VALUES ($1, $2, 'rescue')`, [ngoId, rahul.id]);
    const dog = await insertDog({ ward: "K-West" });
    const caseId = (await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } })).json().data.caseId;
    const d1 = (await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: rahul.id } })).json().data;
    await app.inject({ method: "POST", url: `/api/v1/ngo/dispatches/${d1.id}/decline`, headers: rahul.headers, payload: {} });
    expect(await auditCount("sos.dispatch_decline", rahul.id)).toBe(1);
    const d2 = (await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: rahul.id } })).json().data;
    await app.inject({ method: "POST", url: `/api/v1/ngo/dispatches/${d2.id}/accept`, headers: rahul.headers, payload: {} });
    expect(await auditCount("sos.dispatch_accept", rahul.id)).toBe(1);
    const drive = (await app.inject({ method: "POST", url: "/api/v1/ngo/drives", headers: kavita.headers, payload: { wardId: "K-West", date: "2026-10-04", time: "07:00" } })).json().data;
    await app.inject({ method: "PATCH", url: `/api/v1/ngo/drives/${drive.id}`, headers: kavita.headers, payload: { collarsPacked: 9 } });
    const added = (await app.inject({ method: "POST", url: `/api/v1/ngo/drives/${drive.id}/dogs`, headers: kavita.headers, payload: { slug: dog.slug, tasks: { collar: true } } })).json().data;
    await app.inject({ method: "PATCH", url: `/api/v1/ngo/drives/${drive.id}/dogs/${added.id}`, headers: kavita.headers, payload: { done: { collar: true } } });
    expect(await auditCount("drive.edit", kavita.id)).toBe(1);
    expect(await auditCount("drive.add_dog", kavita.id)).toBe(1);
    expect(await auditCount("drive.dog_update", kavita.id)).toBe(1);
    const vet = await verifiedVet(owner);
    await app.inject({ method: "PATCH", url: "/api/v1/vet/me", headers: vet.headers, payload: { clinic: "New Clinic" } });
    expect(await auditCount("vet.profile_edit", vet.id)).toBe(1);
  });

  it("a paused NGO cannot dispatch", async () => {
    const owner = await insertOwner();
    const kavita = await insertFeeder();
    const ngoId = await activeNgo(owner, kavita);
    const rahul = await insertFeeder();
    await query(`INSERT INTO ngo_members (ngo_id, feeder_id, role) VALUES ($1, $2, 'rescue')`, [ngoId, rahul.id]);
    const dog = await insertDog({ ward: "K-West" });
    const caseId = (await app.inject({ method: "POST", url: "/api/v1/reports", payload: { dogSlug: dog.slug, severity: "serious", deviceToken: device().token } })).json().data.caseId;
    await app.inject({ method: "POST", url: `/api/v1/admin/ngos/${ngoId}/pause`, headers: owner.headers, payload: { reason: "paperwork" } });
    const d = await app.inject({ method: "POST", url: `/api/v1/ngo/sos/${caseId}/dispatch`, headers: kavita.headers, payload: { feederId: rahul.id } });
    expect(d.statusCode).toBe(403);
    expect(d.json().error.code).toBe("NGO_PAUSED");
  });
});

describe("review 7: suspended vets; collar batch number", () => {
  it("an admin can flag a suspended vet's signatures; the vet's dog view says signing is not allowed", async () => {
    const owner = await insertOwner();
    const vet = await verifiedVet(owner);
    const dog = await insertDog({ batchNo: "HJ-0412" });
    await signRecord(vet, { dogSlug: dog.slug, type: "vaccination", vaccine: "Anti-rabies", givenOn: "2026-09-12" });
    await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/suspend`, headers: owner.headers, payload: { reason: "lapsed" } });
    const flag = await app.inject({ method: "POST", url: `/api/v1/admin/vets/${vet.profileId}/flag-signatures`, headers: owner.headers, payload: { flag: true, reason: "check them" } });
    expect(flag.json().data).toMatchObject({ status: "suspended", signaturesFlagged: true });
    expect(await auditCount("vet.flag_signatures", owner.id)).toBe(1);
    const health = (await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}/health` })).json().data;
    expect(health.records[0].flagged).toBe(true);
    expect(health.collarBatchNo).toBe("HJ-0412");
    expect((await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.slug}` })).json().data.collarBatchNo).toBe("HJ-0412");
    const view = await app.inject({ method: "GET", url: `/api/v1/vet/dogs/${dog.slug}`, headers: vet.headers });
    expect(view.json().data).toMatchObject({ canSign: false, vetStatus: "suspended", signingBlockedReason: "suspended" });
  });
});

describe("migration 0030: unknown cost tier", () => {
  it("answers costTier null, never 'free', and sorts unknown after known tiers", async () => {
    const tag = randomUUID().slice(0, 6);
    const ins = await query<{ id: string; cost: string | null }>(
      `INSERT INTO care_providers (name, kind, cost_tier, geo, geo_precision, locality, source)
       VALUES ($1, 'ngo', NULL, ST_SetSRID(ST_MakePoint(72.9001, 19.2201), 4326)::geography, 'locality', 'Test', 'test-0030'),
              ($2, 'ngo', 'paid', ST_SetSRID(ST_MakePoint(72.9001, 19.2201), 4326)::geography, 'locality', 'Test', 'test-0030')
       RETURNING id, cost_tier::text AS cost`,
      [`Unknown Tier ${tag}`, `Paid Tier ${tag}`],
    );
    try {
      const r = await app.inject({ method: "GET", url: "/api/v1/care?lat=19.2201&lng=72.9001&max_km=1" });
      const mine = r.json().data.providers.filter((p: { name: string }) => p.name.endsWith(tag));
      expect(mine.map((p: { name: string; costTier: string | null }) => [p.name.split(" ")[0], p.costTier])).toEqual([
        ["Paid", "paid"],
        ["Unknown", null],
      ]);
    } finally {
      await query(`DELETE FROM care_providers WHERE id = ANY($1::uuid[])`, [ins.rows.map((x) => x.id)]);
    }
  });
});
