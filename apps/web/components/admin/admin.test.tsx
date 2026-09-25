// @vitest-environment jsdom
/**
 * Design v7 admin portal (A1 to A7 and the designed sections). The API is the
 * fixtures' copy of the board (components/admin/fixtures.ts) behind a stubbed
 * fetch, so the real lib/api client runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ path: "/admin", search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => el("a", { href, ...rest }, children),
  };
});

import { chromeFor } from "@/components/ChromeShell";
import { setAccessToken } from "@/lib/api";
import { AdminShell } from "./AdminShell";
import { fileKey } from "./avatarMatch";
import { AvatarScreen } from "./AvatarScreens";
import { afterMerging, mergeMeta, MergeScreen } from "./DogScreens";
import { adminFixtureFetch, AVATAR_EDITOR, BOARD_NOW, dogDetail, TODAY, type FixtureOptions } from "./fixtures";
import { auditWhen, greeting, longDate, matchLine, needsYouRows, sosHoursLabel, todayCards, wardCode } from "./format";
import { canSee } from "./permissions";
import { TeamScreen } from "./TeamScreens";
import { TodayScreen } from "./TodayScreen";
import { VetsScreen } from "./VetsScreen";

let calls: ReturnType<typeof adminFixtureFetch>["calls"];

function mount(node: ReactNode, opts: FixtureOptions = {}) {
  const f = adminFixtureFetch(opts);
  calls = f.calls;
  vi.stubGlobal("fetch", f.fetch);
  return render(<AdminShell>{node}</AdminShell>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BOARD_NOW);
  setAccessToken("tok");
  nav.path = "/admin";
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("chrome", () => {
  it("/admin gets no tab bar, nav or footer, and never the D1 desktop invitation", () => {
    for (const p of ["/admin", "/admin/vets", "/admin/avatars/batch-12/av-0"]) {
      expect(chromeFor(p)).toMatchObject({ kind: "admin", nav: null, tabBar: false, footer: false, desktop: "none" });
    }
    expect(chromeFor("/administrator").kind).not.toBe("admin");
  });
});

describe("copy from the board (A1)", () => {
  it("writes the Needs you rows verbatim, urgent first", () => {
    const rows = needsYouRows(TODAY.needsYou, BOARD_NOW);
    expect(rows.map((r) => [r.title, r.detail, r.action])).toEqual([
      ["SOS · Moti, limping, Lokhandwala", "Raised by Sneha 40 min ago. No vet has accepted.", "Assign a vet"],
      ["Dr. Farhan Qureshi applied to sign records", "MSVC reg. no. and certificate uploaded 3 days ago", "Review"],
      // Adapted: no photo match (CONTRACT.md).
      ["Kalu and Kaalu may be the same dog", "Similar names, same ward, different feeders", "Compare"],
      ["38 avatars ready from batch #12", "34 matched to a dog, 4 need a match", "Review"],
    ]);
    expect(rows[0].loud).toBe(true);
    expect(rows.slice(1).every((r) => !r.loud)).toBe(true);
    expect(rows[2].href).toBe("/admin/merge?a=k4lu2ab7c&b=k3au8mn2p&report=rep-kalu");
  });

  it("writes the four cards", () => {
    expect(todayCards(TODAY).map((c) => [c.label, c.value, c.sub])).toEqual([
      ["Vets to verify", "4", "Oldest waiting 3 days"],
      ["Avatars to review", "38", "From batch #12"],
      ["Open SOS cases", "2", "1 unassigned for 40 min"],
      ["Reports", "3", "2 duplicate dogs, 1 photo"],
    ]);
  });

  it("dates, greeting, audit times, SOS hours and ward codes", () => {
    expect(greeting("Aarti", BOARD_NOW)).toBe("Good morning, Aarti.");
    expect(longDate(BOARD_NOW)).toBe("Friday 25 September");
    expect(auditWhen("2026-09-25T04:12:00.000Z", BOARD_NOW)).toBe("09:42");
    expect(auditWhen("2026-09-24T12:10:00.000Z", BOARD_NOW)).toBe("Yesterday");
    expect(auditWhen("2026-09-23T09:00:00.000Z", BOARD_NOW)).toBe("23 Sep");
    expect(sosHoursLabel({ from: "09:00", to: "21:00" })).toBe("9am to 9pm");
    expect(wardCode("K-West")).toBe("K/W");
    expect(wardCode("P-North")).toBe("P/N");
  });
});

describe("A3 file names (adapted: ID or collar number only)", () => {
  it("reads a slug or a batch number, and nothing else", () => {
    expect(fileKey("r4n7kw2ab.png")).toEqual({ kind: "slug", value: "r4n7kw2ab" });
    expect(fileKey("HJ-0412.png")).toEqual({ kind: "batch_no", value: "HJ-0412" });
    expect(fileKey("hj-0412 (1).PNG")).toEqual({ kind: "batch_no", value: "HJ-0412" });
    expect(fileKey("IMG_2231.png")).toEqual({ kind: "none" });
    expect(fileKey("unknown_07.png")).toEqual({ kind: "none" });
  });

  it("labels tiles as the board does, with no By photo", () => {
    const base = { id: "t", batchId: "b", fileName: "x.png", imageUrl: "", status: "draft" as const, uploadedAt: "", publishedAt: null, signoff: null };
    const dog = { slug: "r4n7kw2ab", name: "Rani", photoUrl: null, photoBy: null, photoAt: null, collarBatchNo: "HJ-0388" };
    expect(matchLine({ ...base, match: "id", dog, replacesExisting: false }).text).toBe("ID · r4n7kw2ab");
    expect(matchLine({ ...base, match: "collar", dog, replacesExisting: false }).text).toBe("Collar · HJ-0388");
    expect(matchLine({ ...base, match: "id", dog, replacesExisting: true }).text).toBe("Replaces existing");
    expect(matchLine({ ...base, match: "none", dog: null, replacesExisting: false }).text).toBe("No match · pick dog");
  });
});

describe("A5 copy", () => {
  it("After merging and each dog's line are the board's", () => {
    const kalu = dogDetail("k4lu2ab7c")!;
    const kaalu = dogDetail("k3au8mn2p")!;
    expect(mergeMeta(kalu)).toBe("Added 14 Mar by Priya · collar HJ-0388 · 212 feeds · 2 signed records");
    expect(mergeMeta(kaalu)).toBe("Added 2 Sep by Imran · no collar · 9 feeds · no records");
    expect(afterMerging(kalu, kaalu)).toBe(
      "One dog named Kalu with collar HJ-0388. All 221 feeds, both photos and the 2 signed records stay. Imran becomes a feeder of Kalu and gets a note. Kaalu's link redirects to Kalu.",
    );
  });
});

describe("access", () => {
  it("an account without an admin role sees a clear not-an-admin page", async () => {
    mount(<TodayScreen />, { me: "not_admin" });
    expect(await screen.findByRole("heading", { name: "This account is not an admin" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
  });

  it("a signed-out visitor is asked to sign in and comes back here", async () => {
    setAccessToken(null);
    mount(<TodayScreen />);
    expect(await screen.findByRole("heading", { name: "Sign in to the admin portal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toMatch(/^\/login\?next=/);
  });

  it("the sidebar shows only what a role opens (avatar editor)", async () => {
    expect(canSee(AVATAR_EDITOR, "vets")).toBe(false);
    expect(canSee(AVATAR_EDITOR, "avatars")).toBe(true);
    mount(<TodayScreen />, { me: AVATAR_EDITOR });
    const side = await screen.findByRole("navigation", { name: "Admin" });
    expect(within(side).queryByRole("link", { name: /^Vets/ })).toBeNull();
    expect(within(side).getByRole("link", { name: /^Avatars/ })).toBeTruthy();
    // Needs you only lists rows they can clear.
    expect(await screen.findByText("38 avatars ready from batch #12")).toBeTruthy();
    expect(screen.queryByText("SOS · Moti, limping, Lokhandwala")).toBeNull();
  });
});

describe("A1 Today", () => {
  it("greets, lists the rows and the sidebar counts match them", async () => {
    mount(<TodayScreen />);
    expect(await screen.findByRole("heading", { name: "Good morning, Aarti." })).toBeTruthy();
    expect(await screen.findByText("SOS · Moti, limping, Lokhandwala")).toBeTruthy();
    const side = screen.getByRole("navigation", { name: "Admin" });
    expect(within(side).getByRole("link", { name: /^Vets 4/ })).toBeTruthy();
    expect(within(side).getByRole("link", { name: /^Avatars 38/ })).toBeTruthy();
    expect(within(side).getByRole("link", { name: /^Reports 3/ })).toBeTruthy();
    expect(within(side).getByRole("link", { name: /^Today/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Assign a vet: SOS/ }).getAttribute("href")).toBe("/admin/sos?id=sos-moti");
  });

  it("Ctrl+K opens the search, Esc closes it", async () => {
    mount(<TodayScreen />);
    await screen.findByText("SOS · Moti, limping, Lokhandwala");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Search dogs, feeders, vets, collar IDs" });
    fireEvent.change(box, { target: { value: "Rani" } });
    expect(await screen.findByRole("option", { name: /Rani/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });
});

describe("A2 Vets", () => {
  it("opens the oldest waiting application; Verify waits for the MSVC tick and sends it", async () => {
    nav.path = "/admin/vets";
    mount(<VetsScreen />);
    expect(await screen.findByRole("heading", { name: "Dr. Farhan Qureshi" })).toBeTruthy();
    const verify = await screen.findByRole("button", { name: "Verify Dr. Qureshi" });
    expect((verify as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: /Open the MSVC register/ }).getAttribute("href")).toBe("https://msvc.maharashtra.gov.in/listofnew");
    fireEvent.click(screen.getByRole("checkbox", { name: "Checked on the MSVC register" }));
    fireEvent.click(verify);
    const dialog = await screen.findByRole("dialog", { name: "Verify Dr. Qureshi?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Verify Dr. Qureshi" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/admin/vets/vet-qureshi/verify")).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/verify"))!.body).toMatchObject({ registerChecked: true });
  });

  it("Decline needs a typed reason and names what happens; Esc cancels", async () => {
    nav.path = "/admin/vets";
    mount(<VetsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline Dr. Qureshi?" });
    expect(dialog.textContent).toMatch(/told why/);
    const go = within(dialog).getByRole("button", { name: "Decline" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Not on the register" } });
    expect(go.disabled).toBe(false);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.path.endsWith("/decline"))).toBe(false);
  });

  it("Remove on a verified vet asks keep or flag, keep by default", async () => {
    nav.path = "/admin/vets";
    nav.search = "tab=verified";
    mount(<VetsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Dr. Kulkarni?" });
    expect((within(dialog).getByRole("radio", { name: /Keep them valid/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Flag them for re-check/ }));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Left practice" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/remove"))?.body).toEqual({ reason: "Left practice", signatures: "flag" }));
  });
});

describe("A4 One avatar", () => {
  it("← → move through the batch", async () => {
    nav.path = "/admin/avatars/batch-12/av-0";
    mount(<AvatarScreen batchId="batch-12" tileId="av-0" />);
    expect(await screen.findByText("Photo on record · by Priya, 12 Aug")).toBeTruthy();
    await screen.findByRole("heading", { name: /1 of 38/ });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/avatars/batch-12/av-1");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/avatars/batch-12/av-37");
  });
});

describe("A5 Merge", () => {
  it("keeps Kalu by default and merges after a confirm", async () => {
    nav.path = "/admin/merge";
    mount(<MergeScreen a="k4lu2ab7c" b="k3au8mn2p" reportId="rep-kalu" />);
    expect(await screen.findByRole("heading", { name: "Are Kalu and Kaalu the same dog?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Merge into Kalu" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge Kaalu into Kalu?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge into Kalu" }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/admin/dogs/merge")?.body).toEqual({ keepSlug: "k4lu2ab7c", mergeSlug: "k3au8mn2p", name: "Kalu", reportId: "rep-kalu" }),
    );
  });
});

describe("A6 Team and audit", () => {
  it("lists the team, the roles and the log", async () => {
    nav.path = "/admin/team";
    mount(<TeamScreen />);
    expect(await screen.findByText("Ward lead · K/W")).toBeTruthy();
    expect(screen.getByText("Rohan Iyer")).toBeTruthy();
    const log = await screen.findByRole("list", { name: "Audit log" });
    expect(log.textContent).toContain("Rohan verified Dr. Arjun Deshmukh");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
    expect(screen.getByText(/The log can't be edited by anyone, including the Owner/)).toBeTruthy();
  });
});

describe("no em dashes in the admin portal", () => {
  it("the source carries none", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dash = String.fromCodePoint(0x2014);
    const dirs = [path.resolve(__dirname), path.resolve(__dirname, "../../app/admin")];
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of dirs.flatMap(walk)) expect(fs.readFileSync(f, "utf8").includes(dash), f).toBe(false);
  });
});
