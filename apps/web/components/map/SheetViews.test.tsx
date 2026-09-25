// @vitest-environment jsdom
/**
 * The map sheet (design v6 M1 to M7): the city words and stale counts, the
 * ward introduced by its dogs, the SOS card, the sign-in sheet (M3), the
 * taken case (M4), the vet (M5), the named not-logged dogs (M6), and the
 * ack refusals worded like the case page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className, ...rest }, children),
  };
});

import { AckedView, CityView, PlaceView, WardView, type FootState } from "./SheetViews";
import type { WardDetail } from "@/app/map/api";
import type { MapPlace, MapWard } from "./logic";
import { ackRefusal } from "@/lib/sos-ack";

const WARD: MapWard = {
  id: "K-West",
  code: "K/W",
  name: "Andheri West",
  lat: 19.13,
  lng: 72.83,
  dogs: 14,
  notFedToday: 5,
  sosOpen: 1,
  latestSos: null,
};

const VET: MapPlace = {
  id: "v1",
  name: "Lokhandwala Pet Hospital",
  kind: "vet",
  wardId: "K-West",
  locality: "Andheri",
  lat: 19.14,
  lng: 72.82,
  hoursNote: null,
  is24x7: true,
  hasAmbulance: true,
  phoneE164: "+912226300101",
  confirmed: true,
  partner: true,
};

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function detail(over: Partial<WardDetail> = {}): WardDetail {
  return {
    ...WARD,
    sos: [
      {
        caseId: "c1",
        severity: "critical",
        raisedAt: minsAgo(13),
        state: "open",
        feedersTold: true,
        mine: false,
        dogName: "Rani",
        taken: false,
      },
    ],
    dogNames: ["Rani", "Kalu", "Bruno"],
    nearby: [VET],
    viewer: { sosOptIn: true, trustScore: 70, canRespond: ["minor", "serious", "critical"] },
    ...over,
  } as WardDetail;
}

function renderWard(foot: FootState, ward: MapWard = WARD, d: WardDetail = detail(), extra: Partial<Parameters<typeof WardView>[0]> = {}) {
  const props = {
    ward,
    detail: d,
    detailError: false,
    foot,
    me: null,
    loginHref: "/login?next=%2Fmap%23ward%3DK%252FW",
    onBack: vi.fn(),
    onHelp: vi.fn(),
    onFeedHere: vi.fn(),
    onRetry: vi.fn(),
    onDismiss: vi.fn(),
    ...extra,
  };
  render(<WardView {...props} />);
  return props;
}

afterEach(() => cleanup());

describe("CityView (M1, V20, M7)", () => {
  const wards: MapWard[] = [
    { ...WARD, sosOpen: 1 },
    { ...WARD, id: "H-West", code: "H/W", name: "Bandra West, Khar", sosOpen: 1, notFedToday: 12, dogs: 45 },
  ];

  it("M1: dog-named SOS rows with Open / Taken open the ward (no case ids), and one line of stats", () => {
    const onWard = vi.fn();
    render(
      <CityView
        wards={wards}
        summary={{ dogs: 59, withCollars: 59, feeders: 23, fedToday: 41, notLoggedToday: 17 }}
        sos={[
          { wardId: "K-West", wardCode: "K/W", dogName: "Rani", severity: "critical", raisedAt: minsAgo(13), taken: false },
          { wardId: "H-West", wardCode: "H/W", dogName: "Bruno", severity: "serious", raisedAt: minsAgo(47), taken: true },
        ]}
        error={false}
        peek={false}
        onRetry={() => {}}
        onWard={onWard}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Two dogs need help. 17 haven't been logged today.");
    const stats = screen.getByText("with collars", { exact: false }).closest("p")!;
    expect(stats.textContent).toBe("59 with collars23 feeders41 fed today");
    const rani = screen.getByRole("button", { name: /Rani · Andheri West/ });
    expect(within(rani).getByText("Can't get up, or bleeding · 13 min")).not.toBeNull();
    expect(within(rani).getByText("Open")).not.toBeNull();
    const bruno = screen.getByRole("button", { name: /Bruno · Bandra West/ });
    expect(within(bruno).getByText("Hurt, or needs checking · 47 min")).not.toBeNull();
    expect(within(bruno).getByText("Taken")).not.toBeNull();
    fireEvent.click(rani);
    expect(onWard).toHaveBeenCalledWith("K-West");
  });

  it("V20: the zero case is its own sentence", () => {
    render(
      <CityView
        wards={[{ ...WARD, sosOpen: 0, notFedToday: 4, name: "Malad" }]}
        error={false}
        peek={false}
        onRetry={() => {}}
        onWard={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^A quiet (morning|afternoon|evening|night)\. No dog needs help\.$/);
    expect(screen.getByText("4 haven't been logged today, all in Malad. They've probably eaten. Nobody has said so.")).not.toBeNull();
  });

  it("loading says Counting Mumbai's dogs…", () => {
    render(<CityView wards={null} error={false} peek={false} onRetry={() => {}} onWard={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Counting Mumbai's dogs…");
  });

  it("M7: stale counts keep the headline, say when they are from, and offer a retry", () => {
    const onRetry = vi.fn();
    const at = new Date("2026-09-25T10:10:00.000Z").getTime(); // 3:40 pm in Mumbai
    render(<CityView wards={wards} staleAt={at} error peek={false} onRetry={onRetry} onWard={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The map is here. The numbers are not.");
    expect(screen.getByText("Showing counts from 3:40 pm, greyed out. Open SOS cases may be missing.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Scan a collar" })).not.toBeNull();
  });
});

describe("WardView (M2, M3, M6)", () => {
  it("M2: introduces the ward by its dogs, links the case, names the dog on the button", () => {
    renderWard({ kind: "idle" });
    expect(screen.getByText("Rani, Kalu, Bruno and 11 others live here. 5 not logged today.")).not.toBeNull();
    const card = screen.getByRole("link", { name: /Rani can't get up/ });
    expect(card.getAttribute("href")).toBe("/sos/c1");
    expect(within(card).getByText("13 min · feeders told · nobody yet")).not.toBeNull();
    expect(screen.getByText("Help nearby")).not.toBeNull();
    expect(screen.getByText("Vet · open now, 24 hours")).not.toBeNull();
    expect(screen.getByRole("button", { name: "I can go and help Rani" })).not.toBeNull();
    expect(screen.getByText("Shown by ward, never by street.")).not.toBeNull();
  });

  it("M3: signed out, a sheet with one line on why, the vet to call, and back to this case after sign-in", () => {
    const props = renderWard({ kind: "needSignIn" });
    const dialog = screen.getByRole("dialog", { name: "Sign in to take Rani's case." });
    expect(
      within(dialog).getByText(
        "It takes a minute with your email. The exact spot is only shared with someone Hetja can reach again.",
      ),
    ).not.toBeNull();
    expect(within(dialog).getByText("Can't wait?")).not.toBeNull();
    expect(within(dialog).getByRole("link", { name: "Call Lokhandwala Pet Hospital" }).getAttribute("href")).toBe(
      "tel:+912226300101",
    );
    expect(within(dialog).getByRole("link", { name: "Sign in with email" }).getAttribute("href")).toBe(props.loginHref);
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it("M6: a ward with no SOS names the dogs nobody logged, and offers I feed in Malad", () => {
    const malad: MapWard = { ...WARD, id: "P-North", code: "P/N", name: "Malad", sosOpen: 0, notFedToday: 4 };
    const props = renderWard(
      { kind: "idle" },
      malad,
      detail({
        ...malad,
        sos: [],
        nearby: [],
        notLoggedToday: [
          { name: "Sheru", lastLoggedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
          { name: "Tiger", lastLoggedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
          { name: "Lali", lastLoggedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
          { name: "Chotu", lastLoggedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
        ],
      }),
    );
    expect(screen.getByText("Nobody's logged these four today. They've probably eaten. Nobody has said so.")).not.toBeNull();
    for (const n of ["Sheru", "Tiger", "Lali", "Chotu"]) expect(screen.getByText(n)).not.toBeNull();
    expect(screen.getByText("3 days")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I feed in Malad" }));
    expect(props.onFeedHere).toHaveBeenCalled();
  });

  it("403 SOS_ACK_FORBIDDEN: same words as the case page, and a way to Me", () => {
    renderWard({ kind: "refused", msg: ackRefusal({ status: 403, code: "SOS_ACK_FORBIDDEN" }) });
    expect(screen.getByText("Only trusted responders can take a case.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Me" }).getAttribute("href")).toBe("/me");
  });

  it("409 SOS_TOO_MANY_OPEN_ACKS", () => {
    renderWard({ kind: "refused", msg: ackRefusal({ status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }) });
    expect(screen.getByText("You already have two open cases. Finish one first.")).not.toBeNull();
  });

  it("429 with retry-after", () => {
    renderWard({ kind: "refused", msg: ackRefusal({ status: 429, code: "RATE_LIMITED", retryAfterSec: 120 }) });
    expect(screen.getByText("That's a lot of cases in a short time.")).not.toBeNull();
    expect(screen.getByText(/Try again in 2 minutes\./)).not.toBeNull();
  });
});

describe("AckedView (M4)", () => {
  it("gets the responder moving: directions first, the case second", () => {
    render(
      <AckedView
        foot={{ kind: "acked", caseId: "c1", dogName: "Rani", dogSex: "female", location: { lat: 19.13, lng: 72.83 }, distanceM: 1400 }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Rani's case is yours.");
    expect(
      screen.getByText("The person who found her can see you're coming. Her exact spot is on the map now, for you only."),
    ).not.toBeNull();
    expect(screen.getByText("1.4 km · about 6 min by auto")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Directions to Rani" }).getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=19.13000,72.83000",
    );
    expect(screen.getByRole("link", { name: "Open the case" }).getAttribute("href")).toBe("/sos/c1");
  });

  it("without the spot yet, Open the case is the one button", () => {
    render(<AckedView foot={{ kind: "acked", caseId: "c1", dogName: null }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The case is yours.");
    expect(screen.getByRole("link", { name: "Open the case" }).getAttribute("href")).toBe("/sos/c1");
    expect(screen.queryByRole("link", { name: /Directions/ })).toBeNull();
  });
});

describe("PlaceView (M5)", () => {
  it("distance, open now, the number once with Copy, directions, and back to the ward", () => {
    const onBack = vi.fn();
    render(<PlaceView place={VET} from={{ name: "Andheri West" }} distanceM={900} onBack={onBack} />);
    expect(screen.getByText("Vet · 900 m")).not.toBeNull();
    expect(screen.getByText("Open now · 24 hours")).not.toBeNull();
    expect(screen.getByText("Ambulance")).not.toBeNull();
    expect(screen.getByText("Treats street dogs")).not.toBeNull();
    expect(screen.getByText("+91 22 2630 0101")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy the number" })).not.toBeNull();
    expect(screen.getByRole("link", { name: /Directions/ }).getAttribute("href")).toContain("destination=19.14000,72.82000");
    expect(screen.getByText("Listed by the clinic. Hetja sends them SOS alerts for K/W.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Call the clinic" }).getAttribute("href")).toBe("tel:+912226300101");
    fireEvent.click(screen.getByRole("button", { name: "‹ Andheri West" }));
    expect(onBack).toHaveBeenCalled();
  });
});
