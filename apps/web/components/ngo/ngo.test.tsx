// @vitest-environment jsdom
/**
 * Design v7 NGO portal (N1 to N5 and the designed NGO screens): the mock's
 * copy, the mapping from the v7 API shapes, and each screen's one action.
 * `ngoApi` is mocked; its mappers are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, back: vi.fn() }), usePathname: () => "/ngo" }));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className, ...rest }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getAccessToken: () => "tok",
    api: {
      ...actual.api,
      getWards: vi.fn().mockResolvedValue({
        wards: [
          { id: "K-West", code: "K/W", name: "Andheri West" },
          { id: "K-East", code: "K/E", name: "Andheri East" },
        ],
      }),
    },
  };
});

vi.mock("./ngo-api", async () => {
  const actual = await vi.importActual<typeof import("./ngo-api")>("./ngo-api");
  const fns = [
    "getMyNgo",
    "registerNgo",
    "getNgoHome",
    "updateAmbulance",
    "updateBeds",
    "updateNgo",
    "getDispatch",
    "sendSomeone",
    "declineCase",
    "acceptSent",
    "declineSent",
    "getTeam",
    "vouchVet",
    "inviteMember",
    "updateMember",
    "removeMember",
    "getWardDogs",
    "getDrives",
    "createDrive",
    "getDrive",
    "startDrive",
    "finishDrive",
    "checkOffDog",
  ] as const;
  return { ...actual, ngoApi: Object.fromEntries(fns.map((f) => [f, vi.fn()])) };
});

import { ngoApi, offersToList, offersToRecord, toCandidates, toDriveDog, toSosCase, type Ngo, type NgoHome } from "./ngo-api";
import {
  bedsLine,
  busyWords,
  candidateSub,
  candidateTitle,
  caseSub,
  collarActions,
  dispatchNote,
  distanceWords,
  dogsLine,
  driveDogLine,
  driveWhen,
  memberRoleLine,
  ngoKicker,
  normalisePhone,
  sendLabel,
  shortName,
  sosLabel,
  teamLine,
  vetSignHref,
} from "./ngo-copy";
import NgoHomeScreen from "./NgoHomeScreen";
import DispatchScreen, { defaultPick } from "./DispatchScreen";
import TeamScreen from "./TeamScreen";
import NgoProfileScreen from "./NgoProfileScreen";
import { driveState } from "./ngo-api";
import DriveScreen from "./DriveScreen";
import NgoRegisterScreen, { draftProblem } from "./NgoRegisterScreen";

const m = ngoApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const NGO: Ngo = {
  id: "ngo1",
  name: "Andheri Paws Trust",
  status: "active",
  wards: ["K-West", "K-East"],
  regType: "trust",
  regNo: "E-21904 (Mum)",
  offers: ["ambulance", "shelter_beds", "collars"],
  publicPhone: "+919820012231",
  ambulance: { count: 1, status: "out", hours: "8am to 10pm", caseId: "c2", dogName: "Laali" },
  beds: { total: 12, free: 3 },
};

const HOME: NgoHome = {
  ngo: NGO,
  role: "coordinator",
  sos: [
    { caseId: "c1", title: "Moti is limping badly", dogName: "Moti", locality: "Lokhandwala", wardId: "K-West", openedAt: ago(40), state: "unassigned" },
    {
      caseId: "c2",
      title: "Laali hit by a bike",
      dogName: "Laali",
      locality: "Andheri East",
      wardId: "K-East",
      openedAt: ago(20),
      state: "on_the_way",
      assignee: { name: "Dr. Pillai", ambulance: true },
      etaMin: 12,
    },
  ],
  team: { vets: 3, volunteers: 11 },
  nextDrive: { id: "d1", place: "Aram Nagar", startsAt: "2026-09-26T01:30:00Z" },
  dogs: { total: 412, unsterilised: 38 },
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getMyNgo!.mockResolvedValue({ ngo: NGO, role: "coordinator" });
  push.mockReset();
});
afterEach(cleanup);

describe("NGO copy (the board's words)", () => {
  it("N2 lines", () => {
    expect(ngoKicker(NGO)).toBe("Andheri Paws Trust · K/W, K/E");
    expect(sosLabel(2)).toBe("SOS in your wards · 2");
    expect(bedsLine({ free: 3, total: 12 })).toBe("3 of 12 free");
    expect(teamLine({ vets: 3, volunteers: 11 })).toBe("3 vets · 11 volunteers");
    expect(dogsLine({ total: 412, unsterilised: 38 })).toBe("412 · 38 unsterilised");
    expect(caseSub(HOME.sos[0]!)).toBe("Lokhandwala · nobody assigned");
    expect(caseSub(HOME.sos[1]!)).toBe("Dr. Pillai + ambulance · ETA 12 min");
  });

  it("N3 rows, button and note", () => {
    const vet = { id: "v1", kind: "vet" as const, name: "Dr. Farhan Qureshi", distanceM: 1200, busy: false, free: true };
    const vol = { id: "m2", kind: "volunteer" as const, name: "Rahul M.", distanceM: 800, busy: false, hasTransport: true };
    const amb = { id: "ambulance", kind: "ambulance" as const, name: "Ambulance", distanceM: null, busy: true, busyWith: "Laali" };
    expect(candidateTitle(vet)).toBe("Dr. Farhan Qureshi");
    expect(candidateSub(vet)).toBe("Vet · 1.2 km · free");
    expect(candidateTitle(vol)).toBe("Rahul (volunteer)");
    expect(candidateSub(vol)).toBe("Has transport · 0.8 km");
    expect(candidateSub(amb)).toBe("Out on Laali's case");
    expect(busyWords("Out on Laali's case", "Out")).toBe("Out on Laali's case");
    expect(sendLabel(vet, false)).toBe("Send Dr. Qureshi");
    expect(sendLabel(vol, true)).toBe("Send Rahul + ambulance");
    expect(dispatchNote("Sneha")).toBe(
      "Sneha will see who's coming and their ETA. If nobody accepts in 15 min, the case opens to all vets nearby.",
    );
    expect(distanceWords(800)).toBe("0.8 km");
    expect(shortName("Dr. Leena Pillai")).toBe("Dr. Pillai");
  });

  it("N4 and N5 lines", () => {
    expect(memberRoleLine({ role: "rescue", hasTransport: true })).toBe("Rescue · has transport");
    expect(memberRoleLine({ role: "coordinator", hasTransport: false })).toBe("Coordinator");
    const d = (tasks: ("collar" | "vaccinate" | "sterilise")[], done: typeof tasks) => ({ id: "x", slug: "s", name: "S", tasks, done });
    expect(driveDogLine(d(["collar", "vaccinate"], ["collar", "vaccinate"]))).toEqual({ text: "✓ Collared · vaccinated", done: true });
    expect(driveDogLine(d(["sterilise"], [])).text).toBe("Sterilise · to clinic");
    expect(driveDogLine(d(["collar", "vaccinate"], [])).text).toBe("Collar + rabies");
    expect(driveWhen("2026-09-26T01:30:00Z")).toBe("Sat 26 Sep · 7am");
    expect(vetSignHref("r4n7kw2ab", "d1")).toBe("/vet/dogs/r4n7kw2ab/sign?kind=vaccination&drive=d1");
  });

  it("phones: Indian numbers to E.164", () => {
    expect(normalisePhone("98200 12231")).toBe("+919820012231");
    expect(normalisePhone("+91 98200 12231")).toBe("+919820012231");
    expect(normalisePhone("12345")).toBeNull();
  });
});

describe("mapping the v7 API", () => {
  it("offers round-trip", () => {
    const r = offersToRecord(["ambulance", "collars"]);
    expect(r).toEqual({ ambulance: true, shelterBeds: false, sterilisation: false, collars: true });
    expect(offersToList(r)).toEqual(["ambulance", "collars"]);
  });

  it("SOS items: nobody, sent, on the way", () => {
    const base = {
      caseId: "c1",
      dog: { slug: "m", name: "Moti", photoUrl: null, avatarUrl: null },
      wardId: "K-West",
      wardCode: "K/W",
      wardName: "Lokhandwala",
      severity: "serious" as const,
      openedAt: ago(40),
      state: "open" as const,
      assigned: null,
      takenBy: null,
      opensToVetsAt: null,
    };
    expect(toSosCase(base).state).toBe("unassigned");
    const sent = { dispatchId: "d", name: "Dr. Qureshi", kind: "vet" as const, withAmbulance: false, etaMin: null, accepted: false };
    expect(toSosCase({ ...base, assigned: sent }).state).toBe("sent");
    expect(toSosCase({ ...base, state: "acked", assigned: { ...sent, accepted: true } }).state).toBe("on_the_way");
  });

  it("the ambulance is a candidate row", () => {
    const rows = toCandidates({ candidates: [], ambulance: { available: false, busyWith: "Out on Laali's case" }, opensToVetsAt: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "ambulance", busy: true });
  });
});

describe("N2 NGO tab", () => {
  it("shows the board's sections and sends from the red button", async () => {
    m.getNgoHome!.mockResolvedValue(HOME);
    render(<NgoHomeScreen />);
    expect(await screen.findByText("Moti is limping badly")).toBeTruthy();
    expect(screen.getByText("Andheri Paws Trust · K/W, K/E")).toBeTruthy();
    expect(screen.getByText("SOS in your wards · 2")).toBeTruthy();
    expect(screen.getByText("On the way")).toBeTruthy();
    expect(screen.getByText("3 of 12 free")).toBeTruthy();
    expect(screen.getByText("Out")).toBeTruthy();
    expect(screen.getByText("3 vets · 11 volunteers ›")).toBeTruthy();
    expect(screen.getByText("Sat, Aram Nagar ›")).toBeTruthy();
    expect(screen.getByText("412 · 38 unsterilised ›")).toBeTruthy();
    expect(screen.getByText("Scan a collar")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send someone" }).getAttribute("href")).toBe("/ngo/sos/c1");
  });

  it("Mark back puts the ambulance in", async () => {
    m.getNgoHome!.mockResolvedValue(HOME);
    m.updateAmbulance!.mockResolvedValue({ status: "in" });
    render(<NgoHomeScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark back" }));
    await waitFor(() => expect(m.updateAmbulance).toHaveBeenCalledWith({ status: "in" }));
    expect(await screen.findByText("In")).toBeTruthy();
  });

  it("a volunteer sees the case, not Send someone", async () => {
    m.getNgoHome!.mockResolvedValue({ ...HOME, role: "volunteer" });
    render(<NgoHomeScreen />);
    await screen.findByText("Moti is limping badly");
    expect(screen.queryByText("Send someone")).toBeNull();
    expect(screen.getByRole("link", { name: "See the case" }).getAttribute("href")).toBe("/sos/c1");
  });

  it("Sent to you: I'll go accepts and opens the case page", async () => {
    m.getNgoHome!.mockResolvedValue({
      ...HOME,
      role: "rescue",
      sentToMe: [{ dispatchId: "dp1", caseId: "c1", dogName: "Moti", wardId: "K-West", openedAt: ago(10), withAmbulance: false }],
    });
    m.acceptSent!.mockResolvedValue({ caseId: "c1", ackedAt: ago(0) });
    render(<NgoHomeScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "I'll go" }));
    await waitFor(() => expect(m.acceptSent).toHaveBeenCalledWith("dp1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sos/c1"));
  });

  it("no NGO: bring one", async () => {
    m.getMyNgo!.mockResolvedValue({ ngo: null, role: null });
    render(<NgoHomeScreen />);
    expect((await screen.findByRole("link", { name: "Bring your NGO to Hetja" })).getAttribute("href")).toBe("/ngo/register");
  });
});

describe("N3 Send someone", () => {
  const DISPATCH = {
    caseId: "c1",
    dogName: "Moti",
    reporterName: "Sneha",
    locality: "Lokhandwala",
    wardId: "K-West",
    openedAt: ago(40),
    escalatesAt: null,
    lat: null,
    lng: null,
    state: "unassigned" as const,
    candidates: [
      { id: "v1", kind: "vet" as const, name: "Dr. Farhan Qureshi", distanceM: 1200, busy: false, free: true },
      { id: "m2", kind: "volunteer" as const, name: "Rahul M.", distanceM: 800, busy: false, hasTransport: true },
      { id: "ambulance", kind: "ambulance" as const, name: "Ambulance", distanceM: null, busy: true, busyWith: "Out on Laali's case" },
    ],
  };

  it("picks the free vet first", () => {
    expect(defaultPick(DISPATCH.candidates)).toBe("v1");
  });

  it("sends Dr. Qureshi", async () => {
    m.getDispatch!.mockResolvedValue(DISPATCH);
    m.sendSomeone!.mockResolvedValue({ id: "dp1" });
    render(<DispatchScreen caseId="c1" />);
    expect(await screen.findByText("Who's going to Moti?")).toBeTruthy();
    expect(screen.getByText("Busy")).toBeTruthy();
    expect(screen.getByText(/Sneha will see who's coming/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send Dr. Qureshi" }));
    await waitFor(() => expect(m.sendSomeone).toHaveBeenCalledWith("c1", { memberId: "v1", ambulance: false }));
    expect(await screen.findByText("Dr. Qureshi has been asked")).toBeTruthy();
  });

  it("We can't take this one passes it on after a confirm", async () => {
    m.getDispatch!.mockResolvedValue(DISPATCH);
    m.declineCase!.mockResolvedValue({ passed: true });
    render(<DispatchScreen caseId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "We can't take this one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pass it on" }));
    await waitFor(() => expect(m.declineCase).toHaveBeenCalledWith("c1"));
    expect(await screen.findByText("Passed on")).toBeTruthy();
  });
});

describe("N4 Team", () => {
  const TEAM = {
    canManage: true,
    vets: [
      { feederId: "v1", name: "Dr. Farhan Qureshi", status: "verified" as const, vouched: true },
      { feederId: "v3", name: "Dr. Nisha Rao", status: "waiting" as const, vouched: false, pronoun: "her" as const },
    ],
    members: [
      { id: "k", name: "Kavita Nair", role: "coordinator" as const, hasTransport: false, me: true },
      { id: "r", name: "Rahul M.", role: "rescue" as const, hasTransport: true },
      { id: "i", name: "Imran S.", role: "collars" as const, hasTransport: false },
      { id: "a", name: "Asha", role: "volunteer" as const, hasTransport: false },
    ],
  };

  it("vouches for a waiting vet", async () => {
    m.getTeam!.mockResolvedValue(TEAM);
    m.vouchVet!.mockResolvedValue({ vouchedAt: ago(0) });
    render(<TeamScreen />);
    expect(await screen.findByText("Vets · 2")).toBeTruthy();
    expect(screen.getByText("Volunteers · 4")).toBeTruthy();
    expect(screen.getByText("Rescue · has transport")).toBeTruthy();
    expect(screen.getByText("1 more")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invite" }).getAttribute("href")).toBe("/ngo/team/invite");
    fireEvent.click(screen.getByRole("button", { name: "Vouch for her" }));
    await waitFor(() => expect(m.vouchVet).toHaveBeenCalledWith("v3"));
  });

  it("others can only look", async () => {
    m.getTeam!.mockResolvedValue({ ...TEAM, canManage: false });
    render(<TeamScreen />);
    await screen.findByText("Vets · 2");
    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Vouch/ })).toBeNull();
  });
});

describe("N5 Drive", () => {
  const DRIVE = {
    id: "d1",
    place: "Aram Nagar",
    wardId: "K-West",
    startsAt: "2026-09-26T01:30:00Z",
    leadVet: { feederId: "v2", name: "Dr. Leena Pillai", pronoun: "her" as const },
    volunteerCount: 4,
    dogCount: 3,
    collarsPacked: 12,
    state: "planned" as const,
    volunteers: [],
    viewerIsLeadVet: true,
    dogs: [
      { id: "dd1", slug: "sheru0001", name: "Sheru", tasks: ["collar", "vaccinate"] as const, done: ["collar", "vaccinate"] as const },
      { id: "dd2", slug: "brown0001", name: "Brownie", tasks: ["sterilise"] as const, done: [] as const },
      { id: "dd3", slug: "golu00001", name: "Golu", tasks: ["collar", "vaccinate"] as const, done: [] as const },
    ].map((d) => ({ ...d, tasks: [...d.tasks], done: [...d.done] })),
  };

  it("shows the board's copy and starts the drive", async () => {
    m.getDrive!.mockResolvedValue(DRIVE);
    m.startDrive!.mockResolvedValue({ startedAt: "2026-09-26T01:34:00Z" });
    render(<DriveScreen driveId="d1" />);
    expect(await screen.findByText("Aram Nagar drive")).toBeTruthy();
    expect(screen.getByText("Sat 26 Sep · 7am · Dr. Pillai, 4 volunteers")).toBeTruthy();
    expect(screen.getByText("✓ Collared · vaccinated")).toBeTruthy();
    expect(screen.getByText("Sterilise · to clinic")).toBeTruthy();
    expect(screen.getByText("Collar + rabies")).toBeTruthy();
    expect(
      screen.getByText(
        "Feeders of these dogs get a heads-up the day before so they can help find them. Vaccinations Dr. Pillai logs here are signed as she goes.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start drive" }));
    await waitFor(() => expect(m.startDrive).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/Started at 7:04am/)).toBeTruthy();
  });

  it("a coordinator finishes a started drive", async () => {
    m.getDrive!.mockResolvedValue({ ...DRIVE, state: "running", startedAt: "2026-09-26T01:34:00Z" });
    m.finishDrive!.mockResolvedValue({ state: "finished", finishedAt: "2026-09-26T06:10:00Z" });
    render(<DriveScreen driveId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Finish drive" }));
    await waitFor(() => expect(m.finishDrive).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText("Finished at 11:40am. 1 of 3 dogs done.")).toBeTruthy();
  });

  it("only coordinators see Finish drive", async () => {
    m.getMyNgo!.mockResolvedValue({ ngo: NGO, role: "rescue" });
    m.getDrive!.mockResolvedValue({ ...DRIVE, state: "running", startedAt: "2026-09-26T01:34:00Z" });
    render(<DriveScreen driveId="d1" />);
    expect(await screen.findByText(/Started at 7:04am/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish drive" })).toBeNull();
  });

  it("drive state from the API", () => {
    expect(driveState({ state: "finished", startedAt: "x", finishedAt: "y" })).toBe("finished");
    expect(driveState({ startedAt: "x", finishedAt: null })).toBe("running");
    expect(driveState({ startedAt: null })).toBe("planned");
  });

  it("a dog registered on the drive, collar not on yet: Print collar, then scan it", async () => {
    const pending = { id: "dd4", slug: "newd00001", name: "Chiku", tasks: ["collar" as const], done: [], pendingActivation: true };
    m.getDrive!.mockResolvedValue({ ...DRIVE, dogs: [...DRIVE.dogs, pending] });
    render(<DriveScreen driveId="d1" />);
    fireEvent.click(await screen.findByText("1 more"));
    fireEvent.click(await screen.findByRole("button", { name: /Chiku/ }));
    expect(screen.getByRole("link", { name: "Print collar" }).getAttribute("href")).toBe("/register/newd00001/print");
    expect(screen.getByRole("link", { name: "Scan it once it's on" }).getAttribute("href")).toBe("/register/newd00001");
  });

  it("maps a pending registration from the API row", () => {
    const row = {
      id: "dd9",
      dog: { slug: "newd00001", name: "Chiku", photoUrl: null, avatarUrl: null, registrationStatus: "pending_activation" },
      tasks: { collar: true, vaccinate: false, sterilise: false },
      done: { collar: false, vaccinate: false, sterilise: false },
      status: "todo" as const,
    };
    expect(toDriveDog(row).pendingActivation).toBe(true);
    expect(collarActions(toDriveDog(row))).toEqual({ print: "/register/newd00001/print", activate: "/register/newd00001" });
    expect(collarActions({ ...toDriveDog(row), done: ["collar"] })).toBeNull();
  });

  it("the lead vet signs a vaccination through the vet flow; a collar is ticked here", async () => {
    m.getDrive!.mockResolvedValue(DRIVE);
    m.checkOffDog!.mockResolvedValue({ ...DRIVE.dogs[2], done: ["collar"] });
    render(<DriveScreen driveId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Golu/ }));
    expect(screen.getByRole("link", { name: "Sign" }).getAttribute("href")).toBe(
      "/vet/dogs/golu00001/sign?kind=vaccination&drive=d1",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Collar/ }));
    await waitFor(() => expect(m.checkOffDog).toHaveBeenCalledWith("d1", "dd3", ["collar"]));
  });
});

describe("NGO profile", () => {
  it("a coordinator changes wards and opening hours", async () => {
    m.updateNgo!.mockResolvedValue({ ...NGO, wards: ["K-West"], hours: "9am to 7pm" });
    render(<NgoProfileScreen />);
    fireEvent.change(await screen.findByLabelText("Opening hours"), { target: { value: "9am to 7pm" } });
    fireEvent.click(screen.getByRole("button", { name: "K/E, tap to remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(m.updateNgo).toHaveBeenCalledWith(expect.objectContaining({ hours: "9am to 7pm", wards: ["K-West"] })),
    );
  });
});

describe("N1 Register an NGO", () => {
  it("names the first thing missing", () => {
    const base = { name: "", regType: "trust" as const, regNo: "", contact: "", phone: "", wards: [], offers: [], certificate: null };
    expect(draftProblem(base)).toBe("Add the NGO's registered name.");
    expect(draftProblem({ ...base, name: "Andheri Paws Trust", regNo: "E-21904", phone: "9820012231" })).toBe(
      "Add the name of the person we should ask for.",
    );
    expect(draftProblem({ ...base, name: "Andheri Paws Trust", regNo: "E-21904", contact: "Kavita Nair", phone: "9820012231" })).toBe(
      "Pick at least one ward you cover.",
    );
  });

  it("sends for checking and shows the status", async () => {
    m.getMyNgo!.mockResolvedValue({ ngo: null, role: null });
    m.registerNgo!.mockResolvedValue({ ...NGO, status: "waiting", submittedAt: "2026-09-25T05:00:00Z" });
    render(<NgoRegisterScreen />);
    expect(await screen.findByText("Bring your NGO to Hetja")).toBeTruthy();
    expect(screen.getByText("We check your registration and call you before switching it on.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Registered name"), { target: { value: "Andheri Paws Trust" } });
    fireEvent.change(screen.getByLabelText("Registration type · number"), { target: { value: "E-21904 (Mum)" } });
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Kavita Nair" } });
    fireEvent.change(screen.getByLabelText("Phone for SOS calls"), { target: { value: "98200 12231" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ Add" }));
    fireEvent.click(await screen.findByRole("button", { name: /K\/W/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Ambulance" }));
    const file = new File([new Uint8Array([37, 80, 68, 70])], "cert.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Registration certificate"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Send for checking" }));
    await waitFor(() => expect(m.registerNgo).toHaveBeenCalled());
    const arg = m.registerNgo!.mock.calls[0]![0];
    expect(arg).toMatchObject({
      name: "Andheri Paws Trust",
      regType: "trust",
      regNo: "E-21904 (Mum)",
      contactName: "Kavita Nair",
      wards: ["K-West"],
      offers: ["ambulance"],
      publicPhone: "+919820012231",
    });
    expect(arg.certificate.mime).toBe("application/pdf");
    expect(await screen.findByText("Sent for checking", { selector: "h1" })).toBeTruthy();
  });
});
