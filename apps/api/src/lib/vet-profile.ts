/**
 * One vet profile as the vet (V1, V2) and the admin (A2) read it. Shared so
 * the two views cannot disagree about what a status or a registration is.
 */
import { query } from "@hetja/db";
import { maskPhone, regLabel, sosHoursOf, type VetStatus } from "./professionals.js";

export const VET_PROFILE_SQL = `
  SELECT v.id, v.feeder_id, f.display_name, v.council, v.reg_no, v.qualification, v.clinic, v.wards,
         v.sos_available, v.sos_start, v.sos_end, v.phone_e164, v.status, v.applied_at, v.decided_at,
         v.decision_reason, v.valid_to, v.register_checked_at, rc.display_name AS register_checked_by_name,
         v.register_not_found_at, COALESCE(cp.is_government OR cp.kind = 'govt', FALSE) AS is_government,
         db.display_name AS decided_by_name, v.vouched_by_ngo_id, vn.name AS vouched_by_name,
         v.ngo_id, n.name AS ngo_name, v.care_provider_id, v.signatures_flagged_at,
         (SELECT count(*)::int FROM medical_records m WHERE m.signed_by = v.feeder_id) AS signatures
    FROM vet_profiles v
    JOIN feeders f ON f.id = v.feeder_id
    LEFT JOIN feeders rc ON rc.id = v.register_checked_by
    LEFT JOIN feeders db ON db.id = v.decided_by
    LEFT JOIN ngos vn ON vn.id = v.vouched_by_ngo_id
    LEFT JOIN ngos n ON n.id = v.ngo_id
    LEFT JOIN care_providers cp ON cp.id = v.care_provider_id`;

export interface VetProfileRow {
  id: string;
  feeder_id: string;
  display_name: string;
  council: string;
  reg_no: string | null;
  qualification: string | null;
  clinic: string | null;
  wards: string[];
  sos_available: boolean;
  sos_start: number | null;
  sos_end: number | null;
  phone_e164: string | null;
  status: VetStatus;
  applied_at: Date | null;
  decided_at: Date | null;
  decision_reason: string | null;
  valid_to: string | null;
  register_checked_at: Date | null;
  register_checked_by_name: string | null;
  register_not_found_at: Date | null;
  is_government: boolean;
  decided_by_name: string | null;
  vouched_by_ngo_id: string | null;
  vouched_by_name: string | null;
  ngo_id: string | null;
  ngo_name: string | null;
  care_provider_id: string | null;
  signatures_flagged_at: Date | null;
  signatures: number;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function vetProfileOf(r: VetProfileRow) {
  return {
    id: r.id,
    feederId: r.feeder_id,
    name: r.display_name,
    council: r.council,
    regNo: r.reg_no ?? "",
    regLabel: regLabel(r.council, r.reg_no) ?? r.council,
    qualification: r.qualification,
    clinic: r.clinic,
    wards: r.wards ?? [],
    sosAvailable: r.sos_available,
    sosHours: sosHoursOf(r.sos_start, r.sos_end),
    publicPhone: r.phone_e164,
    status: r.status,
    appliedAt: iso(r.applied_at),
    decidedAt: iso(r.decided_at),
    decisionReason: r.decision_reason,
    validTo: r.valid_to,
    vouchedBy: r.vouched_by_ngo_id ? { ngoId: r.vouched_by_ngo_id, name: r.vouched_by_name ?? "" } : null,
    ngo: r.ngo_id ? { id: r.ngo_id, name: r.ngo_name ?? "" } : null,
    // "Government vet · free": linked to a government directory entry.
    isGovernment: r.is_government,
    careProviderId: r.care_provider_id,
  };
}

export function adminVetRowOf(r: VetProfileRow) {
  return {
    id: r.id,
    feederId: r.feeder_id,
    name: r.display_name,
    council: r.council,
    regNo: r.reg_no ?? "",
    regLabel: regLabel(r.council, r.reg_no) ?? r.council,
    clinic: r.clinic,
    status: r.status,
    appliedAt: iso(r.applied_at),
    vouched: r.vouched_by_ngo_id !== null,
    registerChecked: r.register_checked_at !== null,
    registerNotFound: r.register_not_found_at !== null,
    isGovernment: r.is_government,
  };
}

export function adminVetDetailOf(r: VetProfileRow, documents: unknown[]) {
  const p = vetProfileOf(r);
  return {
    ...adminVetRowOf(r),
    qualification: p.qualification,
    wards: p.wards,
    sosAvailable: p.sosAvailable,
    sosHours: p.sosHours,
    publicPhone: p.publicPhone,
    publicPhoneMasked: maskPhone(r.phone_e164),
    registerCheckedAt: iso(r.register_checked_at),
    registerCheckedBy: r.register_checked_by_name,
    validTo: r.valid_to,
    decidedAt: p.decidedAt,
    decidedBy: r.decided_by_name,
    decisionReason: r.decision_reason,
    vouchedBy: p.vouchedBy,
    ngo: p.ngo,
    documents,
    signatures: r.signatures,
    signaturesFlagged: r.signatures_flagged_at !== null,
    careProviderId: r.care_provider_id,
    // The Maharashtra State Veterinary Council's public site (no API: the
    // admin checks by hand and ticks "Checked on the MSVC register").
    registerUrl: "https://msvc.org.in/",
  };
}

export async function loadVetProfileRow(where: "id" | "feeder_id", value: string): Promise<VetProfileRow | null> {
  const res = await query<VetProfileRow>(`${VET_PROFILE_SQL} WHERE v.${where} = $1`, [value]);
  return res.rows[0] ?? null;
}

export async function documentsOf(ownerKind: "vet_profile" | "ngo", ownerId: string) {
  const res = await query<{
    id: string;
    kind: string;
    mime: string;
    size_bytes: number;
    uploaded_at: Date;
    delete_after: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, kind, mime, size_bytes, uploaded_at, delete_after, deleted_at
       FROM documents WHERE owner_kind = $1 AND owner_id = $2 ORDER BY uploaded_at`,
    [ownerKind, ownerId],
  );
  return res.rows.map((d) => ({
    id: d.id,
    kind: d.kind,
    mime: d.mime,
    sizeBytes: d.size_bytes,
    uploadedAt: new Date(d.uploaded_at).toISOString(),
    deleteAfter: d.delete_after && ownerKind ? new Date(d.delete_after).toISOString() : null,
    deleted: d.deleted_at !== null,
  }));
}

/**
 * Attach the caller's own pending uploads to an application. Returns the kinds
 * attached; ids that are not the caller's pending documents are ignored.
 */
export async function attachDocuments(
  client: { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> },
  uploaderId: string,
  documentIds: string[],
  ownerKind: "vet_profile" | "ngo",
  ownerId: string,
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const res = await client.query<{ kind: string }>(
    `UPDATE documents SET owner_kind = $3, owner_id = $4, delete_after = NULL
      WHERE id = ANY($1::uuid[]) AND uploaded_by = $2 AND owner_kind = 'pending' AND deleted_at IS NULL
        AND blob_key IS NOT NULL
      RETURNING kind`,
    [documentIds, uploaderId, ownerKind, ownerId],
  );
  return res.rows.map((r) => r.kind);
}
