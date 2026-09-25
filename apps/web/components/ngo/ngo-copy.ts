/**
 * Words for the NGO portal (design v7, N1 to N5). Pure, so the tests can pin
 * the mock's copy: "SOS in your wards · 2", "3 of 12 free", "Vet · 1.2 km ·
 * free", "Send Dr. Qureshi", "✓ Collared · vaccinated", "Collar + rabies".
 */
import { wardDisplay } from "@hetja/contracts";
import type {
  DispatchCandidate,
  DriveDog,
  DriveTask,
  InviteRole,
  Ngo,
  NgoOffer,
  NgoRegType,
  NgoRole,
  NgoSosCase,
  TeamMember,
} from "./ngo-api";

export const OFFERS: { key: NgoOffer; label: string }[] = [
  { key: "ambulance", label: "Ambulance" },
  { key: "shelter_beds", label: "Shelter beds" },
  { key: "sterilisation", label: "Sterilisation" },
  { key: "collars", label: "Collars" },
];

export const REG_TYPES: { key: NgoRegType; label: string }[] = [
  { key: "trust", label: "Trust" },
  { key: "society", label: "Society" },
  { key: "section8", label: "Section 8 company" },
  { key: "other", label: "Other" },
];

export const ROLES: { key: NgoRole; label: string }[] = [
  { key: "coordinator", label: "Coordinator" },
  { key: "rescue", label: "Rescue" },
  { key: "collars", label: "Collars" },
  { key: "volunteer", label: "Volunteer" },
];

export const INVITE_ROLES: { key: InviteRole; label: string }[] = [...ROLES, { key: "vet", label: "Vet" }];

export function roleLabel(role: NgoRole): string {
  return ROLES.find((r) => r.key === role)?.label ?? "Volunteer";
}

export function regTypeLabel(t: NgoRegType): string {
  return REG_TYPES.find((r) => r.key === t)?.label ?? "Trust";
}

export function offerLabel(o: NgoOffer): string {
  return OFFERS.find((x) => x.key === o)?.label ?? o;
}

/** "K-West" -> "K/W". */
export function wardCodeOf(id: string): string {
  return wardDisplay(id).code || id;
}

/** "K/W, K/E". */
export function wardsLine(ids: readonly string[]): string {
  return ids.map(wardCodeOf).join(", ");
}

/** N2's kicker: "Andheri Paws Trust · K/W, K/E". */
export function ngoKicker(ngo: Pick<Ngo, "name" | "wards">): string {
  return ngo.wards.length ? `${ngo.name} · ${wardsLine(ngo.wards)}` : ngo.name;
}

/** "SOS in your wards · 2". */
export function sosLabel(n: number): string {
  return `SOS in your wards · ${n}`;
}

/** "40 min", "1 h 5 min", "3 h". */
export function waitWords(fromIso: string, now = Date.now()): string {
  const min = Math.max(1, Math.round((now - Date.parse(fromIso)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h`;
}

/** The case's headline: "Moti is limping badly", else "Moti needs help". */
export function caseTitle(c: Pick<NgoSosCase, "title" | "dogName">): string {
  if (c.title && c.title.trim()) return c.title.trim();
  return c.dogName ? `${c.dogName} needs help` : "A dog needs help";
}

/** The line under an SOS row. */
export function caseSub(c: NgoSosCase): string {
  const place = c.locality ?? (c.wardId ? `${wardCodeOf(c.wardId)} ward` : null);
  if (c.state === "unassigned") return [place, "nobody assigned"].filter(Boolean).join(" · ");
  const who = c.assignee ? `${c.assignee.name}${c.assignee.ambulance ? " + ambulance" : ""}` : null;
  if (c.state === "sent") return [who ? `Sent ${who}` : "Sent", "waiting for a yes"].join(" · ");
  if (c.state === "with_dog") return [who, "with the dog"].filter(Boolean).join(" · ");
  const eta = typeof c.etaMin === "number" ? `ETA ${Math.max(1, Math.round(c.etaMin))} min` : null;
  return [who, eta].filter(Boolean).join(" · ") || "Someone is going";
}

/** The trailing status word on a covered case. */
export function caseStatus(c: NgoSosCase): string {
  if (c.state === "sent") return "Asked";
  if (c.state === "with_dog") return "With the dog";
  return "On the way";
}

/** "3 of 12 free". */
export function bedsLine(beds: { free: number; total: number } | null | undefined): string {
  if (!beds) return "Not set";
  return `${beds.free} of ${beds.total} free`;
}

/** "3 vets · 11 volunteers". */
export function teamLine(t: { vets: number; volunteers: number }): string {
  const v = t.vets === 1 ? "1 vet" : `${t.vets} vets`;
  const m = t.volunteers === 1 ? "1 volunteer" : `${t.volunteers} volunteers`;
  return `${v} · ${m}`;
}

/** "412 · 38 unsterilised". */
export function dogsLine(d: { total: number; unsterilised: number }): string {
  return `${new Intl.NumberFormat("en-IN").format(d.total)} · ${d.unsterilised} unsterilised`;
}

const KOLKATA = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Sep", Asia/Kolkata. */
export function dayMonth(iso: string): string {
  const dp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: KOLKATA }).formatToParts(new Date(iso));
  const dayNum = dp.find((p) => p.type === "day")?.value ?? "";
  const month = MONTHS[Number(dp.find((p) => p.type === "month")?.value ?? 1) - 1] ?? "";
  return `${dayNum} ${month}`;
}

/** "Sat", Asia/Kolkata. */
export function weekday(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: KOLKATA }).format(new Date(iso));
}

/** "Sat, Aram Nagar". */
export function nextDriveLine(d: { place: string; startsAt: string } | null): string {
  return d ? `${weekday(d.startsAt)}, ${d.place}` : "None planned";
}

/** "Sat 27 Sep · 7am". */
export function driveWhen(iso: string): string {
  const d = new Date(iso);
  // Parts, not the formatted string: some ICU builds write "Sept".
  const day = `${weekday(iso)} ${dayMonth(iso)}`;
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: KOLKATA })
    .formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const ap = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  return `${day} · ${h}${m === "00" ? "" : `:${m}`}${ap}`;
}

/** "Dr. Farhan Qureshi" -> "Dr. Qureshi"; "Rahul M." -> "Rahul". */
export function shortName(name: string): string {
  const n = name.trim();
  const dr = /^Dr\.?\s+/i.exec(n);
  if (dr) {
    const rest = n.slice(dr[0].length).trim().split(/\s+/);
    return `Dr. ${rest[rest.length - 1]}`;
  }
  return n.split(/\s+/)[0] ?? n;
}

/** N5's sub-line: "Sat 27 Sep · 7am · Dr. Pillai, 4 volunteers". */
export function driveSub(d: { startsAt: string; leadVet: { name: string } | null; volunteerCount: number }): string {
  const vols = d.volunteerCount === 1 ? "1 volunteer" : `${d.volunteerCount} volunteers`;
  const who = [d.leadVet ? shortName(d.leadVet.name) : null, d.volunteerCount ? vols : null].filter(Boolean).join(", ");
  return [driveWhen(d.startsAt), who].filter(Boolean).join(" · ");
}

/** "1.2 km", "800 m". */
export function distanceWords(m: number | null | undefined): string | null {
  if (typeof m !== "number" || !Number.isFinite(m)) return null;
  // The board's "0.8 km": kilometres to one place, never less than 0.1.
  return `${Math.max(0.1, Math.round(m / 100) / 10).toFixed(1)} km`;
}

/** "Out on Laali's case": the API's words when it sends a sentence, else built from the dog's name. */
export function busyWords(busyWith: string | null | undefined, verb: "Out" | "On"): string {
  const b = busyWith?.trim();
  if (!b) return verb === "Out" ? "Out on a case" : "On another case";
  if (/case\b/i.test(b) || /^(out|on)\b/i.test(b)) return b;
  return `${verb} on ${b}'s case`;
}

/** N3 row title: "Dr. Farhan Qureshi", "Rahul (volunteer)", "Ambulance". */
export function candidateTitle(c: DispatchCandidate): string {
  if (c.kind === "volunteer") return `${shortName(c.name)} (volunteer)`;
  return c.name;
}

/** N3 row sub: "Vet · 1.2 km · free", "Has transport · 0.8 km", "Out on Laali's case". */
export function candidateSub(c: DispatchCandidate): string {
  const dist = distanceWords(c.distanceM);
  if (c.kind === "ambulance") {
    if (c.busy) return busyWords(c.busyWith, "Out");
    return "In · goes with whoever you send";
  }
  if (c.busy) {
    return [c.kind === "vet" ? "Vet" : null, busyWords(c.busyWith, "On")].filter(Boolean).join(" · ");
  }
  if (c.kind === "vet") return ["Vet", dist, c.free === false ? null : "free"].filter(Boolean).join(" · ");
  return [c.hasTransport ? "Has transport" : "No transport", dist].filter(Boolean).join(" · ");
}

/** N3's button: "Send Dr. Qureshi", "Send Rahul + ambulance". */
export function sendLabel(person: DispatchCandidate | null, ambulance: boolean): string {
  if (!person) return "Pick who's going";
  return `Send ${shortName(person.name)}${ambulance ? " + ambulance" : ""}`;
}

/** N3's note: "Sneha will see who's coming and their ETA. If nobody accepts in 15 min, ..." */
export function dispatchNote(reporterName: string | null): string {
  const who = reporterName?.trim() ? reporterName.trim() : "Whoever raised it";
  return `${who} will see who's coming and their ETA. If nobody accepts in 15 min, the case opens to all vets nearby.`;
}

/** N4 trailing text for a volunteer: "Coordinator", "Rescue · has transport". */
export function memberRoleLine(m: Pick<TeamMember, "role" | "hasTransport">): string {
  return m.hasTransport ? `${roleLabel(m.role)} · has transport` : roleLabel(m.role);
}

const DONE_WORD: Record<DriveTask, string> = { collar: "collared", vaccinate: "vaccinated", sterilise: "sterilised" };
const TODO_WORD: Record<DriveTask, string> = { collar: "Collar", vaccinate: "rabies", sterilise: "Sterilise" };

export function pendingTasks(d: DriveDog): DriveTask[] {
  return d.tasks.filter((t) => !d.done.includes(t));
}

/** N5 row: "✓ Collared · vaccinated" when all done, "Sterilise · to clinic", "Collar + rabies". */
export function driveDogLine(d: DriveDog): { text: string; done: boolean } {
  const todo = pendingTasks(d);
  if (todo.length === 0) {
    const words = d.done.map((t) => DONE_WORD[t]).join(" · ");
    return { text: `✓ ${words.charAt(0).toUpperCase()}${words.slice(1)}`, done: true };
  }
  if (todo.includes("sterilise")) return { text: "Sterilise · to clinic", done: false };
  const words = todo.map((t) => TODO_WORD[t]).join(" + ");
  return { text: `${words.charAt(0).toUpperCase()}${words.slice(1)}`, done: false };
}

/** "18 dogs listed / 7 need sterilising". */
export function driveCounts(dogs: DriveDog[]): { listed: number; sterilise: number } {
  return {
    listed: dogs.length,
    sterilise: dogs.filter((d) => d.tasks.includes("sterilise") && !d.done.includes("sterilise")).length,
  };
}

/** "15 more", "8 more". */
export function moreLine(n: number): string {
  return `${n} more`;
}

/** An Indian mobile or landline in E.164 (+91 and 10 digits), or null. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const d = digits.startsWith("+") ? digits.slice(1) : digits;
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  if (/^0?\d{10}$/.test(d)) return `+91${d.replace(/^0/, "")}`;
  return null;
}

/** "+91 98200 12231". */
export function phoneWords(e164: string | null | undefined): string {
  if (!e164) return "Not set";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/**
 * The vet builder's V3 signing route (app/vet/dogs/[slug]/sign, which reads
 * `kind`, `request` and `note`). Vaccinations the lead vet logs on a drive
 * (N5) are signed there, so a drive never writes an unsigned vaccination.
 * `drive` is passed for when V3 links the signed record back to the drive;
 * the page ignores it today.
 */
export function vetSignHref(slug: string, driveId?: string): string {
  const q = new URLSearchParams({ kind: "vaccination" });
  if (driveId) q.set("drive", driveId);
  return `/vet/dogs/${encodeURIComponent(slug)}/sign?${q.toString()}`;
}

/**
 * N5: a dog registered on the drive whose collar is not tied on yet. Print
 * it (P5), then open its registration (P1) to scan it once it is on.
 */
export function collarActions(d: DriveDog): { print: string; activate: string } | null {
  if (!d.pendingActivation || !d.tasks.includes("collar") || d.done.includes("collar")) return null;
  const s = encodeURIComponent(d.slug);
  return { print: `/register/${s}/print`, activate: `/register/${s}` };
}

/** N5's note, with the lead vet's pronoun when the API knows it. */
export function driveNote(leadVet: { name: string; pronoun?: string | null } | null): string {
  const head = "Feeders of these dogs get a heads-up the day before so they can help find them.";
  if (!leadVet) return `${head} Add a lead vet to sign vaccinations.`;
  const who = shortName(leadVet.name);
  const tail =
    leadVet.pronoun === "her"
      ? "as she goes"
      : leadVet.pronoun === "him"
        ? "as he goes"
        : "there and then";
  return `${head} Vaccinations ${who} logs here are signed ${tail}.`;
}
