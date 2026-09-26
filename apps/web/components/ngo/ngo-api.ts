/**
 * The NGO portal's API seam (design v7, docs/design/v7-portals/CONTRACT.md,
 * "API", NGO: N1 to N5 and the designed NGO screens).
 *
 * Every NGO screen talks to the API through `ngoApi` and nothing else, so
 * the tests mock one module. Each call goes through the shared client's
 * "Design v7 endpoints" block in lib/api.ts (routes under /api/v1/ngo/*,
 * scoped to the caller's NGO) and maps its shapes into the view shapes
 * below, which is what the screens draw from. Optional fields are optional
 * on purpose: a screen must render when the server leaves one out.
 */
import {
  api,
  type DispatchCandidates,
  type DriveDetail as ApiDriveDetail,
  type DriveDog as ApiDriveDog,
  type DriveSummary as ApiDriveSummary,
  type DriveTask,
  type FeederMe,
  type NgoMemberRole,
  type NgoOffers,
  type NgoProfile,
  type NgoRegType,
  type NgoSosItem,
  type NgoStatus,
  type SosCaseV6,
  type VetStatus,
} from "@/lib/api";

export type { DriveTask, NgoRegType, NgoStatus };

// ---------------------------------------------------------------------------
// View shapes
// ---------------------------------------------------------------------------

/** `ngos.offers`, as a list the chips can toggle. */
export type NgoOffer = "ambulance" | "shelter_beds" | "sterilisation" | "collars";

/** `ngo_members.role` (the contract's "coordinator, rescue, collars, volunteer"). */
export type NgoRole = NgoMemberRole;

export interface NgoAmbulance {
  count: number;
  status: "in" | "out";
  /** "8am to 10pm", free text. */
  hours: string | null;
  caseId?: string | null;
  dogName?: string | null;
}

export interface NgoBeds {
  total: number;
  free: number;
}

export interface Ngo {
  id: string;
  name: string;
  status: NgoStatus;
  /** BMC ward ids ("K-West"). Mumbai only. */
  wards: string[];
  citywide?: boolean;
  regType: NgoRegType;
  regNo: string;
  since?: number | null;
  has80G?: boolean;
  offers: NgoOffer[];
  contactName?: string | null;
  /** Public by owner decision: NGOs exist to be called. E.164. */
  publicPhone: string | null;
  /** Opening hours ("9 am to 7 pm"), beside the ambulance's own hours. */
  hours?: string | null;
  ambulance?: NgoAmbulance | null;
  beds?: NgoBeds | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  /** The admin's reason, when paused or removed. */
  reason?: string | null;
}

export interface NgoMine {
  ngo: Ngo | null;
  role: NgoRole | null;
  hasTransport?: boolean;
}

export type NgoSosState = "unassigned" | "sent" | "on_the_way" | "with_dog";

export interface NgoSosCase {
  caseId: string;
  /** "Moti is limping badly" when the API sends a headline; else "{dog} needs help". */
  title?: string | null;
  dogName: string | null;
  dogSlug?: string | null;
  /** Locality, never a street on this list. */
  locality: string | null;
  wardId: string | null;
  openedAt: string;
  state: NgoSosState;
  assignee?: { name: string; ambulance: boolean } | null;
  etaMin?: number | null;
  opensToVetsAt?: string | null;
}

/** A case the caller was sent to (GET /ngo/dispatches/mine). */
export interface SentToMe {
  dispatchId: string;
  caseId: string;
  dogName: string | null;
  wardId: string | null;
  openedAt: string;
  withAmbulance: boolean;
}

export interface NgoHome {
  ngo: Ngo;
  role: NgoRole | null;
  /** Also a verified vet: the NGO tab carries the vet tools. */
  isVet?: boolean;
  sos: NgoSosCase[];
  sentToMe?: SentToMe[];
  team: { vets: number; volunteers: number };
  nextDrive: { id: string; place: string; startsAt: string } | null;
  dogs: { total: number; unsterilised: number };
}

export type CandidateKind = "vet" | "volunteer" | "ambulance";

export interface DispatchCandidate {
  /** feederId, or "ambulance". */
  id: string;
  kind: CandidateKind;
  name: string;
  distanceM: number | null;
  hasTransport?: boolean;
  /** No charge to the person who raised it (N3 "Vet · 1.2 km · free"). */
  free?: boolean;
  busy: boolean;
  /** "Out on Laali's case", as the API words it, or the dog's name. */
  busyWith?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface NgoDispatch {
  caseId: string;
  dogName: string | null;
  reporterName: string | null;
  locality: string | null;
  wardId: string | null;
  openedAt: string | null;
  escalatesAt: string | null;
  /** The exact spot, only when the API gives it to this caller. */
  lat: number | null;
  lng: number | null;
  state: NgoSosState;
  assignee?: { name: string; ambulance: boolean } | null;
  etaMin?: number | null;
  candidates: DispatchCandidate[];
}

export interface TeamVet {
  feederId: string;
  name: string;
  status: VetStatus;
  vouched: boolean;
  /** For "Vouch for her"; without it the button says "Vouch". */
  pronoun?: "her" | "him" | "them" | null;
}

export interface TeamMember {
  id: string;
  name: string;
  role: NgoRole;
  hasTransport: boolean;
  me?: boolean;
}

export interface NgoTeam {
  canManage: boolean;
  vets: TeamVet[];
  members: TeamMember[];
  invites?: number;
}

export type InviteRole = NgoRole | "vet";

export interface DriveDog {
  /** The drive_dogs row. */
  id: string;
  slug: string;
  name: string | null;
  tasks: DriveTask[];
  done: DriveTask[];
  /** Registered on the drive, collar not yet activated: print it, then scan it once tied on. */
  pendingActivation?: boolean;
}

export type DriveState = "planned" | "running" | "finished";

export interface DriveSummary {
  id: string;
  /** "Aram Nagar" (the drive's title). */
  place: string;
  wardId: string;
  startsAt: string;
  leadVet: { feederId: string; name: string; pronoun?: "her" | "him" | "them" | null } | null;
  volunteerCount: number;
  dogCount: number;
  collarsPacked: number;
  state: DriveState;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface DriveDetail extends DriveSummary {
  volunteers: string[];
  dogs: DriveDog[];
  /** The caller leads the drive: vaccinations go through the vet signing flow. */
  viewerIsLeadVet: boolean;
}

export interface NewDriveInput {
  place: string;
  wardId: string;
  /** YYYY-MM-DD and HH:MM, Mumbai time. */
  date: string;
  time: string;
  leadVetId: string | null;
  volunteerIds: string[];
  collarsPacked?: number;
  dogs: { slug: string; tasks: DriveTask[] }[];
}

export interface WardDog {
  slug: string;
  name: string | null;
  wardId: string;
  sterilised: "yes" | "no" | "unknown";
  vaccinated: "yes" | "unknown";
  lastFedAt?: string | null;
}

export interface WardDogs {
  total: number;
  unsterilised: number;
  dogs: WardDog[];
}

export interface RegisterNgoInput {
  name: string;
  regType: NgoRegType;
  regNo: string;
  /** The person Hetja asks for; shown with the public phone (A7 "Kavita Nair · +91 ..."). */
  contactName: string;
  wards: string[];
  offers: NgoOffer[];
  publicPhone: string;
  /** Registration certificate: encrypted at rest, admins only, deleted 30 days after the decision. */
  certificate: { fileName: string; mime: string; base64: string };
}

export interface NgoPatch {
  publicPhone?: string;
  contactName?: string;
  offers?: NgoOffer[];
  ambulanceCount?: number;
  ambulanceHours?: string | null;
  /** Mumbai BMC wards only; audited, the admin sees the change (A7). */
  wards?: string[];
  hours?: string | null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const OFFER_KEYS: [NgoOffer, keyof NgoOffers][] = [
  ["ambulance", "ambulance"],
  ["shelter_beds", "shelterBeds"],
  ["sterilisation", "sterilisation"],
  ["collars", "collars"],
];

export function offersToList(o: Partial<NgoOffers> | null | undefined): NgoOffer[] {
  return OFFER_KEYS.filter(([, k]) => o?.[k]).map(([v]) => v);
}

export function offersToRecord(list: readonly NgoOffer[]): NgoOffers {
  return {
    ambulance: list.includes("ambulance"),
    shelterBeds: list.includes("shelter_beds"),
    sterilisation: list.includes("sterilisation"),
    collars: list.includes("collars"),
  };
}

const TASKS: DriveTask[] = ["collar", "vaccinate", "sterilise"];

export function tasksToList(r: Partial<Record<DriveTask, boolean>> | null | undefined): DriveTask[] {
  return TASKS.filter((t) => r?.[t]);
}

export function tasksToRecord(list: readonly DriveTask[]): Record<DriveTask, boolean> {
  return { collar: list.includes("collar"), vaccinate: list.includes("vaccinate"), sterilise: list.includes("sterilise") };
}

export function toNgo(p: NgoProfile): Ngo {
  const a = p.ambulance;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    wards: p.wards ?? [],
    citywide: p.citywide,
    regType: p.regType,
    regNo: p.regNo,
    since: p.since,
    has80G: p.has80g,
    offers: offersToList(p.offers),
    contactName: p.contactName,
    publicPhone: p.publicPhone,
    hours: p.hours ?? null,
    ambulance: a
      ? {
          count: a.count,
          status: a.status,
          hours: a.hours,
          caseId: a.outOnCase?.caseId ?? null,
          dogName: a.outOnCase?.dogName ?? null,
        }
      : null,
    beds: p.beds ?? null,
    submittedAt: p.appliedAt,
    decidedAt: p.decidedAt,
    reason: p.decisionReason,
  };
}

export function toSosCase(s: NgoSosItem): NgoSosCase {
  const a = s.assigned;
  let state: NgoSosState = "unassigned";
  let assignee: NgoSosCase["assignee"] = null;
  if (a) {
    state = a.accepted ? "on_the_way" : "sent";
    assignee = { name: a.name, ambulance: a.withAmbulance };
  } else if (s.takenBy || s.state === "acked") {
    state = "on_the_way";
    assignee = s.takenBy ? { name: s.takenBy, ambulance: false } : null;
  }
  return {
    caseId: s.caseId,
    dogName: s.dog?.name ?? null,
    dogSlug: s.dog?.slug ?? null,
    locality: s.wardName,
    wardId: s.wardId,
    openedAt: s.openedAt,
    state,
    assignee,
    etaMin: a?.etaMin ?? null,
    opensToVetsAt: s.opensToVetsAt,
  };
}

export function toCandidates(r: DispatchCandidates): DispatchCandidate[] {
  const people: DispatchCandidate[] = r.candidates.map((c) => ({
    id: c.feederId,
    kind: c.kind === "vet" ? "vet" : "volunteer",
    name: c.name,
    distanceM: c.distanceM,
    hasTransport: c.hasTransport,
    free: c.free,
    busy: c.busy,
    busyWith: c.busyWith,
  }));
  return [
    ...people,
    {
      id: "ambulance",
      kind: "ambulance",
      name: "Ambulance",
      distanceM: null,
      busy: !r.ambulance.available,
      busyWith: r.ambulance.busyWith,
    },
  ];
}

export function driveState(d: Pick<ApiDriveSummary, "state" | "startedAt" | "finishedAt">): DriveState {
  if (d.state === "finished" || d.finishedAt) return "finished";
  if (d.state === "started" || d.startedAt) return "running";
  return "planned";
}

function toDriveSummary(d: ApiDriveSummary): DriveSummary {
  return {
    id: d.id,
    place: d.title,
    wardId: d.wardId,
    startsAt: d.startsAt,
    leadVet: d.leadVet,
    volunteerCount: d.volunteers,
    dogCount: d.dogs,
    collarsPacked: d.collarsPacked,
    state: driveState(d),
    startedAt: d.startedAt,
    finishedAt: d.finishedAt ?? null,
  };
}

/**
 * The drive dog's registration status. The v7 DriveDog does not carry one
 * yet; read it where the API is expected to add it (dog.registrationStatus,
 * or registration.status), so N5's "Print collar" appears once it does.
 */
function registrationStatus(d: ApiDriveDog): string | null {
  const x = d as ApiDriveDog & {
    registration?: { status?: string } | null;
    registrationStatus?: string | null;
    dog: ApiDriveDog["dog"] & { registrationStatus?: string | null };
  };
  return x.dog.registrationStatus ?? x.registration?.status ?? x.registrationStatus ?? null;
}

export function toDriveDog(d: ApiDriveDog): DriveDog {
  return {
    id: d.id,
    slug: d.dog.slug,
    name: d.dog.name,
    tasks: tasksToList(d.tasks),
    done: tasksToList(d.done),
    pendingActivation: registrationStatus(d) === "pending_activation",
  };
}

function toDriveDetail(d: ApiDriveDetail, myId: string | null): DriveDetail {
  return {
    ...toDriveSummary(d),
    volunteers: d.volunteerNames ?? [],
    dogs: (d.dogList ?? []).map(toDriveDog),
    viewerIsLeadVet: !!myId && d.leadVet?.feederId === myId,
  };
}

let meCache: Promise<FeederMe | null> | null = null;

/** The caller's own profile, once per page (feederId, vet status). */
function me(): Promise<FeederMe | null> {
  meCache ??= api.getFeederMe().catch(() => {
    meCache = null;
    return null;
  });
  return meCache;
}

/** Test hook. */
export function resetNgoApiCache(): void {
  meCache = null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const ngoApi = {
  /** GET /ngo/me. */
  getMyNgo: async (): Promise<NgoMine> => {
    const r = await api.getNgoMe();
    return { ngo: r.ngo ? toNgo(r.ngo) : null, role: r.role, hasTransport: r.hasTransport };
  },

  /**
   * N1: upload the certificate (POST /documents, kind ngo_registration),
   * then POST /ngo/register with its id.
   */
  registerNgo: async (input: RegisterNgoInput): Promise<Ngo> => {
    const doc = await api.uploadDocument({
      kind: "ngo_registration",
      fileName: input.certificate.fileName,
      mime: input.certificate.mime as Parameters<typeof api.uploadDocument>[0]["mime"],
      base64: input.certificate.base64,
    });
    const p = await api.registerNgo({
      name: input.name,
      regType: input.regType,
      regNo: input.regNo,
      wards: input.wards,
      offers: offersToRecord(input.offers),
      contactName: input.contactName,
      publicPhone: input.publicPhone,
      documentIds: [doc.id],
    });
    return toNgo(p);
  },

  /** N2: GET /ngo/home, the caller's dispatches, and whether they are a vet. */
  getNgoHome: async (): Promise<NgoHome> => {
    const [h, mine, who] = await Promise.all([
      api.getNgoHome(),
      api.getMyDispatches().catch(() => ({ dispatches: [] })),
      me(),
    ]);
    return {
      ngo: toNgo(h.ngo),
      role: h.role,
      isVet: who?.vet?.status === "verified",
      sos: h.sos.map(toSosCase),
      sentToMe: mine.dispatches
        .filter((d) => !d.acceptedAt && !d.declinedAt && d.caseState !== "resolved" && d.caseState !== "false_alarm")
        .map((d) => ({
          dispatchId: d.id,
          caseId: d.caseId,
          dogName: d.dog?.name ?? null,
          wardId: d.wardId,
          openedAt: d.openedAt,
          withAmbulance: d.withAmbulance,
        })),
      team: h.team,
      nextDrive: h.nextDrive ? { id: h.nextDrive.id, place: h.nextDrive.title, startsAt: h.nextDrive.startsAt } : null,
      dogs: h.dogs,
    };
  },

  /** N2 "Mark back" (status) and the ambulance sheet (status, count, hours). */
  updateAmbulance: async (input: {
    status?: "in" | "out";
    count?: number;
    hours?: string | null;
  }): Promise<Partial<NgoAmbulance>> => {
    let out: Partial<NgoAmbulance> = {};
    if (input.count !== undefined || input.hours !== undefined) {
      const p = await api.patchNgoMe({ ambulanceCount: input.count, ambulanceHours: input.hours });
      out = { count: p.ambulance.count, hours: p.ambulance.hours, status: p.ambulance.status };
    }
    if (input.status) {
      const a = await api.setAmbulance(input.status);
      out = {
        ...out,
        count: a.count,
        hours: a.hours,
        status: a.status,
        caseId: a.outOnCase?.caseId ?? null,
        dogName: a.outOnCase?.dogName ?? null,
      };
    }
    return out;
  },

  updateBeds: (input: NgoBeds): Promise<NgoBeds> => api.setBeds(input.free, input.total),

  /** NGO profile (coordinator). Wards are not changed here: an admin changes them (A7). */
  updateNgo: async (input: NgoPatch): Promise<Ngo> => {
    const p = await api.patchNgoMe({
      publicPhone: input.publicPhone,
      contactName: input.contactName,
      offers: input.offers ? offersToRecord(input.offers) : undefined,
      ambulanceCount: input.ambulanceCount,
      ambulanceHours: input.ambulanceHours,
      wards: input.wards,
      hours: input.hours,
    });
    return toNgo(p);
  },

  /**
   * N3: who could go (GET /ngo/sos/:caseId/candidates), with the case from
   * the NGO home list (dog, ward) and, when readable, the case itself (the
   * reporter's first name, the exact spot if this caller may see it).
   */
  getDispatch: async (caseId: string): Promise<NgoDispatch> => {
    const [cands, home, c] = await Promise.all([
      api.getDispatchCandidates(caseId),
      api.getNgoHome().catch(() => null),
      api.getSosCaseV6(caseId).catch(() => null as SosCaseV6 | null),
    ]);
    const item = home?.sos.find((s) => s.caseId === caseId);
    const view = item ? toSosCase(item) : null;
    const cx = c as
      | (SosCaseV6 & {
          reporterName?: string | null;
          dog?: { name?: string | null } | null;
          location?: { lat: number; lng: number } | null;
        })
      | null;
    return {
      caseId,
      dogName: view?.dogName ?? cx?.dog?.name ?? null,
      reporterName: cx?.reporterName ?? null,
      locality: view?.locality ?? cx?.wardName ?? null,
      wardId: view?.wardId ?? cx?.wardId ?? null,
      openedAt: view?.openedAt ?? cx?.openedAt ?? null,
      escalatesAt: view?.opensToVetsAt ?? null,
      lat: cx?.location?.lat ?? null,
      lng: cx?.location?.lng ?? null,
      state: view?.state ?? "unassigned",
      assignee: view?.assignee ?? null,
      etaMin: view?.etaMin ?? null,
      candidates: toCandidates(cands),
    };
  },

  /** N3 "Send Dr. Qureshi": pages that member; their accept takes the case as them. */
  sendSomeone: (caseId: string, input: { memberId: string; ambulance: boolean }) =>
    api.dispatch(caseId, { feederId: input.memberId, withAmbulance: input.ambulance }),

  /** N3 "We can't take this one": the case opens to every vet nearby now. */
  declineCase: (caseId: string) => api.passSos(caseId),

  /** N2 "Sent to you": accept (the API acks the case as the caller) or decline. */
  acceptSent: (dispatchId: string) => api.acceptDispatch(dispatchId),
  declineSent: (dispatchId: string) => api.declineDispatch(dispatchId),

  /** N4. */
  getTeam: async (): Promise<NgoTeam> => {
    const [t, who] = await Promise.all([api.getNgoTeam(), me()]);
    return {
      canManage: t.canManage,
      vets: t.vets.map((v) => ({ feederId: v.feederId, name: v.name, status: v.status, vouched: !!v.vouchedAt })),
      members: t.members.map((m) => ({
        id: m.feederId,
        name: m.name,
        role: m.role,
        hasTransport: m.hasTransport,
        me: !!who && who.feederId === m.feederId,
      })),
      invites: t.invites?.length ?? 0,
    };
  },

  vouchVet: (vetFeederId: string) => api.vouchForVet(vetFeederId),

  inviteMember: (input: { email: string; role: InviteRole; hasTransport: boolean }) => api.inviteToNgo(input),

  updateMember: async (memberId: string, input: { role?: NgoRole; hasTransport?: boolean }): Promise<null> => {
    await api.updateNgoMember(memberId, input);
    return null;
  },

  removeMember: (memberId: string) => api.removeNgoMember(memberId),

  /** Dogs in the NGO's wards, and how many are not sterilised. */
  getWardDogs: async (filter: "all" | "unsterilised" = "all"): Promise<WardDogs> => {
    const [list, unst] = await Promise.all([
      api.getNgoDogs(filter === "all" ? undefined : "unsterilised"),
      filter === "all" ? api.getNgoDogs("unsterilised").catch(() => null) : Promise.resolve(null),
    ]);
    const dogs: WardDog[] = list.dogs.map((d) => ({
      slug: d.slug,
      name: d.name,
      wardId: d.wardId,
      sterilised: d.sterilised,
      vaccinated: d.vaccinated,
      lastFedAt: d.lastFedAt,
    }));
    return {
      total: list.total,
      unsterilised: filter === "all" ? (unst?.total ?? dogs.filter((d) => d.sterilised !== "yes").length) : list.total,
      dogs,
    };
  },

  getDrives: async (): Promise<{ drives: DriveSummary[] }> => {
    const r = await api.getDrives();
    return { drives: r.drives.map(toDriveSummary) };
  },

  createDrive: async (input: NewDriveInput): Promise<DriveSummary> => {
    const d = await api.createDrive({
      title: input.place,
      wardId: input.wardId,
      date: input.date,
      time: input.time,
      leadVetFeederId: input.leadVetId,
      volunteerIds: input.volunteerIds,
      collarsPacked: input.collarsPacked,
      dogs: input.dogs.map((g) => ({ slug: g.slug, tasks: tasksToRecord(g.tasks) })),
    });
    return toDriveSummary(d);
  },

  /** N5. */
  getDrive: async (driveId: string): Promise<DriveDetail> => {
    const [d, who] = await Promise.all([api.getDrive(driveId), me()]);
    return toDriveDetail(d, who?.feederId ?? null);
  },

  /** N5 "Start drive". */
  startDrive: (driveId: string) => api.startDrive(driveId),

  /** N5 "Finish drive" (coordinators). */
  finishDrive: (driveId: string) => api.finishDrive(driveId),

  /** N5 check-off. Vaccinations are not ticked here: the lead vet signs them (V3). */
  checkOffDog: async (driveId: string, driveDogId: string, done: DriveTask[]): Promise<DriveDog> => {
    const d = await api.updateDriveDog(driveId, driveDogId, { done: tasksToRecord(done) });
    return toDriveDog(d);
  },
};

export type NgoApi = typeof ngoApi;
