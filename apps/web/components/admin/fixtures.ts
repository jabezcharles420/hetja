/**
 * The board's example data (A1 to A7: Aarti, Dr. Farhan Qureshi, Kalu and
 * Kaalu), served as the admin API would (lib/api "Design v7 types").
 * Test-only: the vitest suites stub fetch with `adminFixtureFetch`, and the
 * Playwright side-by-side runs answer page.route with `handleAdmin`. Nothing
 * in the app imports it.
 *
 * Plain TypeScript with type-only imports, so Node can strip and run it.
 * Every time is relative to BOARD_NOW, 25 September 2026, 09:50 in Mumbai,
 * the date on A1.
 */
import type {
  AdminCollarDetail,
  AdminCollarRow,
  AdminDocument,
  AdminDogDetail,
  AdminDogRow,
  AdminFeederDetail,
  AdminFeederRow,
  AdminMe,
  AdminNgoDetail,
  AdminNgoRow,
  AdminPermission,
  AdminReportRow,
  AdminSettings,
  AdminSosDetail,
  AdminTeam,
  AdminToday,
  AdminVetDetail,
  AdminVetRow,
  AssignableVet,
  AuditEntry,
  AvatarBatch,
  AvatarBatchDetail,
  AvatarTile,
  DogHealth,
  NgoStatus,
  VetStatus,
  Ward,
} from "@/lib/api";

export const BOARD_NOW = new Date("2026-09-25T04:20:00.000Z");

const MIN = 60_000;
const DAY = 86_400_000;
const at = (msAgo: number): string => new Date(BOARD_NOW.getTime() - msAgo).toISOString();
const days = (n: number): string => at(n * DAY);
const mins = (n: number): string => at(n * MIN);
const hours = (n: number): string => at(n * 3_600_000);

const ALL_PERMISSIONS: AdminPermission[] = [
  "vets",
  "vets_remove",
  "ngos",
  "ngos_remove",
  "dogs",
  "merge",
  "feeders",
  "collars",
  "sos",
  "reports",
  "avatars",
  "team",
  "audit",
  "settings",
];

export const ME: AdminMe = {
  feederId: "f-aarti",
  name: "Aarti Shah",
  roles: [{ role: "owner", wards: [], grantedAt: days(200), grantedByName: null, source: "config" }],
  permissions: ALL_PERMISSIONS,
  wards: null,
};

export const AVATAR_EDITOR: AdminMe = {
  feederId: "f-meera",
  name: "Meera K.",
  roles: [{ role: "avatar_editor", wards: [], grantedAt: days(3), grantedByName: "Aarti", source: "granted" }],
  permissions: ["avatars", "dogs", "settings"],
  wards: null,
};

export const WARDS: Ward[] = [
  { id: "A", code: "A", name: "Colaba" },
  { id: "B", code: "B", name: "Sandhurst Road" },
  { id: "C", code: "C", name: "Marine Lines" },
  { id: "D", code: "D", name: "Grant Road" },
  { id: "H-West", code: "H/W", name: "Bandra West" },
  { id: "K-East", code: "K/E", name: "Andheri East" },
  { id: "K-West", code: "K/W", name: "Andheri West" },
  { id: "L", code: "L", name: "Kurla" },
  { id: "M-West", code: "M/W", name: "Chembur" },
  { id: "P-North", code: "P/N", name: "Malad" },
  { id: "P-South", code: "P/S", name: "Goregaon" },
];

export const TODAY: AdminToday = {
  sidebar: { vets: 4, ngos: 1, avatars: 38, reports: 3, sos: 1 },
  cards: {
    vetsToVerify: { count: 4, oldestWaitingDays: 3 },
    avatarsToReview: { count: 38, batchId: "batch-12", batchNumber: 12 },
    openSos: { count: 2, unassigned: 1, oldestUnassignedMin: 40 },
    reports: { count: 3, duplicates: 2, photos: 1, other: 0 },
  },
  needsYou: [
    {
      kind: "sos",
      caseId: "sos-moti",
      dogName: "Moti",
      wardId: "K-West",
      wardName: "Lokhandwala",
      severity: "serious",
      note: "limping",
      raisedBy: "Sneha",
      openedAt: mins(40),
    },
    { kind: "vet", vetId: "vet-qureshi", name: "Dr. Farhan Qureshi", regLabel: "MSVC 5190", appliedAt: days(3), documents: 2, vouched: false },
    {
      kind: "duplicate",
      reportId: "rep-kalu",
      a: { slug: "k4lu2ab7c", name: "Kalu" },
      b: { slug: "k3au8mn2p", name: "Kaalu" },
      reason: "similar_name",
      sameWard: true,
      differentFeeders: true,
    },
    { kind: "avatars", batchId: "batch-12", batchNumber: 12, files: 38, matched: 34, needMatch: 4 },
  ],
  week: { newDogs: 14, vetSignedRecords: 22, sosResolved: 6, sosTotal: 7, collarsIssued: 9, vaccinationsDue14d: 11 },
};

// ---- Vets (A2) --------------------------------------------------------------------

const vetRow = (id: string, name: string, regNo: string, clinic: string | null, status: VetStatus, appliedAt: string, extra: Partial<AdminVetRow> = {}): AdminVetRow => ({
  id,
  feederId: `f-${id}`,
  name,
  council: "MSVC",
  regNo,
  regLabel: `MSVC ${regNo}`,
  clinic,
  status,
  appliedAt,
  vouched: false,
  registerChecked: false,
  ...extra,
});

export const VETS: AdminVetRow[] = [
  vetRow("vet-qureshi", "Dr. Farhan Qureshi", "5190", "Paws Clinic, Versova", "waiting", days(3)),
  vetRow("vet-pillai", "Dr. Leena Pillai", "4477", "Independent", "waiting", days(2), { vouched: true }),
  vetRow("vet-deshmukh", "Dr. Arjun Deshmukh", "3902", "BSPCA Parel", "waiting", days(1)),
  vetRow("vet-rao", "Dr. Nisha Rao", "6021", "Goregaon", "more_info", mins(90)),
  vetRow("vet-kulkarni", "Dr. Meghna Kulkarni", "3318", "Government Veterinary Hospital, Parel", "verified", days(90), { registerChecked: true }),
  vetRow("vet-menon", "Dr. S. Menon", "2210", "Menon Pet Care, Bandra", "suspended", days(160), { registerChecked: true }),
  vetRow("vet-shaikh", "Dr. Imtiaz Shaikh", "", null, "invited", days(4), { regLabel: "" }),
  vetRow("vet-joshi", "Dr. Kiran Joshi", "", null, "invited", days(6), { regLabel: "" }),
];

const VET_COUNTS: Record<VetStatus, number> = { invited: 2, waiting: 3, more_info: 1, verified: 17, suspended: 1, declined: 0, removed: 0 };

const doc = (id: string, kind: AdminDocument["kind"], uploadedAt: string): AdminDocument => ({
  id,
  kind,
  mime: "image/jpeg",
  sizeBytes: 480_000,
  uploadedAt,
  deleteAfter: null,
  deleted: false,
});

export function vetDetail(id: string): AdminVetDetail | null {
  const row = VETS.find((v) => v.id === id);
  if (!row) return null;
  return {
    ...row,
    qualification: row.status === "invited" ? null : "BVSc & AH",
    wards: ["K-West", "K-East", "P-South"],
    sosAvailable: true,
    sosHours: { from: "09:00", to: "21:00" },
    publicPhone: "+919812344410",
    publicPhoneMasked: "+91 98•••• 4410",
    registerCheckedAt: row.registerChecked ? days(88) : null,
    registerCheckedBy: row.registerChecked ? "Rohan" : null,
    validTo: row.registerChecked ? "2029-03" : null,
    decidedAt: row.status === "suspended" ? days(1) : row.status === "verified" ? days(88) : null,
    decidedBy: row.status === "suspended" ? "Aarti" : row.status === "verified" ? "Rohan" : null,
    decisionReason: row.status === "suspended" ? "registration lapsed" : row.status === "more_info" ? "The certificate photo is blurred" : null,
    vouchedBy: row.vouched ? { ngoId: "ngo-apt", name: "Andheri Paws Trust" } : null,
    ngo: row.vouched ? { id: "ngo-apt", name: "Andheri Paws Trust" } : null,
    documents: row.status === "invited" ? [] : [doc(`${id}-cert`, "certificate", row.appliedAt ?? days(3)), doc(`${id}-id`, "photo_id", row.appliedAt ?? days(3))],
    signatures: row.status === "verified" || row.status === "suspended" ? 41 : 0,
    signaturesFlagged: false,
    careProviderId: null,
    registerUrl: "https://msvc.maharashtra.gov.in/listofnew",
  };
}

// ---- Avatars (A3, A4) -------------------------------------------------------------

type TileDog = NonNullable<AvatarTile["dog"]>;
const tdog = (slug: string, name: string, extra: Partial<TileDog> = {}): TileDog => ({
  slug,
  name,
  photoUrl: null,
  photoBy: "Priya",
  photoAt: "2026-08-12T05:30:00.000Z",
  collarBatchNo: null,
  ...extra,
});

const tile = (i: number, fileName: string, d: TileDog | null, match: AvatarTile["match"], replaces = false): AvatarTile => ({
  id: `av-${i}`,
  batchId: "batch-12",
  fileName,
  imageUrl: "",
  match,
  dog: d,
  replacesExisting: replaces,
  status: "draft",
  uploadedAt: days(1),
  publishedAt: null,
  signoff: null,
});

const FIRST: AvatarTile[] = [
  tile(0, "r4n7kw2ab.png", tdog("r4n7kw2ab", "Rani"), "id"),
  tile(1, "HJ-0388.png", tdog("k4lu2ab7c", "Kalu", { collarBatchNo: "HJ-0388" }), "collar"),
  tile(2, "b8x2mq7zt.png", tdog("b8x2mq7zt", "Bholu", { photoBy: "Imran" }), "id"),
  tile(3, "chiku_side.png", null, "none"),
  tile(4, "m2tq8wz4k.png", tdog("m2tq8wz4k", "Moti", { photoBy: "Sneha" }), "id", true),
  tile(5, "l3p9ww4kc.png", tdog("l3p9ww4kc", "Laali"), "id"),
  tile(6, "sheru_2.png", null, "none"),
  tile(7, "HJ-0120.png", tdog("t6mmy2rbx", "Tommy", { collarBatchNo: "HJ-0120" }), "collar"),
  tile(8, "br5k2ma8d.png", tdog("br5k2ma8d", "Brownie"), "id"),
  tile(9, "unknown_07.png", null, "none"),
  tile(10, "g7lu3pq2w.png", tdog("g7lu3pq2w", "Golu"), "id", true),
  tile(11, "IMG_2231.png", null, "none"),
];

const MORE = ["Bruno", "Kaali", "Motu", "Chotu", "Rocky", "Jimmy", "Lucky", "Simba", "Tiger", "Coco", "Mishti", "Snowy", "Blacky", "Pinky", "Julie", "Raja", "Rani II", "Bittu", "Dolly", "Mithu", "Guddu", "Babli", "Kalia", "Toffee", "Sona", "Chhotu"];
const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";
const fakeSlug = (i: number): string => Array.from({ length: 9 }, (_, k) => ALPH[(i * 7 + k * 13 + 5) % ALPH.length]).join("");

export function batch12(): AvatarBatchDetail {
  const more = MORE.map((n, k) => {
    const i = 12 + k;
    const slug = fakeSlug(i);
    return tile(i, `${slug}.png`, tdog(slug, n), "id", k === 3);
  });
  const tiles = [...FIRST, ...more];
  const batch: AvatarBatch = { id: "batch-12", number: 12, createdAt: days(1), createdBy: "Meera", files: 38, matched: 34, published: 0, status: "open" };
  return {
    batch,
    tiles,
    counts: {
      all: tiles.length,
      byId: tiles.filter((t) => t.match === "id").length,
      byCollar: tiles.filter((t) => t.match === "collar").length,
      manual: tiles.filter((t) => t.match === "manual").length,
      noMatch: tiles.filter((t) => t.match === "none").length,
      replaces: tiles.filter((t) => t.replacesExisting).length,
    },
  };
}

// ---- Dogs, merge ------------------------------------------------------------------

const dogRow = (slug: string, name: string, wardId: string, wardCode: string, batchNo: string | null, createdAt: string, feeders: number, lastFedAt: string | null): AdminDogRow => ({
  slug,
  name,
  wardId,
  wardCode,
  status: "active",
  photoUrl: null,
  avatarUrl: null,
  collar: batchNo !== undefined ? { code: `${slug.slice(0, 3)}-${slug.slice(3, 6)}-${slug.slice(6)}`, batchNo } : null,
  createdAt,
  feeders,
  lastFedAt,
});

export const DOGS: AdminDogRow[] = [
  dogRow("r4n7kw2ab", "Rani", "K-West", "K/W", "HJ-0412", "2026-03-02T05:30:00.000Z", 3, hours(2)),
  dogRow("k4lu2ab7c", "Kalu", "K-West", "K/W", "HJ-0388", "2026-03-14T05:30:00.000Z", 1, hours(5)),
  { ...dogRow("k3au8mn2p", "Kaalu", "K-West", "K/W", null, "2026-09-02T05:30:00.000Z", 1, days(1)), collar: null },
  dogRow("m2tq8wz4k", "Moti", "K-West", "K/W", null, "2026-05-20T05:30:00.000Z", 2, days(1)),
  dogRow("b8x2mq7zt", "Bholu", "K-East", "K/E", "HJ-0231", "2026-01-11T05:30:00.000Z", 4, hours(3)),
  dogRow("s8eru4kq2", "Sheru", "P-South", "P/S", "HJ-0302", "2025-12-01T05:30:00.000Z", 2, days(2)),
];

const HEALTH: DogHealth = {
  records: [
    {
      id: "rec-1",
      type: "vaccination",
      title: "Anti-rabies",
      status: "vet_signed",
      date: "2026-09-12",
      dueOn: "2027-09-12",
      note: null,
      vet: { name: "Dr. Farhan Qureshi", council: "MSVC", regNo: "5190" },
      brand: "Raksharab",
      batch: "RB2419",
      addedBy: null,
      supersedes: null,
      withdraws: null,
      withdrawnAt: null,
      reason: null,
      earNotched: null,
      flagged: false,
      signRequestOpen: false,
      recordedAt: days(13),
    },
    {
      id: "rec-2",
      type: "sterilisation",
      title: "Sterilised",
      status: "vet_signed",
      date: "2025-04",
      dueOn: null,
      note: null,
      vet: { name: "Dr. Leena Pillai", council: "MSVC", regNo: "4477" },
      brand: null,
      batch: null,
      addedBy: null,
      supersedes: null,
      withdraws: null,
      withdrawnAt: null,
      reason: null,
      earNotched: true,
      flagged: false,
      signRequestOpen: false,
      recordedAt: days(500),
    },
  ],
  viewerIsVet: false,
};

export function dogDetail(slug: string): AdminDogDetail | null {
  const d = DOGS.find((x) => x.slug === slug);
  if (!d) return null;
  const kaalu = d.name === "Kaalu";
  return {
    ...d,
    registeredBy: kaalu ? { feederId: "f-imran", name: "Imran" } : { feederId: "f-priya", name: "Priya" },
    registeredAt: d.createdAt,
    verified: !kaalu,
    tagUnderReview: false,
    sex: "female",
    markings: ["white chest"],
    photos: [{ scanId: `${slug}-s1`, url: "", at: "2026-08-12T05:30:00.000Z", byName: kaalu ? "Imran" : "Priya", hidden: false }],
    avatar: {
      current: kaalu ? null : { id: `${slug}-a1`, imageUrl: "", status: "published", publishedAt: days(30), retiredAt: null, restorableUntil: null },
      history: [],
    },
    health: kaalu ? { records: [], viewerIsVet: false } : HEALTH,
    feedsTotal: kaalu ? 9 : 212,
    feederList: kaalu ? [{ feederId: "f-imran", name: "Imran" }] : [{ feederId: "f-priya", name: "Priya" }],
    mergedFrom: d.name === "Sheru" ? [{ slug: "t2ger8mn4", name: "Tiger", mergedAt: days(1) }] : [],
    mergedInto: null,
    openReports: [],
    sos: d.name === "Moti" ? [{ caseId: "sos-moti", severity: "serious", state: "open", openedAt: mins(40) }] : [],
  };
}

// ---- Feeders ----------------------------------------------------------------------

export const FEEDERS: AdminFeederRow[] = [
  { id: "f-priya", name: "Priya S.", trust: 82, wards: ["K-West"], createdAt: "2025-11-02T05:30:00.000Z", suspended: false, dogs: 6, feeds30d: 58 },
  { id: "f-imran", name: "Imran S.", trust: 64, wards: ["K-West", "K-East"], createdAt: "2026-02-18T05:30:00.000Z", suspended: false, dogs: 3, feeds30d: 21 },
  { id: "f-sneha", name: "Sneha R.", trust: 71, wards: ["K-West"], createdAt: "2026-04-09T05:30:00.000Z", suspended: false, dogs: 2, feeds30d: 30 },
  { id: "f-rahul", name: "Rahul T.", trust: 12, wards: ["P-South"], createdAt: "2026-09-10T05:30:00.000Z", suspended: true, dogs: 0, feeds30d: 2 },
];

export function feederDetail(id: string): AdminFeederDetail | null {
  const f = FEEDERS.find((x) => x.id === id);
  if (!f) return null;
  return {
    ...f,
    role: "feeder",
    trustEvents: [
      { at: days(2), type: "feed_confirmed", delta: 1, reason: "Feed confirmed by a second feeder" },
      { at: days(9), type: "report_upheld", delta: -5, reason: "Photo report upheld" },
    ],
    dogList: [
      { slug: "r4n7kw2ab", name: "Rani" },
      { slug: "k4lu2ab7c", name: "Kalu" },
    ],
    recentFeeds: [
      { scanId: `${id}-s1`, dog: { slug: "r4n7kw2ab", name: "Rani" }, at: hours(2), photoUrl: null, hidden: false },
      { scanId: `${id}-s2`, dog: { slug: "k4lu2ab7c", name: "Kalu" }, at: hours(5), photoUrl: null, hidden: false },
    ],
    reportsAgainst: f.suspended ? 3 : 0,
    suspension: f.suspended ? { at: days(2), reason: "posting other people's photos", byName: "Rohan" } : null,
    devices: [
      { deviceRef: `${id}-d1`, lastSeenAt: hours(2), blocked: false },
      { deviceRef: `${id}-d2`, lastSeenAt: days(20), blocked: f.suspended },
    ],
    vet: null,
    ngo: f.id === "f-imran" ? { name: "Andheri Paws Trust", role: "collars" } : null,
  };
}

// ---- Collars ----------------------------------------------------------------------

const collar = (slug: string, dogName: string, wardId: string, batchNo: string | null, issuedAt: string, prints: number, reissues: number): AdminCollarRow => ({
  slug,
  code: `${slug.slice(0, 3)}-${slug.slice(3, 6)}-${slug.slice(6)}`,
  dogName,
  wardId,
  batchNo,
  material: "pvc",
  issuedAt,
  status: "active",
  prints,
  reissues,
});

export const COLLARS: AdminCollarRow[] = [
  collar("r4n7kw2ab", "Rani", "K-West", "HJ-0412", days(2), 1, 0),
  collar("k4lu2ab7c", "Kalu", "K-West", "HJ-0388", days(190), 1, 0),
  collar("b8x2mq7zt", "Bholu", "K-East", "HJ-0231", days(6), 2, 0),
  collar("s8eru4kq2", "Sheru", "P-South", null, days(9), 1, 1),
];

export function collarDetail(slug: string): AdminCollarDetail | null {
  const c = COLLARS.find((x) => x.slug === slug);
  if (!c) return null;
  return {
    ...c,
    printList: [{ at: c.issuedAt, layout: "tags", paper: "a4", tagCount: 1, byName: "Imran" }],
    reissueList: c.reissues ? [{ at: days(9), previousBatchNo: "manual", newBatchNo: "P2-0007", reason: "tag chewed through", byName: "Kavita" }] : [],
  };
}

// ---- SOS ----------------------------------------------------------------------------

export const SOS: AdminSosDetail[] = [
  {
    id: "sos-moti",
    dog: { slug: "m2tq8wz4k", name: "Moti" },
    wardId: "K-West",
    wardCode: "K/W",
    severity: "serious",
    state: "open",
    openedAt: mins(40),
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    raisedBy: "Sneha",
    responder: null,
    unassignedMin: 40,
    ngo: { id: "ngo-apt", name: "Andheri Paws Trust" },
    assignedVet: null,
    note: "limping, back left leg",
    outcome: null,
    timeline: [
      { at: mins(40), kind: "raised", detail: "Sneha" },
      { at: mins(39), kind: "told", detail: "4 feeders" },
    ],
    told: { feeders: 4, vets: 3, ngos: 1 },
    dispatches: [],
  },
  {
    id: "sos-laali",
    dog: { slug: "l3p9ww4kc", name: "Laali" },
    wardId: "K-West",
    wardCode: "K/W",
    severity: "critical",
    state: "acked",
    openedAt: mins(18),
    ackedAt: mins(12),
    escalatedAt: null,
    resolvedAt: null,
    raisedBy: "Priya",
    responder: "Dr. Leena Pillai",
    unassignedMin: null,
    ngo: { id: "ngo-apt", name: "Andheri Paws Trust" },
    assignedVet: null,
    note: "hit by a bike",
    outcome: null,
    timeline: [
      { at: mins(18), kind: "raised", detail: "Priya" },
      { at: mins(12), kind: "told", detail: "Andheri Paws Trust" },
    ],
    told: { feeders: 3, vets: 0, ngos: 1 },
    dispatches: [],
  },
];

export const ASSIGNABLE: AssignableVet[] = [
  { feederId: "f-vet-qureshi", name: "Dr. Farhan Qureshi", regLabel: "MSVC 5190", clinic: "Paws Clinic, Versova", wards: ["K-West", "K-East"], coversWard: true, sosAvailable: true, inHours: true, publicPhone: "+919812344410" },
  { feederId: "f-vet-kulkarni", name: "Dr. Meghna Kulkarni", regLabel: "MSVC 3318", clinic: "Government Veterinary Hospital, Parel", wards: ["F-South"], coversWard: false, sosAvailable: true, inHours: false, publicPhone: "+912224137000" },
];

// ---- Reports ------------------------------------------------------------------------

export const REPORTS: AdminReportRow[] = [
  { id: "rep-kalu", source: "report", kind: "duplicate_dog", dog: { slug: "k4lu2ab7c", name: "Kalu", photoUrl: null }, otherDog: { slug: "k3au8mn2p", name: "Kaalu" }, note: "Same black dog outside the bakery", reporter: "Priya", createdAt: days(1), status: "open", outcome: null },
  { id: "rep-sheru", source: "report", kind: "duplicate_dog", dog: { slug: "s8eru4kq2", name: "Sheru", photoUrl: null }, otherDog: { slug: "t2ger8mn4", name: "Tiger" }, note: null, reporter: "Imran", createdAt: days(2), status: "open", outcome: null },
  { id: "rep-photo", source: "report", kind: "photo", dog: { slug: "b8x2mq7zt", name: "Bholu", photoUrl: null }, otherDog: null, note: "This photo shows a person's face", reporter: "Imran", createdAt: days(1), status: "open", outcome: null },
  { id: "tag-1", source: "tag", kind: "wrong_dog", dog: { slug: "r4n7kw2ab", name: "Rani", photoUrl: null }, otherDog: null, note: "This collar is on a brown male dog", reporter: "Sneha", createdAt: days(3), status: "open", outcome: null },
];

// ---- Team, audit --------------------------------------------------------------------

const grant = (role: AdminMe["roles"][number]["role"], wards: string[] = []) => ({ role, wards, grantedAt: days(30), grantedByName: "Aarti", source: "granted" as const });

export const TEAM: AdminTeam = {
  members: [
    { feederId: "f-aarti", name: "Aarti Shah", roles: [{ ...grant("owner"), source: "config", grantedByName: null }] },
    { feederId: "f-rohan", name: "Rohan Iyer", roles: [grant("moderator")] },
    { feederId: "f-meera", name: "Meera K.", roles: [grant("avatar_editor")] },
    { feederId: "f-imran", name: "Imran S.", roles: [grant("ward_lead", ["K-West"])] },
  ],
  invites: [],
};

const entry = (id: string, iso: string, name: string, summary: string, action: string, kind: AuditEntry["actor"]["kind"] = "admin"): AuditEntry => ({
  id,
  at: iso,
  actor: { id: `f-${name}`, name, kind },
  action,
  subjectType: null,
  subjectId: null,
  summary,
  detail: {},
});

export const AUDIT: AuditEntry[] = [
  entry("a1", "2026-09-25T04:12:00.000Z", "Rohan", "verified Dr. Arjun Deshmukh", "vet.verify"),
  entry("a2", "2026-09-25T03:45:00.000Z", "Dr. Leena Pillai", "signed Bholu · sterilisation", "record.sign", "vet"),
  entry("a3", "2026-09-24T12:10:00.000Z", "Meera", "published 22 avatars from batch #11", "avatars.publish"),
  entry("a4", "2026-09-24T10:02:00.000Z", "Aarti", "suspended Dr. S. Menon · reason: registration lapsed", "vet.suspend"),
  entry("a5", "2026-09-24T07:30:00.000Z", "Rohan", "merged Tiger into Sheru", "dogs.merge"),
  entry("a6", "2026-09-23T09:00:00.000Z", "Imran", "issued collar HJ-0412 to Rani", "collar.issue"),
  entry("a7", "2026-09-23T06:40:00.000Z", "Dr. Farhan Qureshi", "corrected Rani · anti-rabies batch", "record.correct", "vet"),
  entry("a8", "2026-09-22T08:15:00.000Z", "Aarti", "changed Meera to Avatar editor", "team.role"),
];

// ---- NGOs ---------------------------------------------------------------------------

const ngoRow = (id: string, name: string, wards: string[], vets: number, dogs: number, sos30d: number, status: NgoStatus, citywide = false): AdminNgoRow => ({
  id,
  name,
  wards,
  citywide,
  vets,
  dogs,
  sos30d,
  status,
  appliedAt: days(400),
});

export const NGOS: AdminNgoRow[] = [
  ngoRow("ngo-apt", "Andheri Paws Trust", ["K-West", "K-East"], 3, 412, 9, "active"),
  ngoRow("ngo-bspca", "BSPCA", [], 6, 1180, 21, "active", true),
  ngoRow("ngo-wsd", "Welfare of Stray Dogs", ["A", "B", "C", "D"], 4, 960, 14, "active"),
  ngoRow("ngo-bac", "Bandra Animal Care", ["H-West"], 2, 230, 5, "active"),
  ngoRow("ngo-grc", "Goregaon Rescue Collective", ["P-South", "P-North"], 1, 145, 3, "active"),
  ngoRow("ngo-mfa", "Malad Friends of Animals", ["P-North"], 1, 88, 2, "active"),
  { ...ngoRow("ngo-csd", "Chembur Street Dogs", ["M-West"], 0, 0, 0, "waiting"), appliedAt: days(2) },
  ngoRow("ngo-kpa", "Kurla Paws", ["L"], 1, 64, 0, "paused"),
];

export function ngoDetail(id: string): AdminNgoDetail | null {
  const n = NGOS.find((x) => x.id === id);
  if (!n) return null;
  return {
    id: n.id,
    name: n.name,
    regType: "trust",
    regNo: "E-21904 (Mum)",
    since: 2014,
    has80g: true,
    wards: n.wards,
    citywide: n.citywide,
    offers: { ambulance: true, shelterBeds: true, sterilisation: true, collars: true },
    contactName: "Kavita Nair",
    publicPhone: "+91 98•••• 2231",
    status: n.status,
    appliedAt: n.appliedAt,
    decidedAt: n.status === "waiting" ? null : days(390),
    decisionReason: n.status === "paused" ? "Ambulance off the road for repairs" : null,
    ambulance: { count: 1, hours: "8am to 10pm", status: "in", outOnCase: null },
    beds: { total: 12, free: 3 },
    vetCount: n.vets,
    dogCount: n.dogs,
    sos30d: n.sos30d,
    members: 14,
    vetList: [
      { feederId: "f-vet-qureshi", name: "Dr. Farhan Qureshi", status: "verified", vouched: true },
      { feederId: "f-vet-pillai", name: "Dr. Leena Pillai", status: "verified", vouched: true },
      { feederId: "f-vet-rao", name: "Dr. Nisha Rao", status: "waiting", vouched: false },
    ],
    documents: [{ ...doc(`${id}-reg`, "ngo_registration", n.appliedAt), mime: "application/pdf" }],
    careProviderId: null,
  };
}

export const SETTINGS: AdminSettings = {
  sos: {
    escalateAfterMin: 30,
    ngoWindowMin: 15,
    trustFloors: { minor: 0, serious: 20, critical: 40 },
    maxOpenAcks: 2,
    dailyCap: 3,
    weeklyCap: 10,
    maxPaged: 25,
  },
  retention: { photoDays: 365, documentDaysAfterDecision: 30, avatarPreviousDays: 30 },
  budgets: { scanPageKb: 40, feedTrustDailyCap: 5 },
  limits: [
    { name: "Avatar file", rule: "PNG, JPEG or WebP, up to 2 MB" },
    { name: "Documents", rule: "PDF up to 5 MB, images up to 2 MB" },
    { name: "Dogs a new feeder can add", rule: "3 waiting at a time, more with trust" },
  ],
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface FixtureResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

const ok = (data: unknown): FixtureResponse => ({ status: 200, body: { ok: true, data } });
const notFound = (): FixtureResponse => ({ status: 404, body: { ok: false, error: { message: "Not found", code: "NOT_FOUND" } } });

export interface FixtureOptions {
  me?: AdminMe | "signed_out" | "not_admin";
}

/** Answer one API call as the board would. `fullPath` starts after /api/v1. */
export function handleAdmin(method: string, fullPath: string, body: unknown, opts: FixtureOptions = {}): FixtureResponse {
  const [path, query = ""] = fullPath.split("?");
  const params = new URLSearchParams(query);
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  const m = method.toUpperCase();
  const b = (body ?? {}) as Record<string, unknown>;
  if (seg[0] === "wards" && seg.length === 1) return ok({ wards: WARDS });
  if (seg[0] !== "admin") return notFound();
  const r = seg.slice(1);

  if (r[0] === "me") {
    if (opts.me === "signed_out") return { status: 401, body: { ok: false, error: { message: "Sign in", code: "UNAUTHENTICATED" } } };
    if (opts.me === "not_admin") return { status: 403, body: { ok: false, error: { message: "Admins only", code: "ADMIN_REQUIRED" } } };
    return ok(opts.me ?? ME);
  }
  if (r[0] === "today") return ok(TODAY);
  if (r[0] === "search") {
    const q = (params.get("q") ?? "").toLowerCase();
    const has = (s: string | null) => !!s && s.toLowerCase().includes(q);
    return ok({
      dogs: DOGS.filter((d) => has(d.name) || has(d.slug) || has(d.collar?.batchNo ?? null)),
      feeders: FEEDERS.filter((f) => has(f.name)),
      vets: VETS.filter((v) => has(v.name) || has(v.regLabel)),
      collars: COLLARS.filter((c) => has(c.batchNo) || has(c.code)),
      ngos: NGOS.filter((n) => has(n.name)),
    });
  }
  if (r[0] === "documents") return { status: 200, body: "", contentType: "image/jpeg" };

  if (r[0] === "vets") {
    if (r.length === 1) {
      const st = params.get("status");
      return ok({ counts: VET_COUNTS, vets: st ? VETS.filter((v) => v.status === st) : VETS });
    }
    if (r[1] === "invite") return ok({ id: "vet-new", existingAccount: false });
    const d = vetDetail(r[1]);
    if (!d) return notFound();
    if (m === "POST") {
      const next: AdminVetDetail = { ...d };
      const set: Record<string, VetStatus> = { verify: "verified", decline: "declined", "ask-more": "more_info", suspend: "suspended", reinstate: "verified", remove: "removed" };
      if (set[r[2]]) next.status = set[r[2]];
      if (r[2] === "verify") {
        next.registerChecked = true;
        next.registerCheckedAt = BOARD_NOW.toISOString();
        next.registerCheckedBy = "Aarti";
        next.validTo = (b.validTo as string | null) ?? null;
      }
      if (typeof b.reason === "string") next.decisionReason = b.reason;
      return ok(next);
    }
    return ok(d);
  }

  if (r[0] === "avatars") {
    if (r[1] === "batches" && r.length === 2) {
      if (m === "POST") return ok({ id: "batch-13", number: 13, createdAt: BOARD_NOW.toISOString(), createdBy: "Aarti", files: 0, matched: 0, published: 0, status: "open" });
      return ok({
        batches: [
          batch12().batch,
          { id: "batch-11", number: 11, createdAt: days(8), createdBy: "Meera", files: 24, matched: 22, published: 22, status: "published" },
        ],
      });
    }
    if (r[1] === "batches") {
      const bd = batch12();
      if (r[3] === "publish") return ok({ published: bd.tiles.filter((t) => t.dog).length });
      if (r[3] === "files") {
        const name = String(b.fileName ?? "new.png");
        return ok(tile(99, name, null, "none"));
      }
      return ok(bd);
    }
    const found = batch12().tiles.find((t) => t.id === r[1]);
    if (!found) return notFound();
    if (r[2] === "publish") return ok({ ...found, status: "published", publishedAt: BOARD_NOW.toISOString() });
    if (r[2] === "ask-feeder") return ok({ ...found, signoff: { requestedAt: BOARD_NOW.toISOString(), feederName: found.dog?.photoBy ?? null, answer: null } });
    if (r[2] === "match") {
      const slug = b.dogSlug as string | null;
      const dg = DOGS.find((x) => x.slug === slug);
      return ok({ ...found, match: slug ? "manual" : "none", dog: slug ? tdog(slug, dg?.name ?? slug) : null });
    }
    return ok(found);
  }

  if (r[0] === "duplicates") {
    if (r[1] === "dismiss") return ok({ dismissed: true });
    return ok({ candidates: [] });
  }

  if (r[0] === "dogs") {
    if (r[1] === "merge") return ok({ keptSlug: b.keepSlug, mergedSlug: b.mergeSlug, feeds: 221, signedRecords: 2, feedersAdded: 1 });
    if (r.length === 1) {
      const q = (params.get("q") ?? "").toLowerCase();
      return ok({ dogs: DOGS.filter((d) => !q || `${d.name} ${d.slug} ${d.collar?.batchNo ?? ""}`.toLowerCase().includes(q)) });
    }
    const d = dogDetail(r[1]);
    if (!d) return notFound();
    if (r[2] === "status") return ok({ status: b.status });
    return ok(d);
  }
  if (r[0] === "photos") return ok({ hidden: true });

  if (r[0] === "feeders") {
    if (r.length === 1) {
      const q = (params.get("q") ?? "").toLowerCase();
      return ok({ feeders: FEEDERS.filter((f) => !q || f.name.toLowerCase().includes(q)) });
    }
    const f = feederDetail(r[1]);
    if (!f) return notFound();
    if (r[2] === "suspend") return ok({ suspended: true });
    if (r[2] === "unsuspend") return ok({ suspended: false });
    return ok(f);
  }
  if (r[0] === "devices") return ok(r[1] === "block" ? { blocked: true, deviceRef: b.deviceRef } : { blocked: false });

  if (r[0] === "collars") {
    if (r.length === 1) {
      const q = (params.get("q") ?? "").toLowerCase();
      return ok({ collars: COLLARS.filter((c) => !q || `${c.dogName} ${c.code} ${c.batchNo ?? ""}`.toLowerCase().includes(q)) });
    }
    const c = collarDetail(r[1]);
    if (!c) return notFound();
    if (m === "PATCH") return ok({ ...c, batchNo: b.batchNo });
    return ok(c);
  }

  if (r[0] === "sos") {
    if (r.length === 1) {
      const st = params.get("state") ?? "open";
      const cases = st === "unassigned" ? SOS.filter((c) => c.unassignedMin !== null) : st === "escalated" ? SOS.filter((c) => c.state === "escalated") : st === "closed" ? [] : SOS;
      return ok({ cases });
    }
    const c = SOS.find((x) => x.id === r[1]);
    if (!c) return notFound();
    if (r[2] === "vets") return ok({ vets: ASSIGNABLE });
    if (r[2] === "assign-vet") {
      const v = ASSIGNABLE.find((x) => x.feederId === b.vetFeederId);
      return ok({ id: "disp-1", caseId: c.id, ngoId: null, kind: "admin_vet", memberName: v?.name ?? "a vet", withAmbulance: false, etaMin: null, sentAt: BOARD_NOW.toISOString(), acceptedAt: null, declinedAt: null });
    }
    if (r[2] === "resolve") return ok({ id: c.id, state: "resolved", outcome: b.outcome });
    return ok(c);
  }

  if (r[0] === "reports") {
    if (r[2] === "resolve") return ok({ ...REPORTS.find((x) => x.id === r[1]), status: "resolved", outcome: b.outcome });
    const st = params.get("status") ?? "open";
    return ok({ reports: st === "resolved" ? [] : REPORTS });
  }

  if (r[0] === "team") {
    if (m === "POST" && r.length === 1) return ok({ granted: true, invited: false });
    if (r[2] === "role") return ok({ roles: [grant(b.role as "owner", (b.wards as string[]) ?? [])] });
    if (r[2] === "remove") return ok({ removed: true });
    return ok(TEAM);
  }
  if (r[0] === "audit") return ok({ entries: AUDIT, nextBefore: null });
  if (r[0] === "audit.csv") return { status: 200, body: "at,actor,summary\n", contentType: "text/csv" };

  if (r[0] === "ngos") {
    if (r.length === 1) {
      if (m === "POST") return ok(ngoDetail("ngo-apt"));
      const st = params.get("status");
      return ok({ counts: { waiting: 1, active: 6, paused: 1, removed: 0 }, ngos: st ? NGOS.filter((n) => n.status === st) : NGOS });
    }
    const n = ngoDetail(r[1]);
    if (!n) return notFound();
    if (m === "PATCH") return ok({ ...n, ...b });
    const set: Record<string, NgoStatus> = { pause: "paused", resume: "active", approve: "active", remove: "removed" };
    if (set[r[2]]) return ok({ ...n, status: set[r[2]] });
    return ok(n);
  }
  if (r[0] === "settings") return ok(SETTINGS);
  return notFound();
}

/** A fetch stub for vitest: answers /api/v1/* from the fixtures, records calls. */
export function adminFixtureFetch(opts: FixtureOptions = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/v1/, "") + url.search;
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    calls.push({ method, path, body });
    const res = handleAdmin(method, path, body, opts);
    const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    return new Response(text, { status: res.status, headers: { "content-type": res.contentType ?? "application/json" } });
  };
  return { fetch: fn, calls };
}
