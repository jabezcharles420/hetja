/**
 * Which tab bar a feeder gets (design v7 owner decision, "Role tab bars"):
 *
 *   everyone        Home, Map, Scan, Me
 *   verified vet    Home, Map, Vet, Me   (Scan moves inside the Vet tab)
 *   NGO member      Home, Map, NGO, Me   (Scan moves inside the NGO tab)
 *   both            the NGO tab, with the vet tools inside it
 *
 * The role comes from GET /feeders/me (`vet`, `ngo`). It is kept on this phone so the tab
 * bar is right on first paint, refreshed once per session, and cleared on
 * sign out. Hetja's API decides what a vet or NGO member may do; this only
 * picks the tabs.
 */
import type { FeederMe, NgoStatus, VetStatus } from "@/lib/api";

export type TabRole = "vet" | "ngo" | null;

export const TAB_ROLE_KEY = "hetja:tab-role";
export const TAB_ROLE_EVENT = "hetja:tab-role";

/**
 * GET /feeders/me (v7): the Vet tab for `vet.status === "verified"`, the NGO
 * tab for `ngo.status` "active" or "paused" (pausing only stops SOS routing,
 * A7; the NGO portal shows a "Paused by Hetja" banner). Both: NGO.
 */
export function tabRoleFor(me: Pick<FeederMe, "vet" | "ngo"> | null | undefined): TabRole {
  if (!me) return null;
  if (me.ngo?.status === "active" || me.ngo?.status === "paused") return "ngo";
  if (me.vet?.status === "verified") return "vet";
  return null;
}

export function readTabRole(): TabRole {
  try {
    const v = localStorage.getItem(TAB_ROLE_KEY);
    return v === "vet" || v === "ngo" ? v : null;
  } catch {
    return null;
  }
}

export function saveTabRole(role: TabRole): void {
  try {
    if (role) localStorage.setItem(TAB_ROLE_KEY, role);
    else localStorage.removeItem(TAB_ROLE_KEY);
  } catch {
    /* storage blocked: the default tabs show, which is always safe */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TAB_ROLE_EVENT));
}

/** Save the role from a /feeders/me response. */
export function rememberTabRole(me: Pick<FeederMe, "vet" | "ngo"> | null | undefined): void {
  const next = tabRoleFor(me);
  if (next !== readTabRole()) saveTabRole(next);
}

export type PortalKind = "vet" | "ngo";

const STATUS_WORDS: Record<VetStatus | NgoStatus, string> = {
  invited: "Invited",
  waiting: "Waiting",
  more_info: "Asked for more",
  verified: "Verified",
  active: "Active",
  declined: "Declined",
  suspended: "Suspended",
  removed: "Removed",
  paused: "Paused",
};

/**
 * Me's "Sign records as a vet" / "Bring your NGO to Hetja" rows: null when
 * there is no application yet, "done" once verified or active (the Vet or NGO
 * tab takes over and the row goes), else the status in words ("Waiting").
 */
export function portalStatus(
  me: Pick<FeederMe, "vet" | "ngo"> | null | undefined,
  kind: PortalKind,
): null | "done" | string {
  const status = kind === "vet" ? me?.vet?.status : me?.ngo?.status;
  if (!status) return null;
  if ((kind === "vet" && status === "verified") || (kind === "ngo" && (status === "active" || status === "paused"))) {
    return "done";
  }
  return STATUS_WORDS[status] ?? null;
}
