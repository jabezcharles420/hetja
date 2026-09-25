/**
 * Screen 03 (dog profile) plus the small shared bits every view uses: the
 * status pill, the icons, view switching and the toast.
 *
 * Design v4 (docs/design/v4-handoff, "03 Dog profile"): plain white, no
 * motion, the photo, the name and ward line, three status pills, the collar
 * code card, the story, and one red button pinned in the footer. Every pill
 * carries an icon AND words (hard rule 2); an unknown status is a neutral
 * "unknown" pill, never a blank.
 */
import type { DogCard, DogProfile } from "./api";
import {
  collarGroups,
  lastFedText,
  memorialLine,
  pronouns,
  sturdierLine,
  pastelIndex,
  PASTELS,
  possessive,
  sayCollarCode,
  wardLine,
  writtenByLine,
} from "./format";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/* ---------------------------------------------------------------------------
 * Icons: the exact paths from the handoff (StatusPill), 16x16 viewBox,
 * painted with currentColor. The alert "!" is drawn, not typed, so it cannot
 * fall back to a different font's glyph.
 * ------------------------------------------------------------------------- */
export type IconName = "check" | "clock" | "cross" | "alert";

export function icon(name: IconName, size = 16, stroke = 2.2): string {
  const inner =
    name === "check"
      ? `<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
      : name === "clock"
        ? '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
        : name === "cross"
          ? '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
          : '<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M8 4.2v4.6" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1.15" fill="#fff"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export type Tone = "ok" | "warn" | "neutral" | "danger";

/** StatusPill. `small` is the 32px size screen 05 uses. */
export function pill(tone: Tone, name: IconName, text: string, small = false): string {
  return `<span class="pill ${tone}${small ? " sm" : ""}">${icon(name, small && name === "clock" ? 14 : 16)}${escapeHtml(text)}</span>`;
}

/* ---------------------------------------------------------------------------
 * Views. The three screens are sections of one static page; switching is a
 * class toggle, not a navigation, so SOS never waits on a network round trip.
 * ------------------------------------------------------------------------- */
export type View = "profile" | "sos" | "sent" | "tag";
let current: View = "profile";

export function showView(v: View): void {
  current = v;
  for (const id of ["profile", "sos", "sent", "tag"] as const) $(`#v-${id}`).classList.toggle("hidden", id !== v);
  window.scrollTo(0, 0);
  // Move focus to the new screen's heading so a screen reader announces it.
  document.querySelector<HTMLElement>(`#v-${v} [data-focus]`)?.focus();
}

export function currentView(): View {
  return current;
}

export function setStatus(text: string): void {
  $("#status").textContent = text;
}

export function setSub(text: string): void {
  $("#sub").textContent = text;
}

/** A dog who has passed: the page stays, calm, with no feed or SOS actions. */
export function isMemorial(p: DogProfile): boolean {
  return p.status === "deceased";
}

export function renderProfile(p: DogProfile, stale: boolean): void {
  $("#state").classList.add("hidden");
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = buildProfile(p);
  $("#v-profile").classList.remove("mist");
  $("#main-foot").classList.toggle("hidden", isMemorial(p));
  if (isMemorial(p)) return;
  // A dog nobody feeds on Hetja has no feeders to alert; say only what happens.
  $("#cta-cap").textContent =
    p.feederCount === 0 ? "Alerts a vet nearby." : `Alerts ${possessive(p.name, p.sex)} feeders and a vet nearby.`;
  // Feeders who scan with the phone camera land here, not in the app: give
  // them a quiet way to log a feed. Signed-in only (same origin as the web
  // app, so its session key is readable). The SOS stays the one loud action.
  const feed = $<HTMLAnchorElement>("#feed-link");
  if (hasFeederSession()) {
    feed.href = `/feed?dog=${encodeURIComponent(p.slug)}`;
    feed.textContent = `Feeding ${p.name}? Log a feed ›`;
    feed.classList.remove("hidden");
  }
  const copy = app.querySelector<HTMLButtonElement>("#copy");
  copy?.addEventListener("click", () => void copyCode(p.slug, copy));
  if (stale) {
    setNote("You're offline. Showing a saved profile. Vaccination and sterilisation status may be outdated.");
  }
}

/**
 * N8 "No dog has this code." on the collar page. The rows always show; the
 * "Did you mean" card only when the lookup found a near miss.
 */
export function renderNotFound(code: string, suggestions: DogCard[]): void {
  $("#state").classList.add("hidden");
  $("#v-profile").classList.add("mist");
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = notFoundMarkup(code, suggestions);
  // The red button stays (a tampered QR can still belong to a real dog), but
  // with no known dog it can only promise what it will certainly do.
  $("#cta-cap").textContent = "Shows vets and NGOs near you.";
  // A code that is not even well-formed has nothing to report on (panel.ts
  // leaves the button disabled): hide it rather than show a dead red button.
  $("#main-foot").classList.toggle("hidden", $<HTMLButtonElement>("#primary-cta").disabled);
}

export function notFoundMarkup(code: string, suggestions: DogCard[]): string {
  const groups = collarGroups(code.slice(0, 12)).join(" ");
  const mail = `mailto:hello@hetja.in?subject=${encodeURIComponent("Tag looks fake")}&body=${encodeURIComponent(
    `Code on the tag: ${groups}`,
  )}`;
  const near = suggestions.length
    ? `<p class="lead">Two digits may be swapped. Did you mean this dog?</p><div class="card">${suggestions
        .map(suggestionRow)
        .join("")}</div>`
    : `<p class="lead">Check the collar and scan again.</p>`;
  return `
    <div class="nf-top"><a class="back" href="/scan">‹ Scan</a></div>
    ${groups ? `<p class="nf-code">${escapeHtml(groups)}</p>` : ""}
    <h1 class="title" tabindex="-1" data-focus>No dog has this code.</h1>
    ${near}
    <div class="card">
      ${navRow("/scan/code", "Type it again")}
      ${navRow("/scan/find", "Find by ward and photo")}
      ${navRow(mail, "Tag looks fake")}
    </div>`;
}

function navRow(href: string, text: string): string {
  return `<a class="nav" href="${escapeHtml(href)}"><span>${escapeHtml(text)}</span><span class="chev" aria-hidden="true">›</span></a>`;
}

function suggestionRow(c: DogCard): string {
  const name = c.name ?? "No name yet";
  const [bg, ink] = PASTELS[pastelIndex(c.slug)]!;
  const av = c.photoUrl
    ? `<img src="${escapeHtml(c.photoUrl)}" alt="" />`
    : `<span style="background:${bg};color:${ink}">${escapeHtml((name.charAt(0) || "?").toUpperCase())}</span>`;
  const meta = [collarGroups(c.slug).join(" "), c.wardCode || c.wardId].filter(Boolean).join(" · ");
  return `<a class="sugg" href="/d/${encodeURIComponent(c.slug)}"><span class="av">${av}</span><span class="gtx"><span class="row-t">${escapeHtml(
    name,
  )}</span><span class="sugg-m">${escapeHtml(meta)}</span></span><span class="chev" aria-hidden="true">›</span></a>`;
}

export function renderError(message: string): void {
  $("#state").classList.remove("hidden");
  const app = $("#profile");
  app.classList.add("hidden");
  app.innerHTML = "";
  $("#v-profile").classList.remove("mist");
  $("#main-foot").classList.remove("hidden");
  setStatus("Unavailable");
  setSub(message);
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

export function buildProfile(p: DogProfile): string {
  const ward = wardLine(p.wardId, p.wardName);
  const groups = collarGroups(p.slug);
  const pr = pronouns(p.sex);
  const head = `
    <div class="photo">${photoMarkup(p)}</div>
    <div class="name-blk">
      <h1 class="name" tabindex="-1" data-focus>${escapeHtml(p.name)}</h1>
      ${ward ? `<p class="ward">${escapeHtml(ward)}</p>` : ""}
      ${p.verified === false && !isMemorial(p) ? `<span class="badge">Unverified</span>` : ""}
    </div>`;
  if (isMemorial(p)) {
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
  return `${head}
    ${
      p.tagUnderReview
        ? `<div class="review" role="note">${icon("alert", 18)}<p><b>Tag under review</b><br>Someone said this tag is on a different dog. A feeder will check it. SOS still works.</p></div>`
        : ""
    }
    <div class="pills">${statusPills(p)}</div>
    <div class="code-card">
      <div class="code-row">
        <div class="code-col">
          <p class="label">Collar code</p>
          <p class="code">${groups.map((g) => `<span>${escapeHtml(g)}</span>`).join("")}</p>
        </div>
        <button type="button" id="copy" class="quiet">Copy</button>
      </div>
      <p class="say">Say it: ${escapeHtml(sayCollarCode(p.slug))}</p>
    </div>
    ${p.sturdierCollarSuggested ? `<p class="by">${escapeHtml(sturdierLine(p.name, pr))}</p>` : ""}
    ${storyMarkup(p)}
    <button type="button" id="tag-open" class="feedlink">Report a tag problem</button>
  `;
}

function statusPills(p: DogProfile): string {
  // The v4 fields when the API sends them, the legacy ones otherwise: a
  // vaccineStatus string only exists for a VERIFIED record (see api.ts).
  const vacc = p.vaccinated ?? (p.vaccine ? "yes" : "unknown");
  const ster = p.sterilised ?? legacySterilised(p.abcStatus);
  const out = [
    vacc === "yes" ? pill("ok", "check", "Vaccinated") : pill("neutral", "alert", "Vaccination unknown"),
    ster === "yes"
      ? pill("ok", "check", "Sterilised")
      : ster === "no"
        ? pill("neutral", "cross", "Not sterilised")
        : pill("neutral", "alert", "Sterilisation unknown"),
  ];
  if (p.lastFedAt === null) out.push(pill("neutral", "clock", "No feeds logged yet"));
  else if (p.lastFedAt) {
    const t = lastFedText(p.lastFedAt);
    if (t) out.push(pill("neutral", "clock", t));
  }
  return out.join("");
}

function legacySterilised(abc?: string): "yes" | "unknown" {
  const low = abc?.toLowerCase();
  return low === "sterilized" || low === "sterilised" || low === "done" || low === "abc_done" ? "yes" : "unknown";
}

function storyMarkup(p: DogProfile): string {
  if (p.microStory) {
    return `<p class="story">${escapeHtml(p.microStory)}</p><p class="by">${escapeHtml(
      writtenByLine(p.name, p.sex, p.storyAuthorCount),
    )}</p>`;
  }
  const who = possessive(p.name, p.sex);
  const by =
    p.feederCount === 0 ? "Nobody has written one yet." : `${who.charAt(0).toUpperCase()}${who.slice(1)} feeders haven't written one yet.`;
  return `<p class="story">No story yet.</p><p class="by">${escapeHtml(by)}</p>`;
}

function photoMarkup(p: DogProfile): string {
  if (p.photoUrl) return `<img src="${escapeHtml(p.photoUrl)}" alt="Photo of ${escapeHtml(p.name)}" />`;
  // DogAvatar fallback from the handoff: the dog's initial on its stable
  // pastel. No emoji and no image bytes on this hot path.
  const [bg, ink] = PASTELS[pastelIndex(p.slug)]!;
  const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
  return `<div class="initial" style="background:${bg};color:${ink}" role="img" aria-label="No photo of ${escapeHtml(
    p.name,
  )} yet">${escapeHtml(initial)}</div>`;
}

async function copyCode(slug: string, btn: HTMLButtonElement): Promise<void> {
  const text = collarGroups(slug).join(" ");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 2000);
  } catch {
    // No clipboard (http, old WebView): show the code so it can be read out.
    toast(`Collar code ${text}`);
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
