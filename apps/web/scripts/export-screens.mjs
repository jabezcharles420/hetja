#!/usr/bin/env node
/**
 * Export screenshots of every Hetja screen and state, for design review in a
 * tool that cannot visit the live site (Claude Design).
 *
 *   pnpm --filter @hetja/web screens:export
 *
 * Env:
 *   HETJA_SCREENS_BASE_URL  site to shoot (default https://hetja.in). Point it
 *                           at a local server later, e.g. http://127.0.0.1:3100
 *                           behind Caddy, so /d/* reaches the scan app.
 *   HETJA_SCREENS_OUT       output folder (default <Documents>/Hetja-screens,
 *                           the folder next to the repo checkout).
 *   HETJA_SCREENS_ONLY      comma-separated flow ids to run a subset.
 *
 * READ-ONLY AGAINST THE SERVER. Only GET and HEAD requests ever reach the
 * network. Every /api/v1/* call is answered from fixtures below (a few GETs
 * are passed through or augmented), and a catch-all guard aborts ANY other
 * non-GET request (OTP sends, SOS reports, scans, device tokens, beacons), so
 * nothing here can page a responder or send an email. The run ends with a
 * summary of what was mocked and what the guard blocked.
 *
 * Not a test: it lives outside e2e/ so CI never runs it. The screenshots are
 * written outside the repo and must never be committed.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const BASE = (process.env.HETJA_SCREENS_BASE_URL ?? "https://hetja.in").replace(/\/+$/, "");
const OUT = path.resolve(process.env.HETJA_SCREENS_OUT ?? path.join(path.dirname(REPO), "Hetja-screens"));
const ZIP = `${OUT}.zip`;
const ONLY = (process.env.HETJA_SCREENS_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------
// Time helpers (fixtures are relative to "now", in Asia/Kolkata)
// ---------------------------------------------------------------------------

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const inDays = (d) => new Date(NOW + d * 86_400_000).toISOString();
const kolkataDay = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
const TODAY = kolkataDay(NOW);

// ---------------------------------------------------------------------------
// Fixtures (shapes mirror apps/api/src/routes/*.ts and apps/web/lib/api.ts)
// ---------------------------------------------------------------------------

const SLUG = { rani: "r4n7kw2ab", bruno: "b8ru3xm6q", kalu: "k2au9pd3z", moti: "m6ot5hce4" };
const UNKNOWN_SLUG = "zz9q8w7e6";
const photoUrl = (name) => `${BASE}/photos/fixture-${name}.svg`;

function dog(over) {
  return {
    slug: "",
    name: null,
    status: "active",
    wardId: "K-West",
    photoKey: null,
    abcStatus: null,
    vaccineStatus: null,
    microStory: null,
    lastSeenAt: ago(90),
    geo: { lat: 19.136, lng: 72.83 },
    wardName: "Andheri West",
    vaccinated: "unknown",
    sterilised: "unknown",
    lastFedAt: null,
    feederCount: 0,
    storyAuthorCount: 0,
    photoUrl: null,
    ...over,
  };
}

const DOGS = {
  [SLUG.rani]: dog({
    slug: SLUG.rani,
    name: "Rani",
    photoKey: "photos/fixture-rani.svg",
    photoUrl: photoUrl("rani"),
    abcStatus: "sterilised",
    vaccineStatus: "Anti-Rabies · 2026-03-14",
    vaccinated: "yes",
    sterilised: "yes",
    microStory:
      "Rani sleeps under the sugarcane-juice cart on SV Road and walks the lane at seven every evening like she owns it. She does. Loves parle-G, hates the red scooter.",
    lastFedAt: ago(125),
    feederCount: 3,
    storyAuthorCount: 2,
  }),
  [SLUG.bruno]: dog({
    slug: SLUG.bruno,
    name: "Bruno",
    sterilised: "no",
    lastFedAt: ago(60 * 26),
    feederCount: 2,
  }),
  [SLUG.kalu]: dog({
    slug: SLUG.kalu,
    name: "Kalu",
    photoKey: "photos/fixture-kalu.svg",
    photoUrl: photoUrl("kalu"),
    vaccineStatus: "Anti-Rabies · 2026-06-02",
    vaccinated: "yes",
    sterilised: "yes",
    microStory: "Kalu guards the Four Bungalows bus stop and escorts late commuters to the corner. Tips not required.",
    lastFedAt: ago(40),
    feederCount: 4,
    storyAuthorCount: 1,
  }),
  [SLUG.moti]: dog({ slug: SLUG.moti, name: "Moti", lastFedAt: null, feederCount: 0 }),
};

const ME = {
  feederId: "6f1c2d8e-3b7a-4e59-9c10-5a2b7d4e8f31",
  displayName: "Priya S.",
  role: "registrator",
  trustScore: 48,
  verificationTier: "email",
  homeWard: "K-West",
  canRegister: true,
  registrationBudget: { pending: 1, max: 2 },
  capabilities: ["feed", "register", "sos_respond"],
  sosOptIn: true,
};

const STREAK = {
  trustScore: 48,
  streakDays: 12,
  badges: ["first_feed", "week_streak"],
  lastFeedDate: TODAY,
  nextBadgeHint: null,
  streakStart: kolkataDay(NOW - 11 * 86_400_000),
  trustLevel: { name: "Trusted feeder", level: 2, nextThreshold: 50 },
};

const MY_DOGS = [
  { slug: SLUG.rani, name: "Rani", wardId: "K-West", wardName: "Andheri West", lastFedAt: ago(125), myLastFedAt: ago(125) },
  { slug: SLUG.bruno, name: "Bruno", wardId: "K-West", wardName: "Andheri West", lastFedAt: ago(60 * 26), myLastFedAt: ago(60 * 26) },
  { slug: SLUG.kalu, name: "Kalu", wardId: "K-West", wardName: "Andheri West", lastFedAt: ago(40), myLastFedAt: ago(60 * 5) },
  { slug: SLUG.moti, name: "Moti", wardId: "K-West", wardName: "Andheri West", lastFedAt: ago(60 * 30), myLastFedAt: ago(60 * 30) },
];

const collarUrl = (slug) => `${BASE}/d/${slug}?s=Xk3v9QpL2mZt7RbW`;

const REGS = [
  { slug: SLUG.kalu, name: "Kalu", status: "pending_activation", wardId: "K-West", registeredAt: ago(60 * 24 * 2), expiresAt: inDays(12) },
  { slug: SLUG.moti, name: "Moti", status: "pending_activation", wardId: "K-West", registeredAt: ago(60 * 24 * 11), expiresAt: inDays(3) },
  { slug: SLUG.rani, name: "Rani", status: "active", wardId: "K-West", registeredAt: ago(60 * 24 * 60), expiresAt: undefined },
];

const regDetail = (slug, status = "pending_activation") => {
  const r = REGS.find((x) => x.slug === slug) ?? REGS[0];
  return {
    slug,
    name: r.name,
    status,
    wardId: r.wardId,
    registeredAt: r.registeredAt,
    ...(status === "pending_activation" ? { expiresAt: r.expiresAt ?? inDays(12) } : {}),
    collarUrl: collarUrl(slug),
  };
};

const CARE = [
  {
    id: "c1a2b3c4-0000-4000-8000-000000000001",
    name: "Lokhandwala Pet Hospital",
    kind: "private_clinic",
    costTier: "paid",
    phoneE164: "+912226300101",
    altPhoneE164: null,
    hasAmbulance: true,
    is24x7: true,
    hoursNote: null,
    handlesWildlife: false,
    phoneVerifiedAt: ago(60 * 24 * 20),
    geoPrecision: "exact",
    locality: "Andheri West",
    lat: 19.1405,
    lng: 72.8262,
    distanceM: 850,
  },
  {
    id: "c1a2b3c4-0000-4000-8000-000000000002",
    name: "Versova Animal Welfare Trust",
    kind: "ngo",
    costTier: "free",
    phoneE164: "+919820012345",
    altPhoneE164: null,
    hasAmbulance: false,
    is24x7: false,
    hoursNote: "9 am to 7 pm",
    handlesWildlife: false,
    phoneVerifiedAt: ago(60 * 24 * 45),
    geoPrecision: "exact",
    locality: "Versova",
    lat: 19.131,
    lng: 72.815,
    distanceM: 1900,
  },
  {
    id: "c1a2b3c4-0000-4000-8000-000000000003",
    name: "Municipal Veterinary Dispensary, Andheri",
    kind: "govt",
    costTier: "free",
    phoneE164: "+912226204455",
    altPhoneE164: null,
    hasAmbulance: false,
    is24x7: false,
    hoursNote: "Mon to Sat, 10 am to 4 pm",
    handlesWildlife: false,
    phoneVerifiedAt: null,
    geoPrecision: "locality",
    locality: "Andheri West",
    lat: 19.12,
    lng: 72.84,
    distanceM: 2600,
  },
];

const PLACES = [
  {
    id: "p-vet-1",
    name: "Lokhandwala Pet Hospital",
    kind: "vet",
    careKind: "private_clinic",
    wardId: "K-West",
    locality: "Andheri West",
    lat: 19.1405,
    lng: 72.8262,
    hoursNote: null,
    is24x7: true,
    hasAmbulance: true,
    phoneE164: "+912226300101",
    confirmed: true,
    partner: true,
    geoPrecision: "exact",
  },
  {
    id: "p-ngo-1",
    name: "Versova Animal Welfare Trust",
    kind: "ngo",
    careKind: "ngo",
    wardId: "K-West",
    locality: "Versova",
    lat: 19.131,
    lng: 72.815,
    hoursNote: "Open till 7 pm",
    is24x7: false,
    hasAmbulance: false,
    phoneE164: "+919820012345",
    confirmed: true,
    partner: false,
    geoPrecision: "exact",
  },
  {
    id: "p-vet-2",
    name: "Juhu Paws Clinic",
    kind: "vet",
    careKind: "private_clinic",
    wardId: "K-West",
    locality: "Juhu",
    lat: 19.1075,
    lng: 72.8295,
    hoursNote: "Open till 9 pm",
    is24x7: false,
    hasAmbulance: false,
    phoneE164: "+912226150987",
    confirmed: false,
    partner: false,
    geoPrecision: "exact",
  },
  {
    id: "p-vet-3",
    name: "Bandra Vet Centre",
    kind: "vet",
    careKind: "private_clinic",
    wardId: "H-West",
    locality: "Bandra West",
    lat: 19.0596,
    lng: 72.8295,
    hoursNote: "Open till 8 pm",
    is24x7: false,
    hasAmbulance: false,
    phoneE164: "+912226401122",
    confirmed: true,
    partner: true,
    geoPrecision: "exact",
  },
];

/** Per-ward overlays on the real GET /map/wards (which carries real lat/lng). */
const WARD_COUNTS = {
  "K-West": { dogs: 14, notFedToday: 5, sosOpen: 1, latestSos: { severity: "critical", raisedAt: ago(8) } },
  "H-West": { dogs: 11, notFedToday: 2, sosOpen: 1, latestSos: { severity: "serious", raisedAt: ago(42) } },
  "K-East": { dogs: 9, notFedToday: 3, sosOpen: 0, latestSos: null },
  "P-North": { dogs: 6, notFedToday: 4, sosOpen: 0, latestSos: null },
  "G-North": { dogs: 7, notFedToday: 0, sosOpen: 0, latestSos: null },
  A: { dogs: 4, notFedToday: 1, sosOpen: 0, latestSos: null },
  "R-Central": { dogs: 3, notFedToday: 2, sosOpen: 0, latestSos: null },
  S: { dogs: 5, notFedToday: 0, sosOpen: 0, latestSos: null },
};

/** Used when the real wards list cannot be read (offline, local server without data). */
const WARDS_FALLBACK = [
  ["A", "A", "Colaba, Fort", 18.918, 72.828], ["B", "B", "Sandhurst Road", 18.957, 72.836],
  ["C", "C", "Marine Lines", 18.948, 72.826], ["D", "D", "Grant Road, Malabar Hill", 18.96, 72.808],
  ["E", "E", "Byculla", 18.978, 72.836], ["F-North", "F/N", "Matunga, Sion", 19.042, 72.866],
  ["F-South", "F/S", "Parel", 19.004, 72.845], ["G-North", "G/N", "Dadar, Mahim", 19.024, 72.838],
  ["G-South", "G/S", "Worli, Prabhadevi", 19.0, 72.816], ["H-East", "H/E", "Bandra East, Santacruz East", 19.075, 72.856],
  ["H-West", "H/W", "Bandra West, Khar", 19.06, 72.83], ["K-East", "K/E", "Andheri East", 19.115, 72.87],
  ["K-West", "K/W", "Andheri West", 19.136, 72.83], ["L", "L", "Kurla", 19.07, 72.88],
  ["M-East", "M/E", "Govandi, Mankhurd", 19.05, 72.93], ["M-West", "M/W", "Chembur", 19.06, 72.9],
  ["N", "N", "Ghatkopar", 19.086, 72.908], ["P-North", "P/N", "Malad", 19.187, 72.848],
  ["P-South", "P/S", "Goregaon", 19.165, 72.85], ["R-Central", "R/C", "Borivali", 19.231, 72.857],
  ["R-North", "R/N", "Dahisar", 19.25, 72.86], ["R-South", "R/S", "Kandivali", 19.205, 72.852],
  ["S", "S", "Bhandup, Powai", 19.144, 72.936], ["T", "T", "Mulund", 19.172, 72.956],
].map(([id, code, name, lat, lng]) => ({ id, code, name, lat, lng, dogs: 0, notFedToday: 0, sosOpen: 0, latestSos: null }));

let realWardsCache = null;

const CASE_ID = {
  open: "5b1f2c9e-8a47-4d2b-9f61-2e7c3a90d4b8",
  mine: "7c2e4a10-1d9b-4f6e-8a3c-0b5d7e2f9a64",
  other: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  escalated: "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d",
  resolved: "3f4e5d6c-7b8a-4c9d-8e0f-1a2b3c4d5e6f",
  hidden: "0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a",
  broken: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
};

function sosCase(id, over) {
  return {
    id,
    severity: "critical",
    state: "open",
    tier: 1,
    openedAt: ago(12),
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    resolution: null,
    wardId: "K-West",
    wardName: "Andheri West",
    mine: false,
    ...over,
  };
}

const CASES = {
  [CASE_ID.open]: sosCase(CASE_ID.open, {}),
  [CASE_ID.mine]: sosCase(CASE_ID.mine, { state: "acked", ackedAt: ago(5), mine: true }),
  [CASE_ID.other]: sosCase(CASE_ID.other, { severity: "serious", state: "acked", ackedAt: ago(20), openedAt: ago(34), mine: false }),
  [CASE_ID.escalated]: sosCase(CASE_ID.escalated, {
    severity: "serious",
    state: "escalated",
    openedAt: ago(75),
    escalatedAt: ago(45),
    wardId: "H-West",
    wardName: "Bandra West, Khar",
  }),
  [CASE_ID.resolved]: sosCase(CASE_ID.resolved, {
    state: "resolved",
    openedAt: ago(60 * 3),
    ackedAt: ago(170),
    resolvedAt: ago(90),
    resolution: "Taken to the vet, stitched, back on the lane.",
    mine: true,
  }),
};

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const ok = (data, extra = {}) => ({ status: 200, json: { ok: true, data }, ...extra });
const fail = (status, code, message, extra = {}) => ({ status, json: { ok: false, error: { code, message } }, ...extra });
const UNAUTH = fail(401, "UNAUTHENTICATED", "sign in required");

/**
 * Default answers. `s` is the flow's scenario: { signedIn, ...overrides }.
 * Return undefined from a GET handler to pass it through to the real server.
 * Every non-GET MUST return a mock; the guard aborts anything that slips by.
 */
function defaultHandlers(s) {
  const authed = () => s.signedIn;
  const me = () => ({ ...ME, ...(s.me ?? {}) });
  return [
    // --- public reads ---
    ["GET", /^\/dogs\/([^/]+)$/, (m) => (DOGS[m[1]] ? ok(DOGS[m[1]]) : fail(404, "DOG_NOT_FOUND", "No dog with that code."))],
    ["GET", /^\/dogs\/([^/]+)\/medical$/, () => ok({ records: [] })],
    ["GET", /^\/dogs\/([^/]+)\/stories$/, () => ok({ stories: [] })],
    ["GET", /^\/wards$/, () => undefined],
    ["GET", /^\/stats\/impact$/, () => undefined],
    ["GET", /^\/push\/vapid-public-key$/, () => undefined],
    ["GET", /^\/care$/, () => ok({ providers: CARE })],
    // --- map ---
    ["GET", /^\/map\/wards$/, async (_m, ctx) => ok({ wards: await augmentedWards(ctx) })],
    ["GET", /^\/map\/wards\/([^/]+)$/, async (m, ctx) => ok(await wardDetail(decodeURIComponent(m[1]), s, ctx))],
    ["GET", /^\/map\/places$/, () => ok({ places: PLACES, truncated: false })],
    // --- session reads ---
    ["GET", /^\/feeders\/me$/, () => (authed() ? ok(me()) : UNAUTH)],
    ["GET", /^\/feeders\/me\/streak$/, () => (authed() ? ok(STREAK) : UNAUTH)],
    ["GET", /^\/feeders\/me\/dogs$/, () => (authed() ? ok({ dogs: MY_DOGS }) : UNAUTH)],
    ["GET", /^\/registrations$/, () => (authed() ? ok({ registrations: REGS }) : UNAUTH)],
    ["GET", /^\/registrations\/([^/]+)$/, (m) => (authed() ? ok(regDetail(m[1], s.regStatus)) : UNAUTH)],
    ["GET", /^\/sos\/cases\/([^/]+)$/, (m) => {
      if (!authed()) return UNAUTH;
      if (m[1] === CASE_ID.hidden) return fail(403, "SOS_CASE_FORBIDDEN", "not your case");
      if (m[1] === CASE_ID.broken) return fail(500, "INTERNAL", "internal error");
      return CASES[m[1]] ? ok(CASES[m[1]]) : fail(404, "SOS_CASE_NOT_FOUND", "no such case");
    }],
    ["GET", /^\/reports\/([^/]+)\/status$/, () => ok({ state: "open", ackedAt: null, escalatedAt: null, resolvedAt: null })],
    // --- writes: ALL mocked, never sent ---
    ["POST", /^\/devices\/challenge$/, () => fail(503, "MOCKED", "device challenge is mocked in the screenshot run")],
    ["POST", /^\/devices\/token$/, () => fail(503, "MOCKED", "device token is mocked in the screenshot run")],
    ["POST", /^\/auth\/otp$/, () => ok({ expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })],
    // The real route answers a wrong code with the bare result string (routes/auth.ts).
    ["POST", /^\/auth\/verify$/, () => fail(400, "INVALID_CODE", "invalid_code")],
    ["POST", /^\/auth\/refresh$/, () => fail(401, "BAD_REFRESH_TOKEN", "invalid or expired refresh token")],
    ["POST", /^\/scans$/, () =>
      ok({ created: true, scanId: "8d7c6b5a-4f3e-4d2c-9b1a-0f9e8d7c6b5a", streak: { streakDays: 13, lastFeedDate: TODAY }, photoAccepted: true, geoAccepted: true })],
    ["POST", /^\/reports$/, () =>
      ok({ created: true, caseId: CASE_ID.open, tier: 1, fanout: "responders", nearbyCare: CARE })],
    ["POST", /^\/sos\/cases\/([^/]+)\/ack$/, (m) => ok({ id: m[1], ackedBy: ME.feederId, ackedAt: new Date().toISOString() })],
    ["POST", /^\/sos\/cases\/([^/]+)\/resolve$/, (m) =>
      ok({ id: m[1], state: "resolved", resolvedAt: new Date().toISOString(), resolution: "Marked resolved by the responder on the case page." })],
    ["PATCH", /^\/feeders\/me$/, (_m, _c, body) => ok({ ...(body ?? {}) })],
    ["POST", /^\/feeders\/me\/surface$/, () => ok({ role: "registrator" })],
    ["POST", /^\/feeders\/me\/badges\/check$/, () => ok({ granted: [] })],
    ["POST", /^\/registrations$/, () =>
      ok({ slug: SLUG.kalu, status: "pending_activation", wardId: "K-West", registeredAt: new Date().toISOString(), expiresAt: inDays(14), collarUrl: collarUrl(SLUG.kalu), budget: { pending: 2, max: 2 } })],
    ["POST", /^\/push\/subscribe$/, () => ok({ subscribed: true })],
  ];
}

async function augmentedWards(ctx) {
  if (!realWardsCache) {
    try {
      const res = await ctx.route.fetch({ url: `${ctx.origin}/api/v1/map/wards`, method: "GET" });
      const body = await res.json();
      realWardsCache = Array.isArray(body?.data?.wards) && body.data.wards.length ? body.data.wards : WARDS_FALLBACK;
    } catch {
      realWardsCache = WARDS_FALLBACK;
    }
  }
  return realWardsCache.map((w) => ({ ...w, ...(WARD_COUNTS[w.id] ?? { dogs: 0, notFedToday: 0, sosOpen: 0, latestSos: null }) }));
}

async function wardDetail(id, s, ctx) {
  const wards = await augmentedWards(ctx);
  const w = wards.find((x) => x.id === id) ?? wards[0];
  const sos = [];
  if (w.sosOpen && w.latestSos) {
    sos.push({
      caseId: s.signedIn ? CASE_ID.open : null,
      severity: w.latestSos.severity,
      raisedAt: w.latestSos.raisedAt,
      state: "open",
      feedersTold: true,
      mine: false,
    });
  }
  return {
    ...w,
    sos,
    nearby: PLACES.filter((p) => p.wardId === w.id || id === "K-West"),
    viewer: s.signedIn ? { sosOptIn: true, trustScore: ME.trustScore, canRespond: ["minor", "serious", "critical"] } : null,
  };
}

// ---------------------------------------------------------------------------
// Network safety
// ---------------------------------------------------------------------------

const audit = { mocked: [], blocked: [], passedGet: 0 };
const SAFE_METHODS = new Set(["GET", "HEAD"]);

function corsHeaders(request) {
  const origin = request.headers()["origin"] ?? BASE;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type, accept, x-device-token",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "retry-after, x-hetja-stale",
    vary: "origin",
  };
}

async function installRoutes(context, scenario, flowId) {
  // 1. Catch-all guard, registered FIRST so it runs LAST (Playwright runs
  //    routes in reverse registration order). Only GET/HEAD may leave.
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    if (SAFE_METHODS.has(method)) {
      audit.passedGet += 1;
      return route.continue();
    }
    if (method === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(req) });
    }
    audit.blocked.push(`${flowId}: ${method} ${req.url()}`);
    return route.abort("blockedbyclient");
  });

  // 2. Fixture photos.
  await context.route(
    (url) => url.pathname.startsWith("/photos/fixture-"),
    async (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^\/photos\/fixture-/, "").replace(/\.svg$/, "");
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: dogSvg(name), headers: corsHeaders(route.request()) });
    },
  );

  // 3. The API, on any host (web calls api.hetja.in, the scan app calls /api/v1 same-origin).
  const handlers = [...(scenario.api ?? []), ...defaultHandlers(scenario)];
  await context.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    (route) => apiRoute(route).catch(() => undefined),
  );

  // A context closing mid-delay makes fulfill throw; that is fine to swallow.
  async function apiRoute(route) {
    {
      const req = route.request();
      const method = req.method();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^\/api\/v1/, "");
      if (method === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(req) });
      let body;
      try {
        body = req.postDataJSON();
      } catch {
        body = undefined;
      }
      const ctx = { route, url, origin: url.origin, request: req };
      for (const [m, re, fn] of handlers) {
        if (m !== method) continue;
        const match = re.exec(p);
        if (!match) continue;
        const res = await fn(match, ctx, body);
        if (res === undefined) {
          if (SAFE_METHODS.has(method)) return route.fallback();
          break;
        }
        if (!SAFE_METHODS.has(method)) audit.mocked.push(`${flowId}: ${method} ${p} -> ${res.status}`);
        if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs));
        // Simulated dead network: the request fails in the browser, nothing is sent.
        if (res.abort) return route.abort("internetdisconnected");
        return route.fulfill({
          status: res.status,
          contentType: "application/json",
          headers: { ...corsHeaders(req), "cache-control": "no-store", ...(res.headers ?? {}) },
          body: JSON.stringify(res.json),
        });
      }
      if (SAFE_METHODS.has(method)) return route.fallback();
      // An unexpected write: answer it here, never forward it.
      audit.mocked.push(`${flowId}: ${method} ${p} -> 200 (generic mock)`);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(req),
        body: JSON.stringify({ ok: true, data: {} }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Browser-side shims (added with addInitScript)
// ---------------------------------------------------------------------------

function initShim({ signedIn, camera }) {
  try {
    // No beacons ever leave (web-vitals telemetry uses sendBeacon).
    Object.defineProperty(navigator, "sendBeacon", { value: () => true, configurable: true });
  } catch {}
  try {
    // A cached, well-shaped device token: no proof-of-work round trip.
    localStorage.setItem("hetja.deviceToken.v1", "screenshotDevice.fixtureSignature");
    if (signedIn) {
      localStorage.setItem("hetja.accessToken", "screenshot-access.fixture");
      localStorage.setItem("hetja.refreshToken", "screenshot-refresh.fixture");
    } else {
      localStorage.removeItem("hetja.accessToken");
      localStorage.removeItem("hetja.refreshToken");
    }
  } catch {}

  // Camera: "denied" rejects like a refused permission; "fake" paints a street
  // scene into a canvas stream; the native BarcodeDetector is stubbed so no
  // WASM polyfill download is needed and nothing ever "decodes".
  const md = navigator.mediaDevices;
  if (md && camera === "denied") {
    md.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  }
  if (md && camera === "fake") {
    md.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 720;
      c.height = 1280;
      const g = c.getContext("2d");
      let t = 0;
      const draw = () => {
        t += 1;
        const bg = g.createLinearGradient(0, 0, 0, c.height);
        bg.addColorStop(0, "#3a3f47");
        bg.addColorStop(0.55, "#6b5a48");
        bg.addColorStop(1, "#2a2622");
        g.fillStyle = bg;
        g.fillRect(0, 0, c.width, c.height);
        // fur
        g.fillStyle = "#b07a4a";
        g.beginPath();
        g.ellipse(360, 700, 330, 420, 0, 0, Math.PI * 2);
        g.fill();
        // collar band
        g.fillStyle = "#1f5fa8";
        g.fillRect(40, 560, 640, 70);
        // tag with a QR-ish grid
        g.fillStyle = "#f4f1ea";
        g.fillRect(250, 600, 220, 250);
        g.fillStyle = "#111";
        const cell = 12;
        for (let y = 0; y < 15; y++) {
          for (let x = 0; x < 15; x++) {
            const corner = (x < 4 && y < 4) || (x > 10 && y < 4) || (x < 4 && y > 10);
            if (corner ? (x % 3 !== 1 || y % 3 !== 1) : ((x * 7 + y * 13 + x * y) % 3 === 0)) {
              g.fillRect(270 + x * cell, 620 + y * cell, cell - 1, cell - 1);
            }
          }
        }
        g.font = "bold 22px monospace";
        g.fillText("k2a u9p d3z", 285, 830);
        g.fillStyle = `rgba(255,255,255,${0.03 + 0.02 * Math.sin(t / 5)})`;
        g.fillRect(0, 0, c.width, c.height);
      };
      draw();
      setInterval(draw, 120);
      return c.captureStream(10);
    };
  }
  if (camera === "fake" || camera === "denied") {
    window.BarcodeDetector = class {
      static getSupportedFormats() {
        return Promise.resolve(["qr_code"]);
      }
      detect() {
        return Promise.resolve([]);
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture art
// ---------------------------------------------------------------------------

function dogSvg(name) {
  const palettes = {
    rani: { sky1: "#f7d9b0", sky2: "#e7a46a", ground: "#9c7152", fur: "#c98a4b", dark: "#8a5a2e", collar: "#d70015" },
    kalu: { sky1: "#cfe0ee", sky2: "#8fb2cc", ground: "#6d6a63", fur: "#2b2724", dark: "#141210", collar: "#0071e3" },
  };
  const c = palettes[name] ?? palettes.rani;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="800" height="520">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky1}"/><stop offset="1" stop-color="${c.sky2}"/></linearGradient>
<radialGradient id="sun" cx="0.78" cy="0.22" r="0.35"><stop offset="0" stop-color="#fff6e0" stop-opacity="0.9"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="520" fill="url(#s)"/><rect width="800" height="520" fill="url(#sun)"/>
<rect x="560" y="120" width="160" height="260" rx="6" fill="#000" opacity="0.08"/><rect x="40" y="170" width="120" height="210" rx="6" fill="#000" opacity="0.06"/>
<rect y="380" width="800" height="140" fill="${c.ground}"/><rect y="380" width="800" height="8" fill="#000" opacity="0.08"/>
<ellipse cx="420" cy="455" rx="230" ry="22" fill="#000" opacity="0.18"/>
<path d="M600 330 C 680 300, 700 230, 670 200 C 660 250, 630 290, 590 300 Z" fill="${c.fur}"/>
<ellipse cx="440" cy="340" rx="190" ry="85" fill="${c.fur}"/>
<rect x="300" y="360" width="42" height="95" rx="18" fill="${c.fur}"/><rect x="360" y="370" width="40" height="88" rx="18" fill="${c.dark}"/>
<rect x="510" y="360" width="42" height="95" rx="18" fill="${c.fur}"/><rect x="565" y="365" width="40" height="88" rx="18" fill="${c.dark}"/>
<ellipse cx="275" cy="255" rx="92" ry="88" fill="${c.fur}"/>
<path d="M210 190 L 190 105 L 255 170 Z" fill="${c.dark}"/><path d="M320 180 L 350 100 L 355 190 Z" fill="${c.dark}"/>
<ellipse cx="215" cy="290" rx="62" ry="42" fill="${c.fur}"/><ellipse cx="190" cy="282" rx="18" ry="13" fill="#1b1b1b"/>
<circle cx="258" cy="235" r="11" fill="#1b1b1b"/><circle cx="262" cy="231" r="3.5" fill="#fff"/>
<path d="M200 312 Q 225 326 250 312" stroke="#1b1b1b" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M240 318 C 290 350, 330 350, 350 318" stroke="${c.collar}" stroke-width="18" fill="none" stroke-linecap="round"/>
<rect x="282" y="340" width="30" height="36" rx="6" fill="#f4f1ea" stroke="#999" stroke-width="2"/>
</svg>`;
}

/** A PNG (rendered in the browser) for file inputs: "a photo from the phone". */
async function photoPng(browser) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 520 } });
  const p = await ctx.newPage();
  await p.setContent(`<html><body style="margin:0">${dogSvg("rani")}</body></html>`);
  const buf = await p.screenshot({ type: "png" });
  await ctx.close();
  return buf;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const index = new Map(); // key -> { n, route, state, desc, files: [] }
let nextNo = 1;
const failures = [];

function entry(key, route, state, desc) {
  if (!index.has(key)) index.set(key, { n: nextNo++, key, route, state, desc, files: [] });
  return index.get(key);
}

async function settle(page, { scroll = true, idle = 6000 } = {}) {
  await page.waitForLoadState("networkidle", { timeout: idle }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  if (scroll) {
    await page
      .evaluate(async () => {
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 70));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 70));
      })
      .catch(() => undefined);
  }
  await page
    .evaluate(async () => {
      const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

function makeSnap(page, width) {
  return async (key, route, state, desc, opts = {}) => {
    const e = entry(key, route, state, desc);
    await settle(page, opts);
    const base = `${String(e.n).padStart(2, "0")}-${key}-${width}`;
    await page.screenshot({ path: path.join(OUT, `${base}.png`), animations: "allow" });
    e.files.push(`${base}.png`);
    if (opts.full !== false) {
      // A tall viewport rather than fullPage: the app screens are 100dvh
      // columns with sticky footers and inner scrollers, which a stitched
      // full-page capture paints in the middle of the page.
      const vp = page.viewportSize();
      const need = await page.evaluate(() => {
        let extra = 0;
        for (const el of document.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) {
            extra = Math.max(extra, el.scrollHeight - el.clientHeight);
          }
        }
        const doc = document.scrollingElement?.scrollHeight ?? document.body.scrollHeight;
        return Math.max(doc, window.innerHeight + extra);
      });
      const h = Math.min(Math.ceil(need), 12_000);
      if (vp && h > vp.height + 4) {
        await page.setViewportSize({ width: vp.width, height: h });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `${base}-full.png`), animations: "allow" });
        await page.setViewportSize(vp);
        await page.waitForTimeout(300);
        e.files.push(`${base}-full.png`);
      } else {
        // Fits the viewport: the full-page shot is the same picture.
        copyFileSync(path.join(OUT, `${base}.png`), path.join(OUT, `${base}-full.png`));
        e.files.push(`${base}-full.png`);
      }
    }
    console.log(`  shot ${base}`);
  };
}

let browser;
let PHOTO;

/**
 * One flow = one fresh context per width. `fn` drives the page and calls
 * snap() for each state it reaches.
 */
async function flow(id, opts, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const widths = opts.widths ?? [390];
  for (const w of widths) {
    const vp = w === 390 ? MOBILE : DESKTOP;
    const scenario = { signedIn: false, ...opts };
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      isMobile: w === 390,
      hasTouch: w === 390,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      colorScheme: "light",
      serviceWorkers: "block",
      permissions: opts.geo ? ["geolocation"] : [],
      geolocation: opts.geo ? { latitude: 19.1364, longitude: 72.8296, accuracy: 30 } : undefined,
      ignoreHTTPSErrors: false,
    });
    await installRoutes(context, scenario, `${id}@${w}`);
    await context.addInitScript(initShim, { signedIn: !!scenario.signedIn, camera: opts.camera ?? "denied" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    console.log(`flow ${id} @${w}`);
    try {
      await fn({ page, context, snap: makeSnap(page, w), w, go: (p) => page.goto(`${BASE}${p}`, { waitUntil: "load" }) });
    } catch (err) {
      const msg = `${id}@${w}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
      failures.push(msg);
      await page.screenshot({ path: path.join(os.tmpdir(), `hetja-screens-failed-${id}-${w}.png`) }).catch(() => undefined);
      console.error(`  FAILED ${msg}`);
    } finally {
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

const MARKETING = [
  ["home", "/", "Landing page: hero, how it works, today in Mumbai, footer"],
  ["about", "/about", "About Hetja"],
  ["how-it-works", "/how-it-works", "How it works, step by step"],
  ["faq", "/faq", "FAQ with grouped questions (first one open)"],
  ["privacy", "/privacy", "Privacy page (dark nav)"],
  ["contact", "/contact", "Contact page"],
  ["hetja-memorial", "/hetja", "The Hetja memorial page (muted nav, no footer or tab bar)"],
];

async function defineFlows() {
  // --- marketing, 390 and 1440 ---
  for (const [key, route, desc] of MARKETING) {
    await flow(`m-${key}`, { widths: [390, 1440] }, async ({ go, snap }) => {
      await go(route);
      await snap(key, route, "default", desc);
    });
  }

  await flow("m-home-install", {}, async ({ page, go, snap }) => {
    await go("/");
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt");
      e.prompt = () => Promise.resolve();
      e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
      window.dispatchEvent(e);
    });
    await page.waitForTimeout(400);
    await snap("home-install-banner", "/", "install prompt available", "Landing page with the Add to home screen card");
  });

  await flow("m-faq-open", {}, async ({ page, go, snap }) => {
    await go("/faq");
    const summaries = page.locator("summary");
    const n = await summaries.count();
    if (n > 2) await summaries.nth(2).click();
    await snap("faq-item-open", "/faq", "second question expanded", "FAQ with another question opened");
  });

  await flow("design", { widths: [390, 1440] }, async ({ go, snap }) => {
    await go("/design");
    await snap("design-system", "/design", "default", "Internal design-system reference page");
  });

  await flow("not-found", { widths: [390, 1440] }, async ({ go, snap }) => {
    await go("/this-page-does-not-exist");
    await snap("not-found-404", "/<unknown>", "404", "Web app not-found page");
  });

  // --- scan (web) ---
  await flow("scan-denied", { camera: "denied" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("No camera here.").waitFor();
    await snap("scan-no-camera", "/scan", "camera denied / unavailable", "Scan screen fallback: no camera, type the collar code");
    await page.locator("#scan-collar-code").fill("r4n7");
    await page.getByRole("button", { name: "View profile" }).click();
    await page.waitForTimeout(300);
    await snap("scan-code-too-short", "/scan", "typed code too short", "Inline error: the code is 9 characters");
    await page.locator("#scan-collar-code").fill(UNKNOWN_SLUG);
    await page.getByRole("button", { name: "View profile" }).click();
    await page.getByText("No dog with that code").first().waitFor();
    await snap("scan-code-unknown", "/scan", "typed code not found", "Inline error: no dog with that code (API 404)");
  });

  await flow("scan-camera", { camera: "fake" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("Point at the QR on the collar.").waitFor();
    await page.waitForTimeout(800);
    await snap("scan-camera-live", "/scan", "camera running (fake stream)", "Scan screen with a live camera feed and the bracket frame", { full: true });
  });

  // --- login ---
  await flow("login", {}, async ({ page, go, snap }) => {
    await go("/login");
    await snap("login-email", "/login", "email step, empty", "Sign in: email entry");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Type your email first.").waitFor();
    await snap("login-email-empty-error", "/login", "email step, submitted empty", "Validation: type your email first");
    await page.locator("#login-email").fill("priya.s@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Check your email.").waitFor();
    await snap("login-code", "/login", "code step, just sent", "Enter the 6-digit code, resend countdown");
    await page.locator("#login-code").fill("482");
    await snap("login-code-partial", "/login", "code step, 3 digits typed", "Code boxes partly filled");
    await page.locator("#login-code").fill("482915");
    await page.getByText("invalid_code").waitFor({ timeout: 10_000 }).catch(() => undefined);
    await snap("login-code-wrong", "/login", "code step, wrong code", "Wrong code error as the live API words it");
  });

  await flow("login-rate-limited", {
    api: [["POST", /^\/auth\/otp$/, () => fail(429, "RATE_LIMITED", "Too many codes requested for this address. Try again shortly.", { headers: { "retry-after": "300" } })]],
  }, async ({ page, go, snap }) => {
    await go("/login");
    await page.locator("#login-email").fill("priya.s@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("login-email-rate-limited", "/login", "email step, API refused (429)", "Error when too many codes were requested");
  });

  // --- me ---
  await flow("me-out", {}, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("Hello, stranger.").waitFor();
    await snap("me-signed-out", "/me", "signed out", "Me: sign-in prompt");
  });

  await flow("me-in", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("day streak").waitFor();
    await snap("me-signed-in", "/me", "signed in, 4 dogs", "Me: greeting, 12-day streak, badges, trust, my dogs, SOS paging");
    await page.getByRole("switch").click();
    await page.getByText("You won't be paged").waitFor().catch(() => undefined);
    await snap("me-sos-paging-off", "/me", "SOS paging switched off", "Me after turning SOS paging off (PATCH mocked)");
  });

  await flow("me-new", {
    signedIn: true,
    me: { trustScore: 12, sosOptIn: false },
    api: [
      ["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: [] })],
      ["GET", /^\/feeders\/me\/streak$/, () => ok({ trustScore: 12, streakDays: 0, badges: [], lastFeedDate: null, streakStart: null, trustLevel: { name: "New feeder", level: 1, nextThreshold: 40 } })],
    ],
  }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("No dogs yet").waitFor();
    await snap("me-new-feeder", "/me", "signed in, brand-new feeder", "Me with no streak, no badges, no dogs, low trust");
  });

  await flow("me-error", {
    signedIn: true,
    api: [["GET", /^\/feeders\/me\/streak$/, () => fail(500, "INTERNAL", "Something went wrong on our side.")]],
  }, async ({ page, go, snap }) => {
    await go("/me");
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("me-error", "/me", "load failed", "Me when the profile cannot load");
  });

  // --- feed ---
  await flow("feed", { signedIn: true, geo: true }, async ({ page, go, snap }) => {
    await go(`/feed?dog=${SLUG.rani}`);
    await page.getByRole("button", { name: "Log feed" }).waitFor();
    await snap("feed-ready", "/feed?dog=<slug>", "dog loaded", "Log a feed for Rani: photo, how did it go, streak caption");
    await page.locator('input[type="file"]').setInputFiles({ name: "rani.png", mimeType: "image/png", buffer: PHOTO });
    await page.getByRole("button", { name: "Looks unwell" }).click();
    await page.getByTestId("unwell-hint").waitFor();
    await snap("feed-photo-unwell", "/feed?dog=<slug>", "photo added, 'Looks unwell'", "Photo preview and the quiet SOS pointer");
    await page.getByRole("button", { name: "Looks unwell" }).click();
    await page.getByRole("button", { name: "Ate it all" }).click();
    await page.getByRole("button", { name: "Log feed" }).click();
    await page.getByText("Logged.").waitFor({ timeout: 15_000 });
    await snap("feed-logged", "/feed?dog=<slug>", "feed logged", "Success toast before returning to Me (POST mocked)", { scroll: false, idle: 500 });
  });

  await flow("feed-no-dog", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/feed");
    await page.getByText("Scan the collar of the dog you fed.").waitFor();
    await snap("feed-no-dog", "/feed", "no dog chosen", "Log a feed without a collar code");
  });

  // --- register ---
  await flow("register", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("Your registrations").waitFor();
    await page.getByText("days left").first().waitFor();
    await snap("register-dashboard", "/register", "3 registrations", "Registrations dashboard: pending with countdowns, one active");
  });

  await flow("register-empty", { signedIn: true, api: [["GET", /^\/registrations$/, () => ok({ registrations: [] })]] }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("No registrations yet").waitFor();
    await snap("register-dashboard-empty", "/register", "no registrations", "Dashboard empty state");
  });

  await flow("register-out", {}, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("Sign in first.").waitFor();
    await snap("register-signed-out", "/register", "signed out gate", "Registration gate: sign in first");
  });

  await flow("register-nocap", { signedIn: true, me: { role: "feeder", capabilities: ["feed"], canRegister: false } }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("One more step.").waitFor();
    await snap("register-no-capability", "/register", "feeder without registrator role", "Gate: enable registration (self-serve)");
  });

  await flow("register-new", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.getByText("New dog").waitFor();
    await page.waitForTimeout(500);
    await snap("register-new", "/register/new", "blank (home ward preselected)", "New dog form: photo, name, ward, self-reported toggles");
    await page.locator('input[type="file"]').setInputFiles({ name: "kalu.png", mimeType: "image/png", buffer: PHOTO });
    await page.locator("#reg-name").fill("Kalu");
    await page.getByRole("switch", { name: "Vaccinated" }).click();
    await page.getByRole("switch", { name: "Sterilised" }).click();
    await snap("register-new-filled", "/register/new", "filled in", "New dog form with photo, name and both toggles on");
  });

  await flow("register-new-budget", {
    signedIn: true,
    api: [["POST", /^\/registrations$/, () => fail(409, "REGISTRATION_BUDGET_EXCEEDED", "registration budget exceeded")]],
  }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.getByText("New dog").waitFor();
    await page.locator("#reg-name").fill("Bruno");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Save/ }).click();
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("register-new-budget-error", "/register/new", "two dogs already pending", "Error: two dogs are waiting for collars");
  });

  await flow("register-ready", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}/ready`);
    await page.getByText("has a code.").waitFor();
    await snap("register-ready", "/register/[slug]/ready", "pending activation", "Collar ready: QR tag, code, print and save as PDF");
  });

  await flow("register-print", { signedIn: true, widths: [390, 1440] }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}/print`);
    await page.waitForTimeout(800);
    await snap("register-print-sheet", "/register/[slug]/print", "screen", "TPU laser print sheet as seen on screen");
    await page.emulateMedia({ media: "print" });
    await snap("register-print-media", "/register/[slug]/print", "print media", "The same sheet with print CSS applied");
  });

  await flow("register-activate", { signedIn: true, geo: true, camera: "denied" }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Confirm attachment").waitFor();
    await snap("register-activate", `/register/[slug]`, "pending, not attached", "Activate: what to do next and confirm attachment");
    await page.locator("#activate-scan-input").fill(`${BASE}/d/${SLUG.moti}?s=abc`);
    await page.getByRole("button", { name: /attached it/ }).click();
    await page.locator("#activate-scan-error").waitFor();
    await snap("register-activate-mismatch", `/register/[slug]`, "wrong QR pasted", "Error: that QR is for another collar");
    await page.getByRole("button", { name: "Use camera to scan the tag" }).click();
    await page.getByText("Camera access was denied.").waitFor();
    await snap("register-activate-camera-denied", `/register/[slug]`, "camera denied", "In-page tag scanner: camera access denied");
    await page.locator("#activate-scan-input").fill("");
    await page.getByRole("button", { name: /Confirm without paste/ }).click();
    await page.getByText("Activated.").waitFor({ timeout: 15_000 });
    await snap("register-activated", `/register/[slug]`, "activated", "Success: the collar is live (scan POST mocked)");
  });

  await flow("register-activate-camera", { signedIn: true, camera: "fake" }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Confirm attachment").waitFor();
    await page.getByRole("button", { name: "Use camera to scan the tag" }).click();
    await page.getByText("Point the camera at the QR on the collar.").waitFor();
    await page.waitForTimeout(800);
    await snap("register-activate-camera", `/register/[slug]`, "camera scanning (fake stream)", "In-page tag scanner with a live feed");
  });

  await flow("register-active", { signedIn: true, regStatus: "active" }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.rani}`);
    await page.getByText("already active").waitFor();
    await snap("register-already-active", `/register/[slug]`, "already active", "Registration detail for an active collar");
  });

  // --- sos case (responder page) ---
  const caseFlows = [
    ["sos-case-open", CASE_ID.open, "open, takeable", "Responder case page: I can go and help"],
    ["sos-case-mine", CASE_ID.mine, "acked by me", "Responder holds the case: Mark resolved"],
    ["sos-case-other", CASE_ID.other, "acked by someone else", "Someone else is on the way"],
    ["sos-case-escalated", CASE_ID.escalated, "escalated", "Nobody took it in time; vets told"],
    ["sos-case-resolved", CASE_ID.resolved, "resolved", "Finished case"],
    ["sos-case-hidden", CASE_ID.hidden, "403 not yours", "This case isn't yours to see"],
    ["sos-case-error", CASE_ID.broken, "load failed", "Hetja could not be reached"],
  ];
  for (const [key, id, state, desc] of caseFlows) {
    await flow(key, { signedIn: true }, async ({ page, go, snap }) => {
      await go(`/sos/${id}`);
      await page.getByText("SOS case").first().waitFor();
      await page.waitForFunction(() => !document.body.innerText.includes("Loading the case."), null, { timeout: 15_000 });
      await snap(key, "/sos/[caseId]", state, desc);
      if (key === "sos-case-open") {
        await page.getByRole("button", { name: "I can go and help" }).click();
        await page.getByRole("button", { name: "Mark resolved" }).waitFor();
        await snap("sos-case-taken-by-me", "/sos/[caseId]", "just acked", "After tapping I can go and help (POST mocked)");
      }
      if (key === "sos-case-mine") {
        await page.getByRole("button", { name: "Mark resolved" }).click();
        await page.getByText("Has the dog been seen to?").waitFor();
        await snap("sos-case-confirm-resolve", "/sos/[caseId]", "confirm resolve", "Confirmation before closing the case");
      }
    });
  }

  await flow("sos-case-refused", {
    signedIn: true,
    api: [["POST", /^\/sos\/cases\/([^/]+)\/ack$/, () => fail(403, "SOS_ACK_FORBIDDEN", "not a trusted responder for this severity")]],
  }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.open}`);
    await page.getByRole("button", { name: "I can go and help" }).click();
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("sos-case-ack-refused", "/sos/[caseId]", "ack refused (403)", "The server refused the ack; the page explains why");
  });

  // --- map ---
  await flow("map", { widths: [390, 1440] }, async ({ page, go, snap, w }) => {
    await go("/map");
    await page.getByText("Mumbai right now").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1500);
    await snap("map-city", "/map", "city view, signed out", "Map of Mumbai wards with counts (fixture numbers on real ward positions)", { full: false, idle: 10_000 });
    if (w === 390) {
      await page.getByRole("button", { name: "Show more" }).click();
      await page.waitForTimeout(700);
      await snap("map-city-expanded", "/map", "city sheet expanded", "Bottom sheet pulled up: needs help and hungriest wards", { full: false });
    }
    await page.goto(`${BASE}/map#ward=${encodeURIComponent("K/W")}`, { waitUntil: "load" });
    await page.getByRole("button", { name: "I can go and help" }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1800);
    await snap("map-ward", "/map#ward=K%2FW", "K/W ward selected, signed out", "Ward sheet: open SOS, nearby vets and NGOs", { full: false, idle: 10_000 });
    if (w === 390) {
      await page.getByRole("button", { name: "I can go and help" }).click();
      await page.getByText("Sign in first.").waitFor();
      await snap("map-ward-need-sign-in", "/map#ward=K%2FW", "help tapped while signed out", "Footer asks the visitor to sign in first", { full: false });
    }
  });

  await flow("map-in", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("K/W")}`);
    await page.getByRole("button", { name: "I can go and help" }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1800);
    await snap("map-ward-signed-in", "/map#ward=K%2FW", "K/W selected, signed-in responder", "Ward sheet for a trusted responder", { full: false, idle: 10_000 });
    await page.getByRole("button", { name: "I can go and help" }).click();
    await page.getByText("It's yours.").waitFor();
    await snap("map-ward-acked", "/map#ward=K%2FW", "case taken", "After taking the case from the map (POST mocked)", { full: false });
    const pin = page.locator('.leaflet-marker-icon[aria-label="Lokhandwala Pet Hospital"]');
    if (await pin.count()) {
      await pin.first().dispatchEvent("click");
      await page.getByText("Phone").first().waitFor();
      await page.waitForTimeout(1200);
      await snap("map-place", "/map", "vet selected", "Place sheet: a partner vet with phone and hours", { full: false });
    }
    await page.goto(`${BASE}/map#ward=${encodeURIComponent("P/N")}`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Get alerts for/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1800);
    await snap("map-ward-hungry", "/map#ward=P%2FN", "P/N selected, no SOS", "Ward with hungry dogs only: Get alerts for this ward", { full: false });
  });

  await flow("map-loading", { api: [["GET", /^\/map\/wards$/, async (_m, ctx) => ({ ...ok({ wards: await augmentedWards(ctx) }), delayMs: 30_000 })]] }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("Counting the dogs.").waitFor();
    await snap("map-loading", "/map", "wards loading", "Map before the numbers arrive", { full: false, idle: 1500 });
  });

  await flow("map-error", { api: [["GET", /^\/map\/wards$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("The numbers are not.").waitFor();
    await snap("map-error", "/map", "wards failed", "Map error: the map is here, the numbers are not", { full: false });
  });

  await flow("map-live", { widths: [390], api: [["GET", /^\/map\/wards$/, () => undefined], ["GET", /^\/map\/wards\/([^/]+)$/, () => undefined], ["GET", /^\/map\/places$/, () => undefined]] }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("Mumbai right now").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1500);
    await snap("map-live-production", "/map", "real production data (unmocked GETs)", "What the live map shows today, with no dogs registered", { full: false, idle: 10_000 });
  });

  // --- the collar page (apps/scan at /d/<slug>) ---
  await flow("d-rani", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await snap("d-profile-photo", "/d/<slug>", "profile with photo, vaccinated, sterilised, story", "Collar page for Rani (fixture photo illustration)");
  });

  await flow("d-bruno", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.bruno}`);
    await page.locator("h1.name").waitFor();
    await snap("d-profile-no-photo", "/d/<slug>", "no photo, unknown vaccination, not sterilised, no story", "Collar page for Bruno with the initial-letter placeholder");
  });

  await flow("d-moti", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.moti}`);
    await page.locator("h1.name").waitFor();
    await snap("d-profile-no-feeders", "/d/<slug>", "no feeders, no feeds yet", "Collar page for a dog nobody has fed on Hetja yet");
  });

  await flow("d-feeder", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.kalu}`);
    await page.locator("h1.name").waitFor();
    await snap("d-profile-feeder-signed-in", "/d/<slug>", "visitor is a signed-in feeder", "Collar page with the quiet Log a feed link");
  });

  await flow("d-stale", { api: [["GET", /^\/dogs\/([^/]+)$/, (m) => ok(DOGS[m[1]] ?? DOGS[SLUG.rani], { headers: { "x-hetja-stale": "1" } })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator(".banner").waitFor();
    await snap("d-profile-stale", "/d/<slug>", "offline, saved profile", "Banner: showing a saved profile, status may be outdated");
  });

  await flow("d-loading", { api: [["GET", /^\/dogs\/([^/]+)$/, (m) => ({ ...ok(DOGS[m[1]]), delayMs: 30_000 })]] }, async ({ go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await snap("d-loading", "/d/<slug>", "loading", "Collar page before the profile arrives", { idle: 1000 });
  });

  await flow("d-not-found", { api: [["GET", /^\/dogs\/([^/]+)$/, () => undefined]] }, async ({ page, go, snap }) => {
    await go(`/d/${UNKNOWN_SLUG}`);
    await page.getByText("Unavailable").waitFor();
    await snap("d-not-found", "/d/<unknown slug>", "unknown collar (real production 404)", "What a stranger sees for a code that is not registered");
  });

  await flow("d-invalid", {}, async ({ page, go, snap }) => {
    await go("/d/abc");
    await page.getByText("Unrecognized code").waitFor();
    await snap("d-invalid-code", "/d/<malformed>", "malformed code", "Collar page for a URL that is not a valid code");
  });

  await flow("d-sos", {
    geo: true,
    api: [
      ["POST", /^\/reports$/, () => ({ ...ok({ created: true, caseId: CASE_ID.open, tier: 1, fanout: "responders", nearbyCare: CARE }), delayMs: 5000 })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok({ state: "acked", ackedAt: new Date().toISOString(), escalatedAt: null, resolvedAt: null })],
    ],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.getByText("How bad is it?").first().waitFor();
    await snap("d-sos-choose", "/d/<slug> (SOS step 1)", "nothing chosen", "How bad is it? Three choices, Send SOS disabled");
    await page.locator(".opt", { hasText: "Can't get up, or bleeding" }).click();
    await snap("d-sos-chosen", "/d/<slug> (SOS step 1)", "severity chosen", "Can't get up, or bleeding selected; Send SOS enabled");
    await page.locator("#add").click();
    await page.locator("#sos-note").fill("Hit by an auto near the SV Road signal, back leg bleeding. She is lying by the juice cart.");
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#photo-btn").click();
    await (await chooser).setFiles({ name: "sos.png", mimeType: "image/png", buffer: PHOTO });
    await page.getByText("Photo added").waitFor();
    await page.locator("#sos-note").blur();
    await snap("d-sos-note-photo", "/d/<slug> (SOS step 1)", "note and photo added", "Optional note and photo filled in");
    await page.locator("#send").click();
    await page.getByText("Sending…").waitFor();
    await snap("d-sos-sending", "/d/<slug> (SOS step 1)", "sending", "Send SOS in flight (POST mocked, delayed)", { scroll: false, idle: 300 });
    await page.getByText("SOS sent.").waitFor({ timeout: 15_000 });
    await snap("d-sos-sent", "/d/<slug> (SOS sent)", "sent, waiting for reply", "SOS sent: case pill, call now list, first aid");
    console.log("  waiting 16 s for the case poll (acked)");
    await page.waitForTimeout(16_500);
    await page.getByText("On the way").waitFor({ timeout: 10_000 });
    await snap("d-sos-acked", "/d/<slug> (SOS sent)", "someone is on the way", "Case poll says acked: On the way");
  });

  await flow("d-sos-other", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.bruno}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.locator(".opt", { hasText: "Something else" }).click();
    await page.locator("#send").click();
    await page.getByText("SOS sent.").waitFor({ timeout: 15_000 });
    await snap("d-sos-sent-needs-checking", "/d/<slug> (SOS sent)", "sent, 'Something else'", "SOS sent for a less urgent case (warn pill)");
  });

  await flow("d-sos-ratelimited", {
    api: [["POST", /^\/reports$/, () => ({ status: 429, json: { ok: false, error: { code: "RATE_LIMITED", message: "too many reports", data: { nearbyCare: CARE } } }, headers: { "retry-after": "600" } })]],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.locator(".opt", { hasText: "Hurt, but moving" }).click();
    await page.locator("#send").click();
    await page.getByText("SOS not sent.").waitFor();
    await snap("d-sos-rate-limited", "/d/<slug> (SOS sent)", "not sent, rate limited (429)", "This phone hit the report limit; numbers still shown");
  });

  await flow("d-sos-failed-noloc", {
    api: [["POST", /^\/reports$/, () => fail(500, "INTERNAL", "internal error")]],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.locator(".opt", { hasText: "Hurt, but moving" }).click();
    await page.locator("#send").click();
    await page.getByText("SOS not sent.").waitFor();
    await page.getByText("No nearby help loaded").waitFor({ timeout: 15_000 });
    await snap("d-sos-failed-no-location", "/d/<slug> (SOS sent)", "not sent, location denied", "Report failed and no location: honest guidance, no fake number");
  });

  await flow("d-sos-failed-loc", {
    geo: true,
    api: [["POST", /^\/reports$/, () => fail(500, "INTERNAL", "internal error")]],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.locator(".opt", { hasText: "Can't get up, or bleeding" }).click();
    await page.locator("#send").click();
    await page.getByText("SOS not sent.").waitFor();
    await page.locator("#care a.tint").first().waitFor({ timeout: 15_000 });
    await snap("d-sos-failed-with-care", "/d/<slug> (SOS sent)", "not sent, nearby care found", "Report failed; care list from the visitor's location");
  });

  // Route interception outlives setOffline(), so the report is failed here
  // explicitly and navigator.onLine is forced false for the page.
  await flow("d-sos-offline", { api: [["POST", /^\/reports$/, () => ({ status: 0, abort: true })]] }, async ({ page, context, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.locator("h1.name").waitFor();
    await page.locator("#primary-cta").click();
    await page.locator(".opt", { hasText: "Can't get up, or bleeding" }).click();
    await context.setOffline(true);
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.locator("#send").click();
    await page.getByText("SOS not sent.").waitFor();
    await page.waitForTimeout(600);
    await snap("d-sos-offline", "/d/<slug> (SOS sent)", "offline", "No signal: a text message with the details is prepared", { idle: 200 });
    await context.setOffline(false);
  });
}

// ---------------------------------------------------------------------------
// Index and zip
// ---------------------------------------------------------------------------

function writeIndex() {
  const rows = [...index.values()].sort((a, b) => a.n - b.n);
  const lines = [
    "# Hetja screens",
    "",
    `Captured ${new Date().toISOString()} from ${BASE} with Microsoft Edge (Playwright).`,
    "",
    "Every screen is at 390 x 844 (device scale 2) as a viewport shot and a full-page shot (`-full`, identical when the screen fits).",
    "Marketing pages and the map are also at 1440 x 900. Map shots are viewport-only (the map does not scroll).",
    "",
    "Data: production has almost no dogs yet, so dogs, feeders, cases, vets and counts come from fixtures shaped exactly like the",
    "real API responses (except `map-live-production`, which is unmocked; dogs Rani, Bruno, Kalu, Moti in K/W Andheri West; feeder Priya S.). Clinic and NGO names and phone",
    "numbers are fictional. Dog photos are placeholder illustrations. Ward positions on the map are real.",
    "Nothing was written to production: every POST and PATCH was answered by the script.",
    "",
    "| No | Route | State | Description | Files |",
    "|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const esc = (s) => String(s).replace(/\|/g, "\\|");
    lines.push(`| ${String(r.n).padStart(2, "0")} | \`${esc(r.route)}\` | ${esc(r.state)} | ${esc(r.desc)} | ${r.files.join("<br>")} |`);
  }
  if (failures.length) {
    lines.push("", "## Not captured", "", ...failures.map((f) => `- ${f}`));
  }
  writeFileSync(path.join(OUT, "INDEX.md"), `${lines.join("\n")}\n`, "utf8");
}

function zipOut() {
  if (existsSync(ZIP)) rmSync(ZIP);
  const files = readdirSync(OUT);
  if (process.platform === "win32") {
    // bsdtar ships with Windows 10+ and writes zip with -a.
    // The System32 one explicitly: Git for Windows puts a GNU tar earlier on PATH.
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(tar, ["-a", "-c", "-f", ZIP, ...files], { cwd: OUT, stdio: "inherit" });
  } else {
    execFileSync("zip", ["-q", "-r", ZIP, "."], { cwd: OUT, stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!ONLY.length && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  console.log(`Base ${BASE}\nOut  ${OUT}`);
  browser = await chromium.launch({ channel: "msedge" });
  try {
    PHOTO = await photoPng(browser);
    await defineFlows();
  } finally {
    await browser.close();
  }
  writeIndex();
  zipOut();
  const pngs = readdirSync(OUT).filter((f) => f.endsWith(".png")).length;
  console.log(`\n${pngs} PNGs, ${index.size} screens -> ${OUT}\nZip -> ${ZIP}`);
  console.log(`\nNetwork audit: ${audit.passedGet} GET/HEAD passed through; ${audit.mocked.length} writes answered by mocks; ${audit.blocked.length} writes blocked by the guard.`);
  for (const b of audit.blocked) console.log(`  blocked ${b}`);
  if (process.env.HETJA_SCREENS_VERBOSE) for (const m of audit.mocked) console.log(`  mocked ${m}`);
  if (failures.length) {
    console.log(`\n${failures.length} flow(s) failed:`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

await main();
