// @vitest-environment jsdom
/**
 * /sos/[caseId]: the page SOS pushes open (hardening T15), redesigned as the
 * design v5 N2 "SOS alert", and the ack wording it shares with the map
 * (lib/sos-ack.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getSosCaseV5: vi.fn(),
      ackSosCase: vi.fn(),
      declineSosCase: vi.fn(),
      resolveSosCase: vi.fn(),
      getFeederMe: vi.fn(),
    },
  };
});

vi.mock("@/app/map/api", () => ({
  mapApi: { ward: vi.fn() },
}));

import SosCaseScreen, {
  bandLine,
  caseTitle,
  caseWardLine,
  DECLINED_TITLE,
  HIDDEN_TITLE,
  mapsHref,
  raisedAgo,
  SPOT_FOOTNOTE,
} from "@/app/sos/[caseId]/SosCaseScreen";
import { mapApi } from "@/app/map/api";
import { api, ApiError, setAccessToken, type SosCaseV5 } from "@/lib/api";
import { ackRefusal, casePill, waitWords, ACK_TOO_MANY } from "@/lib/sos-ack";

const ID = "3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f";

const apiMock = api as unknown as {
  getSosCaseV5: ReturnType<typeof vi.fn>;
  ackSosCase: ReturnType<typeof vi.fn>;
  declineSosCase: ReturnType<typeof vi.fn>;
  resolveSosCase: ReturnType<typeof vi.fn>;
  getFeederMe: ReturnType<typeof vi.fn>;
};
const wardMock = mapApi.ward as unknown as ReturnType<typeof vi.fn>;

function sosCase(over: Partial<SosCaseV5> = {}): SosCaseV5 {
  return {
    id: ID,
    severity: "serious",
    state: "open",
    tier: 1,
    openedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    resolution: null,
    wardId: "K-West",
    wardName: "Andheri West",
    dog: { slug: "rni482pq7", name: "Rani", photoUrl: null },
    reporterPhotoUrl: "https://api.example/photos/r.jpg",
    note: "bleeding from a leg",
    respondingName: null,
    respondersPaged: 6,
    nearestCare: { name: "Dr Mehta", phoneE164: "+912226001234" },
    declinedByMe: false,
    location: null,
    ...over,
  };
}

const GOING = "I’m going";
const CANT = "I can’t go right now";

beforeEach(() => {
  setAccessToken("tok");
  replace.mockReset();
  wardMock.mockResolvedValue({ sos: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  setAccessToken(null);
});

describe("/sos/[caseId] (N2 SOS alert)", () => {
  it("signed out: straight to login, with the way back", async () => {
    setAccessToken(null);
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
    expect(apiMock.getSosCaseV5).not.toHaveBeenCalled();
  });

  it("open: the band, the title, the photo row, the info card, the footnote and both actions", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Rani is hurt. Bleeding from a leg." })).not.toBeNull();
    expect(screen.getByText("SOS · K/W · 4 min ago")).not.toBeNull();
    expect(screen.getByText("Photo from the person who sent it")).not.toBeNull();
    expect(screen.getByText("Responding")).not.toBeNull();
    expect(screen.getByText("Nobody yet")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Dr Mehta · Call" }).getAttribute("href")).toBe("tel:+912226001234");
    expect(screen.getByText("Shared only with you if you go")).not.toBeNull();
    expect(screen.getByText(SPOT_FOOTNOTE)).not.toBeNull();
    expect(screen.getByRole("button", { name: GOING })).not.toBeNull();
    expect(screen.getByRole("button", { name: CANT })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Open in Maps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
  });

  it("says a passer-by sent it only when the case says so", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ reporterAnonymous: true }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("Sent by a passer-by, no account")).not.toBeNull();
  });

  it("a feeder's own report does not claim a passer-by sent it", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ reporterAnonymous: false }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("Sent with the SOS")).not.toBeNull();
    expect(screen.queryByText("Sent by a passer-by, no account")).toBeNull();
  });

  it("no reporter photo: the dog's own photo, said plainly", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ reporterPhotoUrl: null }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("Rani's profile photo")).not.toBeNull();
    expect(screen.getByText("No photo came with the SOS")).not.toBeNull();
    expect(screen.queryByText("Photo from the person who sent it")).toBeNull();
  });

  it("I'm going: acks, unlocks the exact spot with Open in Maps, then Mark resolved (with a confirm)", async () => {
    const spot = { lat: 19.136021, lng: 72.829634 };
    apiMock.getSosCaseV5
      .mockResolvedValueOnce(sosCase())
      .mockResolvedValueOnce(
        sosCase({ state: "acked", ackedAt: new Date().toISOString(), location: spot, respondingName: "Priya S." }),
      );
    apiMock.ackSosCase.mockResolvedValue({ id: ID, ackedAt: new Date().toISOString() });
    apiMock.resolveSosCase.mockResolvedValue({
      id: ID,
      state: "resolved",
      resolvedAt: new Date().toISOString(),
      resolution: "x",
    });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: GOING }));
    const maps = await screen.findByRole("link", { name: "Open in Maps" });
    expect(maps.getAttribute("href")).toBe(mapsHref(spot));
    expect(maps.getAttribute("href")).toContain("19.136021,72.829634");
    expect(screen.getByText("You")).not.toBeNull();
    expect(screen.queryByText(SPOT_FOOTNOTE)).toBeNull();
    expect(apiMock.ackSosCase).toHaveBeenCalledWith(ID);

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, mark resolved" }));
    expect(await screen.findByText("This one is finished. Thank you.")).not.toBeNull();
    expect(apiMock.resolveSosCase).toHaveBeenCalledWith(ID, expect.objectContaining({ outcome: "resolved" }));
    expect(screen.queryByRole("button", { name: /resolved/i })).toBeNull();
  });

  it("I can't go right now: declines, says so calmly, never acks", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    apiMock.declineSosCase.mockResolvedValue({ declined: true });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: CANT }));
    expect((await screen.findByRole("status")).textContent).toContain(DECLINED_TITLE);
    expect(apiMock.declineSosCase).toHaveBeenCalledWith(ID);
    expect(apiMock.ackSosCase).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: GOING })).toBeNull();
    expect(screen.getByRole("button", { name: "I can go after all" })).not.toBeNull();
  });

  it("declined earlier (declinedByMe): the calm line, not the buttons", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ declinedByMe: true }));
    render(<SosCaseScreen caseId={ID} />);
    expect((await screen.findByRole("status")).textContent).toContain(DECLINED_TITLE);
    expect(screen.queryByRole("button", { name: GOING })).toBeNull();
  });

  it("acked by someone else: their name, no buttons, the spot stays private", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(
      sosCase({ state: "acked", ackedAt: new Date().toISOString(), respondingName: "Anil" }),
    );
    wardMock.mockResolvedValue({ sos: [{ caseId: ID, mine: false }] });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("Anil")).not.toBeNull();
    expect(screen.getByText("Someone else is on the way. Thank you for looking.")).not.toBeNull();
    expect(screen.getByText("Shared only with you if you go")).not.toBeNull();
    expect(screen.queryByRole("button", { name: GOING })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
  });

  it("acked by me (from the map's ward detail): Mark resolved", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ state: "acked", ackedAt: new Date().toISOString() }));
    wardMock.mockResolvedValue({ sos: [{ caseId: ID, mine: true }] });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("button", { name: "Mark resolved" })).not.toBeNull();
    expect(screen.getByText("You")).not.toBeNull();
    expect(wardMock).toHaveBeenCalledWith("K-West");
  });

  it.each([
    ["escalated", "Nobody took this in time, so vets nearby have been told. You can still go.", true],
    ["resolved", "This one is finished. Thank you.", false],
    ["false_alarm", "This case was closed without a rescue.", false],
  ] as const)("%s says so, and offers I'm going only while takeable", async (state, lead, takeable) => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase({ state, severity: "minor" }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText(lead)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Rani needs checking. Bleeding from a leg." })).not.toBeNull();
    expect(screen.queryByRole("button", { name: GOING }) !== null).toBe(takeable);
  });

  it.each([
    [403, "SOS_CASE_FORBIDDEN"],
    [404, "NOT_FOUND"],
  ])("%s: 'This case isn't yours to see.'", async (status, code) => {
    apiMock.getSosCaseV5.mockRejectedValue(new ApiError("no", { status, code }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: HIDDEN_TITLE })).not.toBeNull();
    expect(HIDDEN_TITLE).toBe("This case isn't yours to see.");
  });

  it("403 SOS_ACK_FORBIDDEN: says how to become a trusted responder", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(new ApiError("no", { status: 403, code: "SOS_ACK_FORBIDDEN" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: GOING }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Only trusted responders can take a case.");
    expect(alert.textContent).toContain("turn on SOS alerts in Me");
    expect(screen.getByRole("link", { name: "Open Me" }).getAttribute("href")).toBe("/me");
  });

  it("409 SOS_TOO_MANY_OPEN_ACKS: 'Finish one first', and the button stops", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(new ApiError("no", { status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: GOING }));
    expect((await screen.findByRole("alert")).textContent).toBe(ACK_TOO_MANY);
    expect((screen.getByRole("button", { name: GOING }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("409 SOS_ALREADY_ACKED: thanks, and reads the case again", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(new ApiError("no", { status: 409, code: "SOS_ALREADY_ACKED" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: GOING }));
    expect((await screen.findByRole("alert")).textContent).toContain("Someone else just took this one.");
    await waitFor(() => expect(apiMock.getSosCaseV5).toHaveBeenCalledTimes(2));
  });

  it("429: says when to try again, from retry-after", async () => {
    apiMock.getSosCaseV5.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(
      new ApiError("slow", { status: 429, code: "RATE_LIMITED", retryAfterSec: 600 }),
    );
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: GOING }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That's a lot of cases in a short time. Try again in 10 minutes.",
    );
  });

  it("401 on load: back to login", async () => {
    apiMock.getSosCaseV5.mockRejectedValue(new ApiError("no", { status: 401, code: "UNAUTHENTICATED" }));
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
  });
});

describe("N2 words", () => {
  it("composes the title from severity, name and note", () => {
    expect(caseTitle("serious", "Rani", "Bleeding from a leg.")).toBe("Rani is hurt. Bleeding from a leg.");
    expect(caseTitle("critical", "Rani", "can't stand")).toBe("Rani is badly hurt. Can't stand.");
    expect(caseTitle("minor", null, null)).toBe("A dog needs checking.");
    expect(caseTitle("serious", "  ", "  ")).toBe("A dog is hurt.");
  });

  it("builds the band line", () => {
    const now = Date.parse("2026-09-25T10:00:00Z");
    expect(bandLine({ wardId: "K-West", openedAt: "2026-09-25T09:56:00Z" }, now)).toBe("SOS · K/W · 4 min ago");
    expect(bandLine({ wardId: null, openedAt: "2026-09-25T09:56:00Z" }, now)).toBe("SOS · 4 min ago");
  });
});

describe("lib/sos-ack", () => {
  it("maps every state to its pill", () => {
    expect(casePill("open", false)).toMatchObject({ variant: "danger", text: "Needs help" });
    expect(casePill("acked", false)).toMatchObject({ variant: "warn", text: "Someone is on the way" });
    expect(casePill("acked", true)).toMatchObject({ variant: "ok", text: "You took this" });
    expect(casePill("escalated", false)).toMatchObject({ variant: "danger", text: "Escalated to vets" });
    expect(casePill("resolved", false)).toMatchObject({ variant: "ok", text: "Resolved" });
    expect(casePill("false_alarm", false)).toMatchObject({ variant: "neutral", text: "Closed" });
  });

  it("classifies ack refusals by code first", () => {
    expect(ackRefusal({ status: 403, code: "SOS_ACK_FORBIDDEN" }).kind).toBe("forbidden");
    expect(ackRefusal({ status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }).kind).toBe("tooMany");
    expect(ackRefusal({ status: 409, code: "SOS_ALREADY_ACKED" }).kind).toBe("taken");
    expect(ackRefusal({ status: 409, code: "SOS_CASE_CLOSED" }).kind).toBe("closed");
    expect(ackRefusal({ status: 429, code: "RATE_LIMITED" }).kind).toBe("rateLimited");
    expect(ackRefusal(new Error("x")).kind).toBe("unreachable");
  });

  it("words a wait plainly", () => {
    expect(waitWords(undefined)).toBe("a minute");
    expect(waitWords(30)).toBe("a minute");
    expect(waitWords(600)).toBe("10 minutes");
    expect(waitWords(3600)).toBe("an hour");
    expect(waitWords(5 * 3600)).toBe("5 hours");
  });

  it("ward line and raised time", () => {
    expect(caseWardLine({ wardId: "K-West", wardName: "Andheri West" })).toBe("K/W ward · Andheri West");
    expect(caseWardLine({ wardId: "K-West", wardName: null })).toBe("K/W ward · Andheri West");
    expect(caseWardLine({ wardId: null })).toBeNull();
    const now = Date.parse("2026-09-25T10:00:00Z");
    expect(raisedAgo("2026-09-25T09:59:40Z", now)).toBe("just now");
    expect(raisedAgo("2026-09-25T07:00:00Z", now)).toBe("3 h ago");
    expect(raisedAgo("2026-09-24T09:00:00Z", now)).toBe("yesterday");
  });

  it("uses no em dash anywhere in its copy", () => {
    const dash = String.fromCharCode(0x2014);
    const all = [
      ackRefusal({ status: 403, code: "SOS_ACK_FORBIDDEN" }),
      ackRefusal({ status: 429 }),
      ackRefusal({ status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }),
      SPOT_FOOTNOTE,
      DECLINED_TITLE,
    ];
    expect(JSON.stringify(all).includes(dash)).toBe(false);
  });
});
