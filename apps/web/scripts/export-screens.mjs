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
const OUT = path.resolve(process.env.HETJA_SCREENS_OUT ?? path.join(path.dirname(REPO), "Hetja-screens-v6"));
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
// Fixtures (shapes mirror apps/api/src/routes/*.ts and the v5/v6 blocks of
// apps/web/lib/api.ts and apps/scan/src/api.ts)
// ---------------------------------------------------------------------------

const SLUG = { rani: "r4n7kw2ab", bruno: "b8ru3xm6q", kalu: "k2au9pd3z", moti: "m6ot5hce4", goli: "g5oq8vy3n", tiger: "t7ig3rw4e" };
/** One character off Rani's code: the V3 "did you mean" case. */
const SLUG_TYPO = "r4n7kw2ac";
const UNKNOWN_SLUG = "zz9q8w7e6";
const photoUrl = (name) => `${BASE}/photos/fixture-${name}.svg`;

/** Next 08:00 in Asia/Kolkata, as ISO (the L1 "paused until 8 am"). */
function tomorrow8am() {
  const istNow = new Date(NOW + 5.5 * 3600_000);
  const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 8, 0) - 5.5 * 3600_000);
  return d.toISOString();
}

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
    verified: true,
    tagUnderReview: false,
    sturdierCollarSuggested: false,
    memorial: null,
    sex: null,
    feeders: [],
    lastFedBy: null,
    scanCount: 0,
    ...over,
  };
}

const DOGS = {
  [SLUG.rani]: dog({
    slug: SLUG.rani,
    name: "Rani",
    sex: "female",
    photoKey: "photos/fixture-rani.svg",
    photoUrl: photoUrl("rani"),
    abcStatus: "sterilised",
    vaccineStatus: "Anti-Rabies · 2026-03-14",
    vaccinated: "yes",
    sterilised: "yes",
    microStory:
      "Rani sleeps under the sugarcane-juice cart near the Four Bungalows bus stop and walks the lane at seven every evening like she owns it. She does. Loves parle-G, hates the red scooter.",
    lastFedAt: ago(125),
    feederCount: 2,
    storyAuthorCount: 2,
    feeders: [{ firstName: "Priya" }, { firstName: "Arjun" }],
    lastFedBy: "Priya",
    scanCount: 214,
  }),
  [SLUG.bruno]: dog({
    slug: SLUG.bruno,
    name: "Bruno",
    sex: "male",
    sterilised: "no",
    lastFedAt: ago(60 * 26),
    feederCount: 2,
    feeders: [{ firstName: "Priya" }, { firstName: null }],
    lastFedBy: null,
    scanCount: 38,
  }),
  [SLUG.kalu]: dog({
    slug: SLUG.kalu,
    name: "Kalu",
    sex: "male",
    photoKey: "photos/fixture-kalu.svg",
    photoUrl: photoUrl("kalu"),
    vaccineStatus: "Anti-Rabies · 2026-06-02",
    vaccinated: "yes",
    sterilised: "yes",
    microStory: "Kalu guards the Four Bungalows bus stop and walks late commuters to the corner. Tips not required.",
    lastFedAt: ago(40),
    feederCount: 3,
    storyAuthorCount: 1,
    feeders: [{ firstName: "Priya" }, { firstName: "Meera" }, { firstName: "Anil" }],
    lastFedBy: "Meera",
    scanCount: 96,
  }),
  [SLUG.moti]: dog({ slug: SLUG.moti, name: "Moti", sex: "male", lastFedAt: null, feederCount: 0, scanCount: 3 }),
  [SLUG.goli]: dog({ slug: SLUG.goli, name: "Goli", sex: "female", verified: false, lastFedAt: ago(60 * 20), feederCount: 1, feeders: [{ firstName: "Anil" }], lastFedBy: "Anil", scanCount: 4 }),
  [SLUG.tiger]: dog({ slug: SLUG.tiger, name: "Tiger", sex: "male", photoUrl: photoUrl("tiger"), vaccinated: "yes", sterilised: "yes", lastFedAt: ago(200), feederCount: 2, feeders: [{ firstName: "Priya" }, { firstName: "Meera" }], lastFedBy: "Meera", scanCount: 57 }),
};

/** The profile for a slug with the flow's per-dog overrides applied. */
function dogV6(slug, s = {}) {
  const base = DOGS[slug];
  if (!base) return null;
  return { ...base, ...((s.dogOver ?? {})[slug] ?? {}) };
}

function card(slug, over = {}) {
  const d = DOGS[slug];
  return {
    slug,
    name: d?.name ?? null,
    wardId: "K-West",
    wardCode: "K/W",
    photoUrl: d?.photoUrl ?? null,
    markings: [],
    lastSeenAt: ago(60 * 24 * 4),
    sex: d?.sex ?? null,
    ...over,
  };
}

const CARD = {
  rani: card(SLUG.rani, { markings: ["Brown", "White chest"] }),
  rani2: card("r4n7kw2cd", { name: "Raja", photoUrl: photoUrl("kalu"), markings: ["Black"], sex: "male" }),
  kalu: card(SLUG.kalu, { markings: ["Black", "White chest"] }),
  bruno: card(SLUG.bruno, { markings: ["Brown", "Limps"] }),
  moti: card(SLUG.moti, { markings: ["White", "Spotted"] }),
  goli: card(SLUG.goli, { markings: ["Brown"] }),
  tiger: card(SLUG.tiger, { markings: ["Brown", "Spotted"] }),
};

const WARD_DOGS = [CARD.rani, CARD.kalu, CARD.bruno, CARD.moti, CARD.goli, CARD.tiger,
  card("c9ho2tu4k", { name: "Chotu", markings: ["White"] }), card("s3he5ru8a", { name: "Sheru", markings: ["Black"] }), card("l0ve", { slug: "p4ar8mi2d", name: null, markings: ["Brown"] })];

function wardDogs(wardId, colour) {
  const wardCode = { "K-West": "K/W", "H-West": "H/W", "P-North": "P/N", "K-East": "K/E" }[wardId] ?? wardId;
  const all = WARD_DOGS.map((d) => ({ ...d, wardId, wardCode }));
  const dogs = colour ? all.filter((d) => d.markings.some((m) => m.toLowerCase().includes(colour))) : all;
  return { wardId, total: all.length, colourTotal: dogs.length, dogs };
}

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
  wards: ["K-West", "H-West"],
  quietHours: { start: "23:00", end: "06:00" },
  alertsMode: "all",
  onboarded: true,
  publicName: "Priya S.",
  showFirstName: true,
  sosPausedUntil: null,
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

const STREAK_NEW = { trustScore: 0, streakDays: 0, badges: [], lastFeedDate: null, streakStart: null, trustLevel: { name: "New feeder", level: 1, nextThreshold: 40 } };

function myDog(slug, over) {
  const d = DOGS[slug];
  return {
    slug,
    name: d.name,
    wardId: "K-West",
    wardName: "Andheri West",
    lastFedAt: d.lastFedAt,
    myLastFedAt: d.lastFedAt,
    photoUrl: d.photoUrl,
    status: "active",
    verified: d.verified,
    registeredByMe: true,
    lastFedByName: null,
    attention: null,
    sex: d.sex,
    ...over,
  };
}

const MY_DOGS_V5 = [
  myDog(SLUG.rani, { attention: { kind: "sos", since: ago(12), detail: null } }),
  myDog(SLUG.kalu, { attention: { kind: "tag", since: ago(35), detail: "found_on_ground" }, myLastFedAt: ago(60 * 5), lastFedByName: "Meera" }),
  myDog(SLUG.moti, { attention: { kind: "missing", since: ago(60 * 24 * 9), detail: null }, lastFedAt: ago(60 * 24 * 9), myLastFedAt: ago(60 * 24 * 9) }),
  myDog(SLUG.bruno, { attention: { kind: "vet", since: ago(60 * 24), detail: "2026-10" }, registeredByMe: false }),
  myDog(SLUG.tiger, { lastFedByName: "Meera", myLastFedAt: ago(60 * 26), registeredByMe: false }),
  myDog(SLUG.goli, { attention: { kind: "new", since: ago(60 * 20), detail: null }, verified: false, registeredByMe: false, myLastFedAt: ago(60 * 22), lastFedByName: "Anil" }),
];

function meCacheSnapshot() {
  return { savedAt: new Date(NOW - 2.5 * 3600_000).toISOString(), streak: STREAK, me: ME, dogs: MY_DOGS_V5 };
}

const ALERTS = [
  { id: "a1", kind: "sos", at: ago(12), dog: { slug: SLUG.rani, name: "Rani" }, wardCode: "K/W", actorName: "Anil", detail: null, href: `/sos/5b1f2c9e-8a47-4d2b-9f61-2e7c3a90d4b8` },
  { id: "a2", kind: "tag", at: ago(35), dog: { slug: SLUG.kalu, name: "Kalu" }, wardCode: "K/W", actorName: null, detail: "found_on_ground", href: `/me/dogs/${SLUG.kalu}/tag` },
  { id: "a3", kind: "fed", at: ago(95), dog: { slug: SLUG.kalu, name: "Kalu" }, wardCode: "K/W", actorName: "Meera", detail: "Rice and egg", href: `/me/dogs/${SLUG.kalu}` },
  { id: "a4", kind: "verified", at: ago(60 * 26), dog: { slug: SLUG.tiger, name: "Tiger" }, wardCode: "K/W", actorName: "Dr Mehta", detail: "vaccinated,sterilised", href: `/me/dogs/${SLUG.tiger}` },
  { id: "a5", kind: "not_seen", at: ago(60 * 30), dog: { slug: SLUG.moti, name: "Moti" }, wardCode: "K/W", actorName: null, detail: "9", href: `/me/dogs/${SLUG.moti}/status` },
  { id: "a6", kind: "status", at: ago(60 * 24 * 4), dog: { slug: SLUG.bruno, name: "Bruno" }, wardCode: "K/W", actorName: "Arjun", detail: "active", href: `/me/dogs/${SLUG.bruno}` },
];

const collarUrl = (slug) => `${BASE}/d/${slug}?s=Xk3v9QpL2mZt7RbW`;

const REGS_V6 = [
  { slug: SLUG.kalu, name: "Kalu", status: "pending_activation", wardId: "K-West", registeredAt: ago(60 * 24 * 25), expiresAt: inDays(5), printedAt: ago(60 * 24 * 3), daysLeft: 5, scanCount: 0, liveSince: null, lastScanAt: null, feederNames: [] },
  { slug: SLUG.goli, name: "Goli", status: "pending_activation", wardId: "K-West", registeredAt: ago(60 * 24 * 18), expiresAt: inDays(12), printedAt: null, daysLeft: 12, scanCount: 0, liveSince: null, lastScanAt: null, feederNames: [] },
  { slug: SLUG.bruno, name: "Bruno", status: "expired", wardId: "K-West", registeredAt: ago(60 * 24 * 40), expiresAt: ago(60 * 24 * 10), printedAt: ago(60 * 24 * 38), daysLeft: 0, scanCount: 0, liveSince: null, lastScanAt: null, feederNames: [] },
  { slug: SLUG.rani, name: "Rani", status: "active", wardId: "K-West", registeredAt: ago(60 * 24 * 70), printedAt: ago(60 * 24 * 69), daysLeft: null, scanCount: 214, liveSince: ago(60 * 24 * 68), lastScanAt: ago(125), feederNames: ["Arjun"] },
  { slug: SLUG.tiger, name: "Tiger", status: "active", wardId: "K-West", registeredAt: ago(60 * 24 * 120), printedAt: ago(60 * 24 * 119), daysLeft: null, scanCount: 1, liveSince: ago(60 * 24 * 110), lastScanAt: ago(60 * 24 * 30), feederNames: ["Meera"] },
];

function registrationsV6({ full = false } = {}) {
  const pend = REGS_V6.filter((r) => r.status === "pending_activation");
  return {
    registrations: REGS_V6,
    budget: { pending: full ? 2 : pend.length, max: 2, holders: pend.map((r) => ({ slug: r.slug, name: r.name, printedAt: r.printedAt, daysLeft: r.daysLeft })) },
  };
}

function regDetail(slug, s) {
  const r = REGS_V6.find((x) => x.slug === slug) ?? { ...REGS_V6[0], slug, name: DOGS[slug]?.name ?? null };
  const status = s.regStatus ?? r.status;
  const out = { ...r, status, collarUrl: collarUrl(slug), ...(s.regOver ?? {}) };
  if (status !== "pending_activation" && status !== "expired") delete out.expiresAt;
  return out;
}

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
    distanceM: null,
  },
];
const CARE_SCAN = CARE.map((c, i) => ({ ...c, phone: c.phoneE164, openNow: i === 2 ? false : true }));

const PLACES = [
  { id: "p-vet-1", name: "Lokhandwala Pet Hospital", kind: "vet", careKind: "private_clinic", wardId: "K-West", locality: "Andheri West", lat: 19.1405, lng: 72.8262, hoursNote: null, is24x7: true, hasAmbulance: true, phoneE164: "+912226300101", confirmed: true, partner: true, geoPrecision: "exact" },
  { id: "p-ngo-1", name: "Versova Animal Welfare Trust", kind: "ngo", careKind: "ngo", wardId: "K-West", locality: "Versova", lat: 19.131, lng: 72.815, hoursNote: "Open till 7 pm", is24x7: false, hasAmbulance: false, phoneE164: "+919820012345", confirmed: true, partner: false, geoPrecision: "exact" },
  { id: "p-vet-2", name: "Juhu Paws Clinic", kind: "vet", careKind: "private_clinic", wardId: "K-West", locality: "Juhu", lat: 19.1075, lng: 72.8295, hoursNote: "Open till 9 pm", is24x7: false, hasAmbulance: false, phoneE164: "+912226150987", confirmed: false, partner: false, geoPrecision: "exact" },
  { id: "p-vet-3", name: "Malad Pet Care", kind: "vet", careKind: "private_clinic", wardId: "P-North", locality: "Malad West", lat: 19.187, lng: 72.848, hoursNote: "Open till 8 pm", is24x7: false, hasAmbulance: false, phoneE164: "+912228801122", confirmed: true, partner: true, geoPrecision: "exact" },
];

/** Per-ward overlays on the real GET /map/wards (which carries real lat/lng). */
const WARD_COUNTS = {
  "K-West": { dogs: 14, notFedToday: 0, sosOpen: 1, latestSos: { severity: "critical", raisedAt: ago(13) } },
  "H-West": { dogs: 11, notFedToday: 0, sosOpen: 1, latestSos: { severity: "serious", raisedAt: ago(47) } },
  "K-East": { dogs: 9, notFedToday: 5, sosOpen: 0, latestSos: null },
  "P-North": { dogs: 6, notFedToday: 4, sosOpen: 0, latestSos: null },
  "G-North": { dogs: 7, notFedToday: 3, sosOpen: 0, latestSos: null },
  A: { dogs: 4, notFedToday: 2, sosOpen: 0, latestSos: null },
  "R-Central": { dogs: 3, notFedToday: 3, sosOpen: 0, latestSos: null },
  S: { dogs: 5, notFedToday: 0, sosOpen: 0, latestSos: null },
};
const WARD_COUNTS_CALM = {
  "K-West": { dogs: 14, notFedToday: 0, sosOpen: 0, latestSos: null },
  "H-West": { dogs: 11, notFedToday: 0, sosOpen: 0, latestSos: null },
  "K-East": { dogs: 9, notFedToday: 1, sosOpen: 0, latestSos: null },
  "P-North": { dogs: 6, notFedToday: 3, sosOpen: 0, latestSos: null },
  "G-North": { dogs: 7, notFedToday: 0, sosOpen: 0, latestSos: null },
  A: { dogs: 4, notFedToday: 0, sosOpen: 0, latestSos: null },
  "R-Central": { dogs: 3, notFedToday: 0, sosOpen: 0, latestSos: null },
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
  dogless: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
  hw: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
};

function sosCaseV6(id, over) {
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
    ackedBy: null,
    dog: { slug: SLUG.rani, name: "Rani", photoUrl: photoUrl("rani"), sex: "female" },
    reporterAnonymous: true,
    reporterPhotoUrl: photoUrl("rani"),
    note: "Hit by an auto near the SV Road signal, back leg bleeding. She is lying by the juice cart.",
    respondingName: null,
    respondersPaged: 3,
    nearestCare: { name: "Lokhandwala Pet Hospital", phoneE164: "+912226300101" },
    declinedByMe: false,
    location: null,
    timeline: [
      { at: ago(12), kind: "raised", detail: null },
      { at: ago(12), kind: "told", detail: "3 feeders" },
      { at: new Date(NOW + 18 * 60_000).toISOString(), kind: "escalation_due", detail: null },
    ],
    feedersTold: 3,
    vetsTold: 0,
    ngosTold: 0,
    escalatesAt: new Date(NOW + 18 * 60_000).toISOString(),
    distanceM: 1400,
    outcome: null,
    vetName: null,
    closeByAt: null,
    arrivedAt: null,
    reporterUpdates: [],
    reporterLeftAt: null,
    dogless: false,
    ...over,
  };
}

const SPOT = { lat: 19.13702, lng: 72.83011 };

const CASES_V6 = {
  open: sosCaseV6(CASE_ID.open, {}),
  mine: sosCaseV6(CASE_ID.mine, {
    state: "acked",
    ackedAt: ago(5),
    mine: true,
    ackedBy: ME.feederId,
    respondingName: "Priya",
    location: SPOT,
    escalatesAt: null,
    timeline: [
      { at: ago(17), kind: "raised", detail: null },
      { at: ago(17), kind: "told", detail: "3 feeders" },
      { at: ago(5), kind: "taken", detail: "Priya" },
    ],
    openedAt: ago(17),
  }),
  other: sosCaseV6(CASE_ID.other, {
    state: "acked",
    ackedAt: ago(4),
    openedAt: ago(15),
    respondingName: "Arjun",
    escalatesAt: null,
    timeline: [
      { at: ago(15), kind: "raised", detail: null },
      { at: ago(15), kind: "told", detail: "3 feeders" },
      { at: ago(4), kind: "taken", detail: "Arjun" },
    ],
  }),
  escalated: sosCaseV6(CASE_ID.escalated, {
    state: "escalated",
    openedAt: ago(62),
    escalatedAt: ago(28),
    feedersTold: 3,
    vetsTold: 4,
    escalatesAt: null,
    timeline: [
      { at: ago(62), kind: "raised", detail: null },
      { at: ago(62), kind: "told", detail: "3 feeders" },
      { at: ago(28), kind: "escalated", detail: "4 vets" },
    ],
  }),
  resolved: sosCaseV6(CASE_ID.resolved, {
    state: "resolved",
    openedAt: ago(50),
    ackedAt: ago(45),
    closeByAt: ago(30),
    arrivedAt: ago(26),
    resolvedAt: ago(8),
    mine: true,
    ackedBy: ME.feederId,
    respondingName: "Priya",
    outcome: "taken_to_vet",
    vetName: "Lokhandwala Pet Hospital",
    resolution: "Taken to the vet",
    escalatesAt: null,
    timeline: [
      { at: ago(50), kind: "raised", detail: null },
      { at: ago(50), kind: "told", detail: "3 feeders" },
      { at: ago(45), kind: "taken", detail: "Priya" },
      { at: ago(30), kind: "close_by", detail: null },
      { at: ago(26), kind: "arrived", detail: null },
      { at: ago(8), kind: "resolved", detail: "Taken to a vet" },
    ],
  }),
};

function reportStatus(over = {}) {
  return {
    state: "open",
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    responderFirstName: null,
    takenAt: null,
    closeByAt: null,
    arrivedAt: null,
    outcome: null,
    vetName: null,
    feedersNotifiedNames: ["Priya", "Arjun"],
    feedersNotified: 2,
    vetsNotified: 1,
    updates: [],
    leftAt: null,
    ...over,
  };
}

function dogWeek({ overdue = false } = {}) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = kolkataDay(NOW - i * 86_400_000);
    if (overdue) {
      const fed = ![4, 2].includes(i);
      days.push({ date, fed, outcome: i === 3 ? "didnt_eat" : fed ? "ate_all" : null, byFirstName: fed ? (i % 2 ? "Arjun" : "Priya") : null });
    } else {
      days.push({ date, fed: i !== 5, outcome: i === 3 ? "didnt_eat" : i === 5 ? null : i % 3 === 0 ? "ate_some" : "ate_all", byFirstName: i === 5 ? null : i % 2 ? "Arjun" : "Priya" });
    }
  }
  return {
    days,
    feederNames: ["Priya S.", "Arjun M."],
    rabiesDue: overdue ? { lastGiven: "2025-08-10", dueDate: "2026-08-01" } : { lastGiven: "2026-03-14", dueDate: "2027-03-01" },
    vetRecordCount: overdue ? 1 : 3,
  };
}

const DOG_TAGS = {
  open: [
    { id: "tr-10", kind: "found_on_ground", createdAt: ago(12), reporter: "a passer-by" },
    { id: "tr-11", kind: "wrong_dog", createdAt: ago(60 * 20), reporter: "Arjun" },
  ],
  history: [
    { kind: "reported", at: ago(12), detail: "found_on_ground", byName: null },
    { kind: "resolved", at: ago(60 * 24 * 3), detail: "reprinted", byName: "Priya S." },
    { kind: "reported", at: ago(60 * 24 * 4), detail: "damaged", byName: "Meera" },
    { kind: "printed", at: ago(60 * 24 * 69), detail: "10", byName: "Priya S." },
    { kind: "registered", at: ago(60 * 24 * 70), detail: null, byName: "Priya S." },
  ],
  reportsThisWeek: 3,
  sturdierCollarSuggested: true,
};

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const ok = (data, extra = {}) => ({ status: 200, json: { ok: true, data }, ...extra });
const fail = (status, code, message, extra = {}) => ({ status, json: { ok: false, error: { code, message } }, ...extra });
const UNAUTH = fail(401, "UNAUTHENTICATED", "sign in required");

/** A 9-character query with `?` for unknowns, against the fixture dogs. */
function lookup(code) {
  const c = (code ?? "").toLowerCase();
  const all = Object.values(CARD);
  if (DOGS[c]) return { exact: card(c, CARD[Object.keys(SLUG).find((k) => SLUG[k] === c)] ?? {}), matches: [], suggestions: [] };
  if (c === SLUG_TYPO) return { exact: null, matches: [], suggestions: [CARD.rani] };
  if (c.includes("?")) {
    const re = new RegExp(`^${c.replace(/\?/g, ".")}$`);
    return { exact: null, matches: all.filter((d) => re.test(d.slug)), suggestions: [] };
  }
  return { exact: null, matches: [], suggestions: [] };
}

/**
 * Default answers. `s` is the flow's scenario: { signedIn, me, ...overrides }.
 * Return undefined from a GET handler to pass it through to the real server.
 * Every non-GET MUST return a mock; the guard aborts anything that slips by.
 * `s.state` is per-context memory (e.g. a case acked by this browser).
 */
function defaultHandlers(s) {
  const authed = () => s.signedIn;
  const me = () => ({ ...ME, ...(s.me ?? {}) });
  const st = (s.state ??= {});
  const caseById = (id) => {
    const key = Object.keys(CASE_ID).find((k) => CASE_ID[k] === id);
    const base = CASES_V6[key] ?? sosCaseV6(id, {});
    if (st.acked?.[id]) return { ...base, state: "acked", ackedAt: st.acked[id], mine: true, ackedBy: ME.feederId, respondingName: "Priya", location: SPOT };
    if (st.declined?.[id]) return { ...base, declinedByMe: true };
    return base;
  };
  return [
    // --- public reads ---
    ["GET", /^\/dogs\/lookup$/, (_m, ctx) => ok(lookup(ctx.url.searchParams.get("code")))],
    ["GET", /^\/dogs\/([^/]+)$/, (m) => (dogV6(m[1], s) ? ok(dogV6(m[1], s)) : fail(404, "DOG_NOT_FOUND", "No dog with that code."))],
    ["GET", /^\/dogs\/([^/]+)\/medical$/, () => ok({ records: [] })],
    ["GET", /^\/dogs\/([^/]+)\/stories$/, (m) => ok({ stories: DOGS[m[1]]?.microStory ? [{ id: "st-1", version: 1, paragraph: DOGS[m[1]].microStory, moderatedAt: ago(60 * 24 * 20), createdAt: ago(60 * 24 * 21) }] : [] })],
    ["GET", /^\/wards$/, () => undefined],
    ["GET", /^\/wards\/([^/]+)\/dogs$/, (m, ctx) => ok(wardDogs(decodeURIComponent(m[1]), ctx.url.searchParams.get("colour")))],
    ["GET", /^\/stats\/impact$/, () => undefined],
    ["GET", /^\/push\/vapid-public-key$/, () => undefined],
    ["GET", /^\/care$/, () => ok({ providers: CARE })],
    // --- map ---
    ["GET", /^\/map\/wards$/, async (_m, ctx) => ok(await mapCity(ctx, {}))],
    ["GET", /^\/map\/wards\/([^/]+)$/, async (m, ctx) => ok(await wardDetail(decodeURIComponent(m[1]), s, ctx))],
    ["GET", /^\/map\/places$/, () => ok({ places: PLACES, truncated: false })],
    // --- session reads ---
    ["GET", /^\/feeders\/me$/, () => (authed() ? ok(me()) : UNAUTH)],
    ["GET", /^\/feeders\/me\/streak$/, () => (authed() ? ok(STREAK) : UNAUTH)],
    ["GET", /^\/feeders\/me\/dogs$/, () => (authed() ? ok({ dogs: MY_DOGS_V5 }) : UNAUTH)],
    ["GET", /^\/feeders\/me\/alerts$/, () => (authed() ? ok({ items: ALERTS }) : UNAUTH)],
    ["GET", /^\/feeders\/me\/export$/, () => (authed() ? ok({ feeder: me(), dogs: MY_DOGS_V5, exportedAt: new Date().toISOString() }) : UNAUTH)],
    ["GET", /^\/registrations$/, () => (authed() ? ok(registrationsV6()) : UNAUTH)],
    ["GET", /^\/registrations\/([^/]+)$/, (m) => (authed() ? ok(regDetail(m[1], s)) : UNAUTH)],
    ["GET", /^\/dogs\/([^/]+)\/collar$/, (m) => (authed() ? ok({ slug: m[1], name: DOGS[m[1]]?.name ?? null, wardId: "K-West", collarUrl: collarUrl(m[1]) }) : UNAUTH)],
    ["GET", /^\/dogs\/([^/]+)\/week$/, () => (authed() ? ok(dogWeek()) : UNAUTH)],
    ["GET", /^\/dogs\/([^/]+)\/tags$/, () => (authed() ? ok(st.tagResolved ? { ...DOG_TAGS, open: DOG_TAGS.open.slice(1) } : DOG_TAGS) : UNAUTH)],
    ["GET", /^\/dogs\/([^/]+)\/status-reports$/, () => (authed() ? ok({ reports: [] }) : UNAUTH)],
    ["GET", /^\/sos\/cases\/([^/]+)$/, (m) => {
      if (!authed()) return UNAUTH;
      if (m[1] === CASE_ID.hidden) return fail(403, "SOS_CASE_FORBIDDEN", "not your case");
      if (m[1] === CASE_ID.broken) return fail(404, "SOS_CASE_NOT_FOUND", "no such case");
      return ok(caseById(m[1]));
    }],
    ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(reportStatus())],
    // --- writes: ALL mocked, never sent ---
    ["POST", /^\/devices\/challenge$/, () => fail(503, "MOCKED", "device challenge is mocked in the screenshot run")],
    ["POST", /^\/devices\/token$/, () => fail(503, "MOCKED", "device token is mocked in the screenshot run")],
    ["POST", /^\/auth\/otp$/, () => ok({ expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })],
    ["POST", /^\/auth\/verify$/, () => fail(400, "INVALID_CODE", "invalid_code")],
    ["POST", /^\/auth\/refresh$/, () => fail(401, "BAD_REFRESH_TOKEN", "invalid or expired refresh token")],
    ["POST", /^\/scans$/, (_m, _c, body) =>
      ok({ created: true, scanId: "8d7c6b5a-4f3e-4d2c-9b1a-0f9e8d7c6b5a", streak: { streakDays: 13, lastFeedDate: TODAY }, photoAccepted: true, geoAccepted: true, ...(body?.tellCoFeeders ? { coFeedersTold: 1 } : {}) })],
    ["POST", /^\/scans\/batch$/, (_m, _c, body) =>
      ok({ results: (body?.feeds ?? []).map((f, i) => ({ clientUuid: f.clientUuid, dogSlug: f.dogSlug, created: true, scanId: `batch-${i}` })), streak: { streakDays: 13, lastFeedDate: TODAY } })],
    ["POST", /^\/reports$/, () => ok({ created: true, caseId: CASE_ID.open, tier: 1, fanout: "responders", nearbyCare: CARE, wardId: "K-West" })],
    ["POST", /^\/reports\/([^/]+)\/updates$/, () => ok({ ok: true })],
    ["POST", /^\/reports\/([^/]+)\/left$/, () => ok({ ok: true })],
    ["POST", /^\/sos\/cases\/([^/]+)\/ack$/, (m) => {
      (st.acked ??= {})[m[1]] = new Date().toISOString();
      return ok({ id: m[1], ackedBy: ME.feederId, ackedAt: st.acked[m[1]] });
    }],
    ["POST", /^\/sos\/cases\/([^/]+)\/decline$/, (m) => {
      (st.declined ??= {})[m[1]] = true;
      return ok({ declined: true });
    }],
    ["POST", /^\/sos\/cases\/([^/]+)\/release$/, (m) => ok({ id: m[1], state: "open" })],
    ["POST", /^\/sos\/cases\/([^/]+)\/arrived$/, (m) => ok({ id: m[1], arrivedAt: new Date().toISOString() })],
    ["POST", /^\/sos\/cases\/([^/]+)\/close-by$/, (m) => ok({ id: m[1], closeByAt: new Date().toISOString() })],
    ["POST", /^\/sos\/cases\/([^/]+)\/resolve$/, (m, _c, body) =>
      ok({ id: m[1], state: "resolved", resolvedAt: new Date().toISOString(), resolution: body?.outcome ?? "resolved", outcome: body?.outcome ?? "resolved" })],
    ["PATCH", /^\/feeders\/me$/, (_m, _c, body) => ok({ ...me(), ...(body ?? {}) })],
    ["DELETE", /^\/feeders\/me$/, () => ok({ deleted: true })],
    ["POST", /^\/feeders\/me\/surface$/, () => ok({ role: "registrator" })],
    ["POST", /^\/feeders\/me\/badges\/check$/, () => ok({ granted: [] })],
    ["POST", /^\/registrations$/, () =>
      ok({ slug: SLUG.kalu, status: "pending_activation", wardId: "K-West", registeredAt: new Date().toISOString(), expiresAt: inDays(30), collarUrl: collarUrl(SLUG.kalu), budget: { pending: 2, max: 2 } })],
    ["POST", /^\/registrations\/([^/]+)\/tag-check$/, () => ok({ match: true })],
    ["POST", /^\/collars\/batch$/, (_m, _c, body) =>
      ok({ dogs: (body?.slugs ?? []).map((slug) => ({ slug, name: DOGS[slug]?.name ?? null, wardId: "K-West", collarUrl: collarUrl(slug) })), skipped: [] })],
    ["POST", /^\/dogs\/([^/]+)\/prints$/, () => ok({ id: "print-1" })],
    ["POST", /^\/dogs\/([^/]+)\/tag-reports$/, () => ok({ reportId: "tr-1", feedersNotified: 2, wardCode: "K/W" })],
    ["POST", /^\/dogs\/([^/]+)\/tag-reports\/([^/]+)\/resolve$/, (m, _c, body) => {
      st.tagResolved = true;
      return ok({ id: m[2], resolution: body?.resolution ?? "spare" });
    }],
    ["POST", /^\/dogs\/([^/]+)\/status-reports$/, (_m, _c, body) =>
      ok({ id: "sr-1", status: body?.kind === "not_seen" ? "lost" : body?.kind === "adopted" ? "adopted" : "active", needsConfirmation: body?.kind === "passed_away" })],
    ["POST", /^\/dogs\/([^/]+)\/status-reports\/([^/]+)\/confirm$/, (m) => ok({ id: m[2], status: "deceased" })],
    ["POST", /^\/dogs\/([^/]+)\/stories$/, (_m, _c, body) => ok({ id: "st-2", version: 2, paragraph: body?.paragraph ?? "", moderatedAt: null, createdAt: new Date().toISOString() })],
    ["POST", /^\/dogs\/([^/]+)\/confirm$/, () => ok({ verified: true, via: "feeder" })],
    ["POST", /^\/dogs\/([^/]+)\/checkups$/, () => ok({ verified: true, via: "vet" })],
    ["POST", /^\/push\/subscribe$/, () => ok({ subscribed: true })],
  ];
}

async function realWards(ctx) {
  if (!realWardsCache) {
    try {
      const res = await ctx.route.fetch({ url: `${ctx.origin}/api/v1/map/wards`, method: "GET" });
      const body = await res.json();
      realWardsCache = Array.isArray(body?.data?.wards) && body.data.wards.length ? body.data.wards : WARDS_FALLBACK;
    } catch {
      realWardsCache = WARDS_FALLBACK;
    }
  }
  return realWardsCache;
}

function withCounts(wards, calm) {
  const counts = calm ? WARD_COUNTS_CALM : WARD_COUNTS;
  return wards.map((w) => ({ ...w, ...(counts[w.id] ?? { dogs: 0, notFedToday: 0, sosOpen: 0, latestSos: null }) }));
}

function citySummary(wards, calm) {
  const sos = calm
    ? []
    : [
        { wardId: "K-West", wardCode: "K/W", severity: "critical", raisedAt: ago(13), dogName: "Rani", taken: false },
        { wardId: "H-West", wardCode: "H/W", severity: "serious", raisedAt: ago(47), dogName: "Bruno", taken: true },
      ];
  const dogs = wards.reduce((t, w) => t + w.dogs, 0);
  const notLogged = wards.reduce((t, w) => t + w.notFedToday, 0);
  return { summary: { dogs, withCollars: dogs, feeders: 23, fedToday: dogs - notLogged, notLoggedToday: notLogged }, sos };
}

async function mapCity(ctx, { calm = false } = {}) {
  const wards = withCounts(await realWards(ctx), calm);
  return { wards, ...citySummary(wards, calm) };
}

function mapCacheJson() {
  const wards = withCounts(realWardsCache ?? WARDS_FALLBACK, false);
  return JSON.stringify({ at: NOW - 3 * 3600_000, wards, ...citySummary(wards, false) });
}

const WARD_NAMES = {
  "K-West": ["Rani", "Kalu", "Bruno", "Moti", "Goli", "Tiger", "Chotu", "Sheru", "Laali", "Bholu", "Pinky", "Julie", "Raja", "Sonu"],
  "P-North": ["Moti", "Goli", "Dabbu", "Kaalu", "Sheru", "Chikki"],
};

async function wardDetail(id, s, ctx) {
  const wards = withCounts(await realWards(ctx), false);
  const w = wards.find((x) => x.id === id) ?? wards[0];
  const sos = [];
  if (w.sosOpen && w.latestSos) {
    const acked = s.state?.acked?.[CASE_ID.open];
    sos.push({
      caseId: s.signedIn && !s.noCaseId ? CASE_ID.open : null,
      severity: w.latestSos.severity,
      raisedAt: w.latestSos.raisedAt,
      state: acked ? "acked" : "open",
      feedersTold: true,
      mine: !!acked,
      dogName: w.id === "K-West" ? "Rani" : "Bruno",
      taken: !!acked,
    });
  }
  const names = WARD_NAMES[w.id] ?? [];
  const notLogged = w.id === "P-North"
    ? [
        { name: "Moti", lastLoggedAt: ago(60 * 26) },
        { name: "Goli", lastLoggedAt: ago(60 * 24 * 3) },
        { name: "Dabbu", lastLoggedAt: ago(60 * 30) },
        { name: null, lastLoggedAt: null },
      ]
    : [
        { name: "Moti", lastLoggedAt: ago(60 * 24 * 9) },
        { name: "Goli", lastLoggedAt: ago(60 * 22) },
      ];
  return {
    ...w,
    notFedToday: w.id === "K-West" ? 5 : w.notFedToday,
    dogNames: names,
    notLoggedToday: notLogged,
    sos,
    nearby: PLACES.filter((p) => p.wardId === w.id || (id === "K-West" && p.wardId === "K-West")),
    viewer: s.signedIn ? (s.viewer ?? { sosOptIn: true, trustScore: ME.trustScore, canRespond: ["minor", "serious", "critical"] }) : null,
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

function initShim({ signedIn, camera, notification, local, geoDenied, geoPrompt }) {
  if (geoPrompt) {
    try {
      // Headless answers "denied"; a first-time visitor on a phone sees "prompt".
      const q = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) =>
        d && d.name === "geolocation" ? Promise.resolve({ state: "prompt", onchange: null, addEventListener() {} }) : q(d);
    } catch {}
  }
  try {
    // Sharing and printing open OS dialogs; answer them in the page instead.
    Object.defineProperty(navigator, "share", { value: () => Promise.resolve(), configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    window.print = () => undefined;
  } catch {}
  if (geoDenied) {
    try {
      const q = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) =>
        d && d.name === "geolocation" ? Promise.resolve({ state: "denied", onchange: null, addEventListener() {} }) : q(d);
      navigator.geolocation.getCurrentPosition = (_ok, err) => setTimeout(() => err && err({ code: 1, message: "denied", PERMISSION_DENIED: 1 }), 50);
      navigator.geolocation.watchPosition = (_ok, err) => { setTimeout(() => err && err({ code: 1, message: "denied" }), 50); return 1; };
    } catch {}
  }
  try {
    // Extra localStorage the flow asked for (a saved Me copy, counters, flags).
    for (const [k, v] of Object.entries(local ?? {})) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
  } catch {}
  if (notification) {
    try {
      // Headless Edge answers "denied"; the alerts ask (N13) needs "default".
      const N = function () {};
      N.permission = notification;
      N.requestPermission = () => Promise.resolve(notification);
      Object.defineProperty(window, "Notification", { value: N, configurable: true, writable: true });
    } catch {}
  }
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
  if (md && camera === "none") {
    md.getUserMedia = () => Promise.reject(new DOMException("Requested device not found", "NotFoundError"));
  }
  if (md && camera === "denied") {
    md.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  }
  if (md && (camera === "fake" || camera === "fake-torch")) {
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
      const stream = c.captureStream(10);
      if (camera === "fake-torch") {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities.bind(track) : () => ({});
        track.getCapabilities = () => ({ ...caps(), torch: true });
        track.applyConstraints = () => Promise.resolve();
      }
      return stream;
    };
  }
  if (camera !== "real") {
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
    tiger: { sky1: "#e4f0d8", sky2: "#a9c98f", ground: "#7c6a4e", fur: "#d9a441", dark: "#7a4a1c", collar: "#1a7a35" },
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

/** page.goto with retries: the room's tunnel drops the odd connection. */
async function gotoRetry(page, url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    } catch (err) {
      if (i >= tries || !/net::|Timeout/.test(String(err))) throw err;
      console.log(`  retry ${i} for ${url}`);
      await page.waitForTimeout(2000 * i);
    }
  }
}
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
      // geo: true = Andheri West (K/W); "outside" = Pune, outside Mumbai.
      geolocation: opts.geo === "outside"
        ? { latitude: 18.5204, longitude: 73.8567, accuracy: 30 }
        : opts.geo
          ? { latitude: 19.1364, longitude: 72.8296, accuracy: 30 }
          : undefined,
      ignoreHTTPSErrors: false,
    });
    await installRoutes(context, scenario, `${id}@${w}`);
    await context.addInitScript(initShim, {
      signedIn: !!scenario.signedIn,
      camera: opts.camera ?? "denied",
      notification: opts.notification ?? null,
      geoDenied: !!opts.geoDenied,
      geoPrompt: !!opts.geoPrompt,
      local: Object.fromEntries(
        Object.entries({ ...(opts.meCache ? { "hetja:me-cache": JSON.stringify(meCacheSnapshot()) } : {}), ...(opts.local ?? {}) })
          .map(([k, v]) => [k, v === "__MAP_CACHE__" ? mapCacheJson() : v]),
      ),
    });
    if (opts.blockTiles) {
      // The ESRI basemap: fail every tile so the map shows its no-tiles state.
      await context.route((u) => u.hostname === "static-map-tiles-api.arcgis.com", (r) => r.abort("failed"));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    console.log(`flow ${id} @${w}`);
    try {
      await fn({ page, context, snap: makeSnap(page, w), w, go: (p) => gotoRetry(page, `${BASE}${p}`) });
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
  ["about", "/about", "About Hetja"],
  ["how-it-works", "/how-it-works", "How it works, step by step"],
  ["faq", "/faq", "FAQ grouped for feeders, vets and everyone"],
  ["privacy", "/privacy", "Privacy page (dark nav)"],
  ["contact", "/contact", "Contact page"],
  ["hetja-memorial", "/hetja", "The memorial to the dog the project is named for"],
];

async function defineFlows() {
  // =========================================================================
  // Reading pages, Home, 404, desktop invitation (D1)
  // =========================================================================

  for (const [key, route, desc] of MARKETING) {
    await flow(`m-${key}`, { widths: [390, 1440] }, async ({ go, snap, w }) => {
      await go(route);
      await snap(key, route, w === 1440 ? "desktop: phone layout centred at 480 px" : "default", desc);
    });
  }

  await flow("home", {}, async ({ go, snap }) => {
    await go("/");
    await snap("home", "/", "default", "Home tab: hero, today's real numbers, four-tab TabBar");
  });

  await flow("d1-invite", { widths: [1440] }, async ({ page, go, snap }) => {
    await go("/");
    await page.getByText("Open on your phone").first().waitFor();
    await snap("d1-desktop-invite-home", "/ (desktop)", "D1 desktop invitation", "Hetja lives on your phone: QR to open the same page there");
    await go("/map");
    await page.getByText("Open on your phone").first().waitFor();
    await snap("d1-desktop-invite-map", "/map (desktop)", "D1 on an app route", "Every app route wider than 744 px shows the invitation", { idle: 3000 });
  });

  await flow("not-found", { widths: [390, 1440] }, async ({ page, go, snap }) => {
    await go("/this-lane-does-not-exist");
    await page.getByText(/This lane doesn['’]t go anywhere./).waitFor();
    await snap("v1-not-found", "/<unknown>", "V1 404", "This lane doesn't go anywhere: home page, scan a collar");
  });

  // =========================================================================
  // /me (V7, V8, V9, L1, N13, pause sheet), /alerts, /settings, /welcome
  // =========================================================================

  await flow("me-v7", {}, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("You probably already feed someone.").waitFor();
    await snap("me-v7-signed-out", "/me", "V7 signed out", "What signing in unlocks, one Sign in with email button");
  });

  await flow("me-v8", {
    signedIn: true,
    me: { wards: [], onboarded: true, sosOptIn: false, trustScore: 0 },
    api: [
      ["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: [] })],
      ["GET", /^\/feeders\/me\/streak$/, () => ok(STREAK_NEW)],
      ["GET", /^\/feeders\/me\/alerts$/, () => ok({ items: [] })],
    ],
  }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText(/Three things and you['’]re set./).waitFor();
    await snap("me-v8-day-one", "/me", "V8 day one", "Day one checklist: sign in done, scan a dog, log a feed, pick wards");
  });

  await flow("me-regular", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("day streak").waitFor();
    await snap("me-signed-in", "/me", "signed in, streak and dogs", "Me hub: greeting, streak, trust, my dogs, rows with Alerts unread count");
    await page.getByRole("switch", { name: "SOS alerts" }).click();
    await page.getByText("Need a break from alerts?").waitFor();
    await page.waitForTimeout(400);
    await snap("me-pause-sheet", "/me", "turning SOS alerts off", "Need a break from alerts? pause until tomorrow, for a week, or turn off", { scroll: false });
    await page.getByRole("radio", { name: /Pause for a week/ }).click().catch(() => undefined);
    await snap("me-pause-sheet-week", "/me", "pause sheet, a week chosen", "Pause for a week selected", { scroll: false });
  });

  await flow("me-l1", { signedIn: true, me: { sosPausedUntil: tomorrow8am() } }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("Alerts paused until").waitFor();
    await snap("me-l1-paused", "/me", "L1 SOS alerts paused", "Alerts paused until 8 am, Resume");
  });

  await flow("me-n13", { signedIn: true, me: { sosOptIn: false }, notification: "default" }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText("day streak").waitFor();
    await page.getByRole("switch", { name: "SOS alerts" }).click();
    await page.getByText("Know when a dog near you is hurt.").waitFor();
    await page.waitForTimeout(400);
    await snap("me-n13-alerts-ask", "/me", "N13 alerts ask", "Know when a dog near you is hurt: preview, wards, quiet at night, Turn on alerts", { scroll: false });
  });

  await flow("me-v9", {
    signedIn: true,
    meCache: true,
    api: [
      ["GET", /^\/feeders\/me$/, () => ({ status: 0, abort: true })],
      ["GET", /^\/feeders\/me\/streak$/, () => ({ status: 0, abort: true })],
      ["GET", /^\/feeders\/me\/dogs$/, () => ({ status: 0, abort: true })],
      ["GET", /^\/feeders\/me\/alerts$/, () => ({ status: 0, abort: true })],
    ],
  }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByText(/Can['’]t reach Hetja./).first().waitFor();
    await snap("me-v9-stale", "/me", "V9 offline, saved copy", "Showing this morning's copy. Can't reach Hetja. Retry");
  });

  await flow("me-error", { signedIn: true, api: [["GET", /^\/feeders\/me\/streak$/, () => fail(500, "INTERNAL", "Something went wrong on our side.")]] }, async ({ page, go, snap }) => {
    await go("/me");
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await snap("me-error", "/me", "load failed, nothing saved", "Me when the profile cannot load and there is no saved copy");
  });

  await flow("alerts", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/alerts");
    await page.getByText("Today").first().waitFor();
    await snap("alerts-list", "/alerts", "N5 list, grouped by day", "SOS, tag, verified, fed, not seen and status alerts, newest first");
  });

  await flow("alerts-empty", { signedIn: true, api: [["GET", /^\/feeders\/me\/alerts$/, () => ok({ items: [] })]] }, async ({ page, go, snap }) => {
    await go("/alerts");
    await page.getByText("Nothing yet.").waitFor();
    await snap("alerts-empty", "/alerts", "no alerts", "Nothing yet. Quiet is good");
  });

  await flow("alerts-out", {}, async ({ page, go, snap }) => {
    await go("/alerts");
    await page.getByText("No password, just a code by email.").waitFor();
    await snap("alerts-signed-out", "/alerts", "signed out", "Alerts: sign in to hear when a dog you feed is hurt");
  });

  await flow("alerts-error", { signedIn: true, api: [["GET", /^\/feeders\/me\/alerts$/, () => ({ status: 0, abort: true })]] }, async ({ page, go, snap }) => {
    await go("/alerts");
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await snap("alerts-error", "/alerts", "could not load", "Could not reach Hetja, Try again");
  });

  await flow("settings", { signedIn: true, notification: "default" }, async ({ page, go, snap }) => {
    await go("/settings");
    await page.getByRole("button", { name: /^Name shown/ }).waitFor();
    await snap("settings", "/settings", "N6 default", "Settings: name, wards, alerts, first name switch, your data");
    const sheet = async (key, open, wait, desc, close = "Cancel") => {
      await open();
      await page.getByRole("dialog").filter({ hasText: wait }).first().waitFor();
      await page.waitForTimeout(450);
      await snap(key, "/settings", `sheet: ${wait}`, desc, { scroll: false });
      const dlg = page.getByRole("dialog").last();
      await dlg.getByRole("button", { name: close, exact: true }).first().click().catch(() => page.keyboard.press("Escape"));
      await page.waitForTimeout(450);
    };
    await sheet("settings-sheet-name", () => page.getByRole("button", { name: /^Name shown/ }).click(), "Name shown to others", "Name shown sheet");
    await sheet("settings-sheet-wards", () => page.getByRole("button", { name: /^My wards/ }).click(), "Pick up to 6", "Your wards sheet: 24 wards, up to six", "Done");
    await page.getByRole("button", { name: /^Alerts/ }).click();
    await page.getByRole("dialog").filter({ hasText: "Which alerts" }).first().waitFor().catch(() => undefined);
    await page.waitForTimeout(450);
    await snap("settings-sheet-alerts", "/settings", "sheet: Alerts", "SOS only or All, SOS alerts switch, quiet hours", { scroll: false });
    await page.getByRole("dialog").last().getByRole("button", { name: /^Quiet hours/ }).click().catch(() => undefined);
    await page.waitForTimeout(500);
    await snap("settings-sheet-quiet-hours", "/settings", "sheet: Quiet hours", "Quiet hours: from, to", { scroll: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const alertsDlg = page.getByRole("dialog").filter({ hasText: "Which alerts" }).first();
    if (!(await alertsDlg.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /^Alerts/ }).click().catch(() => undefined);
      await page.waitForTimeout(450);
    }
    await page.getByRole("dialog").last().getByRole("switch", { name: /SOS alerts/ }).click().catch(() => undefined);
    await page.getByText("Need a break from alerts?").waitFor({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(450);
    await snap("settings-sheet-pause", "/settings", "sheet: pause alerts", "SOS switch turned off inside Alerts: pause instead", { scroll: false });
    await gotoRetry(page, `${BASE}/settings`);
    await page.getByRole("button", { name: /^Delete my account/ }).waitFor();
    await page.getByRole("button", { name: /^Delete my account/ }).click();
    await page.getByText("Delete your account?").waitFor();
    await page.waitForTimeout(450);
    await snap("settings-sheet-delete", "/settings", "sheet: delete account", "Delete your account? What goes and what stays", { scroll: false });
  });

  await flow("settings-n13", { signedIn: true, me: { sosOptIn: false }, notification: "default" }, async ({ page, go, snap }) => {
    await go("/settings");
    await page.getByRole("button", { name: /^Alerts/ }).click();
    await page.waitForTimeout(450);
    await page.getByRole("dialog").last().getByRole("switch", { name: /SOS alerts/ }).click();
    await page.getByText("Know when a dog near you is hurt.").waitFor();
    await page.waitForTimeout(400);
    await snap("settings-n13-alerts-ask", "/settings", "N13 from Settings", "Alerts ask opened from the Alerts sheet", { scroll: false });
  });

  await flow("settings-noname", { signedIn: true, me: { showFirstName: false } }, async ({ page, go, snap }) => {
    await go("/settings");
    await page.getByText(/You['’]re counted as a feeder, not named./).waitFor();
    await snap("settings-first-name-off", "/settings", "first name hidden", "Show my first name switched off: counted, not named");
  });

  await flow("settings-out", {}, async ({ page, go, snap }) => {
    await go("/settings");
    await page.getByText("Sign in to change your name, wards and alerts.").waitFor();
    await snap("settings-signed-out", "/settings", "signed out", "Settings when signed out");
  });

  await flow("welcome", { signedIn: true, me: { onboarded: false, wards: [], quietHours: undefined, sosOptIn: false }, notification: "default" }, async ({ page, go, snap }) => {
    await go("/welcome");
    await page.getByText("Welcome. Where do you feed?").waitFor();
    await snap("welcome-n1", "/welcome", "N1 Become a feeder", "Name shown, ward chips, SOS alerts, quiet hours, Start feeding");
    await page.getByRole("button", { name: /More wards/ }).click();
    await page.getByText("Pick up to 6").first().waitFor();
    await page.waitForTimeout(450);
    await snap("welcome-wards-sheet", "/welcome", "wards sheet", "Your wards: pick up to 6", { scroll: false });
    await page.getByRole("dialog").last().getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Quiet hours/ }).click();
    await page.waitForTimeout(450);
    await snap("welcome-quiet-sheet", "/welcome", "quiet hours sheet", "Quiet hours: from, to, Save", { scroll: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.getByLabel("Name shown to others").fill("");
    await page.getByRole("button", { name: "Start feeding" }).click();
    await page.getByText("Type the name others will see").waitFor();
    await snap("welcome-name-error", "/welcome", "empty name", "Type the name others will see, up to 40 letters");
    await page.getByLabel("Name shown to others").fill("Priya S.");
    await page.getByRole("button", { name: "Start feeding" }).click();
    await page.getByText("Know when a dog near you is hurt.").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await snap("welcome-n13-alerts-ask", "/welcome", "N13 after Start feeding", "Alerts ask after onboarding", { scroll: false });
  });

  // =========================================================================
  // /login (V4, V5, V6)
  // =========================================================================

  await flow("login", {}, async ({ page, go, snap }) => {
    await go("/login");
    await page.getByText("No password.").first().waitFor();
    await snap("login-v4-email", "/login", "V4 email", "Sign in. No password. Email, Send code, Cancel");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Type your email first.").waitFor();
    await snap("login-v4-empty-error", "/login", "V4 empty submit", "Type your email first");
    await page.locator('input[type="email"]').fill("priya.s@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Check your email.").waitFor();
    await snap("login-v5-code", "/login", "V5 code sent", "Six boxes, It works for 5 minutes, Resend in 0:30");
    await page.getByLabel("6-digit code").fill("482");
    await snap("login-v5-partial", "/login", "V5 three digits typed", "Code boxes partly filled");
    await page.getByLabel("6-digit code").fill("482915");
    await page.getByText(/That['’]s not the code./).waitFor({ timeout: 10_000 });
    await snap("login-v5-wrong-code", "/login", "V5 wrong code", "That's not the code. Check the newest email. Send a new code");
  });

  await flow("login-v6", {
    api: [["POST", /^\/auth\/otp$/, () => fail(429, "RATE_LIMITED", "Too many codes requested for this address. Try again shortly.", { headers: { "retry-after": "840" } })]],
  }, async ({ page, go, snap }) => {
    await go("/login");
    await page.locator('input[type="email"]').fill("priya.s@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText(/Let['’]s take a breath./).waitFor();
    await snap("login-v6-rate-limited", "/login", "V6 too many codes", "Let's take a breath: you can ask again at a stated time");
  });

  await flow("login-expired", { api: [["POST", /^\/auth\/verify$/, () => fail(400, "EXPIRED", "expired")]] }, async ({ page, go, snap }) => {
    await go("/login");
    await page.locator('input[type="email"]').fill("priya.s@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Check your email.").waitFor();
    await page.getByLabel("6-digit code").fill("482915");
    await page.waitForTimeout(1500);
    await snap("login-v5-expired", "/login", "V5 expired code", "Expired code message");
  });

  await flow("login-otp-error", { api: [["POST", /^\/auth\/otp$/, () => fail(400, "INVALID_EMAIL", "email must be a valid email address")]] }, async ({ page, go, snap }) => {
    await go("/login");
    await page.locator('input[type="email"]').fill("priya.s@example");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("login-v4-server-error", "/login", "V4 server refused the email", "Per-field error from the API");
  });

  // =========================================================================
  // Scan tab: /scan, /scan/code, /scan/find (F1, F2, F3, V2, V3, N8)
  // =========================================================================

  await flow("scan-camera", { camera: "fake-torch" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("Point at the QR on the collar.").waitFor();
    await page.waitForTimeout(800);
    await snap("scan-camera", "/scan", "camera live, torch available", "Camera open by itself, bracket frame, torch button, type-the-code sheet", { scroll: false, idle: 1500 });
    await page.getByRole("button", { name: "Torch" }).click().catch(() => undefined);
    await page.waitForTimeout(300);
    await snap("scan-camera-torch-on", "/scan", "torch on", "Torch pressed", { scroll: false, idle: 300 });
    console.log("  waiting for the 6 s no-read timer (F1)");
    await page.getByText("Mud and rain do this. Try one of these.").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await snap("scan-f1-cant-read", "/scan", "F1: no read after 6 s (fake stream that never decodes)", "Can't read this QR: type the code, find by ward and photo, SOS anyway", { scroll: false, idle: 300 });
  });

  await flow("scan-denied", { camera: "denied" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("Camera is off for Hetja.").waitFor();
    await snap("scan-camera-denied", "/scan", "camera permission denied", "Camera is off for Hetja, with the three ways on");
  });

  await flow("scan-typing", { camera: "fake" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("Point at the QR on the collar.").waitFor();
    await page.locator("#scan-collar-code").focus();
    await page.getByRole("button", { name: "View profile" }).click();
    await page.getByText("Type the code printed under the QR.").first().waitFor();
    await snap("scan-empty-submit", "/scan", "typed nothing, submitted", "Error under the code field: type the code printed under the QR", { scroll: false });
  });

  await flow("scan-nocamera", { camera: "none" }, async ({ page, go, snap }) => {
    await go("/scan");
    await page.getByText("No camera here.").waitFor();
    await snap("scan-no-camera", "/scan", "no camera on this device", "No camera here, type the code or try one of these");
  });

  // --- /scan/code ---
  await flow("scan-code", {}, async ({ page, go, snap }) => {
    await go("/scan/code");
    await page.getByText("Type the code on the collar.").waitFor();
    await snap("scan-code-v2-empty", "/scan/code", "V2 empty", "Type the code on the collar: nine characters, counter");
    await page.getByRole("textbox", { name: "Collar code" }).fill("r4n7k");
    await snap("scan-code-v2-typing", "/scan/code", "V2 typing, 5 of 9", "Counter says four more to go");
    await page.getByRole("textbox", { name: "Collar code" }).fill(SLUG_TYPO);
    await snap("scan-code-v2-full", "/scan/code", "V2 all nine typed", "That's all nine; Find the dog enabled");
    await page.getByRole("button", { name: "Find the dog" }).click();
    await page.getByText("One letter off.").first().waitFor();
    await snap("scan-code-v3-did-you-mean", "/scan/code", "V3 full-code miss, one suggestion", "No dog has this code. One letter off. Is it her? Yes, that's Rani");
  });

  await flow("scan-code-several", { api: [["GET", /^\/dogs\/lookup$/, () => ok({ exact: null, matches: [], suggestions: [CARD.rani, CARD.moti] })]] }, async ({ page, go, snap }) => {
    await go(`/scan/code?code=${SLUG_TYPO}`);
    await page.getByText("Is it one of these?").waitFor();
    await snap("scan-code-v3-several", "/scan/code?code=", "V3 miss, several suggestions", "One letter off. Is it one of these? None of these. Type it again");
  });

  await flow("scan-code-n8", { api: [["GET", /^\/dogs\/lookup$/, () => ok({ exact: null, matches: [], suggestions: [] })]] }, async ({ page, go, snap }) => {
    await go(`/scan/code?code=${UNKNOWN_SLUG}`);
    await page.getByText("Nothing on Hetja is one letter off either.").waitFor();
    await snap("scan-code-n8-no-dog", "/scan/code?code=", "N8 no dog, no suggestion", "No dog has this code: find by ward and photo, tag looks fake");
    await page.getByRole("button", { name: "Tag looks fake" }).click().catch(() => page.getByText("Tag looks fake").click());
    await page.getByText("If the tag looks fake").waitFor();
    await snap("scan-code-n8-fake-tag", "/scan/code?code=", "tag looks fake dialog", "If the tag looks fake: what to do");
  });

  await flow("scan-code-limited", { api: [["GET", /^\/dogs\/lookup$/, () => fail(429, "RATE_LIMITED", "too many lookups", { headers: { "retry-after": "60" } })]] }, async ({ page, go, snap }) => {
    await go(`/scan/code?code=${UNKNOWN_SLUG}`);
    await page.getByText(/That['’]s a lot of tries from this phone./).first().waitFor();
    await snap("scan-code-rate-limited", "/scan/code?code=", "lookup rate limited (429)", "That's a lot of tries from this phone");
  });

  await flow("scan-code-f2", {
    api: [["GET", /^\/dogs\/lookup$/, (_m, ctx) => {
      const code = ctx.url.searchParams.get("code") ?? "";
      return ok({ exact: null, matches: code.startsWith("r4n") ? [CARD.rani, CARD.rani2] : [], suggestions: [] });
    }]],
  }, async ({ page, go, snap }) => {
    await go("/scan/code?part=1");
    await page.getByText("Type what you can read").waitFor();
    await snap("scan-code-f2-empty", "/scan/code?part=1", "F2 empty", "Type what you can read: three boxes, unknowns allowed");
    await page.getByTestId("code-box-0").fill("r4");
    await snap("scan-code-f2-too-few", "/scan/code?part=1", "F2 too few characters", "Type 2 more to see matching dogs");
    await page.getByTestId("code-box-0").fill("r4n");
    await page.getByTestId("code-box-1").fill("7?w");
    await page.getByText("dogs match").waitFor();
    await snap("scan-code-f2-matches", "/scan/code?part=1", "F2 two matches", "2 dogs match, check the photo before you log anything");
    await page.getByTestId("code-box-0").fill("zz9");
    await page.getByText("No dogs match").waitFor();
    await snap("scan-code-f2-none", "/scan/code?part=1", "F2 no matches", "No dog on Hetja has those characters in those places");
  });

  // --- /scan/find ---
  await flow("scan-find-geo", { geo: true }, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText("Which dog is it?").waitFor();
    await page.getByText("dogs registered in K/W").waitFor();
    await snap("scan-find-f3", "/scan/find", "F3 ward from location", "Find by ward and photo: K/W from location, coat colour chips, photo grid");
    await page.getByRole("button", { name: "Brown" }).click();
    await page.getByText("brown dogs registered in K/W").waitFor();
    await snap("scan-find-f3-brown", "/scan/find", "F3 brown filter", "Narrowed to brown dogs");
    await page.getByRole("button", { name: "Change" }).click();
    await page.waitForTimeout(400);
    await snap("scan-find-f3-ward-picker", "/scan/find", "ward picker open", "Pick a ward");
  });

  await flow("scan-find-pick", {}, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText(/We couldn['’]t tell where you are./).waitFor({ timeout: 15_000 });
    await snap("scan-find-f3-no-location", "/scan/find", "no location, not signed in", "We couldn't tell where you are. Pick the ward you're in");
  });

  await flow("scan-find-home", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText("Your home ward").waitFor({ timeout: 15_000 });
    await page.getByText("registered in K/W").first().waitFor();
    await snap("scan-find-f3-home-ward", "/scan/find", "signed in, home ward", "Ward taken from the feeder's home ward");
  });

  await flow("scan-find-empty", { geo: true, api: [["GET", /^\/wards\/([^/]+)\/dogs$/, (m) => ok({ wardId: m[1], total: 0, colourTotal: 0, dogs: [] })]] }, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText("No dogs registered in K/W yet.").waitFor();
    await snap("scan-find-f3-empty", "/scan/find", "ward with no dogs", "No dogs registered in K/W yet");
  });

  await flow("scan-find-error", { geo: true, api: [["GET", /^\/wards\/([^/]+)\/dogs$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText(/Couldn['’]t load the dogs in K\/W right now\./).waitFor();
    await snap("scan-find-f3-error", "/scan/find", "ward dogs failed", "Couldn't load the dogs, Try again");
  });

  await flow("scan-find-loading", { geo: true, api: [["GET", /^\/wards\/([^/]+)\/dogs$/, (m) => ({ ...ok(wardDogs(m[1])), delayMs: 30_000 })]] }, async ({ page, go, snap }) => {
    await go("/scan/find");
    await page.getByText("Loading dogs in K/W").waitFor();
    await snap("scan-find-f3-loading", "/scan/find", "loading", "Skeleton tiles while the ward loads", { idle: 500 });
  });

  // --- /scan/find?sos=1 (Send SOS anyway) ---
  await flow("sos-anyway", {
    geo: true,
    api: [
      ["POST", /^\/reports$/, () => ({ ...ok({ created: true, caseId: CASE_ID.dogless, tier: 1, fanout: "responders", nearbyCare: CARE, wardId: "K-West" }), delayMs: 3000 })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(reportStatus({ feedersNotifiedNames: ["Priya", "Arjun", "Meera"], feedersNotified: 3, vetsNotified: 1 }))],
    ],
  }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByText("How bad is it?").waitFor({ timeout: 15_000 });
    await page.locator("a", { hasText: "Call" }).first().waitFor();
    await snap("sos-anyway-choose", "/scan/find?sos=1", "choose severity, care list", "Get the dog help now: how bad is it, Or call now list, finder below");
    await page.getByRole("radio", { name: /Can't get up, or bleeding/ }).click();
    await snap("sos-anyway-chosen", "/scan/find?sos=1", "severity chosen", "Send SOS enabled; shares K/W ward, never your exact spot");
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText("Sending SOS").first().waitFor();
    await snap("sos-anyway-sending", "/scan/find?sos=1", "sending", "Sending SOS (POST mocked, delayed)", { scroll: false, idle: 200 });
    await page.getByText("Your SOS is out.").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await snap("sos-anyway-sent", "/scan/find?sos=1", "sent with counts", "Your SOS is out: 3 feeders and 1 vet in K/W got it");
  });

  await flow("sos-anyway-nobody", {
    geo: true,
    api: [
      ["POST", /^\/reports$/, () => ok({ created: true, caseId: CASE_ID.dogless, tier: 1, fanout: "escalated", nearbyCare: CARE, wardId: "K-West" })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(reportStatus({ feedersNotifiedNames: [], feedersNotified: 0, vetsNotified: 0 }))],
    ],
  }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByRole("radio", { name: /Something else/ }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText("Nobody nearby was reached.").waitFor({ timeout: 15_000 });
    await snap("sos-anyway-nobody-reached", "/scan/find?sos=1", "sent, nobody reached", "Nobody nearby was reached. Please call someone below");
  });

  await flow("sos-anyway-open", {
    geo: true,
    api: [["POST", /^\/reports$/, () => ({ status: 429, json: { ok: false, error: { code: "SOS_CASE_OPEN", message: "open case" }, data: { openCase: { caseId: CASE_ID.dogless, raisedAt: ago(14), responderFirstName: "Priya", takenAt: ago(6) } } } })]],
  }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByRole("radio", { name: /Can't get up, or bleeding/ }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText("Your SOS is already out.").waitFor({ timeout: 15_000 });
    await snap("sos-anyway-already-open", "/scan/find?sos=1", "already sent from this phone", "Your SOS is already out. Priya is on the way");
  });

  await flow("sos-anyway-failed", { geo: true, api: [["POST", /^\/reports$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByRole("radio", { name: /Hurt, but moving/ }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText("SOS not sent.").waitFor({ timeout: 15_000 });
    await snap("sos-anyway-failed", "/scan/find?sos=1", "not sent (server error)", "SOS not sent: Hetja couldn't send it, call someone below, Try again");
  });

  await flow("sos-anyway-limited", { geo: true, api: [["POST", /^\/reports$/, () => fail(429, "RATE_LIMITED", "too many reports")]] }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByRole("radio", { name: /Hurt, but moving/ }).click({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText("This phone has sent the most SOS reports").waitFor({ timeout: 15_000 });
    await snap("sos-anyway-rate-limited", "/scan/find?sos=1", "not sent (429)", "This phone has sent the most SOS reports allowed");
  });

  await flow("sos-anyway-offline", { geo: true, api: [["POST", /^\/reports$/, () => ({ status: 0, abort: true })]] }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByRole("radio", { name: /Can't get up, or bleeding/ }).click({ timeout: 15_000 });
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.getByRole("button", { name: "Send SOS" }).click();
    await page.getByText(/No signal, so it didn['’]t go out./).waitFor({ timeout: 15_000 });
    await snap("sos-anyway-offline", "/scan/find?sos=1", "not sent (offline)", "No signal, so it didn't go out");
  });

  await flow("sos-anyway-outside", { geo: "outside" }, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByText("Hetja only covers Mumbai for now").waitFor({ timeout: 15_000 });
    await snap("sos-anyway-outside-mumbai", "/scan/find?sos=1", "location outside Mumbai", "Hetja only covers Mumbai for now, call someone below");
  });

  await flow("sos-anyway-noloc", {}, async ({ page, go, snap }) => {
    await go("/scan/find?sos=1");
    await page.getByText("Hetja needs your location to send an SOS").waitFor({ timeout: 20_000 });
    await snap("sos-anyway-no-location", "/scan/find?sos=1", "no location", "Hetja needs your location to send an SOS without the dog's code");
  });

  // =========================================================================
  // Register and print (L3, V13, V12, R2 to R5, P6, P1 to P4, V14, R7/P5, R8)
  // =========================================================================

  await flow("reg-l3", {}, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText(/There['’]s a dog without a name near you./).waitFor();
    await snap("register-l3-signed-out", "/register", "L3 signed out", "There's a dog without a name near you. Sign in to register a dog");
  });

  await flow("reg-v13", { signedIn: true, me: { role: "feeder", capabilities: ["feed"], canRegister: false } }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("Every dog on Hetja started with someone like you.").waitFor();
    await snap("register-v13-start", "/register", "V13 start (registration not yet on)", "What it takes: a photo, a printed tag, about 150 rupees; Register your first dog");
  });

  await flow("reg-v13-empty", { signedIn: true, api: [["GET", /^\/registrations$/, () => ok({ registrations: [], budget: { pending: 0, max: 2, holders: [] } })]] }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("Every dog on Hetja started with someone like you.").waitFor();
    await snap("register-v13-no-dogs", "/register", "V13 registrator with no dogs yet", "Same start screen for a registrator who has none");
  });

  await flow("reg-v12", { signedIn: true, local: { "hetja.dogSex.k2au9pd3z": "male", "hetja.dogSex.m6ot5hce4": "male" } }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByText("Dogs you put on Hetja").waitFor();
    await snap("register-v12-list", "/register", "V12 list", "Each dog as a sentence: needs his collar, tag not printed, expired, live");
  });

  await flow("reg-error", { signedIn: true, api: [["GET", /^\/feeders\/me$/, () => fail(500, "INTERNAL", "Something went wrong on our side.")]] }, async ({ page, go, snap }) => {
    await go("/register");
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await snap("register-error", "/register", "could not load", "Error with Try again");
  });

  await flow("reg-new", { signedIn: true, geo: true, camera: "denied" }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.getByText("Face in the oval.").first().waitFor();
    await page.waitForTimeout(600);
    await snap("register-new-r2-photo", "/register/new", "R2 photo, step 1 of 4", "Face in the oval. Crouch to their eye level");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "kalu.png", mimeType: "image/png", buffer: PHOTO });
    await page.waitForTimeout(1500);
    await snap("register-new-r2-photo-taken", "/register/new", "R2 photo chosen", "Photo in place, continue");
    const next = page.getByRole("button", { name: /^(Use this photo|Continue|Next)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.getByText("Is this dog already registered?").waitFor({ timeout: 15_000 });
    await page.getByText("Same dog").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await snap("register-new-r3-duplicates", "/register/new", "R3 duplicate check, step 2", "Similar dogs in K/W, Same dog, None of these, continue");
    await page.getByRole("button", { name: "None of these, continue" }).click();
    await page.getByText(/^About (them|her|him)$/).first().waitFor();
    await snap("register-new-r4-about", "/register/new", "R4 about the dog, empty", "Name, sex, how to spot them, health if you know");
    await page.locator("#reg-name").fill("Kalu");
    await page.locator('input[name="reg-sex"][value="male"]').check({ force: true });
    for (const m of ["Black", "White chest"]) await page.getByRole("button", { name: m, exact: true }).click().catch(() => undefined);
    await page.locator('input[name="reg-vacc"][value="yes"]').check({ force: true }).catch(() => undefined);
    await snap("register-new-r4-filled", "/register/new", "R4 filled", "Kalu, male, black with a white chest, vaccinated");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Check and confirm").first().waitFor();
    await snap("register-new-r5-confirm", "/register/new", "R5 check and confirm", "Summary and two promises; Register Kalu disabled until ticked");
    await page.getByText("I see him at least once a week.").click();
    await page.getByText(/I won['’]t post where he/).click();
    await snap("register-new-r5-ticked", "/register/new", "R5 both promises ticked", "Register Kalu enabled");
  });

  await flow("reg-new-empty-ward", { signedIn: true, geo: true, api: [["GET", /^\/wards\/([^/]+)\/dogs$/, (m) => ok({ wardId: m[1], total: 0, colourTotal: 0, dogs: [] })]] }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "kalu.png", mimeType: "image/png", buffer: PHOTO });
    await page.waitForTimeout(1500);
    const next = page.getByRole("button", { name: /^(Use this photo|Continue|Next)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.getByText("No dogs are registered in K/W yet.").waitFor({ timeout: 15_000 });
    await snap("register-new-r3-none", "/register/new", "R3 no dogs in the ward", "No dogs are registered in K/W yet");
  });

  await flow("reg-new-budget", { signedIn: true, geo: true, api: [["POST", /^\/registrations$/, () => fail(409, "REGISTRATION_BUDGET_EXCEEDED", "registration budget exceeded")]] }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "kalu.png", mimeType: "image/png", buffer: PHOTO });
    await page.waitForTimeout(1500);
    const next = page.getByRole("button", { name: /^(Use this photo|Continue|Next)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.getByRole("button", { name: "None of these, continue" }).click({ timeout: 15_000 });
    await page.locator("#reg-name").fill("Kalu");
    await page.locator('input[name="reg-sex"][value="male"]').check({ force: true });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("I see him at least once a week.").click();
    await page.getByText(/I won['’]t post where he/).click();
    await page.getByRole("button", { name: /^Register/ }).click();
    await page.locator("[role=alert]").filter({ hasText: /\S/ }).first().waitFor();
    await snap("register-new-submit-error", "/register/new", "submit refused (budget)", "Two dogs are already waiting for their collars");
  });

  await flow("reg-p6", {
    signedIn: true,
    me: { registrationBudget: { pending: 2, max: 2 } },
    api: [["GET", /^\/registrations$/, () => ok(registrationsV6({ full: true }))]],
  }, async ({ page, go, snap }) => {
    await go("/register/new");
    await page.getByText("Put one of these on first.").waitFor();
    await snap("register-new-p6-slots-full", "/register/new", "P6 both slots taken", "2 of 2 collars waiting: put one of these on first");
  });

  await flow("reg-p1", { signedIn: true, local: { "hetja.dogSex.k2au9pd3z": "male" } }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Waiting for collar").first().waitFor();
    await snap("register-p1-waiting", "/register/[slug]", "P1 waiting for collar, printed", "Tracker: printed, fit the collar, scan it to switch the page on");
    await page.getByRole("button", { name: /Scan .* collar/ }).click();
    await page.waitForTimeout(1500);
    await snap("register-p1-scan-dialog", "/register/[slug]", "P1 scan dialog", "Checking Kalu: the full-screen scanner", { scroll: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  await flow("reg-p1-unprinted", { signedIn: true, regOver: { printedAt: null, daysLeft: 12 } }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Not printed yet").first().waitFor();
    await snap("register-p1-not-printed", "/register/[slug]", "P1 not printed yet", "Tracker starts at Print the tag");
  });

  await flow("reg-expired", { signedIn: true, regStatus: "expired", regOver: { daysLeft: 0 } }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Code expired").first().waitFor();
    await snap("register-expired", "/register/[slug]", "code expired", "Code expired, scanning still switches it on");
  });

  await flow("reg-p2", {
    signedIn: true,
    api: [["POST", /^\/registrations\/([^/]+)\/tag-check$/, () => ok({ match: false, expected: { slug: SLUG.kalu, name: "Kalu" }, scanned: { slug: SLUG.bruno, name: "Bruno" } })]],
  }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByRole("button", { name: "Type the code instead" }).click();
    await page.getByLabel("Code on the tag").fill(SLUG.bruno);
    await page.getByText(/That['’]s Bruno['’]s tag./).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await snap("register-p2-wrong-tag", "/register/[slug]", "P2 wrong tag", "That's Bruno's tag: scanned versus looking for, both codes", { scroll: false });
  });

  await flow("reg-p3", { signedIn: true, geo: true, api: [["POST", /^\/registrations\/([^/]+)\/tag-check$/, () => ok({ match: true })]] }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByRole("button", { name: "Type the code instead" }).click();
    await page.getByLabel("Code on the tag").fill(SLUG.kalu);
    await page.getByText("is live.").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await snap("register-p3-live", "/register/[slug]", "P3 just switched on", "Kalu is live: story, feed, page, register another (scan POST mocked)");
  });

  await flow("reg-p4", { signedIn: true, regStatus: "active", regOver: { liveSince: ago(60 * 24 * 61), lastScanAt: ago(60 * 24 * 4), scanCount: 14, feederNames: ["Anil", "Meera"], daysLeft: null } }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}`);
    await page.getByText("Live since").first().waitFor();
    await snap("register-p4-manage", "/register/[slug]", "P4 live dog", "Manage a live dog: page, reprint, edit, feeders with Invite");
    await page.getByRole("button", { name: "Invite" }).click().catch(() => undefined);
    await page.waitForTimeout(600);
    await snap("register-p4-invite", "/register/[slug]", "P4 invite tapped", "Invite shared or link copied", { scroll: false });
  });

  await flow("reg-v14", { signedIn: true, local: { "hetja.dogSex.k2au9pd3z": "male" } }, async ({ page, go, snap }) => {
    await go(`/register/${SLUG.kalu}/ready`);
    await page.getByText("is almost on Hetja.").waitFor();
    await snap("register-v14-ready", "/register/[slug]/ready", "V14 code ready", "Kalu is almost on Hetja: QR, code, Unverified pill, Print Kalu's tag");
  });

  for (const w of [390, 1440]) {
    await flow(`reg-print-${w}`, { signedIn: true, widths: [w], local: { "hetja.dogSex.k2au9pd3z": "male" } }, async ({ page, go, snap }) => {
      await go(`/register/${SLUG.kalu}/print`);
      await page.getByText("Print the tag").first().waitFor();
      await page.waitForTimeout(1200);
      await snap("register-print-r7-paper-tags", "/register/[slug]/print", "R7 paper, 10 small tags, A4", "Paper, laminated: 10 small tags and a collar band, live preview");
      await page.getByText("1 large tag + wall notice").click();
      await page.waitForTimeout(900);
      await snap("register-print-r7-paper-notice", "/register/[slug]/print", "R7 paper, large tag and wall notice", "One large tag and a wall notice");
      await page.locator('input[name="paper"][value="letter"]').check({ force: true });
      await page.waitForTimeout(900);
      await snap("register-print-r7-letter", "/register/[slug]/print", "R7 paper, Letter", "Letter paper selected");
      await page.locator('input[name="material"]').first().check({ force: true });
      await page.waitForTimeout(900);
      await snap("register-print-p5-laser", "/register/[slug]/print", "P5 laser on TPU", "Laser on TPU: 40 x 40 mm, scale 100%");
      await page.getByText("Specs ›").first().click().catch(() => undefined);
      await page.waitForTimeout(500);
      await snap("register-print-p5-laser-specs", "/register/[slug]/print", "P5 laser, specs open", "For the print shop: TPU Shore 95A, laser-etch, sizes");
    });
  }

  for (const [layout, label] of [["tags", "10 small tags and band"], ["notice", "large tag and wall notice"]]) {
    await flow(`reg-sheet-${layout}`, { signedIn: true, widths: [390, 1440], local: { "hetja.dogSex.k2au9pd3z": "male" } }, async ({ page, go, snap }) => {
      await go(`/register/${SLUG.kalu}/print/sheet?layout=${layout}&paper=a4`);
      await page.getByRole("region", { name: "Printable collar sheet" }).waitFor();
      await page.waitForTimeout(1200);
      await snap(`register-print-sheet-${layout}`, "/register/[slug]/print/sheet", `A4 sheet: ${label}`, `The printable A4 page, ${label}`);
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(500);
      await snap(`register-print-sheet-${layout}-print-css`, "/register/[slug]/print/sheet", `A4 sheet: ${label}, print CSS`, "Same sheet with print media applied");
    });
  }

  await flow("reg-r8", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/register/batch?add=${SLUG.kalu}`);
    await page.getByText("Batch sheet").first().waitFor();
    await page.getByText("slots on this A4 page").first().waitFor();
    await snap("register-batch-r8", "/register/batch", "R8 batch sheet", "Up to 8 dogs on one A4 page, slots bar, Download sheet");
  });

  await flow("reg-r8-empty", { signedIn: true, api: [["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: [] })]] }, async ({ page, go, snap }) => {
    await go("/register/batch");
    await page.getByText("Dogs you register or feed show here.").waitFor();
    await snap("register-batch-empty", "/register/batch", "no dogs", "Dogs you register or feed show here");
  });

  await flow("reg-batch-sheet", { signedIn: true, widths: [390, 1440] }, async ({ page, go, snap }) => {
    await go(`/register/batch/sheet?slugs=${SLUG.kalu},${SLUG.rani},${SLUG.bruno}&paper=a4`);
    await page.getByRole("region", { name: "Printable collar sheet" }).waitFor();
    await page.waitForTimeout(1200);
    await snap("register-batch-sheet", "/register/batch/sheet", "A4 batch sheet, 3 dogs", "Batch sheet: ward K/W, 3 dogs x 2 tags");
  });

  // =========================================================================
  // My dogs (N4, N15, N16, N9, F6), vet (N3)
  // =========================================================================

  await flow("mydogs", { signedIn: true }, async ({ page, go, snap }) => {
    await go("/me/dogs");
    await page.getByText("need you today").first().waitFor();
    await snap("mydogs-n4-needs-you", "/me/dogs", "N4 needs you filter", "SOS, tag and missing first; confirm a new dog section");
    await page.getByRole("button", { name: /^All/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
    await snap("mydogs-n4-all", "/me/dogs", "N4 all dogs", "Every dog with its pill: SOS, tag, missing, vet due, new, fed");
    await page.getByRole("button", { name: /^Confirm / }).first().click();
    await page.getByText("Confirmed. Thank you.").waitFor();
    await snap("mydogs-n4-confirmed", "/me/dogs", "N4 dog confirmed", "Confirmed. Thank you. (POST mocked)");
  });

  await flow("mydogs-calm", { signedIn: true, api: [["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: MY_DOGS_V5.map((d) => ({ ...d, attention: null, verified: true })) })]] }, async ({ page, go, snap }) => {
    await go("/me/dogs");
    await page.getByText("nothing needs you today").first().waitFor();
    await snap("mydogs-n4-calm", "/me/dogs", "nothing needs you", "All dogs fed or looked after");
  });

  await flow("mydogs-empty", { signedIn: true, api: [["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: [] })]] }, async ({ page, go, snap }) => {
    await go("/me/dogs");
    await page.getByText("No dogs yet.").waitFor();
    await snap("mydogs-n4-empty", "/me/dogs", "no dogs", "No dogs yet. Register a dog");
  });

  await flow("mydogs-error", { signedIn: true, api: [["GET", /^\/feeders\/me\/dogs$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go("/me/dogs");
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await snap("mydogs-n4-error", "/me/dogs", "could not load", "Hetja could not be reached. Try again");
  });

  await flow("dogweek", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.rani}`);
    await page.getByText("This week").first().waitFor();
    await snap("mydog-n15-week", "/me/dogs/[slug]", "N15 Rani's week", "Seven days fed and by whom, rabies booster due, vet records");
  });

  await flow("dogweek-overdue", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/week$/, () => ok(dogWeek({ overdue: true }))]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.bruno}`);
    await page.getByText("This week").first().waitFor();
    await snap("mydog-n15-week-overdue", "/me/dogs/[slug]", "N15 gaps and overdue booster", "Missed days, didn't eat note, rabies overdue");
  });

  await flow("dogweek-hidden", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/week$/, () => fail(403, "NOT_A_FEEDER", "not a feeder of this dog")]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}`);
    await page.getByText("see this.").first().waitFor();
    await snap("mydog-n15-not-a-feeder", "/me/dogs/[slug]", "not a feeder", "Only feeders of Moti see this");
  });

  await flow("story", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/stories$/, () => ok({ stories: [] })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.rani}/story`);
    await page.getByText(/Rani.s story/).first().waitFor();
    await snap("mydog-n16-story-empty", "/me/dogs/[slug]/story", "N16 empty", "Two or three lines; Stuck? Try chips; 0 / 280");
    await page.locator("textarea").fill("Rani sleeps under the sugarcane-juice cart near the Four Bungalows bus stop. Loves parle-G, hates the red scooter.");
    await snap("mydog-n16-story-typed", "/me/dogs/[slug]/story", "N16 typed", "A story typed, counter, Save story");
    await page.locator("textarea").fill("She lives outside flat 12, building 4, 400053.");
    await page.getByText("That looks like part of an address.").waitFor();
    await snap("mydog-n16-address-warning", "/me/dogs/[slug]/story", "N16 address warning", "That looks like part of an address. A landmark is safer");
    await page.locator("textarea").fill("Rani sleeps under the sugarcane-juice cart near the Four Bungalows bus stop. Loves parle-G, hates the red scooter.");
    await page.getByRole("button", { name: "Save story" }).click();
    await page.getByText("Saved.").first().waitFor();
    await snap("mydog-n16-saved", "/me/dogs/[slug]/story", "N16 saved", "Shows on her page once a moderator has read it (POST mocked)");
  });

  await flow("status", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/status-reports$/, () => ok({ reports: [] })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}/status`);
    await page.getByText("Update on Moti").first().waitFor();
    await snap("mydog-n9-status", "/me/dogs/[slug]/status", "N9 form", "Not seen lately, adopted or moved, passed away");
    await page.getByText("Not seen lately").first().click();
    await page.waitForTimeout(300);
    await snap("mydog-n9-not-seen", "/me/dogs/[slug]/status", "N9 not seen chosen", "Ask K/W feeders to look");
    await page.getByRole("button", { name: /Ask .*feeders to look/ }).click();
    await page.getByText("will look out for Moti.").waitFor();
    await snap("mydog-n9-not-seen-sent", "/me/dogs/[slug]/status", "N9 not seen sent", "K/W feeders will look out for Moti (POST mocked)");
  });

  await flow("status-passed", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/status-reports$/, () => ok({ reports: [] })], ["POST", /^\/dogs\/([^/]+)\/status-reports$/, () => ok({ id: "sr-1", status: "active", needsConfirmation: true })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}/status`);
    await page.getByText(/has passed away/).first().click();
    await page.waitForTimeout(300);
    await snap("mydog-n9-passed-chosen", "/me/dogs/[slug]/status", "N9 passed away chosen", "Ask a second feeder to confirm");
    await page.getByRole("button", { name: "Ask a second feeder to confirm" }).click();
    await page.getByText("Thank you for telling us.").waitFor();
    await snap("mydog-n9-passed-sent", "/me/dogs/[slug]/status", "N9 waiting for a second feeder", "Another feeder of Moti will be asked to confirm");
  });

  await flow("status-confirm", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/status-reports$/, () => ok({ reports: [{ id: "sr-2", kind: "passed_away", createdAt: ago(60 * 5), reportedByName: "Arjun M.", mine: false }] })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}/status`);
    await page.getByText("may have passed away.").first().waitFor();
    await snap("mydog-n9-second-feeder", "/me/dogs/[slug]/status", "N9 second feeder asked to confirm", "Arjun M. said Moti has passed away. Yes, Moti has passed / I'm not sure");
  });

  await flow("status-mine", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/status-reports$/, () => ok({ reports: [{ id: "sr-3", kind: "passed_away", createdAt: ago(60 * 5), reportedByName: "Priya S.", mine: true }] })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}/status`);
    await page.getByText("waiting for a second feeder").first().waitFor();
    await snap("mydog-n9-own-pending", "/me/dogs/[slug]/status", "N9 own report pending", "You said Moti has passed away; waiting for a second feeder");
  });

  await flow("status-deceased", { signedIn: true, dogOver: { [SLUG.moti]: { status: "deceased" } } }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.moti}/status`);
    await page.getByText("Moti has passed away.").first().waitFor();
    await snap("mydog-n9-deceased", "/me/dogs/[slug]/status", "N9 dog has died", "Moti has passed away");
  });

  await flow("tag", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.rani}/tag`);
    await page.getByText("Tag history").first().waitFor();
    await snap("mydog-f6-tag", "/me/dogs/[slug]/tag", "F6 open reports", "Tag came off and tag on the wrong dog; reprint, I have a spare, checked; history; sturdier collar");
    await page.getByRole("button", { name: "I have a spare" }).first().click();
    await page.waitForTimeout(1200);
    await snap("mydog-f6-spare", "/me/dogs/[slug]/tag", "F6 spare fitted", "After I have a spare (POST mocked, list reloads)");
  });

  await flow("tag-fine", { signedIn: true, api: [["GET", /^\/dogs\/([^/]+)\/tags$/, () => ok({ open: [], history: DOG_TAGS.history, reportsThisWeek: 0, sturdierCollarSuggested: false })]] }, async ({ page, go, snap }) => {
    await go(`/me/dogs/${SLUG.kalu}/tag`);
    await page.getByText("tag is fine.").first().waitFor();
    await snap("mydog-f6-fine", "/me/dogs/[slug]/tag", "F6 no open reports", "Kalu's tag is fine. No open reports");
  });

  await flow("vet-n3", { signedIn: true, me: { role: "vet", capabilities: ["vet"], displayName: "Dr Mehta", publicName: "Dr Mehta" } }, async ({ page, go, snap }) => {
    await go(`/vet/${SLUG.rani}`);
    await page.getByText("Vet account").first().waitFor();
    await snap("vet-n3-checkup", "/vet/[slug]", "N3 checkup form, nothing chosen", "Rabies, sterilised, next vaccine due, note for feeders, I examined this dog");
    await page.getByText("Given today").first().click();
    await page.getByText("Yes, confirmed").first().click();
    await page.locator("textarea").first().fill("Healthy. Small cut on the left ear, healing. Please keep an eye on it.").catch(() => undefined);
    await page.getByText("I examined this dog and the photo matches.").click();
    await snap("vet-n3-filled", "/vet/[slug]", "N3 filled", "Save and verify Rani enabled");
    await page.getByRole("button", { name: /Save and verify/ }).click();
    await page.getByText("is verified.").first().waitFor();
    await snap("vet-n3-verified", "/vet/[slug]", "N3 saved", "Rani is verified (POST mocked)");
  });

  await flow("vet-notvet", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/vet/${SLUG.rani}`);
    await page.getByText("Checkups are recorded by vet accounts").first().waitFor();
    await snap("vet-n3-not-a-vet", "/vet/[slug]", "viewer is not a vet", "Checkup record: recorded by vet accounts only");
  });

  // =========================================================================
  // Feed (V10, V11, L2, N7)
  // =========================================================================

  await flow("feed-v10", { signedIn: true, geo: true, local: { "hetja:install-offered": "1" } }, async ({ page, go, snap }) => {
    await go(`/feed?dog=${SLUG.rani}`);
    await page.getByRole("button", { name: /^Log feed/ }).waitFor();
    await snap("feed-log", "/feed?dog=<slug>", "log screen", "Feeding Rani: photo, how was she, Log feed, streak caption");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "rani.png", mimeType: "image/png", buffer: PHOTO });
    await page.getByRole("button", { name: "Ate it all" }).click();
    await snap("feed-log-filled", "/feed?dog=<slug>", "photo and outcome chosen", "Photo preview, Ate it all");
    await page.getByRole("button", { name: /^Log feed/ }).click();
    await page.getByText("Rani has eaten.").waitFor({ timeout: 15_000 });
    await snap("feed-v10-done", "/feed?dog=<slug>", "V10 fed", "Rani has eaten: streak card, scan the next dog (POST mocked)");
  });

  await flow("feed-v23", { signedIn: true, geo: true, local: { "hetja.feedsLogged": "0", "hetja:install-offered": null } }, async ({ page, go, snap }) => {
    await go(`/feed?dog=${SLUG.rani}`);
    await page.getByRole("button", { name: /^Log feed/ }).waitFor();
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt");
      e.prompt = () => Promise.resolve();
      e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
      window.dispatchEvent(e);
    });
    await page.getByRole("button", { name: /^Log feed/ }).click();
    await page.getByText("Rani has eaten.").waitFor({ timeout: 15_000 });
    await page.getByText("Keep Rani one tap away.").waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await snap("feed-v23-add-to-home", "/feed?dog=<slug>", "V23 after the first feed", "Keep Rani one tap away: Add to home screen", { scroll: false });
  });

  await flow("feed-l2", { signedIn: true, geo: true, local: { "hetja:install-offered": "1" } }, async ({ page, go, snap }) => {
    await go(`/feed?dog=${SLUG.rani}`);
    await page.getByRole("button", { name: "Looks unwell" }).click();
    await page.getByTestId("unwell-hint").waitFor();
    await page.getByLabel(/What did you notice/).fill("Limping on the back left leg, didn't finish her rice.").catch(() => undefined);
    await snap("feed-l2-unwell", "/feed?dog=<slug>", "L2 looks unwell", "Tell Arjun (a note, not an alarm), what did you notice, raise an SOS link");
  });

  await flow("feed-v11", { signedIn: true, geo: true, local: { "hetja:install-offered": "1" } }, async ({ page, go, snap }) => {
    await go("/feed");
    await page.getByText("Who did you feed?").waitFor();
    await snap("feed-v11-round", "/feed", "V11 who did you feed", "Tap everyone from tonight's round");
    await page.getByRole("button", { name: /Rani/ }).first().click();
    await page.getByRole("button", { name: /Kalu/ }).first().click();
    await snap("feed-v11-two-picked", "/feed", "V11 two dogs picked", "Log 2 feeds");
    await page.getByRole("button", { name: /^Log 2 feeds/ }).click();
    await page.getByText("have eaten.").first().waitFor({ timeout: 15_000 });
    await snap("feed-v11-done", "/feed", "V11 round logged", "Rani and Kalu have eaten (POST /scans/batch mocked)");
  });

  await flow("feed-v11-empty", { signedIn: true, api: [["GET", /^\/feeders\/me\/dogs$/, () => ok({ dogs: [] })]] }, async ({ page, go, snap }) => {
    await go("/feed");
    await page.getByText("Scan the collar of the dog you fed.").waitFor();
    await snap("feed-no-dogs", "/feed", "no dogs to pick", "Scan the collar of the dog you fed");
  });

  await flow("feed-n7", { signedIn: true, local: { "hetja:install-offered": "1" } }, async ({ page, go, snap }) => {
    await go(`/feed?dog=${SLUG.rani}`);
    await page.getByRole("button", { name: /^Log feed/ }).waitFor();
    await page.getByRole("button", { name: "Ate a little" }).click();
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.getByRole("button", { name: /^Log feed/ }).click();
    await page.getByText("feed is saved.").first().waitFor({ timeout: 15_000 });
    await snap("feed-n7-offline", "/feed?dog=<slug>", "N7 no signal", "Offline: feed saved, waiting to send, SOS needs signal, call a vet directly");
  });

  // =========================================================================
  // SOS responder page /sos/[caseId] (P9, P10, P11, L4, L5, L6, V21, V22)
  // =========================================================================

  const caseShot = async (page, text) => {
    // Copy uses curly apostrophes in places: match either kind.
    const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['\u2019]"));
    await page.getByText(re).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
  };

  await flow("sos-p9", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.open)]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.open}`);
    await caseShot(page, "Nobody has taken it");
    await snap("sos-p9-open", "/sos/[caseId]", "P9 open case", "Rani, can't get up: report and photo, timeline, distance, I can go and help, I can't go right now");
    await page.getByRole("button", { name: /I can['’]t go right now/ }).click().catch(() => page.getByText(/I can['’]t go right now/).click());
    await page.getByText("Thanks for saying.").waitFor();
    await snap("sos-p9-declined", "/sos/[caseId]", "P9 declined", "Thanks for saying; I can go after all (POST mocked)");
  });

  await flow("sos-p9-refused", {
    signedIn: true,
    api: [
      ["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.open)],
      ["POST", /^\/sos\/cases\/([^/]+)\/ack$/, () => fail(403, "SOS_ACK_FORBIDDEN", "not a trusted responder for this severity")],
    ],
  }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.open}`);
    await caseShot(page, "Nobody has taken it");
    await page.getByRole("button", { name: /^I can go and help/ }).click();
    await page.getByText("Only trusted responders can take a case.").waitFor();
    await snap("sos-p9-ack-refused", "/sos/[caseId]", "ack refused (403)", "Only trusted responders can take a case. Open Me");
  });

  let p10Step = 0;
  await flow("sos-p10", {
    signedIn: true,
    blockTiles: false,
    api: [
      ["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(p10Step === 0 ? CASES_V6.mine : p10Step === 1 ? { ...CASES_V6.mine, closeByAt: ago(1) } : { ...CASES_V6.mine, closeByAt: ago(3), arrivedAt: ago(0) })],
      ["POST", /^\/sos\/cases\/([^/]+)\/close-by$/, () => { p10Step = 1; return ok({ id: CASE_ID.mine, closeByAt: new Date().toISOString() }); }],
      ["POST", /^\/sos\/cases\/([^/]+)\/arrived$/, () => { p10Step = 2; return ok({ id: CASE_ID.mine, arrivedAt: new Date().toISOString() }); }],
    ],
  }, async ({ page, go, snap }) => {
    p10Step = 0;
    await go(`/sos/${CASE_ID.mine}`);
    await caseShot(page, "is waiting for you.");
    await page.waitForTimeout(1500);
    await snap("sos-p10-taken", "/sos/[caseId]", "P10 you took it", "Rani is waiting for you: exact spot for you only, Directions, nearest vet, steps");
    await page.getByRole("button", { name: /Tell the reporter you['’]re close/ }).click();
    await page.getByRole("button", { name: /^I['’]m with/ }).waitFor();
    await snap("sos-p10-close-by", "/sos/[caseId]", "P10 close by", "The reporter knows you're close; I'm with Rani");
    await page.getByRole("button", { name: /^I['’]m with/ }).click();
    await page.waitForTimeout(1500);
    await snap("sos-p10-arrived", "/sos/[caseId]", "P10 with Rani", "Arrived: with Rani and the time");
    await page.getByRole("button", { name: "Mark resolved" }).click();
    await page.getByText("How did it end?").waitFor();
    await page.waitForTimeout(400);
    await snap("sos-p11-outcome", "/sos/[caseId]", "P11 how did it end", "Taken to a vet, treated on the spot, couldn't find, didn't make it", { scroll: false });
    await page.getByText("Taken to a vet").first().click();
    await page.getByLabel(/Which vet/).fill("Lokhandwala Pet Hospital").catch(() => undefined);
    await snap("sos-p11-vet", "/sos/[caseId]", "P11 taken to a vet chosen", "Which vet? filled in", { scroll: false });
  });

  await flow("sos-p10-release", {
    signedIn: true,
    api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.mine)], ["POST", /^\/sos\/cases\/([^/]+)\/release$/, () => ok({ id: CASE_ID.mine, state: "open" })]],
  }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.mine}`);
    await caseShot(page, "is waiting for you.");
    await page.getByRole("button", { name: /I can['’]t make it after all/ }).click().catch(() => page.getByText(/I can['’]t make it after all/).click());
    await page.getByText("Handed back.").first().waitFor();
    await snap("sos-p10-released", "/sos/[caseId]", "P10 handed back", "I can't make it after all: other responders asked again");
  });

  await flow("sos-p10-noloc", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok({ ...CASES_V6.mine, location: null })]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.mine}`);
    await caseShot(page, "The exact spot is loading.");
    await snap("sos-p10-spot-loading", "/sos/[caseId]", "P10 exact spot not yet loaded", "K/W Andheri West. The exact spot is loading");
  });

  for (const [key, over, text, desc] of [
    ["sos-v21-vet", { outcome: "taken_to_vet", vetName: "Lokhandwala Pet Hospital" }, "got to a vet in", "Rani got to a vet in 42 minutes"],
    ["sos-v21-spot", { outcome: "treated_on_spot", vetName: null }, "was treated on the spot.", "Treated on the spot"],
    ["sos-v21-notfound", { outcome: "not_found", vetName: null }, "Nobody could find Rani.", "Nobody could find Rani"],
    ["sos-v21-died", { outcome: "died", vetName: null }, "didn't make it.", "Rani didn't make it"],
    ["sos-v21-false", { outcome: "false_alarm", state: "false_alarm", vetName: null }, "closed without a rescue.", "Closed without a rescue"],
  ]) {
    await flow(key, { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok({ ...CASES_V6.resolved, ...over })]] }, async ({ page, go, snap }) => {
      await go(`/sos/${CASE_ID.resolved}`);
      await caseShot(page, text);
      await snap(key, "/sos/[caseId]", `V21 resolved: ${over.outcome}`, desc);
    });
  }

  await flow("sos-l4", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.other)]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.other}`);
    await caseShot(page, "is on the way to Rani.");
    await page.waitForTimeout(800);
    await snap("sos-l4-stand-down", "/sos/[caseId]", "L4 someone else took it", "Arjun is on the way to Rani; meanwhile, near you, dogs not logged");
  });

  await flow("sos-l5", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.escalated)]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.escalated}`);
    await caseShot(page, "Nobody has reached Rani yet.");
    await snap("sos-l5-escalated", "/sos/[caseId]", "L5 escalated, nobody took it", "Vets told; you still can: I can go and help Rani");
  });

  await flow("sos-l6", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ({ status: 0, abort: true })]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.open}`);
    await caseShot(page, "Couldn't load");
    await snap("sos-l6-no-signal-fresh", "/sos/[caseId]", "L6 no signal, never loaded here", "Couldn't load this case; Try again");
  });

  await flow("sos-l6-cached", { signedIn: true }, async ({ page, context, go, snap }) => {
    let fail2 = false;
    await context.route((u) => u.pathname.startsWith("/api/v1/sos/cases/"), async (route) => {
      if (fail2) return route.abort("internetdisconnected");
      return route.fallback();
    });
    await go(`/sos/${CASE_ID.open}`);
    await caseShot(page, "Nobody has taken it");
    await page.waitForTimeout(800);
    fail2 = true;
    await page.reload({ waitUntil: "load" });
    await caseShot(page, "Couldn't load");
    await snap("sos-l6-no-signal", "/sos/[caseId]", "L6 no signal, alert remembered", "Couldn't load Rani's case: here's what your alert said, saved care numbers");
  });

  await flow("sos-v22", {
    signedIn: true,
    api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ({ status: 403, json: { ok: false, error: { message: "not yours", code: "SOS_CASE_FORBIDDEN" }, data: { forbiddenReason: "not_enough_trust", wardId: "K-West", wardCode: "K/W", checklist: { sosOptIn: true, paused: false, inMyWards: null, trustScore: 34, trustFloor: 40, feedsToGo: 6 } } } })]],
  }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.hidden}`);
    await caseShot(page, "Want cases like this?");
    await snap("sos-v22-not-eligible", "/sos/[caseId]", "V22 not allowed yet", "This case went to the feeders nearby; checklist of what is missing");
  });

  await flow("sos-v22-off", {
    signedIn: true,
    api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ({ status: 403, json: { ok: false, error: { message: "not yours", code: "SOS_CASE_FORBIDDEN" }, data: { forbiddenReason: "not_opted_in", wardId: "K-West", wardCode: "K/W", checklist: { sosOptIn: false, paused: false, inMyWards: false, trustScore: 52, trustFloor: 40, feedsToGo: 0 } } } })]],
  }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.hidden}`);
    await caseShot(page, "Want cases like this?");
    await snap("sos-v22-alerts-off", "/sos/[caseId]", "V22 alerts off", "Checklist with SOS alerts off: Turn on SOS alerts");
  });

  await flow("sos-gone", { signedIn: true, api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => fail(404, "SOS_CASE_NOT_FOUND", "no such case")]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.broken}`);
    await caseShot(page, "This case isn't there any more.");
    await snap("sos-case-gone", "/sos/[caseId]", "case not found (404)", "This case isn't there any more");
  });

  await flow("sos-desktop", { signedIn: true, widths: [1440], api: [["GET", /^\/sos\/cases\/([^/]+)$/, () => ok(CASES_V6.open)]] }, async ({ page, go, snap }) => {
    await go(`/sos/${CASE_ID.open}`);
    await caseShot(page, "Nobody has taken it");
    await snap("sos-p9-desktop", "/sos/[caseId] (desktop)", "P9 at 1440, phone layout centred", "Push-opened case page on a laptop: centred 480 px frame");
  });

  // =========================================================================
  // Map (M1 to M7, V20)
  // =========================================================================

  const mapOpts = { full: false, idle: 10_000 };

  await flow("map-m1", {}, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("Mumbai right now").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1800);
    await snap("map-city-peek", "/map", "city view, sheet in peek", "Ward markers with counts; sheet peek", mapOpts);
    await page.getByRole("button", { name: "Show more" }).click();
    await page.getByText("with collars").first().waitFor();
    await page.waitForTimeout(700);
    await snap("map-m1-mumbai-right-now", "/map", "M1 sheet pulled up", "Two dogs need help, stats line, needs help rows with dog names, open or taken", mapOpts);
  });

  await flow("map-v20", {
    api: [["GET", /^\/map\/wards$/, async (_m, ctx) => ok(await mapCity(ctx, { calm: true }))]],
  }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("No dog needs help.").first().waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Show more" }).click().catch(() => undefined);
    await page.waitForTimeout(1500);
    await snap("map-v20-calm-day", "/map", "V20 calm day, no SOS", "A quiet evening. No dog needs help. A few not logged, mostly in Malad", mapOpts);
  });

  await flow("map-m2-out", {}, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("K/W")}`);
    await page.getByRole("button", { name: /I can go and help/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await snap("map-m2-ward", "/map#ward=K%2FW", "M2 ward selected, signed out", "Andheri West: dogs by first name, Rani can't get up, help nearby, I can go and help Rani", mapOpts);
    await page.getByRole("button", { name: /I can go and help/ }).click();
    await page.getByText(/Sign in to take Rani['’]s case./).waitFor();
    await page.waitForTimeout(500);
    await snap("map-m3-sign-in", "/map#ward=K%2FW", "M3 sign in to take it", "Sign in to take Rani's case, with a Can't wait? call card", mapOpts);
  });

  await flow("map-m4", { signedIn: true, geo: true }, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("K/W")}`);
    await page.getByRole("button", { name: /I can go and help/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await snap("map-m2-ward-signed-in", "/map#ward=K%2FW", "M2 signed-in responder", "Ward sheet for an eligible responder", mapOpts);
    await page.getByRole("button", { name: /I can go and help/ }).click();
    await page.getByText("case is yours.").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await snap("map-m4-taken", "/map#ward=K%2FW", "M4 taken from the map", "Rani's case is yours: exact spot for you only, directions, distance", mapOpts);
  });

  await flow("map-m5", { signedIn: true, geo: true }, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("K/W")}`);
    await page.getByRole("button", { name: /I can go and help/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const pin = page.locator('.leaflet-marker-icon[aria-label="Lokhandwala Pet Hospital"]');
    if (await pin.count()) await pin.first().dispatchEvent("click");
    else await page.getByText("Lokhandwala Pet Hospital", { exact: true }).first().click();
    await page.getByRole("button", { name: /Call the clinic/ }).or(page.getByRole("link", { name: /Call the clinic/ })).first().waitFor();
    await page.waitForTimeout(1800);
    await snap("map-m5-vet", "/map", "M5 a vet selected", "Open now 24 hours, ambulance, number with Copy, Call the clinic", mapOpts);
  });

  await flow("map-notresponder", { signedIn: true, noCaseId: true, me: { trustScore: 22, sosOptIn: true }, viewer: { sosOptIn: true, trustScore: 22, canRespond: [] } }, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("K/W")}`);
    await page.getByRole("button", { name: /I can go and help/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /I can go and help/ }).click();
    await page.getByText("Not yet.").first().waitFor();
    await snap("map-not-responder", "/map#ward=K%2FW", "signed in, trust too low", "Not yet. Taking this case needs a trust score of 60", mapOpts);
  });

  await flow("map-m6", { signedIn: true, notification: "default", me: { wards: ["K-West"] } }, async ({ page, go, snap }) => {
    await go(`/map#ward=${encodeURIComponent("P/N")}`);
    await page.getByRole("button", { name: /I feed in/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await snap("map-m6-ward-no-sos", "/map#ward=P%2FN", "M6 Malad, no SOS", "Nobody's logged these four today, grid of dogs, I feed in Malad", mapOpts);
    await page.getByRole("button", { name: /I feed in/ }).click();
    await page.getByText("Know when a dog near you is hurt.").waitFor();
    await page.waitForTimeout(500);
    await snap("map-m6-alerts-ask", "/map#ward=P%2FN", "M6 I feed in Malad tapped", "Alerts ask (N13) from the map", mapOpts);
  });

  await flow("map-m7", {
    local: { "hetja.map.wards.v1": "__MAP_CACHE__" },
    api: [["GET", /^\/map\/wards$/, () => fail(500, "INTERNAL", "internal error")]],
  }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("The map is here. The numbers are not.").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1800);
    await snap("map-m7-numbers-failed", "/map", "M7 numbers failed, cached counts", "Showing counts from earlier, greyed out; Try again", mapOpts);
  });

  await flow("map-m7-nocache", { api: [["GET", /^\/map\/wards$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("The map is here. The numbers are not.").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1500);
    await snap("map-m7-no-cache", "/map", "numbers failed, nothing cached", "Hetja could not be reached just now, the map still works", mapOpts);
  });

  await flow("map-notiles", { blockTiles: true }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("Street map unavailable.").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await snap("map-no-tiles", "/map", "street map failed to load", "Street map unavailable. Wards are shown at their centres", mapOpts);
  });

  await flow("map-live", { api: [["GET", /^\/map\/wards$/, () => undefined], ["GET", /^\/map\/wards\/([^/]+)$/, () => undefined], ["GET", /^\/map\/places$/, () => undefined]] }, async ({ page, go, snap }) => {
    await go("/map");
    await page.getByText("Mumbai right now").first().waitFor({ state: "attached" });
    await page.waitForTimeout(1800);
    await snap("map-live-production", "/map", "real production data (unmocked GETs)", "What the live map shows today", mapOpts);
  });

  // =========================================================================
  // Collar page /d/<slug> (apps/scan): V15 to V19, P7, P8, P12, P13, N10 to N12,
  // F4, F5, L7, unverified, tag under review, memorial, D2
  // =========================================================================

  const dView = async (page) => page.locator("#v-profile").waitFor();

  await flow("d-v15", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText("Rani has 2 feeders.").first().waitFor();
    await snap("d-v15-profile", "/d/<slug>", "V15 a dog with feeders", "You found Rani: photo, ward, pills, Priya fed her 2 hours ago, Rani needs help");
  });

  await flow("d-v15-feeder", { signedIn: true }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText("Log a feed").first().waitFor();
    await snap("d-v15-signed-in-feeder", "/d/<slug>", "V15 visitor is a signed-in feeder", "Collar code card with Say it, Feeding Rani? Log a feed");
  });

  await flow("d-v16", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.moti}`);
    await page.getByText("Nobody feeds Moti on Hetja yet.").waitFor();
    await snap("d-v16-no-feeders", "/d/<slug>", "V16 nobody feeds this dog", "Nobody feeds Moti on Hetja yet, I feed Moti; tells a vet nearby");
  });

  await flow("d-v17", { api: [["GET", /^\/dogs\/([^/]+)$/, (m) => ok(dogV6(m[1]), { headers: { "x-hetja-stale": "1", date: new Date(NOW - 20 * 3600_000).toUTCString() } })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText(/You['’]re offline, so this is the last copy your phone saw./).waitFor();
    await snap("d-v17-saved-copy", "/d/<slug>", "V17 offline, saved copy", "Saved yesterday chip, Vaccinated as of yesterday, works offline");
  });

  await flow("d-p7", { api: [["GET", /^\/dogs\/([^/]+)$/, (m) => ({ ...ok(dogV6(m[1])), delayMs: 30_000 })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText(/Loading this dog['’]s page/).first().waitFor();
    await snap("d-p7-loading", "/d/<slug>", "P7 loading", "Skeleton with the code; the red button works before the page loads", { idle: 800 });
  });

  await flow("d-p8", { api: [["GET", /^\/dogs\/([^/]+)$/, () => fail(404, "DOG_NOT_FOUND", "No dog with that code.")]] }, async ({ page, go, snap }) => {
    await go(`/d/${UNKNOWN_SLUG}`);
    await page.getByText(/Hetja doesn['’]t know this collar./).waitFor();
    await snap("d-p8-unknown-collar", "/d/<unknown>", "P8 unknown collar (404)", "Hetja doesn't know this collar: you scanned, type again, find by photo, SOS still live");
  });

  await flow("d-p8-malformed", {}, async ({ page, go, snap }) => {
    await go("/d/abc1x");
    await page.getByText(/Hetja doesn['’]t know this collar./).waitFor();
    await snap("d-p8-malformed-code", "/d/<malformed>", "P8 malformed code, no fetch", "Same screen for a URL that is not a code");
  });

  await flow("d-p8-live", { api: [["GET", /^\/dogs\/([^/]+)$/, () => undefined]] }, async ({ page, go, snap }) => {
    await go(`/d/${UNKNOWN_SLUG}`);
    await page.getByText(/Hetja doesn['’]t know this collar./).waitFor({ timeout: 15_000 }).catch(() => undefined);
    await snap("d-p8-live-production", "/d/<unknown>", "real production 404 (unmocked GET)", "What production answers today for an unregistered code");
  });

  await flow("d-p8-sos", {
    geo: true,
    api: [
      ["GET", /^\/dogs\/([^/]+)$/, () => fail(404, "DOG_NOT_FOUND", "No dog with that code.")],
      ["POST", /^\/reports$/, () => ok({ created: true, caseId: CASE_ID.dogless, tier: 1, fanout: "responders", nearbyCare: CARE_SCAN, wardId: "K-West" })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(reportStatus({ feedersNotifiedNames: ["Priya", "Arjun"], feedersNotified: 3, vetsNotified: 1 }))],
    ],
  }, async ({ page, go, snap }) => {
    await go(`/d/${UNKNOWN_SLUG}`);
    await page.getByText(/Hetja doesn['’]t know this collar./).waitFor();
    await page.locator("#primary-cta").click();
    await page.getByText(/What['’]s happened?/).first().waitFor();
    await snap("d-p8-sos-choose", "/d/<unknown> SOS", "dogless SOS, what happened", "No dog: What's happened? Send SOS to the ward");
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.locator("#send").click();
    await page.getByText("Your SOS is out.").first().waitFor({ timeout: 20_000 });
    await snap("d-p8-sos-sent", "/d/<unknown> SOS", "dogless SOS sent", "Your SOS is out, call list");
  });

  await flow("d-unverified", { dogOver: { [SLUG.kalu]: { verified: false } } }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.kalu}`);
    await page.getByText("Unverified").first().waitFor();
    await snap("d-unverified", "/d/<slug>", "unverified dog", "Unverified badge on a new dog nobody has vouched for");
  });

  await flow("d-review", { dogOver: { [SLUG.rani]: { tagUnderReview: true, sturdierCollarSuggested: true } } }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText("Tag under review").first().waitFor();
    await snap("d-tag-under-review", "/d/<slug>", "tag under review, sturdier collar", "A feeder will check the tag; SOS still works; tag keeps coming off");
  });

  await flow("d-memorial", { dogOver: { [SLUG.moti]: { status: "deceased", memorial: { feederNames: ["Priya S.", "Arjun M.", "Meera K.", "Anil D."] }, microStory: "Moti kept the night watch at the Versova fish market for eleven years. Every stall owner knew his bark.", feederCount: 4 } } }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.moti}`);
    await page.getByText("has passed away.").first().waitFor();
    await snap("d-memorial", "/d/<slug>", "memorial (deceased dog)", "Moti has passed away. His page stays, with the names of everyone who fed him");
  });

  await flow("d-error", { api: [["GET", /^\/dogs\/([^/]+)$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText("Unavailable").first().waitFor();
    await snap("d-error", "/d/<slug>", "server error", "Unavailable: can't reach Hetja, SOS still works");
  });

  // --- F4 / F5 tag problems ---
  await flow("d-f4", { geo: true, api: [["POST", /^\/dogs\/([^/]+)\/tag-reports$/, () => ok({ reportId: "tr-1", feedersNotified: 2, wardCode: "K/W" })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#tag-open").click();
    await page.getByText(/What['’]s wrong with the tag?/).waitFor();
    await page.waitForTimeout(300);
    await snap("d-f4-tag-problem", "/d/<slug> tag sheet", "F4 report a tag problem", "What's wrong with the tag? Four choices, no sign-in needed");
    await page.locator('.grow[data-kind="found_on_ground"]').click();
    await page.getByText(/Rani['’]s feeders know./).first().waitFor();
    await snap("d-f5-reported", "/d/<slug> tag sheet", "F5 found tag reported", "2 feeders in K/W got an alert; what to do with the tag; seen Rani nearby?");
    await page.locator("#seen").click();
    await page.getByText("That helps.").first().waitFor({ timeout: 15_000 });
    await snap("d-f5-seen", "/d/<slug> tag sheet", "F5 seen nearby", "Thanks. That helps (view scan POST mocked)");
  });

  await flow("d-f5-wrong", { api: [["POST", /^\/dogs\/([^/]+)\/tag-reports$/, () => ok({ reportId: "tr-2", feedersNotified: 2, wardCode: "K/W" })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#tag-open").click();
    await page.locator('.grow[data-kind="wrong_dog"]').click();
    await page.getByText("under review").first().waitFor();
    await snap("d-f5-wrong-dog", "/d/<slug> tag sheet", "F5 wrong dog reported", "Report sent; this tag shows as under review");
  });

  await flow("d-f5-offline", {}, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#tag-open").click();
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.locator('.grow[data-kind="damaged"]').click();
    await page.getByText("Your report is saved.").first().waitFor();
    await snap("d-f5-offline", "/d/<slug> tag sheet", "F5 offline", "Your report is saved; it sends when back online");
  });

  // --- SOS on the collar page ---
  await flow("d-sos", {
    geo: true,
    api: [
      ["POST", /^\/reports$/, () => ({ ...ok({ created: true, caseId: CASE_ID.open, tier: 1, fanout: "responders", nearbyCare: CARE_SCAN, wardId: "K-West" }), delayMs: 4000 })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(reportStatus({ feedersNotifiedNames: ["Priya", "Arjun"], feedersNotified: 2, vetsNotified: 1 }))],
    ],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.getByText(/What['’]s happened to Rani?/).waitFor();
    await snap("d-v18-what-happened", "/d/<slug> SOS", "V18 what happened, nothing chosen", "Three choices; Send SOS for Rani disabled");
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.locator("#sos-note").fill("Hit by an auto near the SV Road signal, back leg bleeding. Lying by the juice cart.").catch(() => undefined);
    const chooser = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
    await page.locator("#ph").click().catch(() => undefined);
    const fc = await chooser;
    if (fc) await fc.setFiles({ name: "sos.png", mimeType: "image/png", buffer: PHOTO });
    await page.waitForTimeout(800);
    await snap("d-v18-chosen", "/d/<slug> SOS", "V18 chosen, note and photo", "Can't get up selected, note, photo; shares K/W ward only");
    await page.locator("#send").click();
    await page.getByText("Sending to Priya").first().waitFor();
    await snap("d-v18-sending", "/d/<slug> SOS", "V18 sending", "Sending to Priya (POST mocked, delayed)", { scroll: false, idle: 200 });
    await page.getByText(/Rani['’]s feeders know./).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(4500);
    await snap("d-v19-sent", "/d/<slug> SOS", "V19 sent", "Priya and Arjun know; waiting for a reply; can't wait? call");
  });

  await flow("d-n12", { geoPrompt: true, api: [["POST", /^\/reports$/, () => ok({ created: true, caseId: CASE_ID.open, tier: 1, nearbyCare: CARE_SCAN })]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: "Hurt, but moving" }).click();
    await page.locator("#send").click();
    await page.getByText("Share where you are, once.").waitFor();
    await snap("d-n12-location-ask", "/d/<slug> SOS", "N12 location ask", "Share where you are, once: Continue, or send without location");
  });

  await flow("d-p12", { geoDenied: true }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.locator("#send").click();
    await page.getByText("Not sent yet.").first().waitFor({ timeout: 20_000 });
    await snap("d-p12-no-location", "/d/<slug> SOS", "P12 location refused", "Not sent yet: copy details, share location and send, send to feeders only");
  });

  await flow("d-p13", { geo: true, local: { "hetja.scan.care": JSON.stringify([{ name: "Lokhandwala Pet Hospital", phone: "+912226300101" }, { name: "Versova Animal Welfare Trust", phone: "+919820012345" }]) } }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.locator("#send").click();
    await page.getByText("No signal. The message is written.").first().waitFor({ timeout: 20_000 });
    await snap("d-p13-no-signal", "/d/<slug> SOS", "P13 no signal", "The message is written: Open Messages, or text a saved vet");
  });

  let n10Phase = 0;
  await flow("d-n10", {
    geo: true,
    api: [
      ["POST", /^\/reports$/, () => ok({ created: true, caseId: CASE_ID.open, tier: 1, fanout: "responders", nearbyCare: CARE_SCAN, wardId: "K-West" })],
      ["GET", /^\/reports\/([^/]+)\/status$/, () => ok(n10Phase === 0
        ? reportStatus({ state: "acked", ackedAt: ago(1), responderFirstName: "Priya", takenAt: ago(1), feedersNotifiedNames: ["Priya", "Arjun"], feedersNotified: 2, vetsNotified: 1 })
        : reportStatus({ state: "resolved", ackedAt: ago(40), responderFirstName: "Priya", takenAt: ago(40), closeByAt: ago(30), arrivedAt: ago(28), resolvedAt: ago(1), outcome: "taken_to_vet", vetName: "Lokhandwala Pet Hospital", feedersNotifiedNames: ["Priya", "Arjun"], feedersNotified: 2, vetsNotified: 1 }))],
      ["POST", /^\/reports\/([^/]+)\/updates$/, () => ok({ ok: true })],
    ],
  }, async ({ page, context, go, snap }) => {
    n10Phase = 0;
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.locator("#send").click();
    await page.getByText("Priya is on the way.").first().waitFor({ timeout: 25_000 });
    await page.waitForTimeout(600);
    await snap("d-n10-on-the-way", "/d/<slug> SOS", "N10 Priya is on the way", "Timeline, while you wait first-aid lines, send Priya an update, I had to leave");
    await page.locator("#upd").click();
    await page.locator("#upd-note").fill("She's moved under the bus stop bench, still breathing.").catch(() => undefined);
    await page.waitForTimeout(400);
    await snap("d-n10-update-sheet", "/d/<slug> SOS", "N10 send an update", "Update sheet for Priya", { scroll: false });
    await page.locator("#upd-go").click().catch(() => undefined);
    await page.waitForTimeout(600);
    n10Phase = 1;
    console.log("  waiting for the next status poll (N11)");
    await page.getByText("Rani is with a vet.").first().waitFor({ timeout: 25_000 });
    await page.waitForTimeout(600);
    await snap("d-n11-outcome", "/d/<slug> SOS", "N11 what happened", "Rani is with a vet: raised, help arrived, outcome");
  });

  await flow("d-l7", {
    geo: true,
    api: [["POST", /^\/reports$/, () => ({ status: 429, json: { ok: false, error: { code: "SOS_CASE_OPEN", message: "open case", data: { openCase: { caseId: CASE_ID.open, raisedAt: ago(18), responderFirstName: "Priya", takenAt: ago(15) } } }, data: { openCase: { caseId: CASE_ID.open, raisedAt: ago(18), responderFirstName: "Priya", takenAt: ago(15) } } } })]],
  }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: /Can['’]t get up, or bleeding/ }).click();
    await page.locator("#send").click();
    await page.getByText("Rani already has an SOS open.").first().waitFor({ timeout: 20_000 });
    await snap("d-l7-already-open", "/d/<slug> SOS", "L7 SOS already open", "You raised it; Priya took it and is on the way; add an update, call a vet");
  });

  await flow("d-sos-failed", { geo: true, api: [["POST", /^\/reports$/, () => fail(500, "INTERNAL", "internal error")]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: "Hurt, but moving" }).click();
    await page.locator("#send").click();
    await page.getByText("SOS not sent.").first().waitFor({ timeout: 20_000 });
    await snap("d-sos-not-sent", "/d/<slug> SOS", "not sent (server error)", "SOS not sent: Hetja couldn't confirm it, Try again");
  });

  await flow("d-sos-limited", { geo: true, api: [["POST", /^\/reports$/, () => fail(429, "RATE_LIMITED", "too many reports")]] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await dView(page);
    await page.locator("#primary-cta").click();
    await page.locator("label.opt", { hasText: "Hurt, but moving" }).click();
    await page.locator("#send").click();
    await page.getByText("This phone has sent the most SOS reports").first().waitFor({ timeout: 20_000 });
    await snap("d-sos-rate-limited", "/d/<slug> SOS", "not sent (429)", "This phone has sent the most SOS reports allowed");
  });

  await flow("d-d2", { widths: [1440] }, async ({ page, go, snap }) => {
    await go(`/d/${SLUG.rani}`);
    await page.getByText("Rani is on Hetja.").first().waitFor();
    await snap("d-d2-desktop", "/d/<slug> (desktop)", "D2 desktop collar page", "Rani is on Hetja: standing next to her? use your phone; QR; SOS from here");
    await page.locator("#dk-sos").click();
    await page.getByText(/What['’]s happened to Rani?/).waitFor();
    await snap("d-d2-desktop-sos", "/d/<slug> (desktop)", "D2 SOS from the desktop", "SOS form centred at 480 px");
  });
}

// ---------------------------------------------------------------------------
// Index and zip
// ---------------------------------------------------------------------------

function writeIndex() {
  const rows = [...index.values()].sort((a, b) => a.n - b.n);
  const lines = [
    "# Hetja screens (design v5 + v6)",
    "",
    `Captured ${new Date().toISOString()} from ${BASE} with Microsoft Edge (Playwright).`,
    "",
    "Every screen is at 390 x 844 (device scale 2) as a viewport shot and a full-page shot (`-full`, identical when the screen fits).",
    "Desktop (1440 x 900): the reading pages and /hetja (phone layout centred at 480 px), the D1 invitation, the collar page D2,",
    "the print sheets, the 404 and the SOS case page. Map shots are viewport-only (the map does not scroll).",
    "Screen codes in the State column (V7, P9, M1, F3, N12 ...) are the ones in docs/design/v5-handoff and v6-handoff.",
    "",
    "Data: production has almost no dogs yet, so dogs, feeders, cases, vets and counts come from fixtures shaped like the",
    "real API responses (dogs Rani, Kalu, Bruno, Moti, Goli, Tiger in K/W Andheri West; feeders Priya S., Arjun, Meera, Anil).",
    "`map-live-production` and `d-p8-live-production` are unmocked. Clinic and NGO names and phone numbers are fictional.",
    "Dog photos are placeholder illustrations. Ward positions on the map are real.",
    "Nothing was written to production: every POST, PATCH and DELETE was answered by the script or blocked.",
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
