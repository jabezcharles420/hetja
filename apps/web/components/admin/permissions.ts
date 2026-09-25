/**
 * Who sees what (CONTRACT.md "Roles and access", A6 "Roles"), read from the
 * permissions GET /admin/me returns (lib/api AdminPermission). The API
 * enforces the same map and audits every write; the portal only hides what a
 * role cannot do, so nobody meets a 403 halfway through a task.
 *
 *   owner          every permission
 *   moderator      vets, ngos, dogs, merge, feeders, collars, sos, reports, audit, settings
 *   avatar_editor  avatars, dogs (read, for matching), settings
 *   ward_lead      collars, sos, dogs (read), settings: in their wards only
 *   "vets_remove", "ngos_remove" and "team" are the owner's alone.
 */
import type { AdminMe, AdminPermission } from "@/lib/api";

export type Section =
  | "today"
  | "vets"
  | "ngos"
  | "dogs"
  | "avatars"
  | "feeders"
  | "collars"
  | "sos"
  | "reports"
  | "team"
  | "audit"
  | "settings";

/** The permission that opens each sidebar section. Today is everyone's. */
const SECTION_PERMISSION: Record<Exclude<Section, "today">, AdminPermission> = {
  vets: "vets",
  ngos: "ngos",
  dogs: "dogs",
  avatars: "avatars",
  feeders: "feeders",
  collars: "collars",
  sos: "sos",
  reports: "reports",
  team: "team",
  audit: "audit",
  settings: "settings",
};

type Who = Pick<AdminMe, "permissions" | "roles">;

export function canSee(me: Who, section: Section): boolean {
  if (section === "today") return true;
  return me.permissions.includes(SECTION_PERMISSION[section]);
}

/** A write the role may make. Dog status and merges are moderator work ("merge"). */
export function can(me: Who, permission: AdminPermission): boolean {
  return me.permissions.includes(permission);
}

export function isAdmin(me: Partial<Who> | null | undefined): boolean {
  return !!me?.roles?.length;
}
