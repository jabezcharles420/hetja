import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/api";
import { dayLabel, describeAlert, groupAlerts, relativeTime } from "@/lib/alerts";

const NOW = new Date("2026-09-25T12:00:00.000Z"); // 17:30 in Mumbai
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function alert(over: Partial<Alert>): Alert {
  return {
    id: "a",
    kind: "fed",
    at: ago(60_000),
    dog: { slug: "rni428pq7", name: "Rani" },
    wardCode: "K/W",
    actorName: null,
    detail: null,
    href: "/d/rni428pq7",
    ...over,
  };
}

describe("describeAlert: the N5 mock's examples, from structured fields", () => {
  it("sos", () => {
    expect(describeAlert(alert({ kind: "sos", actorName: "Anil" }))).toMatchObject({
      title: "SOS · Rani is hurt",
      detail: "K/W · Anil is going",
      dot: "sos",
    });
    expect(describeAlert(alert({ kind: "sos" })).detail).toBe("K/W · Nobody is going yet");
  });

  it("tag", () => {
    expect(describeAlert(alert({ kind: "tag", detail: "found_on_ground" }))).toMatchObject({
      title: "Rani's tag came off",
      detail: "Reported by a passer-by",
      dot: "attention",
    });
    expect(describeAlert(alert({ kind: "tag", detail: "damaged", actorName: "Anil" }))).toMatchObject({
      title: "Rani's tag is damaged",
      detail: "Reported by Anil",
    });
  });

  it("verified", () => {
    expect(
      describeAlert(
        alert({ kind: "verified", dog: { slug: "t", name: "Tiger" }, actorName: "Dr Mehta", detail: "vaccinated,sterilised" }),
      ),
    ).toMatchObject({ title: "Dr Mehta verified Tiger", detail: "Vaccinated · sterilised", dot: "ok" });
  });

  it("fed", () => {
    expect(
      describeAlert(alert({ kind: "fed", dog: { slug: "k", name: "Kalu" }, actorName: "Anil", detail: "Rice and egg" })),
    ).toMatchObject({ title: "Kalu was fed", detail: "Rice and egg · Anil", dot: "off" });
    expect(describeAlert(alert({ kind: "fed", actorName: null, detail: null })).detail).toBeNull();
  });

  it("not_seen", () => {
    expect(describeAlert(alert({ kind: "not_seen", dog: { slug: "m", name: "Moti" }, detail: "9" }))).toMatchObject({
      title: "Moti not seen in 9 days",
      detail: "Tap to update",
      dot: "attention",
    });
    expect(describeAlert(alert({ kind: "not_seen", detail: null })).title).toBe("Rani not seen lately");
  });

  it("an unnamed dog still reads as a sentence", () => {
    expect(describeAlert(alert({ kind: "sos", dog: null })).title).toBe("SOS · A dog is hurt");
    expect(describeAlert(alert({ kind: "tag", dog: { slug: "x", name: null }, detail: "too_tight" })).title).toBe(
      "A dog's collar is too tight",
    );
  });

  it("keeps href for the row link", () => {
    expect(describeAlert(alert({ href: "/sos/abc" })).href).toBe("/sos/abc");
  });
});

describe("relativeTime", () => {
  it("matches the mock's 4m / 2h / 8h", () => {
    expect(relativeTime(ago(4 * 60_000), NOW)).toBe("4m");
    expect(relativeTime(ago(2 * 3600_000 + 60_000), NOW)).toBe("2h");
    expect(relativeTime(ago(8 * 3600_000), NOW)).toBe("8h");
    expect(relativeTime(ago(10_000), NOW)).toBe("now");
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe("3d");
  });
});

describe("groupAlerts", () => {
  it("groups by Mumbai day, newest first: Today, Yesterday, then a date", () => {
    const sections = groupAlerts(
      [
        alert({ id: "old", at: ago(3 * 86_400_000) }),
        alert({ id: "b", at: ago(2 * 3600_000) }),
        alert({ id: "a", at: ago(60_000) }),
        alert({ id: "y", at: ago(20 * 3600_000) }),
      ],
      NOW,
    );
    expect(sections.map((s) => s.label)).toEqual(["Today", "Yesterday", "Tuesday 22 September"]);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("uses Asia/Kolkata for the day boundary", () => {
    // 19:00 UTC on the 24th is 00:30 on the 25th in Mumbai: still "Today".
    expect(dayLabel("2026-09-24T19:00:00.000Z", NOW)).toBe("Today");
    expect(dayLabel("2026-09-24T18:00:00.000Z", NOW)).toBe("Yesterday");
  });
});
