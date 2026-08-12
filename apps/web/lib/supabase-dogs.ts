/**
 * Supabase read path for public dog data.
 *
 * These call the three signature-gated RPCs defined in
 * ops/supabase/03_hardening.sql rather than selecting from tables: every table
 * in `public` has RLS enabled with no anon policy, so a direct
 * `.from("dogs").select()` with the publishable key returns nothing. The RPCs
 * re-implement what the Fastify API enforced in code — HMAC signature check,
 * ward-level coordinate coarsening, verified/moderated filtering.
 *
 * Shapes match the DogProfile / MedicalRecord / Story types in lib/api.ts so
 * either data path can feed the same components.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DogProfile, DogStatus, MedicalRecord, Story } from "./api";

interface DogProfileRow {
  slug: string;
  name: string | null;
  status: string;
  ward_id: string;
  photo_key: string | null;
  abc_status: string | null;
  vaccine_status: string | null;
  micro_story: string | null;
  last_seen_at: string | null;
  lat: number | string | null;
  lng: number | string | null;
}

interface MedicalRow {
  record_type: string;
  vaccine_name: string | null;
  vaccine_date: string | null;
  abc_date: string | null;
  diagnosis: string | null;
  treatment: string | null;
  severity: string | null;
  created_at: string;
  hash_curr: string;
}

interface StoryRow {
  id: string;
  version: number;
  paragraph: string;
  moderated_at: string | null;
  created_at: string;
}

/** Postgres numeric arrives over PostgREST as a string to preserve precision. */
function toNum(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Public dog profile. Returns null when the slug does not exist OR the
 * signature is invalid — the RPC deliberately does not distinguish the two, so
 * random slugs cannot be enumerated (INVARIANT 1).
 */
export async function getDogProfile(
  supabase: SupabaseClient,
  slug: string,
  sig: string,
): Promise<DogProfile | null> {
  const { data, error } = await supabase.rpc("get_dog_profile", {
    p_slug: slug,
    p_sig: sig,
  });

  if (error) throw new Error(`get_dog_profile failed: ${error.message}`);

  const row = ((data ?? []) as DogProfileRow[])[0];
  if (!row) return null;

  const lat = toNum(row.lat);
  const lng = toNum(row.lng);

  return {
    slug: row.slug,
    name: row.name,
    status: row.status as DogStatus,
    wardId: row.ward_id,
    photoKey: row.photo_key,
    abcStatus: row.abc_status,
    vaccineStatus: row.vaccine_status,
    microStory: row.micro_story,
    lastSeenAt: row.last_seen_at,
    geo: lat !== null && lng !== null ? { lat, lng } : null,
  };
}

/** Verified medical records, newest first. */
export async function getDogMedical(
  supabase: SupabaseClient,
  slug: string,
  sig: string,
): Promise<MedicalRecord[]> {
  const { data, error } = await supabase.rpc("get_dog_medical", {
    p_slug: slug,
    p_sig: sig,
  });

  if (error) throw new Error(`get_dog_medical failed: ${error.message}`);
  return (data ?? []) as MedicalRow[] as MedicalRecord[];
}

/** Moderated micro-stories, newest first. */
export async function getDogStories(
  supabase: SupabaseClient,
  slug: string,
  sig: string,
): Promise<Story[]> {
  const { data, error } = await supabase.rpc("get_dog_stories", {
    p_slug: slug,
    p_sig: sig,
  });

  if (error) throw new Error(`get_dog_stories failed: ${error.message}`);

  return ((data ?? []) as StoryRow[]).map((r) => ({
    id: r.id,
    version: r.version,
    paragraph: r.paragraph,
    moderatedAt: r.moderated_at,
    createdAt: r.created_at,
  }));
}
