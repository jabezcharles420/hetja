/**
 * Design v5 on the collar page: F4 (report a tag problem), F5 (the answer),
 * the Unverified / Tag under review / sturdier collar states, the memorial
 * page, and the code-miss path (P8, tested in v6.test.ts). The page has no DOM test
 * harness, so every state is pinned through the pure builders that render it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDogProfile, NotFoundError, type DogProfile } from "./api.js";
import { pronouns, tagChoices, tagFootnote, tagSentCopy } from "./format.js";
import { rawCode } from "./slug.js";
import { flushTagQueue, listTagQueue, queueTagReport, readTagReport, sendTagReport, tagSentMarkup, TAG_QUEUE_KEY } from "./tag.js";
import { buildProfile } from "./ui.js";

const her = pronouns("female");
const they = pronouns(undefined);

function dog(over: Partial<DogProfile> = {}): DogProfile {
  return { slug: "rni482pq7", name: "Rani", status: "active", wardId: "K-West", sex: "female", feederCount: 3, ...over };
}

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("localStorage", memStorage());
  vi.stubGlobal("navigator", { onLine: true });
  // A cached device token, so no proof-of-work runs in these tests.
  localStorage.setItem("hetja.deviceToken.v1", "dev.tok");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pronouns", () => {
  it("her / his from the record, they / them without one", () => {
    expect(pronouns("female")).toEqual({ subj: "she", obj: "her", poss: "her" });
    expect(pronouns("m")).toEqual({ subj: "he", obj: "him", poss: "his" });
    expect(pronouns(undefined)).toEqual({ subj: "they", obj: "them", poss: "their" });
  });
});

describe("F4 sheet copy", () => {
  it("carries the mock's four rows verbatim", () => {
    expect(tagChoices(her).map((c) => [c.kind, c.title, c.sub])).toEqual([
      ["damaged", "Damaged or faded", "Still on her, hard to scan"],
      ["found_on_ground", "Found it on the ground", "The dog isn't with me"],
      ["wrong_dog", "This isn't the dog in the photo", "Tag is on a different dog"],
      ["too_tight", "Collar is too tight", "Or cutting into the neck"],
    ]);
    expect(tagChoices(they)[0]!.sub).toBe("Still on them, hard to scan");
  });

  it("footnote verbatim, and no promise of feeders when there are none", () => {
    expect(tagFootnote(her, 3)).toBe("No sign-in needed. Her feeders are told within a minute.");
    expect(tagFootnote(they, undefined)).toBe("No sign-in needed. Their feeders are told within a minute.");
    expect(tagFootnote(her, 0)).toBe("No sign-in needed.");
  });
});

describe("F5 copy", () => {
  const sent = (n: number | null, ward: string | null = "K/W") =>
    ({ kind: "sent", feedersNotified: n, wardCode: ward }) as const;

  it("found on the ground: the mock's sentence with the API's count and ward", () => {
    expect(tagSentCopy("found_on_ground", "Rani", her, sent(3))).toEqual({
      title: "Rani's feeders know.",
      msg: "3 feeders in K/W got an alert that her tag came off. Someone will put a new one on her.",
      ok: true,
    });
    expect(tagSentCopy("found_on_ground", "Rani", they, sent(1, null)).msg).toBe(
      "1 feeder got an alert that their tag came off. Someone will put a new one on them.",
    );
  });

  it("zero feeders is said honestly, not as 'her feeders know'", () => {
    const c = tagSentCopy("found_on_ground", "Rani", her, sent(0));
    expect(c.title).toBe("Report saved.");
    expect(c.msg).toBe("Nobody feeds Rani on Hetja yet, so no one got an alert. Your report is saved for whoever does.");
  });

  it("the other three kinds, in the same voice", () => {
    expect(tagSentCopy("damaged", "Rani", her, sent(2)).msg).toBe(
      "2 feeders in K/W got an alert that her tag is damaged. Someone will put a new one on her.",
    );
    expect(tagSentCopy("too_tight", "Rani", her, sent(2)).msg).toBe(
      "2 feeders in K/W got an alert that her collar is too tight. Someone will loosen or change it.",
    );
    const wrong = tagSentCopy("wrong_dog", "Rani", her, sent(2)).msg;
    expect(wrong).toBe("2 feeders in K/W got an alert. Until a feeder checks, this tag shows as under review. SOS still works.");
  });

  it("an unknown count claims no number", () => {
    expect(tagSentCopy("damaged", "Rani", her, sent(null)).msg).toMatch(/^Feeders in K\/W got an alert/);
  });

  it("queued offline and rate limited", () => {
    expect(tagSentCopy("damaged", "Rani", her, { kind: "queued" })).toMatchObject({
      title: "Your report is saved.",
      msg: "It goes to Hetja when you're back online. Her feeders won't hear until then.",
    });
    const r = tagSentCopy("damaged", "Rani", her, { kind: "rate_limited" });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("the red button still works");
  });
});

describe("F5 markup", () => {
  it("found on the ground shows the two steps and the seen row", () => {
    const html = tagSentMarkup("found_on_ground", dog(), { kind: "sent", feedersNotified: 3, wardCode: "K/W" });
    expect(html).toContain("Done");
    expect(html).toContain("What to do with the tag");
    expect(html).toContain("Leave it tied to a pole or gate near where you found it, at eye level.");
    expect(html).toContain("Or bin it. The code still works on her spare tags.");
    expect(html).toContain("Seen Rani nearby?");
    expect(html).toContain("Helps feeders find her faster");
    expect(html).toContain("Yes, just now");
  });

  it("offline keeps the steps but not the seen row (it needs signal)", () => {
    const html = tagSentMarkup("found_on_ground", dog(), { kind: "queued" });
    expect(html).toContain("What to do with the tag");
    expect(html).not.toContain("Yes, just now");
  });

  it("other kinds get only the confirmation", () => {
    const html = tagSentMarkup("too_tight", dog(), { kind: "sent", feedersNotified: 3, wardCode: "K/W" });
    expect(html).toContain("Rani&#39;s feeders know.");
    expect(html).not.toContain("What to do with the tag");
  });
});

describe("posting a tag report", () => {
  it("reads the API's answer", () => {
    expect(readTagReport(201, { ok: true, data: { reportId: "r1", feedersNotified: 3, wardCode: "K/W" } })).toEqual({
      kind: "sent",
      feedersNotified: 3,
      wardCode: "K/W",
    });
    expect(readTagReport(200, { ok: true, data: { feedersNotified: -1 } })).toMatchObject({ feedersNotified: null });
    expect(readTagReport(429, null)).toEqual({ kind: "rate_limited" });
    expect(readTagReport(500, null)).toBe("error");
  });

  it("sends { kind } with the device token header, no sign-in", async () => {
    const f = vi.fn(async () => json(201, { ok: true, data: { reportId: "r1", feedersNotified: 3, wardCode: "K/W" } }));
    vi.stubGlobal("fetch", f);
    const o = await sendTagReport("rni482pq7", "found_on_ground");
    expect(o).toEqual({ kind: "sent", feedersNotified: 3, wardCode: "K/W" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/dogs/rni482pq7/tag-reports");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "found_on_ground" });
    expect((init.headers as Record<string, string>)["x-device-token"]).toBe("dev.tok");
  });

  it("queues when offline, and when the request never reaches the server", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(await sendTagReport("rni482pq7", "damaged")).toEqual({ kind: "queued" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network"))));
    expect(await sendTagReport("rni482pq7", "too_tight")).toEqual({ kind: "queued" });
    expect(listTagQueue()).toEqual([
      { slug: "rni482pq7", kind: "damaged" },
      { slug: "rni482pq7", kind: "too_tight" },
    ]);
  });

  it("the queue dedupes, flushes in order, keeps what the server wants to wait on", async () => {
    queueTagReport("rni482pq7", "damaged");
    queueTagReport("rni482pq7", "damaged");
    queueTagReport("abc234xyz", "wrong_dog");
    expect(listTagQueue()).toHaveLength(2);
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(201, { ok: true, data: {} }))
      .mockResolvedValueOnce(json(429, { ok: false }));
    vi.stubGlobal("fetch", f);
    expect(await flushTagQueue()).toBe(1);
    expect(listTagQueue()).toEqual([{ slug: "abc234xyz", kind: "wrong_dog" }]);
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { ok: false })));
    await flushTagQueue();
    expect(localStorage.getItem(TAG_QUEUE_KEY)).toBeNull();
  });
});

describe("profile states", () => {
  it("grey Unverified pill only when verified is false", () => {
    expect(buildProfile(dog({ verified: false }))).toContain('<span class="badge">Unverified</span>');
    expect(buildProfile(dog({ verified: true }))).not.toContain("Unverified");
    expect(buildProfile(dog())).not.toContain("Unverified");
  });

  it("Tag under review banner, with the SOS left alone", () => {
    const html = buildProfile(dog({ tagUnderReview: true }));
    expect(html).toContain("Tag under review");
    expect(html).toContain("SOS still works.");
    expect(buildProfile(dog())).not.toContain("Tag under review");
  });

  it("asks for a sturdier collar after repeated reports", () => {
    expect(buildProfile(dog({ sturdierCollarSuggested: true }))).toContain(
      "Rani&#39;s tag keeps coming off. A sturdier collar would help her.",
    );
    expect(buildProfile(dog({ sex: undefined, sturdierCollarSuggested: true }))).toContain("would help them.");
  });

  it("a quiet Report a tag problem entry under the content", () => {
    const html = buildProfile(dog());
    expect(html).toContain('id="tag-open"');
    expect(html.indexOf("Report a tag problem")).toBeGreaterThan(html.indexOf('class="story"'));
  });

  it("memorial: names of everyone who fed them, no pills, no tag entry", () => {
    const html = buildProfile(dog({ status: "deceased", memorial: { feederNames: ["Priya S.", "Anil K."] } }));
    expect(html).toContain("Rani has passed away. Her page stays, with the names of everyone who fed her.");
    expect(html).toContain("<li>Priya S.</li><li>Anil K.</li>");
    expect(html).not.toContain('class="pills"');
    expect(html).not.toContain("tag-open");
    expect(buildProfile(dog({ status: "deceased", sex: undefined }))).toContain("Their page stays");
  });
});

describe("a code that matches no dog", () => {
  it("reads whatever follows /d/ as the code", () => {
    expect(rawCode("/d/RNI428PQ7")).toBe("rni428pq7");
    expect(rawCode("/d/rni-428-pq7/")).toBe("rni428pq7");
    expect(rawCode("/d/")).toBe("");
  });

  it("GET /dogs/:slug 404 is a NotFoundError, not 'can't reach Hetja'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { ok: false, error: { code: "NOT_FOUND" } })));
    await expect(fetchDogProfile("rni428pq7", "")).rejects.toBeInstanceOf(NotFoundError);
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { ok: false })));
    await expect(fetchDogProfile("rni428pq7", "")).rejects.not.toBeInstanceOf(NotFoundError);
  });

  it("maps the v5 profile fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, {
          ok: true,
          data: {
            slug: "rni482pq7",
            name: "Rani",
            status: "deceased",
            wardId: "K-West",
            verified: false,
            tagUnderReview: true,
            sturdierCollarSuggested: true,
            memorial: { feederNames: ["Priya S.", 7] },
          },
        }),
      ),
    );
    const { profile } = await fetchDogProfile("rni482pq7", "");
    expect(profile.verified).toBe(false);
    expect(profile.tagUnderReview).toBe(true);
    expect(profile.sturdierCollarSuggested).toBe(true);
    expect(profile.memorial).toEqual({ feederNames: ["Priya S."] });
  });
});
