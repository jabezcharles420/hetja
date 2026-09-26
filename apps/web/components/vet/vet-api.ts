/**
 * The vet portal's view of the API (design v7, docs/design/v7-portals/
 * CONTRACT.md, "API: Vet" and "Feeder side of signing").
 *
 * The calls are lib/api.ts's "Design v7 endpoints"; this module turns their
 * shapes into what the screens draw (a sign request's "anti-rabies" title,
 * a signer line's parts, a health list with corrections and withdrawals
 * resolved) so the screens never reach into raw payloads. Reads are
 * defensive: a field the server leaves out becomes null, never a crash on a
 * vet's phone. Fields the v7 types do not carry yet (a government vet's
 * flag on a profile or a signer) are read if present.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  api,
  ApiError,
  type DocumentMime,
  type HealthRecord as ApiHealthRecord,
  type MySignature,
  type SignRequest as ApiSignRequest,
  type SosHours,
  type VetProfile as ApiVetProfile,
  type VetRecordDraft,
  type VetRecordProposal,
  type VetSosItem,
  type WebAuthnResponseJSON,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export type VetStatus = ApiVetProfile["status"];
export type RecordKind = "vaccination" | "sterilisation" | "treatment";
export type { SosHours };

export interface VetProfile {
  status: VetStatus;
  /** "Dr. Farhan Qureshi". */
  name: string;
  council: string;
  regNo: string;
  /** "MSVC 5190". */
  regLabel: string;
  clinic: string | null;
  /** Canonical ward ids ("K-West"). */
  wards: string[];
  sosAvailable: boolean;
  sosHours: SosHours | null;
  /** Public by design (owner decision): vets exist to be called. */
  publicPhone: string | null;
  /** Government vets are free, and Hetja says so. */
  isGovernment: boolean;
  appliedAt: string | null;
  decidedAt: string | null;
  /** The admin's reason for Ask for more, Decline, Suspend or Remove. */
  reason: string | null;
  /** A passkey exists for this account (on some device). */
  hasPasskey: boolean;
  canSign: boolean;
  canAcceptSos: boolean;
  /** Document kinds on file ("certificate", "photo_id"). */
  documents: string[];
}

export interface DogRef {
  slug: string;
  name: string | null;
  photoUrl: string | null;
}

export interface SignRequest {
  id: string;
  dog: DogRef;
  kind: RecordKind;
  /** "anti-rabies", "sterilised", "DHPPi booster". */
  title: string;
  requestedBy: string | null;
  givenOn: string | null;
  hasEvidence: boolean;
  createdAt: string | null;
  proposed: Partial<VetRecordProposal>;
  /** The feeder-noted record the request is about, if any. */
  recordId: string | null;
}

/** V2's list rows need only this much of a request. */
export type SignRequestSummary = Pick<SignRequest, "id" | "dog" | "kind" | "title" | "requestedBy" | "givenOn" | "hasEvidence">;

export interface VetSos {
  caseId: string;
  dog: DogRef | null;
  /** "Moti is limping badly": the reporter's note, else "<name> needs help". */
  title: string;
  /** "Lokhandwala": ward level, never a street. */
  place: string | null;
  /** "Sneha": the reporter's first name, when signed in. */
  withName: string | null;
  distanceM: number | null;
  sex: "male" | "female" | null;
}

export interface VetHome {
  vet: VetProfile;
  sos: VetSos[];
  signRequests: SignRequest[];
  dueSoon: { count: number; by: string | null };
}

export interface HealthSigner {
  name: string;
  council: string | null;
  regNo: string | null;
  isGovernment: boolean;
}

export interface HealthRecord {
  id: string;
  kind: RecordKind | "deworming" | "checkup" | "other";
  title: string;
  status: "vet_signed" | "feeder_noted";
  date: string | null;
  dueOn: string | null;
  note: string | null;
  brand: string | null;
  batch: string | null;
  vet: HealthSigner | null;
  addedBy: string | null;
  supersedes: string | null;
  withdrawn: boolean;
  earNotched: boolean | null;
  requestOpen: boolean;
}

export interface DogHealth {
  records: HealthRecord[];
  certificateUrl: string | null;
  viewerIsVet: boolean;
}

export interface VetDogView {
  dog: DogRef & {
    sex: "male" | "female" | null;
    ageYears: number | null;
    /** The collar's batch number ("HJ-0412") where set, else null (use the 3-3-3 code). */
    collarNo: string | null;
    wardId: string | null;
  };
  youFeed: boolean;
  lastFed: { byFirstName: string | null; at: string } | null;
  /** The dog's records, corrections and withdrawals resolved (currentRecords). */
  health: HealthRecord[];
  notesToConfirm: HealthRecord[];
  openRequests: SignRequest[];
  canSign: boolean;
}

export interface SignedRecord extends HealthRecord {
  dog: DogRef;
  signedAt: string | null;
  requestedBy: string | null;
  /** A newer version exists (this one is struck through). */
  corrected: boolean;
  flagged: boolean;
}

export interface DueSoonDog {
  dog: DogRef;
  wardId: string | null;
  /** "Anti-rabies". */
  title: string | null;
  dueOn: string;
}

export interface ApplyDoc {
  kind: "certificate" | "photo_id";
  fileName: string;
  mime: DocumentMime;
  base64: string;
}

export interface ApplyInput {
  regNo: string;
  clinic: string | null;
  sosAvailable: boolean;
  wards: string[];
  sosHours: SosHours | null;
  publicPhone: string;
  documents: ApplyDoc[];
}

export interface VetProfilePatch {
  clinic?: string | null;
  wards?: string[];
  sosAvailable?: boolean;
  sosHours?: SosHours | null;
  publicPhone?: string;
}

export interface VaccinationPayload {
  kind: "vaccination";
  vaccine: string;
  brand: string;
  batch: string;
  givenOn: string;
  nextDue: string | null;
}
export interface SterilisationPayload {
  kind: "sterilisation";
  date: string;
  earNotched: boolean;
  note: string | null;
}
export interface TreatmentPayload {
  kind: "treatment";
  date: string;
  diagnosis: string;
  treatment: string;
  nextCheck: string | null;
}
export type RecordPayload = VaccinationPayload | SterilisationPayload | TreatmentPayload;

export interface SignInput {
  dogSlug: string;
  payload: RecordPayload | { kind: "withdrawal" };
  requestId?: string | null;
  /** Signing a feeder's note ("1 feeder note to confirm"): the note it confirms. */
  confirmsRecordId?: string | null;
  /** N5: the dog's row on an NGO drive, so the signature checks its "vaccinate" task. */
  driveDogId?: string | null;
  /** From uploadRecordPhoto: the vaccine sticker or clinic slip. */
  photoId?: string | null;
  /** Correct / withdraw: the vet's own signed record. */
  supersedes?: string | null;
  reason?: string | null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function dogRef(d: { slug: string; name: string | null; photoUrl?: string | null; avatarUrl?: string | null } | null | undefined): DogRef {
  return { slug: d?.slug ?? "", name: d?.name ?? null, photoUrl: d?.photoUrl ?? d?.avatarUrl ?? null };
}

function kindOf(t: string | null | undefined): RecordKind {
  return t === "vaccination" || t === "sterilisation" ? t : "treatment";
}

/** "Anti-rabies" -> "anti-rabies", but "DHPPi booster" keeps its capitals. */
export function lowerTitle(t: string): string {
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function proposalTitle(p: Partial<VetRecordProposal>, kind: RecordKind): string {
  if (kind === "vaccination") return lowerTitle(p.vaccine ?? "vaccination");
  if (kind === "sterilisation") return "sterilised";
  return lowerTitle(p.diagnosis ?? p.treatment ?? "treatment");
}

export function normProfile(
  p: ApiVetProfile | null | undefined,
  extra: { passkeys?: number; canSign?: boolean; canAcceptSos?: boolean; documents?: string[] } = {},
): VetProfile | null {
  if (!p) return null;
  return {
    status: p.status,
    name: p.name ?? "",
    council: p.council ?? "MSVC",
    regNo: p.regNo ?? "",
    regLabel: p.regLabel ?? [p.council, p.regNo].filter(Boolean).join(" "),
    clinic: p.clinic ?? null,
    wards: p.wards ?? [],
    sosAvailable: p.sosAvailable === true,
    sosHours: p.sosHours ?? null,
    publicPhone: p.publicPhone ?? null,
    isGovernment: p.isGovernment === true,
    appliedAt: p.appliedAt ?? null,
    decidedAt: p.decidedAt ?? null,
    reason: p.decisionReason ?? null,
    hasPasskey: (extra.passkeys ?? 0) > 0,
    canSign: extra.canSign ?? p.status === "verified",
    canAcceptSos: extra.canAcceptSos ?? p.status === "verified",
    documents: extra.documents ?? [],
  };
}

export function normRequest(r: ApiSignRequest): SignRequest {
  const p = r.proposed ?? ({} as VetRecordProposal);
  const kind = kindOf(p.type);
  return {
    id: r.id,
    dog: dogRef(r.dog),
    kind,
    title: proposalTitle(p, kind),
    requestedBy: r.requestedBy ?? null,
    givenOn: p.givenOn ?? null,
    hasEvidence: !!r.evidencePhotoUrl,
    createdAt: r.requestedAt ?? null,
    proposed: p,
    recordId: r.recordId ?? null,
  };
}

export function normHealth(r: ApiHealthRecord): HealthRecord {
  const vet = r.vet;
  const k = r.type;
  return {
    id: r.id,
    kind: k === "vaccination" || k === "sterilisation" || k === "treatment" || k === "deworming" || k === "checkup" ? k : "other",
    title: r.title,
    status: r.status,
    date: r.date ?? null,
    dueOn: r.dueOn ?? null,
    note: r.note ?? null,
    brand: r.brand ?? null,
    batch: r.batch ?? null,
    vet:
      r.status === "vet_signed" && vet
        ? { name: vet.name ?? "", council: str(vet.council), regNo: str(vet.regNo), isGovernment: vet.isGovernment === true }
        : null,
    addedBy: r.addedBy ?? null,
    supersedes: r.supersedes ?? null,
    withdrawn: !!r.withdrawnAt,
    earNotched: r.earNotched ?? null,
    requestOpen: r.signRequestOpen === true,
  };
}

export function currentRecords(list: HealthRecord[]): HealthRecord[] {
  const replaced = new Set(list.map((r) => r.supersedes).filter((x): x is string => !!x));
  return list.filter((r) => !r.withdrawn && !replaced.has(r.id));
}

/**
 * What a dog's page shows: withdrawal records and what they withdrew drop
 * out, and a correction replaces the record it supersedes. Newest first.
 */
export function currentFromApi(list: ApiHealthRecord[]): HealthRecord[] {
  const withdrawn = new Set(list.filter((r) => r.type === "withdrawal" && r.withdraws).map((r) => r.withdraws!));
  return currentRecords(
    list
      .filter((r) => r.type !== "withdrawal")
      .map((r) => {
        const h = normHealth(r);
        return withdrawn.has(h.id) ? { ...h, withdrawn: true } : h;
      }),
  ).reverse();
}

function normSos(c: VetSosItem): VetSos {
  const name = c.dog?.name ?? null;
  const note = str(c.note);
  const sex = c.dog?.sex;
  return {
    caseId: c.caseId,
    dog: c.dog ? dogRef(c.dog) : null,
    title: note ? note.charAt(0).toUpperCase() + note.slice(1) : `${name ?? "A dog"} needs help`,
    place: c.wardName ?? c.wardCode ?? null,
    withName: c.reporterName ?? null,
    distanceM: c.distanceM ?? null,
    sex: sex === "male" || sex === "female" ? sex : null,
  };
}

/** Our draft as the API hashes it (VetRecordDraft), built in one place so both sign calls send the same bytes. */
export function toDraft(input: SignInput): VetRecordDraft {
  const base = {
    dogSlug: input.dogSlug,
    ...(input.requestId ? { signRequestId: input.requestId } : {}),
    ...(input.confirmsRecordId ? { confirmsRecordId: input.confirmsRecordId } : {}),
    ...(input.driveDogId ? { driveDogId: input.driveDogId } : {}),
    ...(input.photoId ? { photoId: input.photoId } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
  const p = input.payload;
  if (p.kind === "withdrawal") return { ...base, type: "withdrawal" };
  if (p.kind === "vaccination") {
    return {
      ...base,
      type: "vaccination",
      vaccine: p.vaccine,
      ...(p.brand ? { brand: p.brand } : {}),
      batch: p.batch,
      givenOn: p.givenOn,
      dueOn: p.nextDue,
    };
  }
  if (p.kind === "sterilisation") {
    return { ...base, type: "sterilisation", givenOn: p.date, earNotched: p.earNotched, ...(p.note ? { note: p.note } : {}) };
  }
  return {
    ...base,
    type: "treatment",
    givenOn: p.date,
    diagnosis: p.diagnosis,
    treatment: p.treatment,
    ...(p.nextCheck ? { dueOn: p.nextCheck } : {}),
  };
}

function toSigned(s: MySignature, detail: HealthRecord | undefined): SignedRecord {
  const base: HealthRecord = detail ?? {
    id: s.id,
    kind: kindOf(s.type),
    title: s.title,
    status: "vet_signed",
    date: s.date,
    dueOn: null,
    note: null,
    brand: null,
    batch: s.batch,
    vet: null,
    addedBy: null,
    supersedes: s.supersedes,
    withdrawn: false,
    earNotched: null,
    requestOpen: false,
  };
  return {
    ...base,
    dog: { slug: s.dog.slug, name: s.dog.name, photoUrl: null },
    signedAt: s.signedAt ?? null,
    requestedBy: s.requestedBy ?? null,
    corrected: s.status === "corrected",
    withdrawn: s.status === "withdrawn" || base.withdrawn,
    flagged: s.status === "flagged",
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const vetApi = {
  /** GET /vet/me. Null when the caller never applied. */
  async getMyVet(): Promise<VetProfile | null> {
    const me = await api.getVetMe();
    return normProfile(me.profile, {
      passkeys: me.passkeys?.length ?? 0,
      canSign: me.canSign,
      canAcceptSos: me.canAcceptSos,
      documents: (me.documents ?? []).map((d) => d.kind),
    });
  },

  /** V1: upload each document (POST /documents), then POST /vet/apply with their ids. */
  async apply(input: ApplyInput): Promise<VetProfile | null> {
    const ids: string[] = [];
    for (const d of input.documents) {
      const up = await api.uploadDocument({ kind: d.kind, fileName: d.fileName, mime: d.mime, base64: d.base64 });
      ids.push(up.id);
    }
    const p = await api.applyAsVet({
      council: "MSVC",
      regNo: input.regNo,
      clinic: input.clinic,
      wards: input.wards,
      sosAvailable: input.sosAvailable,
      sosHours: input.sosHours,
      publicPhone: input.publicPhone,
      documentIds: ids,
    });
    return normProfile(p, { documents: input.documents.map((d) => d.kind) });
  },

  async patchMyVet(patch: VetProfilePatch, passkeys = 0): Promise<VetProfile | null> {
    return normProfile(await api.patchVetMe(patch), { passkeys });
  },

  /** V2. 403 VET_NOT_VERIFIED unless verified or suspended. */
  async getHome(): Promise<VetHome> {
    const h = await api.getVetHome();
    const vet = normProfile(h.profile, { canSign: h.canSign, canAcceptSos: h.canAcceptSos, passkeys: h.canSign ? 1 : 0 });
    if (!vet) throw new ApiError("Not a vet", { status: 403, code: "VET_NOT_VERIFIED" });
    return {
      vet,
      sos: (h.sos ?? []).filter((c) => !c.taken).map(normSos),
      signRequests: (h.signRequests ?? []).map(normRequest),
      dueSoon: { count: h.dueSoon?.count ?? 0, by: h.dueSoon?.by ?? null },
    };
  },

  /** One open request (GET /vet/sign-requests/:id). An answered one is a 404 to V3. */
  async getRequest(id: string): Promise<SignRequest> {
    const r = await api.getVetSignRequest(id);
    if ((r.status ?? "open") !== "open") throw new ApiError("Already answered", { status: 404 });
    return normRequest(r);
  },

  /** V3 "I didn't give this". */
  declineRequest: (id: string, reason?: string) => api.declineSignRequest(id, reason),

  /** V2b and V3's header. */
  async getVetDog(slug: string): Promise<VetDogView> {
    const v = await api.getVetDog(slug);
    const d = v.dog;
    return {
      dog: {
        slug: d.slug,
        name: d.name,
        photoUrl: d.photoUrl ?? d.avatarUrl ?? null,
        sex: d.sex === "male" || d.sex === "female" ? d.sex : null,
        ageYears: d.approxAge ?? null,
        collarNo: d.collar?.batchNo ?? null,
        wardId: d.wardId ?? null,
      },
      youFeed: v.youFeed === true,
      lastFed: v.lastFedAt ? { byFirstName: v.lastFedBy ?? null, at: v.lastFedAt } : null,
      health: currentFromApi(v.health?.records ?? []),
      notesToConfirm: (v.notesToConfirm ?? []).map(normHealth),
      openRequests: (v.openSignRequests ?? []).map(normRequest),
      canSign: v.canSign === true,
    };
  },

  async getDueSoon(): Promise<{ by: string | null; dogs: DueSoonDog[] }> {
    const r = await api.getVetDueSoon();
    return {
      by: r.by ?? null,
      dogs: (r.dogs ?? []).map((d) => ({ dog: dogRef(d), wardId: d.wardId ?? null, title: d.lastLabel ?? null, dueOn: d.due })),
    };
  },

  async getSignatures(): Promise<SignedRecord[]> {
    const { signatures } = await api.getMySignatures();
    return (signatures ?? []).map((s) => toSigned(s, undefined));
  },

  /** V5: the signature, with its full fields read from the dog's health list. */
  async getSignature(id: string): Promise<SignedRecord> {
    const s = await api.getMySignature(id);
    let detail: HealthRecord | undefined;
    try {
      const h = await api.getDogHealth(s.dog.slug);
      const raw = (h.records ?? []).find((r) => r.id === id);
      detail = raw ? normHealth(raw) : undefined;
    } catch {
      /* the list row is enough to correct the batch and the date */
    }
    return toSigned(s, detail);
  },

  /** V3's optional sticker photo, uploaded before signing: its id is part of the signed draft. */
  uploadRecordPhoto: async (base64: string) => (await api.uploadRecordPhoto(base64)).photoId,

  /** "Or search by name or ID": dogs in the vet's wards (GET /vet/dogs?q=). */
  searchDogs: async (q: string) => (await api.searchVetDogs(q)).dogs ?? [],

  /**
   * The collar's batch number for the certificate. The public dog profile
   * does not carry it yet, so it is read from there if it ever does, and
   * otherwise from the vet's view of the dog (a vet is who prints most
   * certificates). Null when neither says.
   */
  async collarNo(slug: string, publicDog: unknown): Promise<string | null> {
    const o = obj(publicDog);
    const direct = str(o.collarBatchNo) ?? str(o.batchNo) ?? str(obj(o.collar).batchNo);
    if (direct) return direct;
    try {
      return (await api.getVetDog(slug)).dog.collar?.batchNo ?? null;
    } catch {
      return null;
    }
  },

  /** N5: the dog's row on a drive, to link the signature to it. Null when it can't be read. */
  async driveDogId(driveId: string, slug: string): Promise<string | null> {
    try {
      const d = await api.getDrive(driveId);
      return (d.dogList ?? []).find((x) => x.dog.slug === slug)?.id ?? null;
    } catch {
      return null;
    }
  },

  registerOptions: async () => (await api.passkeyRegistrationOptions()) as unknown as PublicKeyCredentialCreationOptionsJSON,
  registerPasskey: (response: RegistrationResponseJSON) => api.registerPasskey(response as unknown as WebAuthnResponseJSON),

  /** Step 1 of signing: the server hashes the draft, and that hash is the passkey's challenge. */
  async signOptions(
    input: SignInput,
  ): Promise<{ challengeId: string; optionsJSON: PublicKeyCredentialRequestOptionsJSON; draft: VetRecordDraft }> {
    const draft = toDraft(input);
    const o = await api.signOptions(draft);
    return { challengeId: o.challengeId, optionsJSON: o.options as unknown as PublicKeyCredentialRequestOptionsJSON, draft };
  },
  /** Step 2: the same draft, byte for byte, with the assertion. */
  sign: (challengeId: string, draft: VetRecordDraft, assertion: AuthenticationResponseJSON) =>
    api.signRecord(challengeId, draft, assertion as unknown as WebAuthnResponseJSON),

  /** V4: public; a vet's Bearer only sets viewerIsVet. */
  async getHealth(slug: string): Promise<DogHealth> {
    const h = await api.getDogHealth(slug);
    return { records: currentFromApi(h.records ?? []), certificateUrl: h.certificateUrl ?? null, viewerIsVet: h.viewerIsVet === true };
  },

  /** A feeder notes care themselves: "Feeder noted". */
  addFeederNote: (
    slug: string,
    input: { type: "vaccination" | "sterilisation" | "treatment" | "deworming" | "other"; title?: string; date: string; note?: string },
  ) => api.addHealthNote(slug, input),

  /** "Ask a vet to sign" on a feeder-noted record. */
  askToSign: (slug: string, recordId: string) => api.askVetToSign(slug, { recordId }),
};
