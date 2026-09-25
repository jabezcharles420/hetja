// @vitest-environment jsdom
/**
 * /sos/[caseId]: the page SOS pushes open, as design v6 (P9, P10, P11, L4,
 * L5, L6, V21, V22), and the ack wording it shares with the map
 * (lib/sos-ack.ts). The API is mocked to the v6 shapes in lib/api.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
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
      getSosCaseV6: vi.fn(),
      ackSosCase: vi.fn(),
      declineSosCase: vi.fn(),
      releaseSosCase: vi.fn(),
      closeBySosCase: vi.fn(),
      arrivedSosCase: vi.fn(),
      resolveSosCaseV6: vi.fn(),
      getFeederMe: vi.fn(),
    },
  };
});

vi.mock("@/lib/care-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/care-cache")>("@/lib/care-cache");
  return {
    ...actual,
    rememberCase: vi.fn().mockResolvedValue(undefined),
    caseGlance: vi.fn().mockResolvedValue(null),
    loadCareNumbers: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/app/map/api", () => ({
  mapApi: { ward: vi.fn() },
}));

import SosCaseScreen, {
  caseWardLine,
  DECLINED_TITLE,
  HIDDEN_LEAD,
  namesList,
  raisedAgo,
  RELEASED_LINE,
  SPOT_CAPTION,
} from "@/app/sos/[caseId]/SosCaseScreen";
import { mapApi } from "@/app/map/api";
import { api, ApiError, setAccessToken, type SosCaseV6 } from "@/lib/api";
import { caseGlance, loadCareNumbers } from "@/lib/care-cache";
import { ackRefusal, casePill, waitWords, ACK_TOO_MANY } from "@/lib/sos-ack";

const ID = "3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f";
const MIN = 60_000;

type Mock = ReturnType<typeof vi.fn>;
const m = api as unknown as Record<string, Mock>;
const wardMock = mapApi.ward as unknown as Mock;

function sosCase(over: Partial<SosCaseV6> = {}): SosCaseV6 {
  return {
    id: ID,
    severity: "critical",
    state: "open",
    tier: 1,
    openedAt: new Date(Date.now() - 16 * MIN).toISOString(),
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    resolution: null,
    wardId: "K-West",
    wardName: "Andheri West",
    dog: { slug: "rni482pq7", name: "Rani", photoUrl: null, sex: "female" },
    reporterPhotoUrl: null,
    reporterAnonymous: true,
    note: "Hit by an auto near the SV Road signal, back leg bleeding.",
    respondingName: null,
    nearestCare: { name: "Lokhandwala Pet Hospital", phoneE164: "+912226001234" },
    declinedByMe: false,
    location: null,
    feedersTold: 2,
    vetsTold: 1,
    ngosTold: 0,
    escalatesAt: new Date(Date.now() + 14 * MIN).toISOString(),
    distanceM: 1400,
    ...over,
  };
}

beforeEach(() => {
  setAccessToken("tok");
  replace.mockReset();
  push.mockReset();
  wardMock.mockResolvedValue({ sos: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  setAccessToken(null);
});

describe("/sos/[caseId] (design v6)", () => {
  it("signed out: straight to login, with the way back", async () => {
    setAccessToken(null);
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
    expect(m.getSosCaseV6).not.toHaveBeenCalled();
  });

  it("P9 open: dog, severity, pills, the reporter's note, timeline, distance, and the take button", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Can't get up, or bleeding" })).not.toBeNull();
    expect(screen.getByText("Rani · K/W Andheri West")).not.toBeNull();
    expect(screen.getByText("Nobody has taken it")).not.toBeNull();
    expect(screen.getByText("16 min ago")).not.toBeNull();
    expect(screen.getByText("From a passer-by, no account")).not.toBeNull();
    expect(screen.getByText("Raised by a passer-by")).not.toBeNull();
    expect(screen.getByText("2 feeders and 1 vet told")).not.toBeNull();
    expect(screen.getByText("All ward vets told if nobody takes it")).not.toBeNull();
    expect(screen.getByText("About 1.4 km from you")).not.toBeNull();
    expect(screen.getByText("Around 6 minutes by auto")).not.toBeNull();
    expect(screen.getByText(SPOT_CAPTION)).not.toBeNull();
    expect(screen.getByRole("button", { name: "I can go and help" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "I can’t go right now" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Map" }).getAttribute("href")).toBe("/map");
    expect(screen.queryByRole("link", { name: "Directions" })).toBeNull();
  });

  it("uses the API's timeline when it sends one", async () => {
    const t = new Date(Date.now() - 16 * MIN).toISOString();
    m.getSosCaseV6!.mockResolvedValue(
      sosCase({ timeline: [{ at: t, kind: "raised", detail: null }, { at: t, kind: "told", detail: "3 feeders" }] }),
    );
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("3 feeders told")).not.toBeNull();
    expect(screen.queryByText("2 feeders and 1 vet told")).toBeNull();
  });

  it("P10: taking it unlocks the exact spot with Directions, the vet and the close-by row", async () => {
    const spot = { lat: 19.136021, lng: 72.829634 };
    m.getSosCaseV6!
      .mockResolvedValueOnce(sosCase())
      .mockResolvedValueOnce(sosCase({ state: "acked", ackedAt: new Date().toISOString(), location: spot }));
    m.ackSosCase!.mockResolvedValue({ id: ID, ackedAt: new Date().toISOString() });
    m.closeBySosCase!.mockResolvedValue({ id: ID, closeByAt: new Date().toISOString() });
    m.arrivedSosCase!.mockResolvedValue({ id: ID, arrivedAt: new Date().toISOString() });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect(await screen.findByRole("heading", { name: "Rani is waiting for you." })).not.toBeNull();
    expect(screen.getByText(/You took this · /)).not.toBeNull();
    const dir = screen.getByRole("link", { name: "Directions" });
    expect(dir.getAttribute("href")).toContain("destination=19.136021,72.829634");
    expect(screen.getByText("Lokhandwala Pet Hospital")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Call Lokhandwala Pet Hospital" }).getAttribute("href")).toBe(
      "tel:+912226001234",
    );
    fireEvent.click(screen.getByRole("button", { name: /Tell the reporter you.re close/ }));
    await waitFor(() => expect(m.closeBySosCase).toHaveBeenCalledWith(ID));
    fireEvent.click(await screen.findByRole("button", { name: /I.m with Rani/ }));
    expect(await screen.findByText("With Rani")).not.toBeNull();
    expect(m.arrivedSosCase).toHaveBeenCalledWith(ID);
  });

  it("P10: 'I can't make it after all' releases the case back to others", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase({ state: "acked", ackedAt: new Date().toISOString(), mine: true }));
    m.releaseSosCase!.mockResolvedValue({ id: ID, state: "open" });
    render(<SosCaseScreen caseId={ID} />);
    const release = await screen.findByRole("button", { name: "I can’t make it after all" });
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    fireEvent.click(release);
    expect(await screen.findByText(RELEASED_LINE)).not.toBeNull();
    expect(m.releaseSosCase).toHaveBeenCalledWith(ID);
    expect(screen.getByRole("button", { name: "I can go and help" })).not.toBeNull();
  });

  it("P11: close with an outcome and a vet, then V21 says what happened", async () => {
    const opened = new Date(Date.now() - 3 * 60 * MIN).toISOString();
    m.getSosCaseV6!.mockResolvedValue(
      sosCase({ openedAt: opened, state: "acked", ackedAt: new Date().toISOString(), mine: true, respondingName: "Priya" }),
    );
    const resolvedAt = new Date(Date.parse(opened) + 29 * MIN).toISOString();
    m.resolveSosCaseV6!.mockResolvedValue({ id: ID, state: "resolved", resolvedAt, resolution: "x", outcome: "taken_to_vet" });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
    expect(screen.getByRole("dialog", { name: "How did it end?" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "She didn't make it" })).not.toBeNull();
    const close = screen.getByRole("button", { name: "Close the case" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Taken to a vet" }));
    fireEvent.change(screen.getByLabelText("Which vet? (optional)"), { target: { value: "Lokhandwala Pet Hospital" } });
    fireEvent.click(close);
    expect(await screen.findByRole("heading", { name: "Rani got to a vet in 29 minutes." })).not.toBeNull();
    expect(m.resolveSosCaseV6).toHaveBeenCalledWith(ID, { outcome: "taken_to_vet", vetName: "Lokhandwala Pet Hospital" });
    expect(screen.getByText("You took her to Lokhandwala Pet Hospital. The passer-by who raised it has been told.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "See Rani’s page" }).getAttribute("href")).toBe("/d/rni482pq7");
  });

  it("P11: 'She didn't make it' goes on to the N9 memorial flow", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase({ state: "acked", ackedAt: new Date().toISOString(), mine: true }));
    m.resolveSosCaseV6!.mockResolvedValue({ id: ID, state: "resolved", resolvedAt: new Date().toISOString(), resolution: "x", outcome: "died" });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
    fireEvent.click(screen.getByRole("radio", { name: "She didn't make it" }));
    expect(screen.queryByLabelText("Which vet? (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close the case" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/me/dogs/rni482pq7/status"));
    expect(m.resolveSosCaseV6).toHaveBeenCalledWith(ID, { outcome: "died" });
  });

  it("V21: a resolved case shows the timeline and the outcome", async () => {
    const opened = new Date(Date.now() - 4 * 60 * MIN).toISOString();
    m.getSosCaseV6!.mockResolvedValue(
      sosCase({
        state: "resolved",
        openedAt: opened,
        ackedAt: new Date(Date.parse(opened) + 4 * MIN).toISOString(),
        arrivedAt: new Date(Date.parse(opened) + 12 * MIN).toISOString(),
        resolvedAt: new Date(Date.parse(opened) + 29 * MIN).toISOString(),
        outcome: "taken_to_vet",
        vetName: "Lokhandwala Pet Hospital",
        respondingName: "Priya",
      }),
    );
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Rani got to a vet in 29 minutes." })).not.toBeNull();
    expect(screen.getByText(/Resolved · /)).not.toBeNull();
    expect(screen.getByText("Priya took her to Lokhandwala Pet Hospital. The passer-by who raised it has been told.")).not.toBeNull();
    expect(screen.getByText("Priya took it")).not.toBeNull();
    expect(screen.getByText("With Rani")).not.toBeNull();
    expect(screen.getByText("Taken to a vet")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "I can go and help" })).toBeNull();
  });

  it("L4: someone else took it, named and green, with something useful nearby", async () => {
    m.getSosCaseV6!.mockResolvedValue(
      sosCase({
        severity: "serious",
        state: "acked",
        wardId: "H-West",
        wardName: "Bandra West",
        dog: { slug: "brunoab22", name: "Bruno", photoUrl: null },
        ackedAt: new Date(Date.now() - 22 * MIN).toISOString(),
        respondingName: "Meera",
      }),
    );
    wardMock.mockResolvedValue({ sos: [{ caseId: ID, mine: false }], notLoggedTodayDogs: [{ name: "Moti" }, { name: "Goli" }] });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Meera is on the way to Bruno." })).not.toBeNull();
    expect(screen.getByText("Covered · taken 22 min ago")).not.toBeNull();
    expect(screen.getByText("Thanks for looking. If they need a hand, you’ll get a note.")).not.toBeNull();
    expect(await screen.findByText("Moti and Goli haven't been logged in H/W today.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Back to the map" }).getAttribute("href")).toBe("/map");
    expect(screen.queryByRole("button", { name: "I can go and help" })).toBeNull();
  });

  it("L5: escalated with nobody on it says so plainly, and is still takeable", async () => {
    const opened = new Date(Date.now() - 60 * MIN).toISOString();
    m.getSosCaseV6!.mockResolvedValue(
      sosCase({
        severity: "serious",
        state: "escalated",
        openedAt: opened,
        escalatedAt: new Date(Date.parse(opened) + 30 * MIN).toISOString(),
        dog: { slug: "brunoab22", name: "Bruno", photoUrl: null, sex: "male" },
        wardId: "H-West",
        wardName: "Bandra West",
        feedersTold: 3,
        vetsTold: 4,
        ngosTold: 2,
        distanceM: 2800,
        escalatesAt: null,
      }),
    );
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Nobody has reached Bruno yet." })).not.toBeNull();
    expect(screen.getByText("1 hour · vets told")).not.toBeNull();
    expect(screen.getByText(/His feeders didn.t answer, so every vet in H\/W was told at/)).not.toBeNull();
    expect(screen.getByText("3 feeders told · no reply")).not.toBeNull();
    expect(screen.getByText("4 vets and 2 NGOs told")).not.toBeNull();
    expect(screen.getByRole("button", { name: "I can go and help Bruno" })).not.toBeNull();
    expect(screen.getByText(`About 2.8 km from you. ${SPOT_CAPTION}`)).not.toBeNull();
  });

  it("V22: 403 reassures first, then shows the real responder rule as a checklist", async () => {
    (caseGlance as unknown as Mock).mockResolvedValue({ caseId: ID, wardId: "H-West" });
    m.getSosCaseV6!.mockRejectedValue(
      new ApiError("no", {
        status: 403,
        code: "SOS_CASE_FORBIDDEN",
        data: {
          forbiddenReason: "not_opted_in",
          checklist: { sosOptIn: false, paused: false, inMyWards: null, trustScore: 33, trustFloor: 40, feedsToGo: 7 },
        },
      }),
    );
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "This case went to feeders in H/W." })).not.toBeNull();
    expect(screen.getByText(HIDDEN_LEAD)).not.toBeNull();
    expect(screen.getByText("Want cases like this?")).not.toBeNull();
    expect(screen.getByText("Signed in")).not.toBeNull();
    expect(screen.getByText("Alerts on for H/W")).not.toBeNull();
    expect(screen.getByText("10 feeds logged (you have 3)")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Turn on alerts for H/W" }).getAttribute("href")).toBe("/settings");
  });

  it("L6: a case that didn't load shows what the alert said, saved vets, and Try again", async () => {
    (caseGlance as unknown as Mock).mockResolvedValue({
      caseId: ID,
      dogName: "Rani",
      dogSlug: "rni482pq7",
      severity: "critical",
      wardId: "K-West",
      wardName: "Andheri West",
      openedAt: "2026-09-25T10:32:00Z",
      pushBody: null,
    });
    (loadCareNumbers as unknown as Mock).mockResolvedValue({
      wards: ["K-West"],
      savedAt: "x",
      numbers: [{ id: "v1", name: "Lokhandwala Pet Hospital", kind: "vet", wardId: "K-West", phoneE164: "+912226001234", is24x7: true }],
    });
    m.getSosCaseV6!.mockRejectedValueOnce(new ApiError("down", { status: 0, code: "NETWORK_ERROR" }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Couldn't load Rani's case." })).not.toBeNull();
    expect(screen.getByText("The signal dropped. Here's what your alert said:")).not.toBeNull();
    expect(screen.getByText("Can't get up, or bleeding")).not.toBeNull();
    expect(screen.getByText("K/W Andheri West · raised 4:02 pm")).not.toBeNull();
    expect(screen.getByText("Vet · 24 hours · saved on this phone")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:+912226001234");
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Can't get up, or bleeding" })).not.toBeNull();
  });

  it("I can't go right now: declines calmly, never acks", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    m.declineSosCase!.mockResolvedValue({ declined: true });
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can’t go right now" }));
    expect((await screen.findByRole("status")).textContent).toContain(DECLINED_TITLE);
    expect(m.declineSosCase).toHaveBeenCalledWith(ID);
    expect(m.ackSosCase).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "I can go after all" })).not.toBeNull();
  });

  it("403 SOS_ACK_FORBIDDEN: says how to become a trusted responder", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    m.ackSosCase!.mockRejectedValue(new ApiError("no", { status: 403, code: "SOS_ACK_FORBIDDEN" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Only trusted responders can take a case.");
    expect(screen.getByRole("link", { name: "Open Me" }).getAttribute("href")).toBe("/me");
  });

  it("409 SOS_TOO_MANY_OPEN_ACKS: 'Finish one first', and the button stops", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    m.ackSosCase!.mockRejectedValue(new ApiError("no", { status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ACK_TOO_MANY);
    expect((screen.getByRole("button", { name: "I can go and help" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("409 SOS_ALREADY_ACKED: thanks, and reads the case again", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    m.ackSosCase!.mockRejectedValue(new ApiError("no", { status: 409, code: "SOS_ALREADY_ACKED" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Someone else just took this one.");
    await waitFor(() => expect(m.getSosCaseV6).toHaveBeenCalledTimes(2));
  });

  it("429: says when to try again, from retry-after", async () => {
    m.getSosCaseV6!.mockResolvedValue(sosCase());
    m.ackSosCase!.mockRejectedValue(new ApiError("slow", { status: 429, code: "RATE_LIMITED", retryAfterSec: 600 }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That's a lot of cases in a short time. Try again in 10 minutes.",
    );
  });

  it("401 on load: back to login", async () => {
    m.getSosCaseV6!.mockRejectedValue(new ApiError("no", { status: 401, code: "UNAUTHENTICATED" }));
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
  });
});

describe("lib/sos-ack", () => {
  it("maps every state to its pill", () => {
    expect(casePill("open", false)).toMatchObject({ variant: "danger", text: "Needs help" });
    expect(casePill("acked", true)).toMatchObject({ variant: "ok", text: "You took this" });
    expect(casePill("resolved", false)).toMatchObject({ variant: "ok", text: "Resolved" });
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
    expect(waitWords(600)).toBe("10 minutes");
    expect(waitWords(3600)).toBe("an hour");
  });

  it("ward line, raised time and name lists", () => {
    expect(caseWardLine({ wardId: "K-West", wardName: "Andheri West" })).toBe("K/W ward · Andheri West");
    expect(caseWardLine({ wardId: null })).toBeNull();
    const now = Date.parse("2026-09-25T10:00:00Z");
    expect(raisedAgo("2026-09-25T07:00:00Z", now)).toBe("3 h ago");
    expect(namesList(["Moti", "Goli"])).toBe("Moti and Goli");
    expect(namesList(["A", "B", "C", "D"])).toBe("A, B and 2 more");
  });
});
