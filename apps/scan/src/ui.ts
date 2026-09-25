/**
 * The dog profile plus the small shared bits every view uses: the status
 * pill, the icons, view switching, the bottom sheet and the toast.
 *
 * Design v6 (docs/design/v6-handoff): V15 "You found Rani." with her feeders
 * by first name, V16 the invitation when nobody feeds the dog, V17 the saved
 * copy offline, P8 an unknown collar (SOS stays live), and D2 a dog's link
 * opened on a desktop. v5 states stay: Unverified, Tag under review, the
 * sturdier-collar line and the memorial page. Plain white, no motion. Every
 * pill carries an icon AND words; an unknown status is a neutral "unknown"
 * pill, never a blank.
 */
import type { DogProfile } from "./api";
import {
  clock,
  collarGroups,
  dayWord,
  feederLine,
  helpCap,
  lastFedText,
  memorialLine,
  pronouns,
  sturdierLine,
  pastelIndex,
  PASTELS,
  sayCollarCode,
  wardLine,
} from "./format";
import { qrSvg } from "./qr";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/* ---------------------------------------------------------------------------
 * Icons: the exact paths from the handoff (StatusPill), 16x16 viewBox,
 * painted with currentColor. The alert "!" is drawn, not typed, so it cannot
 * fall back to a different font's glyph.
 * ------------------------------------------------------------------------- */
export type IconName = "check" | "clock" | "cross" | "alert" | "pin";

export function icon(name: IconName, size = 16, stroke = 2.2): string {
  const inner =
    name === "check"
      ? `<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
      : name === "clock"
        ? '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
        : name === "cross"
          ? '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
          : name === "pin"
            ? '<g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 14.5s5-4.3 5-8.2A5 5 0 0 0 3 6.3c0 3.9 5 8.2 5 8.2z"/><circle cx="8" cy="6.3" r="1.8"/></g>'
            : '<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M8 4.2v4.6" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1.15" fill="#fff"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export type Tone = "ok" | "warn" | "neutral" | "danger";

/** StatusPill. `small` is the 32px size screen 05 uses. */
export function pill(tone: Tone, name: IconName, text: string, small = false): string {
  return `<span class="pill ${tone}${small ? " sm" : ""}">${icon(name, small && name === "clock" ? 14 : 16)}${escapeHtml(text)}</span>`;
}

/* ---------------------------------------------------------------------------
 * Views. The screens are sections of one static page; switching is a class
 * toggle, not a navigation, so SOS never waits on a network round trip. On
 * a desktop (D2) the profile view is the wide "desk" view instead.
 * ------------------------------------------------------------------------- */
export type View = "profile" | "sos" | "sent" | "tag" | "desk";
let current: View = "profile";

export function showView(v: View): void {
  if (v === "profile" && document.body.classList.contains("desk")) v = "desk";
  current = v;
  for (const id of ["profile", "sos", "sent", "tag", "desk"] as const) $(`#v-${id}`).classList.toggle("hidden", id !== v);
  window.scrollTo(0, 0);
  // Move focus to the new screen's heading so a screen reader announces it.
  document.querySelector<HTMLElement>(`#v-${v} [data-focus]`)?.focus();
}

export function currentView(): View {
  return current;
}

/** A dog who has passed: the page stays, calm, with no feed or SOS actions. */
export function isMemorial(p: DogProfile): boolean {
  return p.status === "deceased";
}

function setCta(label: string, capText: string): void {
  $("#cta-t").textContent = label;
  $("#cta-cap").textContent = capText;
}

export function renderProfile(p: DogProfile, stale: boolean): void {
  $("#state").classList.add("hidden");
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = buildProfile(p, stale);
  $("#main-foot").classList.toggle("hidden", isMemorial(p));
  if (isMemorial(p)) return;
  setCta(`${p.name} needs help`, stale ? "Works offline." : helpCap(p));
  // Feeders who scan with the phone camera land here, not in the app: give
  // them a quiet way to log a feed. Signed-in only (same origin as the web
  // app, so its session key is readable). The SOS stays the one loud action.
  const feed = $<HTMLAnchorElement>("#feed-link");
  if (hasFeederSession()) {
    feed.href = feedHref(p.slug);
    feed.textContent = `Feeding ${p.name}? Log a feed ›`;
    feed.classList.remove("hidden");
  }
  const copy = app.querySelector<HTMLButtonElement>("#copy");
  copy?.addEventListener("click", () => void copyText(collarGroups(p.slug).join(" "), copy));
}

const feedHref = (slug: string): string => `/feed?dog=${encodeURIComponent(slug)}`;

/**
 * P8 "Hetja doesn't know this collar." The red button stays live: with no
 * dog it becomes a dogless SOS to the visitor's ward (sos.ts).
 */
export function renderUnknown(code: string): void {
  $("#state").classList.add("hidden");
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = unknownMarkup(code);
  $("#main-foot").classList.remove("hidden");
  setCta("This dog needs help", "Alerts vets and feeders in your ward. No code needed.");
}

export function unknownMarkup(code: string): string {
  return `<div class="p8">
    <h1 class="title" tabindex="-1" data-focus>Hetja doesn't know this collar.</h1>
    <p class="lead2">It may be new and not switched on yet, or a letter was misread. The dog is still someone's.</p>
    ${code ? `<div class="code-card"><p class="label">You scanned</p>${codeSpans(code.slice(0, 12))}</div>` : ""}
    <div class="card line">
      <a class="nav" href="/scan/code"><span>Type the code again</span>${CHEV}</a>
      <a class="nav" href="/scan/find"><span class="gtx"><span>Find the dog by photo</span><span class="g-s">Dogs in the ward you're in</span></span>${CHEV}</a>
    </div></div>`;
}

const CHEV = '<span class="chev" aria-hidden="true">›</span>';

function codeSpans(code: string): string {
  return `<p class="code">${collarGroups(code)
    .map((g) => `<span>${escapeHtml(g)}</span>`)
    .join("")}</p>`;
}

export function renderError(message: string): void {
  const st = $("#state");
  st.classList.remove("hidden");
  st.innerHTML = `<p class="title">Unavailable</p><p class="lead">${escapeHtml(message)}</p>`;
  const app = $("#profile");
  app.classList.add("hidden");
  app.innerHTML = "";
  $("#main-foot").classList.remove("hidden");
}

export function setNote(text: string): void {
  $("#note").innerHTML = `<p class="banner">${escapeHtml(text)}</p>`;
}

export function clearNote(): void {
  $("#note").innerHTML = "";
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, ms = 4000): void {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

/* ---------------------------------------------------------------------------
 * Bottom sheet (F4 tag problems, N12 location ask, N10 update). One at a
 * time, over a view made inert while it is open.
 * ------------------------------------------------------------------------- */
let under: HTMLElement | undefined;
let returnFocus: HTMLElement | null = null;

export function openSheet(html: string, underView: string, onScrim: () => void): void {
  const el = $("#sheet");
  returnFocus = document.activeElement as HTMLElement | null;
  el.innerHTML = `<div class="scrim" id="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t"><span class="grab" aria-hidden="true"></span>${html}</div>`;
  el.classList.remove("hidden");
  under = $(underView);
  under.inert = true;
  $("#scrim").addEventListener("click", onScrim);
  $("#sheet-t").focus();
}

export function closeSheet(): void {
  const el = $("#sheet");
  if (el.classList.contains("hidden")) return;
  el.classList.add("hidden");
  el.innerHTML = "";
  if (under) under.inert = false;
  returnFocus?.focus();
}

export function sheetOpen(): boolean {
  return !$("#sheet").classList.contains("hidden");
}

/* ---------------------------------------------------------------------------
 * Profile (V15, V16, V17 and the v5 states).
 * ------------------------------------------------------------------------- */

export function buildProfile(p: DogProfile, stale = false, now: number = Date.now()): string {
  const ward = wardLine(p.wardId, p.wardName);
  const pr = pronouns(p.sex);
  const mem = isMemorial(p);
  const saved = stale ? p.savedAt : undefined;
  const head = `
    <div class="photo">${photoMarkup(p)}${
      stale ? `<span class="saved">${icon("clock", 14)}${saved ? `Saved ${dayWord(saved, now)}, ${clock(saved)}` : "Saved copy"}</span>` : ""
    }</div>
    <div class="name-blk">
      ${mem ? "" : `<p class="label">You found</p>`}
      <h1 class="name" tabindex="-1" data-focus>${escapeHtml(mem ? p.name : `${p.name}.`)}</h1>
      ${ward ? `<p class="ward">${escapeHtml(ward)}</p>` : ""}
      ${p.verified === false && !mem ? `<span class="badge">Unverified</span>` : ""}
    </div>`;
  if (mem) {
    const names = p.memorial?.feederNames ?? [];
    return `${head}
    <p class="lead">${escapeHtml(memorialLine(p.name, pr))}</p>
    ${
      names.length
        ? `<div class="code-card"><p class="label">Fed by</p><ul class="names">${names
            .map((n) => `<li>${escapeHtml(n)}</li>`)
            .join("")}</ul></div>`
        : ""
    }
    ${p.microStory ? `<p class="story">${escapeHtml(p.microStory)}</p>` : ""}`;
  }
  const asOf = saved ? `, as of ${dayWord(saved, now)}` : "";
  const line = p.feederCount === undefined ? undefined : feederLine(p.name, p, now);
  return `${head}
    ${
      p.tagUnderReview
        ? `<div class="review" role="note">${icon("alert", 18)}<p><b>Tag under review</b><br>Someone said this tag is on a different dog. A feeder will check it. SOS still works.</p></div>`
        : ""
    }
    <div class="pills">${statusPills(p, asOf, p.feederCount === undefined)}</div>
    ${stale ? `<p class="by">You're offline, so this is the last copy your phone saw. The SOS button still works. It sends when there's signal, or by text.</p>` : ""}
    ${
      p.feederCount === 0
        ? `<div class="invite"><p class="inv-t">${escapeHtml(`Nobody feeds ${p.name} on Hetja yet.`)}</p><p class="inv-s">${escapeHtml(
            `If you give ${p.name} a biscuit on your way to work, that counts. Become ${pr.poss} first feeder and ${pr.poss} page will say so.`,
          )}</p><a class="inv-l" href="${feedHref(p.slug)}">${escapeHtml(`I feed ${p.name} ›`)}</a></div>`
        : line
          ? `<div class="fcard">${avatars(p.feederNames ?? [])}<p>${escapeHtml(line)}</p></div>`
          : ""
    }
    ${p.sturdierCollarSuggested ? `<p class="by">${escapeHtml(sturdierLine(p.name, pr))}</p>` : ""}
    ${p.microStory ? `<p class="story">${escapeHtml(p.microStory)}</p>` : ""}
    ${
      // The big code card stays for feeders; a stranger rarely needs it (V15).
      hasFeederSession()
        ? `<div class="code-card"><div class="code-row"><div class="code-col"><p class="label">Collar code</p>${codeSpans(
            p.slug,
          )}</div><button type="button" id="copy" class="quiet">Copy</button></div><p class="say">Say it: ${escapeHtml(
            sayCollarCode(p.slug),
          )}</p></div>`
        : `<p class="cline">Collar ${escapeHtml(collarGroups(p.slug).join(" "))} · <button type="button" id="copy" class="clink">Copy</button></p>`
    }
    <button type="button" id="tag-open" class="feedlink">Report a tag problem</button>
  `;
}

/** Overlapping first-name initials (V15), at most three. */
function avatars(names: string[]): string {
  return names.length
    ? `<span class="avs" aria-hidden="true">${names
        .slice(0, 3)
        .map((n) => `<span>${escapeHtml(n.charAt(0).toUpperCase())}</span>`)
        .join("")}</span>`
    : "";
}

function statusPills(p: DogProfile, asOf = "", withFed = true): string {
  // The v4 fields when the API sends them, the legacy ones otherwise: a
  // vaccineStatus string only exists for a VERIFIED record (see api.ts).
  const vacc = p.vaccinated ?? (p.vaccine ? "yes" : "unknown");
  const ster = p.sterilised ?? legacySterilised(p.abcStatus);
  const out = [
    vacc === "yes" ? pill("ok", "check", `Vaccinated${asOf}`) : pill("neutral", "alert", "Vaccination unknown"),
    ster === "yes"
      ? pill("ok", "check", `Sterilised${asOf}`)
      : ster === "no"
        ? pill("neutral", "cross", "Not sterilised")
        : pill("neutral", "alert", "Sterilisation unknown"),
  ];
  // v6 moves "Last fed" into the feeder line; an older API without feeder
  // counts (and the desktop D2) keep the pill.
  if (withFed && p.lastFedAt) {
    const t = lastFedText(p.lastFedAt);
    if (t) out.push(pill("neutral", "clock", t));
  }
  return out.join("");
}

function legacySterilised(abc?: string): "yes" | "unknown" {
  const low = abc?.toLowerCase();
  return low === "sterilized" || low === "sterilised" || low === "done" || low === "abc_done" ? "yes" : "unknown";
}

export function photoMarkup(p: { slug: string; name: string; photoUrl?: string }): string {
  if (p.photoUrl) return `<img src="${escapeHtml(p.photoUrl)}" alt="Photo of ${escapeHtml(p.name)}" />`;
  // DogAvatar fallback from the handoff: the dog's initial on its stable
  // pastel. No emoji and no image bytes on this hot path.
  const [bg, ink] = PASTELS[pastelIndex(p.slug)]!;
  const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
  return `<div class="initial" style="background:${bg};color:${ink}" role="img" aria-label="No photo of ${escapeHtml(
    p.name,
  )} yet">${escapeHtml(initial)}</div>`;
}

/* ---------------------------------------------------------------------------
 * D2: a dog's link opened on a desktop (wider than 744 px). The dog, a QR
 * handoff to the phone, and SOS still one click away (the SOS form itself
 * is the mobile one centred at 480 px).
 * ------------------------------------------------------------------------- */

export const isDesk = (): boolean => matchMedia("(min-width: 745px)").matches;

export function deskMarkup(p: DogProfile, url: string): string {
  const pr = pronouns(p.sex);
  const n = p.feederCount;
  const ward = [wardLine(p.wardId, p.wardName), n ? `fed by ${n === 1 ? "1 person" : `${n} people`}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `<header class="dk-h"><span class="dk-dot"></span>Hetja</header>
  <div class="dk">
    <div class="dk-l">
      <div class="photo dk-ph">${photoMarkup(p)}</div>
      <div class="name-blk"><h1 class="dk-n" tabindex="-1" data-focus>${escapeHtml(`${p.name} is on Hetja.`)}</h1><p class="dk-w">${escapeHtml(ward)}</p></div>
      <div class="pills">${statusPills(p)}</div>
    </div>
    <div class="dk-r">
      <p class="dk-t">Standing next to ${pr.obj}?<br>Use your phone.</p>
      <div class="dk-q">${qrSvg(url)}<p class="lead">${escapeHtml(
        `Scan to open ${p.name}'s page on your phone. It can share your location with whoever comes to help.`,
      )}</p></div>
      <div class="dk-s"><p>${escapeHtml(
        `${pr.subj === "they" ? "Are" : "Is"} ${pr.subj} hurt right now? You can still raise an SOS from here.`,
      )}</p><button type="button" class="btn sos dk-b" id="dk-sos">${icon("alert", 20)}${escapeHtml(`${p.name} needs help`)}</button></div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------------- */

/** Copies text, and says so on the button. No clipboard (http, old WebView): a toast. */
export async function copyText(text: string, btn: HTMLButtonElement, fail = `Collar code ${text}`): Promise<void> {
  const was = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = was), 2000);
  } catch {
    toast(fail);
  }
}

/** True when this browser holds a web-app feeder session (apps/web lib/api.ts
 * ACCESS_TOKEN_KEY). Storage can throw (private mode, blocked site data). */
export function hasFeederSession(): boolean {
  try {
    return !!localStorage.getItem("hetja.accessToken");
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}
