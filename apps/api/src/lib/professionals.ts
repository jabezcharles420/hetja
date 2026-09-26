/**
 * Vets and NGOs as the rest of the system sees them (design v7).
 *
 * PUBLIC PROFESSIONAL CONTACTS (owner decision, 2026-09-25). A verified vet's
 * and an active NGO's phone number are shown wherever care providers are
 * (the SOS sent screen, the map, a dog's page), like the care directory's
 * published numbers. They are professionals who exist to be called. This is
 * the one rescoping of INVARIANT 3 in v7 and it covers professionals only:
 * a feeder's or a reporter's contact details are still never stored except
 * as an HMAC and never shown (docs/INVARIANTS.md, v7 section).
 *
 * GOVERNMENT IS FREE. A vet linked to a government directory entry, or a
 * government hospital, is labelled "Government vet · free" / "Government
 * hospital · free": `isGovernment` true and cost tier "free".
 */
import { BMC_WARD_CODES, isBmcWardCode, wardDisplay } from "@hetja/contracts";
import { query } from "@hetja/db";
import { normalizeIndianPhone } from "./phone.js";

export type VetStatus = "invited" | "waiting" | "more_info" | "verified" | "suspended" | "declined" | "removed";
export type NgoStatus = "waiting" | "active" | "paused" | "removed";
export type NgoMemberRole = "coordinator" | "rescue" | "collars" | "volunteer";

export const ALL_WARDS: readonly string[] = BMC_WARD_CODES;

/** Mumbai wards only (A7 adapted: "NGOs may only cover Mumbai wards"). */
export function validWards(wards: readonly string[]): boolean {
  return wards.every((w) => isBmcWardCode(w)) && new Set(wards).size === wards.length;
}

export function regLabel(council: string | null | undefined, regNo: string | null | undefined): string | null {
  return regNo ? `${council ?? "MSVC"} ${regNo}` : null;
}

/** "09:00" -> 540. null for anything that is not HH:MM. */
export function minutesOf(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function sosHoursOf(start: number | null, end: number | null): { from: string; to: string } | null {
  return start == null || end == null ? null : { from: hhmm(start), to: hhmm(end) };
}

/** Inside the vet's SOS hours at this Mumbai minute. No hours set = any time. Wraps midnight. */
export function inHours(start: number | null, end: number | null, minute: number): boolean {
  if (start == null || end == null || start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function kolkataMinute(d: Date = new Date()): number {
  return Math.floor((((d.getTime() / 60_000 + 330) % 1440) + 1440) % 1440);
}

/** "+919820044410" -> "+91 98•••• 4410" (A2). */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const m = /^\+91(\d{2})\d*(\d{4})$/.exec(e164);
  return m ? `+91 ${m[1]}•••• ${m[2]}` : `${e164.slice(0, 4)}•••• ${e164.slice(-4)}`;
}

export function publicPhone(input: string): string | null {
  return normalizeIndianPhone(input);
}

export interface VetStanding {
  id: string;
  status: VetStatus;
  council: string;
  regNo: string | null;
  wards: string[];
  sosAvailable: boolean;
}

/** The caller's vet profile, or null when they never applied or were invited. */
export async function vetStanding(feederId: string): Promise<VetStanding | null> {
  const r = await query<{
    id: string;
    status: VetStatus;
    council: string;
    reg_no: string | null;
    wards: string[];
    sos_available: boolean;
  }>(`SELECT id, status, council, reg_no, wards, sos_available FROM vet_profiles WHERE feeder_id = $1`, [feederId]);
  const v = r.rows[0];
  return v
    ? { id: v.id, status: v.status, council: v.council, regNo: v.reg_no, wards: v.wards ?? [], sosAvailable: v.sos_available }
    : null;
}

/** Verified and not suspended: may sign records and take SOS as a vet. */
export async function isActiveVet(feederId: string): Promise<boolean> {
  const v = await vetStanding(feederId);
  return v?.status === "verified";
}

export interface NgoMembership {
  ngoId: string;
  name: string;
  status: NgoStatus;
  role: NgoMemberRole;
  hasTransport: boolean;
  wards: string[];
  citywide: boolean;
}

export async function ngoMembership(feederId: string): Promise<NgoMembership | null> {
  const r = await query<{
    ngo_id: string;
    name: string;
    status: NgoStatus;
    role: NgoMemberRole;
    has_transport: boolean;
    wards: string[];
    citywide: boolean;
  }>(
    `SELECT m.ngo_id, n.name, n.status, m.role, m.has_transport, n.wards, n.citywide
       FROM ngo_members m JOIN ngos n ON n.id = m.ngo_id
      WHERE m.feeder_id = $1 AND m.left_at IS NULL AND n.status <> 'removed'`,
    [feederId],
  );
  const m = r.rows[0];
  return m
    ? {
        ngoId: m.ngo_id,
        name: m.name,
        status: m.status,
        role: m.role,
        hasTransport: m.has_transport,
        wards: m.wards ?? [],
        citywide: m.citywide,
      }
    : null;
}

export interface PublicVet {
  feederId: string;
  name: string;
  council: string;
  regNo: string;
  regLabel: string;
  clinic: string | null;
  publicPhone: string | null;
  sosAvailable: boolean;
  sosHours: { from: string; to: string } | null;
  isGovernment: boolean;
  costTier: "free" | "subsidised" | "paid" | null;
}

export interface PublicNgo {
  id: string;
  name: string;
  publicPhone: string | null;
  hasAmbulance: boolean;
  ambulanceStatus: "in" | "out" | null;
  bedsFree: number | null;
  isGovernment: false;
}

/** SQL for one public vet row (join vet_profiles v, feeders f, care_providers cp). */
const VET_SQL = `
  SELECT v.feeder_id, f.display_name, v.council, v.reg_no, v.clinic, v.phone_e164, v.sos_available,
         v.sos_start, v.sos_end,
         COALESCE(cp.is_government OR cp.kind = 'govt', FALSE) AS is_government,
         cp.cost_tier::text AS cost_tier
    FROM vet_profiles v
    JOIN feeders f ON f.id = v.feeder_id AND f.deleted_at IS NULL AND f.suspended_at IS NULL
    LEFT JOIN care_providers cp ON cp.id = v.care_provider_id`;

type VetRow = {
  feeder_id: string;
  display_name: string;
  council: string;
  reg_no: string;
  clinic: string | null;
  phone_e164: string | null;
  sos_available: boolean;
  sos_start: number | null;
  sos_end: number | null;
  is_government: boolean;
  cost_tier: string | null;
};

export function publicVetOf(r: VetRow): PublicVet {
  return {
    feederId: r.feeder_id,
    name: r.display_name,
    council: r.council,
    regNo: r.reg_no,
    regLabel: regLabel(r.council, r.reg_no) ?? r.council,
    clinic: r.clinic,
    publicPhone: r.phone_e164,
    sosAvailable: r.sos_available,
    sosHours: sosHoursOf(r.sos_start, r.sos_end),
    isGovernment: r.is_government,
    costTier: r.is_government ? "free" : ((r.cost_tier as PublicVet["costTier"]) ?? null),
  };
}

/** Verified vets covering a ward, government first. */
export async function vetsForWard(wardId: string, limit = 8): Promise<PublicVet[]> {
  const res = await query<VetRow>(
    `${VET_SQL}
      WHERE v.status = 'verified' AND v.wards @> ARRAY[$1]::text[]
      ORDER BY is_government DESC, v.sos_available DESC, f.display_name
      LIMIT $2`,
    [wardId, limit],
  );
  return res.rows.map(publicVetOf);
}

/** Active NGOs covering a ward (or citywide). Paused NGOs are not listed (no routing either). */
export async function ngosForWard(wardId: string, limit = 5): Promise<PublicNgo[]> {
  const res = await query<{
    id: string;
    name: string;
    phone_e164: string | null;
    offers_ambulance: boolean;
    ambulance_count: number;
    ambulance_status: "in" | "out";
    offers_shelter: boolean;
    beds_free: number;
  }>(
    `SELECT id, name, phone_e164, offers_ambulance, ambulance_count, ambulance_status, offers_shelter, beds_free
       FROM ngos
      WHERE status = 'active' AND (citywide OR wards @> ARRAY[$1]::text[])
      ORDER BY citywide, name
      LIMIT $2`,
    [wardId, limit],
  );
  return res.rows.map((n) => ({
    id: n.id,
    name: n.name,
    publicPhone: n.phone_e164,
    hasAmbulance: n.offers_ambulance && n.ambulance_count > 0,
    ambulanceStatus: n.offers_ambulance && n.ambulance_count > 0 ? n.ambulance_status : null,
    bedsFree: n.offers_shelter ? n.beds_free : null,
    isGovernment: false as const,
  }));
}

export async function wardProfessionals(wardId: string | null | undefined): Promise<{ vets: PublicVet[]; ngos: PublicNgo[] }> {
  if (!wardId || !isBmcWardCode(wardId)) return { vets: [], ngos: [] };
  const [vets, ngos] = await Promise.all([vetsForWard(wardId), ngosForWard(wardId)]);
  return { vets, ngos };
}

export function wardCodeOf(wardId: string | null | undefined): string | null {
  return wardId ? wardDisplay(wardId).code : null;
}

export { VET_SQL };
export type { VetRow };
