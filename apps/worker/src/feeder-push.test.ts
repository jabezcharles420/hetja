/**
 * send_feeder_push (design v5): alerts mode and quiet hours, decided at send
 * time. Pure functions only; the handler around them is a SELECT and a loop.
 */
import { describe, expect, it } from "vitest";
import {
  HANDLERS,
  JOB_PRODUCERS,
  inQuietHours,
  minuteOfDayInKolkata,
  minutesUntilQuietEnd,
  partitionFeederPush,
} from "./index.js";

describe("quiet hours", () => {
  it("handles windows inside a day and across midnight", () => {
    // 23:00 to 06:00
    expect(inQuietHours(1380, 360, 1400)).toBe(true);
    expect(inQuietHours(1380, 360, 100)).toBe(true);
    expect(inQuietHours(1380, 360, 360)).toBe(false);
    expect(inQuietHours(1380, 360, 720)).toBe(false);
    // 13:00 to 14:00
    expect(inQuietHours(780, 840, 800)).toBe(true);
    expect(inQuietHours(780, 840, 840)).toBe(false);
    // unset or degenerate
    expect(inQuietHours(null, null, 100)).toBe(false);
    expect(inQuietHours(600, 600, 600)).toBe(false);
  });

  it("holds a push until the window ends", () => {
    expect(minutesUntilQuietEnd(360, 1400)).toBe(400);
    expect(minutesUntilQuietEnd(360, 100)).toBe(260);
  });

  it("reads the clock in Asia/Kolkata", () => {
    // 17:30 UTC is 23:00 IST.
    expect(minuteOfDayInKolkata(new Date("2026-09-25T17:30:00Z"))).toBe(1380);
    expect(minuteOfDayInKolkata(new Date("2026-09-25T00:00:00Z"))).toBe(330);
  });
});

describe("partitionFeederPush", () => {
  it("sends to 'all' feeders outside quiet hours, holds the quiet ones, treats unset as 'all', and skips only 'sos_only'", () => {
    const { now, later } = partitionFeederPush(
      [
        { id: "awake", alerts_mode: "all", quiet_start: 1380, quiet_end: 360 },
        { id: "asleep", alerts_mode: "all", quiet_start: 1380, quiet_end: 360 },
        { id: "sos-only", alerts_mode: "sos_only", quiet_start: null, quiet_end: null },
        { id: "default", alerts_mode: null, quiet_start: null, quiet_end: null },
        { id: "no-window", alerts_mode: "all", quiet_start: null, quiet_end: null },
      ].map((r) => (r.id === "awake" ? { ...r, quiet_start: 60, quiet_end: 120 } : r)),
      1400,
    );
    expect(now.sort()).toEqual(["awake", "default", "no-window"]);
    expect([...later.entries()]).toEqual([[400, ["asleep"]]]);
  });

  it("the SOS push carries severity, dog name, ward and time, never a position", async () => {
    const { sosPushPayload } = await import("./index.js");
    const p = JSON.parse(
      sosPushPayload("c1", { severity: "critical", dog_name: "Rani", ward_id: "K-West", opened_at: new Date("2026-09-25T10:00:00Z") }),
    );
    expect(p).toMatchObject({ caseId: "c1", url: "/sos/c1", severity: "critical", dogName: "Rani", wardId: "K-West", openedAt: "2026-09-25T10:00:00.000Z" });
    expect(JSON.stringify(p)).not.toMatch(/lat|lng/);
    expect(JSON.parse(sosPushPayload("c2", undefined))).toMatchObject({ dogName: null, wardId: null, openedAt: null });
  });

  it("is a registered handler with a producer", () => {
    expect(HANDLERS.send_feeder_push).toBeTypeOf("function");
    expect(JOB_PRODUCERS.send_feeder_push).toMatch(/enqueueFeederPush/);
  });
});
