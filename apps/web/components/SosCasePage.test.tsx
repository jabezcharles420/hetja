// @vitest-environment jsdom
/**
 * /sos/[caseId]: the page SOS pushes open (hardening T15), and the ack
 * wording it shares with the map (lib/sos-ack.ts).
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
      getSosCase: vi.fn(),
      ackSosCase: vi.fn(),
      resolveSosCase: vi.fn(),
      getFeederMe: vi.fn(),
    },
  };
});

vi.mock("@/app/map/api", () => ({
  mapApi: { ward: vi.fn() },
}));

import SosCaseScreen, { caseWardLine, HIDDEN_TITLE, raisedAgo } from "@/app/sos/[caseId]/SosCaseScreen";
import { mapApi } from "@/app/map/api";
import { api, ApiError, setAccessToken, type SosCase } from "@/lib/api";
import { ackRefusal, casePill, waitWords, ACK_TOO_MANY } from "@/lib/sos-ack";

const ID = "3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f";

const apiMock = api as unknown as {
  getSosCase: ReturnType<typeof vi.fn>;
  ackSosCase: ReturnType<typeof vi.fn>;
  resolveSosCase: ReturnType<typeof vi.fn>;
  getFeederMe: ReturnType<typeof vi.fn>;
};
const wardMock = mapApi.ward as unknown as ReturnType<typeof vi.fn>;

function sosCase(over: Partial<SosCase> = {}): SosCase {
  return {
    id: ID,
    severity: "critical",
    state: "open",
    tier: 1,
    openedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    ackedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    resolution: null,
    wardId: "K-West",
    wardName: "Andheri West",
    ...over,
  };
}

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

describe("/sos/[caseId]", () => {
  it("signed out: straight to login, with the way back", async () => {
    setAccessToken(null);
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
    expect(apiMock.getSosCase).not.toHaveBeenCalled();
  });

  it("open: 'Needs help', the severity, the ward line, raised time and the map link", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase());
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Can't get up, or bleeding" })).not.toBeNull();
    expect(screen.getByText("Needs help")).not.toBeNull();
    expect(screen.getByText("K/W ward · Andheri West")).not.toBeNull();
    expect(screen.getByText("Raised 12 min ago")).not.toBeNull();
    expect(screen.getByRole("link", { name: "See K/W on the map ›" }).getAttribute("href")).toBe("/map#ward=K%2FW");
    expect(screen.getByRole("button", { name: "I can go and help" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
  });

  it("taking it: 'You took this', then Mark resolved (with a confirm)", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase({ severity: "serious" }));
    apiMock.ackSosCase.mockResolvedValue({ id: ID, ackedAt: new Date().toISOString() });
    apiMock.resolveSosCase.mockResolvedValue({
      id: ID,
      state: "resolved",
      resolvedAt: new Date().toISOString(),
      resolution: "x",
    });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: "Hurt, or needs checking" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I can go and help" }));
    expect(await screen.findByText("You took this")).not.toBeNull();
    expect(apiMock.ackSosCase).toHaveBeenCalledWith(ID);

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, mark resolved" }));
    expect(await screen.findByText("Resolved")).not.toBeNull();
    expect(apiMock.resolveSosCase).toHaveBeenCalledWith(ID, expect.objectContaining({ outcome: "resolved" }));
    expect(screen.queryByRole("button", { name: /resolved/i })).toBeNull();
  });

  it("acked by someone else: 'Someone is on the way', no buttons", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase({ state: "acked", ackedAt: new Date().toISOString() }));
    wardMock.mockResolvedValue({ sos: [{ caseId: ID, mine: false }] });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("Someone is on the way")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "I can go and help" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
  });

  it("acked by me (from the map's ward detail): 'You took this' and Mark resolved", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase({ state: "acked", ackedAt: new Date().toISOString() }));
    wardMock.mockResolvedValue({ sos: [{ caseId: ID, mine: true }] });
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText("You took this")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Mark resolved" })).not.toBeNull();
    expect(wardMock).toHaveBeenCalledWith("K-West");
  });

  it.each([
    ["escalated", "Escalated to vets"],
    ["resolved", "Resolved"],
    ["false_alarm", "Closed"],
  ] as const)("%s shows '%s'", async (state, text) => {
    apiMock.getSosCase.mockResolvedValue(sosCase({ state, severity: "minor" }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByText(text)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Minor" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "I can go and help" }) !== null).toBe(state === "escalated");
  });

  it.each([
    [403, "SOS_CASE_FORBIDDEN"],
    [404, "NOT_FOUND"],
  ])("%s: 'This case isn't yours to see.'", async (status, code) => {
    apiMock.getSosCase.mockRejectedValue(new ApiError("no", { status, code }));
    render(<SosCaseScreen caseId={ID} />);
    expect(await screen.findByRole("heading", { name: HIDDEN_TITLE })).not.toBeNull();
    expect(HIDDEN_TITLE).toBe("This case isn't yours to see.");
  });

  it("403 SOS_ACK_FORBIDDEN: says how to become a trusted responder", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(new ApiError("no", { status: 403, code: "SOS_ACK_FORBIDDEN" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Only trusted responders can take a case.");
    expect(alert.textContent).toContain("turn on SOS alerts in Me");
    expect(screen.getByRole("link", { name: "Open Me" }).getAttribute("href")).toBe("/me");
  });

  it("409 SOS_TOO_MANY_OPEN_ACKS: 'Finish one first', and the button stops", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(new ApiError("no", { status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }));
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ACK_TOO_MANY);
    expect((screen.getByRole("button", { name: "I can go and help" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("429: says when to try again, from retry-after", async () => {
    apiMock.getSosCase.mockResolvedValue(sosCase());
    apiMock.ackSosCase.mockRejectedValue(
      new ApiError("slow", { status: 429, code: "RATE_LIMITED", retryAfterSec: 600 }),
    );
    render(<SosCaseScreen caseId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "I can go and help" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That's a lot of cases in a short time. Try again in 10 minutes.",
    );
  });

  it("401 on load: back to login", async () => {
    apiMock.getSosCase.mockRejectedValue(new ApiError("no", { status: 401, code: "UNAUTHENTICATED" }));
    render(<SosCaseScreen caseId={ID} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/sos/${ID}`)}`));
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
    ];
    expect(JSON.stringify(all).includes(dash)).toBe(false);
  });
});
