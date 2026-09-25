/**
 * A dog's health list (design v7, V4 "What everyone sees", V5 corrections).
 *
 * Built from medical_records, which is append-only and hash-chained
 * (INVARIANTs 8 and 9): nothing here is ever an UPDATE. A correction is a
 * later row with corrects_record_id pointing at the row it replaces (the old
 * one stays in the list, and the client strikes it through); a withdrawal is
 * a row of record_type 'withdrawal' pointing at the row it takes off the page
 * (the withdrawn row gets `withdrawnAt`). The list includes every row, oldest
 * first, so a client can show the current versions and the history from one
 * read; the shape is the one the lead fixed for the collar page (V4).
 *
 *   status "vet_signed"    is_verified: a verified vet's passkey signature
 *                          (v7), a contracted vet's checkup (v5) or a signed
 *                          clinic write (medical.ts). vet = name, council and
 *                          registration number (v7) or the clinic's name.
 *   status "feeder_noted"  everything else: a feeder's own note. addedBy is
 *                          their first name, opt-out respected (v6 rule).
 *
 * A merged dog's records are read with the kept dog's (A5): the ledger is
 * never rewritten, so the kept dog's list is the union.
 */
import { query } from "@hetja/db";
import { firstName } from "./public-name.js";

export type HealthRecordType =
  | "vaccination"
  | "sterilisation"
  | "treatment"
  | "deworming"
  | "checkup"
  | "other"
  | "withdrawal";

export interface HealthRecord {
  id: string;
  type: HealthRecordType;
  title: string;
  status: "vet_signed" | "feeder_noted";
  date: string | null;
  dueOn: string | null;
  note: string | null;
  vet: { name: string; council: string | null; regNo: string | null; isGovernment: boolean } | null;
  brand: string | null;
  batch: string | null;
  addedBy: string | null;
  supersedes: string | null;
  withdraws: string | null;
  withdrawnAt: string | null;
  reason: string | null;
  earNotched: boolean | null;
  flagged: boolean;
  signRequestOpen: boolean;
  recordedAt: string;
  /** A vet-signed record that confirmed a feeder note: the note's id (also in supersedes). */
  confirms: string | null;
  /** On a feeder note: when a vet's signed record confirmed it. */
  confirmedAt: string | null;
  /** A private photo (vaccine sticker) is attached; fetch it from photoPath with a session. */
  hasPhoto: boolean;
  photoPath: string | null;
}

export function recordTypeOf(raw: string): HealthRecordType {
  const t = raw.trim().toLowerCase();
  if (t === "vaccination" || t === "vaccine") return "vaccination";
  if (t === "sterilisation" || t === "sterilization" || t === "abc") return "sterilisation";
  if (t === "treatment") return "treatment";
  if (t === "deworming") return "deworming";
  if (t === "checkup") return "checkup";
  if (t === "withdrawal") return "withdrawal";
  return "other";
}

const DEFAULT_TITLE: Record<HealthRecordType, string> = {
  vaccination: "Vaccination",
  sterilisation: "Sterilised",
  treatment: "Treatment",
  deworming: "Deworming",
  checkup: "Checkup",
  other: "Care note",
  withdrawal: "",
};

function dateStr(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = /^\d{4}-\d{2}(-\d{2})?/.exec(String(v));
  return m ? m[0] : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

interface Row {
  id: string;
  record_type: string;
  vaccine_name: string | null;
  vaccine_date: Date | string | null;
  abc_date: Date | string | null;
  diagnosis: string | null;
  treatment: string | null;
  is_verified: boolean;
  payload: Record<string, unknown> | null;
  record_source: string | null;
  corrects_record_id: string | null;
  correction_reason: string | null;
  created_at: Date;
  signer_name: string | null;
  council: string | null;
  reg_no: string | null;
  flagged: boolean;
  clinic_name: string | null;
  noter_name: string | null;
  noter_show: boolean | null;
  noter_deleted: Date | null;
  open_request: boolean;
  signer_government: boolean;
  photo_id: string | null;
  dog_slug: string;
}

/** The dog and every dog merged into it. */
export async function dogIdsWithMerged(dogId: string): Promise<string[]> {
  const res = await query<{ id: string }>(`SELECT id FROM dogs WHERE id = $1 OR merged_into = $1`, [dogId]);
  return res.rows.map((r) => r.id);
}

export async function healthRecords(dogId: string): Promise<HealthRecord[]> {
  const ids = await dogIdsWithMerged(dogId);
  const res = await query<Row>(
    `SELECT m.id, m.record_type, m.vaccine_name, m.vaccine_date, m.abc_date, m.diagnosis, m.treatment,
            m.is_verified, m.payload, m.record_source, m.corrects_record_id, m.correction_reason, m.created_at,
            sf.display_name AS signer_name, vp.council, vp.reg_no,
            COALESCE(cp.is_government OR cp.kind = 'govt', FALSE) AS signer_government,
            (SELECT x.id FROM documents x WHERE x.owner_kind = 'medical_record' AND x.owner_id = m.id AND x.deleted_at IS NULL LIMIT 1) AS photo_id,
            d.slug AS dog_slug,
            (vp.signatures_flagged_at IS NOT NULL) AS flagged,
            v.clinic_name,
            nf.display_name AS noter_name, nf.show_first_name AS noter_show, nf.deleted_at AS noter_deleted,
            EXISTS (SELECT 1 FROM sign_requests r WHERE r.record_id = m.id AND r.status = 'open') AS open_request
       FROM medical_records m
       LEFT JOIN feeders sf ON sf.id = m.signed_by
       LEFT JOIN vet_profiles vp ON vp.feeder_id = m.signed_by
       LEFT JOIN care_providers cp ON cp.id = vp.care_provider_id
       JOIN dogs d ON d.id = m.dog_id
       LEFT JOIN vets v ON v.id = m.vet_id
       LEFT JOIN feeders nf ON nf.id = m.noted_by
      WHERE m.dog_id = ANY($1::uuid[])
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 500`,
    [ids],
  );
  const withdrawnAt = new Map<string, string>();
  const confirmedAt = new Map<string, string>();
  for (const r of res.rows) {
    if (recordTypeOf(r.record_type) === "withdrawal" && r.corrects_record_id) {
      withdrawnAt.set(r.corrects_record_id, new Date(r.created_at).toISOString());
    }
    const c = (r.payload ?? {}).confirms;
    if (typeof c === "string") confirmedAt.set(c, new Date(r.created_at).toISOString());
  }
  return res.rows.map((r) => {
    const p = r.payload ?? {};
    const type = recordTypeOf(r.record_type);
    const signed = r.is_verified;
    const withdrawal = type === "withdrawal";
    const title =
      withdrawal ? "" : (str(p.title) ?? (type === "vaccination" ? str(r.vaccine_name) : null) ?? DEFAULT_TITLE[type]);
    return {
      id: r.id,
      type,
      title,
      status: signed ? "vet_signed" : "feeder_noted",
      date: dateStr(p.givenOn) ?? dateStr(r.vaccine_date) ?? dateStr(r.abc_date) ?? dateStr(p.date),
      dueOn: dateStr(p.dueOn),
      note: str(p.note) ?? (type === "treatment" || type === "checkup" ? str(r.treatment) : null),
      vet: signed
        ? r.signer_name
          ? { name: r.signer_name, council: r.council, regNo: r.reg_no, isGovernment: r.signer_government }
          : r.clinic_name
            ? { name: r.clinic_name, council: null, regNo: null, isGovernment: false }
            : null
        : null,
      brand: str(p.brand),
      batch: str(p.batch),
      addedBy: signed ? null : firstName(r.noter_name, r.noter_show, r.noter_deleted),
      supersedes: withdrawal ? null : r.corrects_record_id,
      withdraws: withdrawal ? r.corrects_record_id : null,
      withdrawnAt: withdrawnAt.get(r.id) ?? null,
      reason: r.correction_reason,
      earNotched: typeof p.earNotched === "boolean" ? p.earNotched : null,
      flagged: signed && r.flagged,
      signRequestOpen: r.open_request,
      recordedAt: new Date(r.created_at).toISOString(),
      confirms: typeof p.confirms === "string" ? p.confirms : null,
      confirmedAt: confirmedAt.get(r.id) ?? null,
      hasPhoto: r.photo_id !== null,
      photoPath: r.photo_id ? `/dogs/${r.dog_slug}/health/${r.id}/photo` : null,
    } satisfies HealthRecord;
  });
}

/** The records a page would show: not superseded, not withdrawn, not a withdrawal. */
export function currentRecords(list: HealthRecord[]): HealthRecord[] {
  const gone = new Set<string>();
  for (const r of list) {
    if (r.supersedes) gone.add(r.supersedes);
    if (r.withdraws) gone.add(r.withdraws);
  }
  return list.filter((r) => r.type !== "withdrawal" && !r.withdrawnAt && !gone.has(r.id));
}

/**
 * SQL fragment: a medical_records row `m` that a later row withdrew or
 * corrected. Used by the dog profile so a withdrawn signature stops making the
 * page say Vaccinated / Sterilised.
 */
export const RECORD_STILL_CURRENT_SQL = `NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id)`;
