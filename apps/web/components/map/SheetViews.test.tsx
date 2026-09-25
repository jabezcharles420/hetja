// @vitest-environment jsdom
/**
 * The ward sheet's footer: ack refusals worded like the case page, the link
 * to /sos/<caseId> after taking one, and the honest alerts caption (B-03).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

import { ALERTS_CAPTION, WardView, type FootState } from "./SheetViews";
import type { WardDetail } from "@/app/map/api";
import type { MapWard } from "./logic";
import { ackRefusal } from "@/lib/sos-ack";

const WARD: MapWard = {
  id: "K-West",
  code: "K/W",
  name: "Andheri West",
  dogs: 12,
  notFedToday: 2,
  sosOpen: 1,
} as MapWard;

function detail(over: Partial<WardDetail> = {}): WardDetail {
  return {
    ...WARD,
    sos: [
      {
        caseId: "c1",
        severity: "critical",
        raisedAt: new Date().toISOString(),
        state: "open",
        feedersTold: true,
        mine: false,
      },
    ],
    nearby: [],
    viewer: { sosOptIn: true, trustScore: 70, canRespond: ["minor", "serious", "critical"] },
    ...over,
  } as WardDetail;
}

function renderFoot(foot: FootState, ward: MapWard = WARD, d: WardDetail = detail()) {
  render(
    <WardView
      ward={ward}
      detail={d}
      detailError={false}
      foot={foot}
      me={null}
      loginHref="/login"
      onBack={() => {}}
      onHelp={() => {}}
      onAlerts={() => {}}
      onRetry={() => {}}
      onDismiss={() => {}}
    />,
  );
}

afterEach(() => cleanup());

describe("WardFoot", () => {
  it("403 SOS_ACK_FORBIDDEN: same words as the case page, and a way to Me", () => {
    renderFoot({ kind: "refused", msg: ackRefusal({ status: 403, code: "SOS_ACK_FORBIDDEN" }) });
    expect(screen.getByText("Only trusted responders can take a case.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Me" }).getAttribute("href")).toBe("/me");
  });

  it("409 SOS_TOO_MANY_OPEN_ACKS", () => {
    renderFoot({ kind: "refused", msg: ackRefusal({ status: 409, code: "SOS_TOO_MANY_OPEN_ACKS" }) });
    expect(screen.getByText("You already have two open cases. Finish one first.")).not.toBeNull();
  });

  it("429 with retry-after", () => {
    renderFoot({ kind: "refused", msg: ackRefusal({ status: 429, code: "RATE_LIMITED", retryAfterSec: 120 }) });
    expect(screen.getByText("That's a lot of cases in a short time.")).not.toBeNull();
    expect(screen.getByText(/Try again in 2 minutes\./)).not.toBeNull();
  });

  it("after taking a case, links to /sos/<caseId>", () => {
    renderFoot({ kind: "acked", caseId: "c1" });
    expect(screen.getByRole("link", { name: "Open the case" }).getAttribute("href")).toBe("/sos/c1");
  });

  it("'Get alerts' says it turns on SOS alerts and that they follow where you feed", () => {
    renderFoot({ kind: "idle" }, { ...WARD, sosOpen: 0 }, detail({ sosOpen: 0, sos: [] }));
    expect(screen.getByRole("button", { name: "Get alerts for K/W ward" })).not.toBeNull();
    expect(screen.getByText(ALERTS_CAPTION)).not.toBeNull();
    expect(ALERTS_CAPTION).toBe("Turns on SOS alerts. Alerts follow where you feed.");
  });
});
