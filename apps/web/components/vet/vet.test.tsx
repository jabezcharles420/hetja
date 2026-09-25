// @vitest-environment jsdom
/**
 * Design v7 vet portal (docs/design/v7-portals): V1 to V5, V2b, the designed
 * screens, the passkey plumbing and the certificate PDF. The API is mocked at
 * lib/api.ts's "Design v7 endpoints"; @simplewebauthn/browser is mocked so
 * the signing flow can be checked without an authenticator (the real
 * ceremony is exercised in Edge with a CDP virtual authenticator).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/vet/dogs/r4n7kw2ab",
  redirect: vi.fn(),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
vi.mock("@simplewebauthn/browser", () => webauthn);

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getVetMe: vi.fn(),
      getVetHome: vi.fn(),
      getVetDog: vi.fn(),
      getVetSignRequests: vi.fn(),
      getVetSignRequest: vi.fn(),
      getMySignature: vi.fn(),
      uploadRecordPhoto: vi.fn(),
      getDrive: vi.fn(),
      searchVetDogs: vi.fn(),
      declineSignRequest: vi.fn(),
      passkeyRegistrationOptions: vi.fn(),
      registerPasskey: vi.fn(),
      signOptions: vi.fn(),
      signRecord: vi.fn(),
      getMySignatures: vi.fn(),
      getDogHealth: vi.fn(),
      askVetToSign: vi.fn(),
      addHealthNote: vi.fn(),
      uploadDocument: vi.fn(),
      applyAsVet: vi.fn(),
      ackSosCase: vi.fn(),
      declineSosCase: vi.fn(),
    },
  };
});

import { api, setAccessToken, type HealthRecord as ApiHealthRecord, type SignRequest as ApiSignRequest, type VetProfile as ApiVetProfile } from "@/lib/api";
import ApplyScreen from "./ApplyScreen";
import { buildCertificatePdf, certificateFileName, certificateRows } from "./certificate-pdf";
import CorrectScreen from "./CorrectScreen";
import FeederHealth from "./FeederHealth";
import { healthOrder } from "./HealthList";
import { isAppleMobile, signLabel } from "./passkey";
import SignRecordScreen, { draftFrom, matchVaccine, payloadFor, payloadReady } from "./SignRecordScreen";
import { looksLikeCode } from "./SearchScreen";
import { currentFromApi, lowerTitle, normHealth, normRequest, toDraft } from "./vet-api";
import {
  aYearAfter,
  clock,
  dogFacts,
  dueLine,
  hoursLabel,
  longDate,
  recordLine,
  requestSub,
  signerLine,
  sosLabel,
  sosSub,
  withdrawSentence,
} from "./vet-copy";
import VetDogScreen, { notesLine } from "./VetDogScreen";
import VetHome from "./VetHome";

type Mocked = Record<string, ReturnType<typeof vi.fn>>;
const m = api as unknown as Mocked;

const SLUG = "r4n7kw2ab";

function profile(over: Partial<ApiVetProfile> = {}): ApiVetProfile {
  return {
    id: "v1",
    feederId: "f1",
    name: "Dr. Farhan Qureshi",
    council: "MSVC",
    regNo: "5190",
    regLabel: "MSVC 5190",
    qualification: null,
    clinic: "Paws Clinic, Versova",
    wards: ["K-West", "K-East"],
    sosAvailable: true,
    sosHours: { from: "09:00", to: "21:00" },
    publicPhone: "+91 98200 04410",
    status: "verified",
    appliedAt: null,
    decidedAt: null,
    decisionReason: null,
    validTo: null,
    vouchedBy: null,
    ngo: null,
    ...over,
  };
}

function rec(over: Partial<ApiHealthRecord>): ApiHealthRecord {
  return {
    id: "x",
    type: "vaccination",
    title: "",
    status: "vet_signed",
    date: null,
    dueOn: null,
    note: null,
    vet: null,
    brand: null,
    batch: null,
    addedBy: null,
    supersedes: null,
    withdraws: null,
    withdrawnAt: null,
    reason: null,
    earNotched: null,
    flagged: false,
    signRequestOpen: false,
    recordedAt: "2026-09-12T10:00:00Z",
    ...over,
  };
}

const RABIES = rec({
  id: "rec1",
  title: "Anti-rabies",
  date: "2026-09-12",
  dueOn: "2027-09-12",
  brand: "Raksharab",
  batch: "RB2409",
  vet: { name: "Dr. Farhan Qureshi", council: "MSVC", regNo: "5190" },
});
const STER = rec({ id: "rec2", type: "sterilisation", title: "Sterilised", date: "2025-04", note: "ear notched", vet: { name: "Dr. Leena Pillai", council: "MSVC", regNo: "4477" } });
const DEWORM = rec({ id: "rec3", type: "deworming", title: "Deworming", status: "feeder_noted", date: "2026-08-03", addedBy: "Priya" });

const REQ: ApiSignRequest = {
  id: "sr1",
  dog: { slug: SLUG, name: "Rani", photoUrl: null, avatarUrl: null },
  proposed: { type: "vaccination", vaccine: "Anti-rabies", brand: "Raksharab", batch: "RB2409", givenOn: "2026-09-12", dueOn: "2027-09-12" },
  recordId: null,
  requestedBy: "Priya",
  requestedAt: "2026-09-13T08:00:00Z",
  evidencePhotoUrl: null,
  note: null,
  status: "open",
};

function vetDog() {
  return {
    dog: { slug: SLUG, name: "Rani", sex: "female", approxAge: 3, status: "active", wardId: "K-West", wardCode: "K/W", photoUrl: null, avatarUrl: null, collar: { code: SLUG, batchNo: "HJ-0412" } },
    youFeed: true,
    lastFedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    lastFedBy: "Priya",
    health: { records: [RABIES, STER, DEWORM], viewerIsVet: true },
    notesToConfirm: [DEWORM],
    openSignRequests: [REQ],
    canSign: true,
  };
}

beforeEach(() => {
  setAccessToken("t");
  for (const f of Object.values(m)) if (typeof f?.mockReset === "function") f.mockReset();
  webauthn.startRegistration.mockReset();
  webauthn.startAuthentication.mockReset();
  replace.mockReset();
  push.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------

describe("words and dates", () => {
  it("formats the board's dates and lines", () => {
    expect(longDate("2026-09-12")).toBe("12 Sep 2026");
    expect(longDate("2025-04")).toBe("Apr 2025");
    expect(aYearAfter("2026-09-12")).toBe("2027-09-12");
    expect(aYearAfter("2028-02-29")).toBe("2029-02-28");
    expect(clock("09:00")).toBe("9am");
    expect(clock("21:30")).toBe("9:30pm");
    expect(hoursLabel({ from: "09:00", to: "21:00" })).toBe("9am to 9pm");
    expect(sosLabel(1200)).toBe("SOS near you · 1.2 km");
    expect(sosSub("Lokhandwala", "Sneha", "him")).toBe("Lokhandwala · Sneha is with him");
    expect(dueLine(11, "2026-10-09")).toBe("11 dogs need a booster by 9 Oct");
    expect(dogFacts("HJ-0412", "female", 3)).toBe("Collar HJ-0412 · female · ~3 yrs");
  });

  it("V4's lines, with the government label for a government vet", () => {
    const r = normHealth(RABIES);
    expect(recordLine(r)).toBe("12 Sep 2026 · due again 12 Sep 2027");
    expect(signerLine(r)).toBe("Dr. Farhan Qureshi · MSVC 5190 · Raksharab RB2409");
    expect(recordLine(normHealth(STER))).toBe("Apr 2025 · ear notched");
    expect(recordLine(normHealth(DEWORM))).toBe("3 Aug 2026 · added by Priya");
    const gov = normHealth(rec({ ...RABIES, vet: { name: "Dr. A. Kale", council: "MSVC", regNo: "3301", isGovernment: true } as never }));
    expect(signerLine(gov)).toBe("Dr. A. Kale · Government vet · free · MSVC 3301 · Raksharab RB2409");
  });

  it("V2's request rows", () => {
    const r = normRequest(REQ);
    expect(r.title).toBe("anti-rabies");
    expect(requestSub(r)).toBe("Priya says you gave it on 12 Sep");
    expect(requestSub({ requestedBy: "Imran", givenOn: null, hasEvidence: true })).toBe("Imran uploaded the clinic slip");
    expect(lowerTitle("DHPPi booster")).toBe("DHPPi booster");
    expect(normRequest({ ...REQ, proposed: { type: "sterilisation", givenOn: "2026-09-18" } }).title).toBe("sterilised");
  });

  it("V5's withdraw sentence", () => {
    expect(withdrawSentence("vaccination", "Rani", "Priya")).toBe(
      "If this dog wasn't vaccinated by you. The badge comes off Rani's page and Priya is told.",
    );
  });

  it("the passkey button's words", () => {
    expect(signLabel("Sign", true)).toBe("Sign with Face ID");
    expect(signLabel("Sign", false)).toBe("Sign with your screen lock");
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 5)).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 0)).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 14)", 5)).toBe(false);
  });

  it("search tells an ID from a name", () => {
    expect(looksLikeCode("rni 482")).toBe(true);
    expect(looksLikeCode("Rani")).toBe(false);
  });
});

describe("records", () => {
  it("corrections replace, withdrawals remove, the board's order holds", () => {
    const corrected = rec({ ...RABIES, id: "rec1b", batch: "RB2419", supersedes: "rec1" });
    const withdrawal = rec({ id: "w1", type: "withdrawal", withdraws: "rec2" });
    const list = currentFromApi([RABIES, STER, DEWORM, corrected, withdrawal]);
    expect(list.map((r) => r.id).sort()).toEqual(["rec1b", "rec3"]);
    expect(healthOrder(currentFromApi([DEWORM, STER, RABIES])).map((r) => r.title)).toEqual(["Anti-rabies", "Sterilised", "Deworming"]);
  });

  it("V3 fills in from the request, and the draft is what the API hashes", () => {
    const d = draftFrom(normRequest(REQ), null);
    expect(d).toMatchObject({ vaccine: "Anti-rabies", brand: "Raksharab", batch: "RB2409", givenOn: "2026-09-12", nextDue: "2027-09-12" });
    const p = payloadFor("vaccination", d);
    expect(payloadReady(p)).toBe(true);
    expect(toDraft({ dogSlug: SLUG, payload: p, requestId: "sr1" })).toEqual({
      dogSlug: SLUG,
      signRequestId: "sr1",
      type: "vaccination",
      vaccine: "Anti-rabies",
      brand: "Raksharab",
      batch: "RB2409",
      givenOn: "2026-09-12",
      dueOn: "2027-09-12",
    });
    expect(toDraft({ dogSlug: SLUG, payload: p, photoId: "ph1", driveDogId: "dd1" })).toMatchObject({ photoId: "ph1", driveDogId: "dd1" });
    expect(toDraft({ dogSlug: SLUG, payload: { kind: "withdrawal" }, supersedes: "rec1", reason: "Not mine" })).toEqual({
      dogSlug: SLUG,
      supersedes: "rec1",
      reason: "Not mine",
      type: "withdrawal",
    });
    expect(matchVaccine("rabies")).toBe("Anti-rabies");
    expect(payloadReady(payloadFor("treatment", { ...d, diagnosis: "", treatment: "" }))).toBe(false);
  });

  it("the certificate prints vet-signed records only, as a real PDF", async () => {
    const records = currentFromApi([RABIES, STER, DEWORM]);
    expect(certificateRows(records).map((r) => r.title)).toEqual(["Anti-rabies", "Sterilised"]);
    const bytes = await buildCertificatePdf({ slug: SLUG, name: "Rani", wardId: "K-West", records, now: new Date(2026, 8, 26) });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(certificateFileName(SLUG, "Rani")).toBe("hetja-certificate-rani.pdf");
  });
});

// ---------------------------------------------------------------------------

describe("V2 Vet tab", () => {
  it("draws the board's sections from GET /vet/home", async () => {
    m.getVetHome!.mockResolvedValue({
      profile: profile(),
      canSign: true,
      canAcceptSos: true,
      sos: [
        {
          caseId: "c1",
          dog: { slug: "m0t1k8w2q", name: "Moti", photoUrl: null, avatarUrl: null, sex: "male" },
          wardId: "K-West",
          wardCode: "K/W",
          wardName: "Lokhandwala",
          severity: "serious",
          openedAt: "2026-09-25T10:00:00Z",
          note: "Moti is limping badly",
          reporterName: "Sneha",
          taken: false,
          distanceM: 1200,
        },
      ],
      signRequests: [REQ],
      signRequestCount: 1,
      dueSoon: { count: 11, by: "2026-10-09" },
    });
    m.ackSosCase!.mockResolvedValue({ id: "c1", ackedAt: "now" });
    render(<VetHome />);
    expect(await screen.findByText("✓ Verified · MSVC 5190")).not.toBeNull();
    expect(screen.getByText("SOS near you · 1.2 km")).not.toBeNull();
    expect(screen.getByText("Moti is limping badly")).not.toBeNull();
    expect(screen.getByText("Lokhandwala · Sneha is with him")).not.toBeNull();
    expect(screen.getByText("Scan a collar").closest("a")!.getAttribute("href")).toBe("/scan?intent=vet");
    expect(screen.getByText("Or search by name or ID")).not.toBeNull();
    expect(screen.getByText("Feeders asking you to sign · 1")).not.toBeNull();
    expect(screen.getByText("Rani · anti-rabies").closest("a")!.getAttribute("href")).toBe(`/vet/dogs/${SLUG}/sign?request=sr1&kind=vaccination`);
    expect(screen.getByText("11 dogs need a booster by 9 Oct")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I’ll take it" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sos/c1"));
    expect(m.ackSosCase).toHaveBeenCalledWith("c1");
  });

  it("a feeder who is not a vet goes to the application", async () => {
    const { ApiError } = await import("@/lib/api");
    m.getVetHome!.mockRejectedValue(new ApiError("no", { status: 403, code: "VET_NOT_VERIFIED" }));
    render(<VetHome />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/vet/apply"));
  });
});

describe("V2b a dog's page for a vet", () => {
  it("shows the vet-only actions and the note to confirm", async () => {
    m.getVetDog!.mockResolvedValue(vetDog());
    render(<VetDogScreen slug={SLUG} />);
    expect(await screen.findByRole("heading", { name: "Rani" })).not.toBeNull();
    expect(screen.getByText("You feed her too · last fed by Priya 2h ago")).not.toBeNull();
    expect(screen.getByText("I fed Rani")).not.toBeNull();
    expect(screen.getByText("Vet · only you see this")).not.toBeNull();
    expect(screen.getByText("Sign vaccination").getAttribute("href")).toBe(`/vet/dogs/${SLUG}/sign?kind=vaccination`);
    expect(screen.getByText("Mark sterilised")).not.toBeNull();
    expect(screen.getByText("Add treatment")).not.toBeNull();
    expect(screen.getByText("Health notes").getAttribute("href")).toBe(`/vet/dogs/${SLUG}/health`);
    expect(screen.getByText("1 feeder note to confirm: deworming, 3 Aug")).not.toBeNull();
    expect(screen.getByText("This dog needs help").getAttribute("href")).toBe(`/d/${SLUG}`);
    expect(notesLine([normHealth(DEWORM), normHealth(DEWORM)])).toBe("2 feeder notes to confirm: deworming, 3 Aug and more");
  });
});

describe("V3 sign a record", () => {
  function mockSign(passkeys: unknown[] = [{ id: "p1" }]) {
    m.getVetMe!.mockResolvedValue({ profile: profile(), canSign: true, canAcceptSos: true, passkeys, documents: [] });
    m.getVetDog!.mockResolvedValue(vetDog());
    m.getVetSignRequest!.mockResolvedValue(REQ);
    m.signOptions!.mockResolvedValue({ challengeId: "ch1", recordHash: "9f2c", options: { challenge: "abc" } });
    m.signRecord!.mockResolvedValue({ recordId: "new", hash: "h", recordHash: "9f2c", dogSlug: SLUG, type: "vaccination", signedAt: "now" });
    webauthn.startAuthentication.mockResolvedValue({ id: "cred", rawId: "cred", type: "public-key", response: {}, clientExtensionResults: {} });
  }

  it("is filled in from Priya's request and signs the same draft it hashed", async () => {
    mockSign();
    render(<SignRecordScreen slug={SLUG} requestId="sr1" kind="vaccination" />);
    expect(await screen.findByText("Collar HJ-0412 · female · ~3 yrs")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Vaccination" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Batch") as HTMLInputElement).value).toBe("RB2409");
    expect(screen.getByText("12 Sep 2026")).not.toBeNull();
    expect(screen.getByText("12 Sep 2027")).not.toBeNull();
    expect(
      screen.getByText(
        "Filled in from Priya's request. Change anything that's wrong. Priya will be told when it's signed, and reminded a week before it's due.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: /Vet$/ }).getAttribute("href")).toBe("/vet");
    fireEvent.click(screen.getByRole("button", { name: "Sign with your screen lock" }));
    expect(await screen.findByRole("heading", { name: "Signed." })).not.toBeNull();
    const draft = m.signOptions!.mock.calls[0]![0];
    expect(m.signRecord).toHaveBeenCalledWith("ch1", draft, expect.objectContaining({ id: "cred" }));
    expect(draft).toMatchObject({ signRequestId: "sr1", type: "vaccination", batch: "RB2409" });
    expect(webauthn.startRegistration).not.toHaveBeenCalled();
  });

  it("sets up a passkey inline the first time", async () => {
    mockSign([]);
    m.passkeyRegistrationOptions!.mockResolvedValue({ challenge: "reg" });
    m.registerPasskey!.mockResolvedValue({ id: "p2" });
    webauthn.startRegistration.mockResolvedValue({ id: "cred", type: "public-key", response: {} });
    render(<SignRecordScreen slug={SLUG} requestId="sr1" kind="vaccination" />);
    expect(await screen.findByText("First, set up signing on this phone")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign with your screen lock" }));
    expect(await screen.findByRole("heading", { name: "Signed." })).not.toBeNull();
    expect(m.registerPasskey).toHaveBeenCalled();
  });

  it("a cancelled passkey saves nothing and says so", async () => {
    mockSign();
    webauthn.startAuthentication.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<SignRecordScreen slug={SLUG} requestId="sr1" kind="vaccination" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign with your screen lock" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Signing was cancelled. Nothing was saved.");
    expect(m.signRecord).not.toHaveBeenCalled();
  });

  it("from an NGO drive: links the drive's dog, then goes back to the drive", async () => {
    mockSign();
    m.getDrive!.mockResolvedValue({ id: "d1", dogList: [{ id: "dd7", dog: { slug: SLUG, name: "Rani", photoUrl: null, avatarUrl: null }, tasks: {}, done: {}, status: "todo" }] });
    render(<SignRecordScreen slug={SLUG} kind="vaccination" driveId="d1" />);
    expect((await screen.findByRole("link", { name: /Drive$/ })).getAttribute("href")).toBe("/ngo/drives/d1");
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "RB2409" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign with your screen lock" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/ngo/drives/d1"));
    expect(m.signOptions!.mock.calls[0]![0]).toMatchObject({ driveDogId: "dd7", type: "vaccination" });
  });

  it("confirming a feeder note sends confirmsRecordId", async () => {
    mockSign();
    render(<SignRecordScreen slug={SLUG} kind="treatment" noteId="rec3" />);
    expect(await screen.findByText(/Filled in from Priya's note/)).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Treatment" }), { target: { value: "Albendazole" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign with your screen lock" }));
    expect(await screen.findByRole("heading", { name: "Signed." })).not.toBeNull();
    expect(m.signOptions!.mock.calls[0]![0]).toMatchObject({ confirmsRecordId: "rec3", diagnosis: "Deworming" });
  });

  it("\"I didn't give this\" declines the request", async () => {
    mockSign();
    m.declineSignRequest!.mockResolvedValue({ declined: true });
    render(<SignRecordScreen slug={SLUG} requestId="sr1" kind="vaccination" />);
    fireEvent.click(await screen.findByRole("button", { name: "I didn’t give this" }));
    expect(await screen.findByRole("heading", { name: "Declined." })).not.toBeNull();
    expect(m.declineSignRequest).toHaveBeenCalledWith("sr1", undefined);
  });
});

describe("V5 correct a signed record", () => {
  it("shows old and new, and signs a correction that supersedes", async () => {
    m.getMySignature!.mockResolvedValue({ id: "rec1", dog: { slug: SLUG, name: "Rani" }, type: "vaccination", title: "Anti-rabies", date: "2026-09-12", batch: "RB2409", signedAt: "2026-09-12T10:00:00Z", status: "valid", supersedes: null, requestedBy: "Priya" });
    m.getDogHealth!.mockResolvedValue({ records: [RABIES], viewerIsVet: true });
    m.getVetMe!.mockResolvedValue({ profile: profile(), canSign: true, canAcceptSos: true, passkeys: [{ id: "p1" }], documents: [] });
    m.signOptions!.mockResolvedValue({ challengeId: "ch2", recordHash: "h", options: { challenge: "c" } });
    m.signRecord!.mockResolvedValue({ recordId: "rec1b" });
    webauthn.startAuthentication.mockResolvedValue({ id: "cred", type: "public-key", response: {} });
    render(<CorrectScreen id="rec1" />);
    expect(await screen.findByRole("heading", { name: "Correct Rani’s anti-rabies record" })).not.toBeNull();
    expect(screen.getByText("Signed records can’t be edited. A correction adds a new version and keeps the old one visible, struck through.")).not.toBeNull();
    expect(screen.getByText("Or withdraw it")).not.toBeNull();
    expect(screen.getByText("If this dog wasn't vaccinated by you. The badge comes off Rani's page and Priya is told.")).not.toBeNull();
    const sign = screen.getByRole("button", { name: "Sign correction" }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "RB2419" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Typo in batch number. Checked the vial box." } });
    expect(screen.getByText("RB2409")).not.toBeNull();
    fireEvent.click(sign);
    expect(await screen.findByRole("heading", { name: "Correction signed." })).not.toBeNull();
    expect(m.signOptions!.mock.calls[0]![0]).toMatchObject({ type: "vaccination", batch: "RB2419", supersedes: "rec1", reason: "Typo in batch number. Checked the vial box." });
  });
});

describe("V1 apply, and where it stands", () => {
  it("a new applicant gets the board's form", async () => {
    m.getVetMe!.mockResolvedValue({ profile: null, canSign: false, canAcceptSos: false, passkeys: [], documents: [] });
    render(<ApplyScreen />);
    expect(await screen.findByRole("heading", { name: "Sign records as a vet" })).not.toBeNull();
    expect(screen.getByText("We check your registration with the state council. Usually within 2 days.")).not.toBeNull();
    expect(screen.getByText("Maharashtra (MSVC) ▾")).not.toBeNull();
    expect(screen.getByText("Certificate")).not.toBeNull();
    expect(screen.getByText("Photo ID")).not.toBeNull();
    expect(screen.getByText("I’m available for SOS calls in the wards I choose next.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Send for checking" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asked for more shows the admin's reason", async () => {
    m.getVetMe!.mockResolvedValue({ profile: profile({ status: "more_info", decisionReason: "The certificate photo is blurred." }), canSign: false, canAcceptSos: false, passkeys: [], documents: [] });
    render(<ApplyScreen />);
    expect(await screen.findByRole("heading", { name: "We need a little more." })).not.toBeNull();
    expect(screen.getByText("The certificate photo is blurred.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Update and send again" }));
    expect(await screen.findByRole("heading", { name: "Sign records as a vet" })).not.toBeNull();
  });

  it("a verified vet goes to the Vet tab", async () => {
    m.getVetMe!.mockResolvedValue({ profile: profile(), canSign: true, canAcceptSos: true, passkeys: [], documents: [] });
    render(<ApplyScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/vet"));
  });
});

describe("V4 on the feeder's dog page", () => {
  it("lists the records and asks a vet to sign a feeder note", async () => {
    m.getDogHealth!.mockResolvedValue({ records: [RABIES, STER, DEWORM], viewerIsVet: false });
    m.askVetToSign!.mockResolvedValue({ id: "sr9" });
    render(<FeederHealth slug={SLUG} name="Rani" wardId="K-West" />);
    expect(await screen.findByText("Anti-rabies")).not.toBeNull();
    expect(screen.getAllByText("✓ Vet signed")).toHaveLength(2);
    expect(screen.getByText("Feeder noted")).not.toBeNull();
    expect(screen.getByText("Dr. Leena Pillai · MSVC 4477")).not.toBeNull();
    expect(screen.getByText("Vaccination certificate for rescues and adoptions")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask a vet to sign" }));
    expect(await screen.findByText("Asked. A vet near you will see it.")).not.toBeNull();
    expect(m.askVetToSign).toHaveBeenCalledWith(SLUG, { recordId: "rec3" });
  });

  it("a feeder notes care themselves", async () => {
    m.getDogHealth!.mockResolvedValue({ records: [], viewerIsVet: false });
    m.addHealthNote!.mockResolvedValue({ recordId: "n1" });
    render(<FeederHealth slug={SLUG} name="Rani" wardId="K-West" />);
    fireEvent.click(await screen.findByRole("button", { name: "Note care" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as Feeder noted" }));
    await waitFor(() => expect(m.addHealthNote).toHaveBeenCalledWith(SLUG, expect.objectContaining({ type: "deworming" })));
  });
});
