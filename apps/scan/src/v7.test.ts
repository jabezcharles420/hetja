/**
 * Design v7 on the collar page (docs/design/v7-portals, V4): the public
 * health list. Vet-signed rows name the vet, council number and batch;
 * feeder-noted rows say who added them; corrections show only the current
 * version; withdrawals are not shown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentHealth, fetchHealth, type HealthRecord } from "./api.js";
import { recordDate } from "./format.js";
import { healthMarkup } from "./ui.js";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The API's HealthRecord (apps/web/lib/api.ts "Design v7 types"), every field present. */
const rec = (o: Record<string, unknown>): Record<string, unknown> => ({
  type: "other",
  title: "",
  status: "feeder_noted",
  date: null,
  dueOn: null,
  note: null,
  vet: null,
  brand: null,
  batch: null,
  addedBy: null,
  supersedes: null,
  withdraws: null,
  withdrawnAt: null,
  reason: null,
  earNotched: null,
  flagged: false,
  signRequestOpen: false,
  recordedAt: "2026-09-12T10:00:00Z",
  ...o,
});
const RAW = [
  rec({
    id: "r1",
    type: "vaccination",
    title: "Anti-rabies",
    status: "vet_signed",
    date: "2026-09-12",
    dueOn: "2027-09-12",
    vet: { name: "Dr. Farhan Qureshi", council: "MSVC", regNo: "5190" },
    brand: "Raksharab",
    batch: "RB2409",
  }),
  rec({ id: "r2", type: "sterilisation", title: "Sterilised", status: "vet_signed", date: "2025-04", earNotched: true, vet: { name: "Dr. Leena Pillai", council: "MSVC", regNo: "4477" } }),
  rec({ id: "r3", type: "deworming", title: "Deworming", date: "2026-08-03", addedBy: "Priya" }),
];

afterEach(() => vi.unstubAllGlobals());

describe("V4 health list", () => {
  it("reads dates the way the mock writes them", () => {
    expect(recordDate("2026-09-12")).toBe("12 Sep 2026");
    expect(recordDate("2026-08-03T00:00:00Z")).toBe("3 Aug 2026");
    expect(recordDate("2025-04")).toBe("Apr 2025");
    expect(recordDate("nonsense")).toBe("");
    expect(recordDate(undefined)).toBe("");
  });

  it("maps the API rows and renders the mock's lines verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true, data: { records: RAW } })));
    const h = (await fetchHealth("r4n7kw2ab"))!;
    expect(h.records.map((r) => r.title)).toEqual(["Anti-rabies", "Sterilised", "Deworming"]);
    const html = healthMarkup(h, "r4n7kw2ab", true);
    expect(html).toContain('<h2 class="h2">Health</h2>');
    expect(html).toContain("12 Sep 2026 · due again 12 Sep 2027");
    expect(html).toContain("Dr. Farhan Qureshi · MSVC 5190 · Raksharab RB2409");
    expect(html).toContain("Apr 2025 · ear notched");
    expect(html).toContain("Dr. Leena Pillai · MSVC 4477");
    expect(html).toContain("3 Aug 2026 · added by Priya");
    expect(html.match(/✓ Vet signed/g)).toHaveLength(2);
    expect(html).toContain("Feeder noted");
    expect(html).toContain("Ask a vet to sign");
    expect(html).toContain('href="/vet/r4n7kw2ab/certificate"');
    expect(html).toContain("Vaccination certificate for rescues and adoptions");
    expect(html).not.toContain("Open vet view");
  });

  it("a stranger gets no Ask a vet link; a verified vet gets Open vet view", () => {
    const h = { records: currentHealth([{ id: "r3", title: "Deworming", signed: false, addedBy: "Priya" }]), viewerIsVet: true };
    const html = healthMarkup(h, "r4n7kw2ab", false);
    expect(html).not.toContain("Ask a vet to sign");
    expect(html).toContain('href="/vet/dogs/r4n7kw2ab"');
    // No vet-signed record: no certificate to offer.
    expect(html).not.toContain("Vaccination certificate");
    expect(healthMarkup({ records: [], viewerIsVet: false }, "x")).toBe("");
    expect(healthMarkup(undefined, "x")).toBe("");
  });

  it("shows the current version of a corrected record and nothing withdrawn", async () => {
    // Oldest first, corrections and withdrawals included, as the API sends them.
    const rows = [
      ...RAW.map((r) => (r.id === "r2" ? { ...r, withdrawnAt: "2026-09-20T00:00:00Z" } : r)),
      { ...RAW[0], id: "r4", batch: "RB2419", supersedes: "r1", reason: "Typo in batch number." },
      rec({ id: "w1", type: "withdrawal", withdraws: "r2", reason: "Not vaccinated by me." }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true, data: { records: rows, certificateUrl: "/vet/r4n7kw2ab/certificate" } })));
    const h = (await fetchHealth("r4n7kw2ab"))!;
    expect(h.records.map((r) => r.id)).toEqual(["r3", "r4"]);
    // A correction of a correction: only the last version remains.
    expect(currentHealth([{ id: "a", title: "X", signed: true }, { id: "b", title: "X", signed: true, supersedes: "a" }, { id: "c", title: "X", signed: true, supersedes: "b" }]).map((r) => r.id)).toEqual(["c"]);
    const html = healthMarkup(h, "r4n7kw2ab", false);
    expect(html).toContain("Raksharab RB2419");
    expect(html).not.toContain("RB2409");
    expect(html).not.toContain("Sterilised");
    expect(html).toContain('href="/vet/r4n7kw2ab/certificate"');
    const marked: HealthRecord[] = [{ id: "a", title: "X", signed: true, withdrawn: true }];
    expect(currentHealth(marked)).toEqual([]);
  });

  it("flagged signatures and open sign requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, { ok: true, data: { records: [{ ...RAW[0], flagged: true }, { ...RAW[2], signRequestOpen: true }], viewerIsVet: false } }),
      ),
    );
    const html = healthMarkup((await fetchHealth("r4n7kw2ab"))!, "r4n7kw2ab", true);
    expect(html).toContain("Being re-checked");
    expect(html).not.toContain("✓ Vet signed");
    // Already asked: no second "Ask a vet to sign"; a flagged record offers no certificate.
    expect(html).not.toContain("Ask a vet to sign");
    expect(html).not.toContain("Vaccination certificate");
  });

  it("sends the session when there is one, and fails quietly", async () => {
    const f = vi.fn(async () => json(200, { ok: true, data: { records: [], viewerIsVet: true } }));
    vi.stubGlobal("fetch", f);
    expect(await fetchHealth("r4n7kw2ab", "tok")).toEqual({ records: [], certificateUrl: undefined, viewerIsVet: true });
    const first = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(first[0]).toBe("/api/v1/dogs/r4n7kw2ab/health");
    expect((first[1].headers as Record<string, string>).authorization).toBe("Bearer tok");
    await fetchHealth("r4n7kw2ab");
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("authorization");
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { ok: false })));
    expect(await fetchHealth("r4n7kw2ab")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchHealth("r4n7kw2ab")).toBeUndefined();
  });
});
