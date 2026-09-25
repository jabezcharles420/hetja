import { describe, expect, it } from "vitest";
import { formatRetryAt, verifyErrorMessage } from "@/lib/login";
import { dayOneSteps, fedWhenLabel, staleCopyLabel, unreadCount } from "@/lib/me-hub";
import { eightAmIst, isPaused, pauseOptions, pauseSentence, resumeLabel } from "@/lib/sos-pause";
import { isIosSafari } from "@/lib/install-offer";
import type { FeederMe } from "@/lib/api";

// 2026-09-25 17:30 IST.
const NOW = new Date("2026-09-25T12:00:00.000Z");

describe("V6: Retry-After as a clock time", () => {
  it("reads 840 s as a time 14 minutes on", () => {
    expect(formatRetryAt(840, NOW)).toEqual({ clock: "5:44 pm", relative: "in 14 minutes" });
    expect(formatRetryAt(30, NOW)?.relative).toBe("in 1 minute");
  });

  it("says nothing it does not know", () => {
    expect(formatRetryAt(undefined, NOW)).toBeNull();
    expect(formatRetryAt(0, NOW)).toBeNull();
  });
});

describe("V5: the wrong code, in words", () => {
  it("names the likely cause", () => {
    expect(verifyErrorMessage("INVALID_CODE", "invalid_code")).toBe("That's not the code. Check the newest email.");
    expect(verifyErrorMessage(undefined, "expired")).toMatch(/run out/);
  });
});

describe("L1: pause times, Mumbai time", () => {
  it("offers tomorrow 8 am and a week on", () => {
    const o = pauseOptions(NOW);
    expect(o.tomorrow.at.toISOString()).toBe("2026-09-26T02:30:00.000Z");
    expect(o.tomorrow.label).toBe("8 am");
    expect(o.week.label).toBe("2 Oct");
  });

  it("uses the Mumbai day even just after midnight UTC", () => {
    // 00:30 IST on the 26th: tomorrow is the 27th.
    expect(eightAmIst(new Date("2026-09-25T19:00:00.000Z"), 1).toISOString()).toBe("2026-09-27T02:30:00.000Z");
  });

  it("labels and detects a pause", () => {
    expect(resumeLabel("2026-09-26T02:30:00.000Z", NOW)).toBe("8 am");
    expect(resumeLabel("2026-10-02T02:30:00.000Z", NOW)).toBe("2 Oct");
    expect(isPaused("2026-09-26T02:30:00.000Z", NOW)).toBe(true);
    expect(isPaused("2026-09-24T02:30:00.000Z", NOW)).toBe(false);
    expect(isPaused(null, NOW)).toBe(false);
  });

  it("says who will still hear, without inventing co-feeders", () => {
    expect(pauseSentence(["Rani", "Kalu"], ["K/W"])).toBe(
      "If Rani or Kalu is hurt, other feeders and the vets in K/W will still hear. You won't.",
    );
    expect(pauseSentence([], [])).toBe("If a dog you feed is hurt, other feeders and the vets nearby will still hear. You won't.");
  });
});

describe("V8 / V9: Me helpers", () => {
  const me = { wards: [] } as unknown as FeederMe;

  it("the checklist ticks off as the feeder goes", () => {
    const fresh = dayOneSteps({ me, dogs: [], streakDays: 0 });
    expect(fresh.map((s) => s.done)).toEqual([true, false, false, false]);
    const done = dayOneSteps({
      me: { wards: ["K-West"] } as unknown as FeederMe,
      dogs: [{ slug: "a", name: "Rani", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: NOW.toISOString() }],
      streakDays: 1,
    });
    expect(done.every((s) => s.done)).toBe(true);
  });

  it("names the stale copy by when it was saved", () => {
    expect(staleCopyLabel("2026-09-25T03:00:00.000Z", NOW)).toBe("this morning's");
    expect(staleCopyLabel("2026-09-25T09:00:00.000Z", NOW)).toBe("this afternoon's");
    expect(staleCopyLabel("2026-09-24T09:00:00.000Z", NOW)).toBe("yesterday's");
    expect(staleCopyLabel("2026-09-20T09:00:00.000Z", NOW)).toBe("an older");
  });

  it("fed labels like V9", () => {
    expect(fedWhenLabel("2026-09-25T01:40:00.000Z", NOW)).toBe("Fed 7:10 am");
    expect(fedWhenLabel("2026-09-24T09:00:00.000Z", NOW)).toBe("Fed yesterday");
    expect(fedWhenLabel(null, NOW)).toBe("Not fed yet");
  });

  it("counts unread alerts", () => {
    const a = (at: string) => ({ id: at, kind: "fed" as const, at, dog: null, wardCode: null, actorName: null, detail: null, href: "/" });
    expect(unreadCount([a("2026-09-25T11:00:00.000Z"), a("2026-09-25T08:00:00.000Z")], Date.parse("2026-09-25T10:00:00.000Z"))).toBe(1);
  });
});

describe("V23: iOS gets the Share steps", () => {
  it("recognises iOS Safari, not iOS Chrome", () => {
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36")).toBe(false);
  });
});
