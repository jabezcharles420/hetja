import type { DogProfile } from "./api";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/* ---------------------------------------------------------------------------
 * Web Speech (Phase 0 of the enhancement stack, §E.7 / §M.9).
 * Zero-dependency native speechSynthesis: closes the illiterate-user gap on
 * the scan page. Honesty rule: the Listen button only exists when the
 * browser actually supports speechSynthesis.
 * ------------------------------------------------------------------------- */
const SPEECH_SUPPORTED = typeof window !== "undefined" && "speechSynthesis" in window;

function stopSpeech(): void {
  if (SPEECH_SUPPORTED) window.speechSynthesis.cancel();
}

function speakDog(p: DogProfile): void {
  if (!SPEECH_SUPPORTED) return;
  const bits = [
    `This dog is named ${p.name}.`,
    p.sex ? `${p.sex}.` : "",
    p.approxAge !== undefined ? `Around ${p.approxAge} years old.` : "",
    // `p.vaccine` is a VaccineStatus OBJECT, not a string. Interpolating it
    // directly made the page read "Vaccination: object Object." aloud — and a
    // template literal accepts any type, so TypeScript never objected. This is
    // the accessibility affordance for a non-literate bystander on a
    // life-safety page, so it is the one place where the spoken text is the
    // whole feature.
    p.vaccine
      ? p.vaccine.upToDate
        ? "Vaccination is up to date."
        : "Vaccination status is not confirmed."
      : "",
    p.abcStatus ? `Sterilisation: ${p.abcStatus}.` : "",
    p.microStory ?? "",
    "If this dog is hurt, press the red button to alert nearby responders.",
  ].filter(Boolean);
  const utterance = new SpeechSynthesisUtterance(bits.join(" "));
  utterance.lang = "en-IN";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

const CHECK_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function setStatus(text: string): void {
  $("#status").textContent = text;
}

export function setSub(text: string): void {
  $("#sub").textContent = text;
}

export function renderProfile(p: DogProfile, stale: boolean): void {
  $("#state").classList.add("hidden");
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = buildCard(p, stale);
  if (SPEECH_SUPPORTED) {
    stopSpeech();
    app.querySelector<HTMLButtonElement>(".listen")?.addEventListener("click", () => speakDog(p));
  }
  if (stale) {
    setNote("You're offline — showing a saved profile. Vaccination and ABC status may be outdated.");
  }
}

export function renderError(message: string): void {
  if (SPEECH_SUPPORTED) stopSpeech();
  $("#state").classList.remove("hidden");
  const app = $("#profile");
  app.classList.add("hidden");
  app.innerHTML = "";
  setStatus("Unavailable");
  setSub(message);
}

export function setNote(html: string): void {
  $("#note").innerHTML = `<p class="banner">${html}</p>`;
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

function buildCard(p: DogProfile, stale: boolean): string {
  const metaBits = [p.sex, p.approxAge !== undefined ? `~${p.approxAge}y` : undefined, p.coatPattern]
    .filter((s): s is string => !!s)
    .join(" · ");
  const abc = fmtAbc(p.abcStatus);
  const vaccine = fmtVaccine(p.vaccine);
  const lastSeen = p.lastSeenAt
    ? `<div class="fr-row"><span>Last seen</span><span>${escapeHtml(p.lastSeenAt)}</span></div>`
    : "";
  const story = p.microStory
    ? escapeHtml(p.microStory)
    : `No story yet — help us learn about ${escapeHtml(p.name)}.`;

  return `
    <div class="photo">${photoMarkup(p)}</div>
    <h1 class="dog-name">${escapeHtml(p.name)}</h1>
    ${SPEECH_SUPPORTED ? `<button type="button" class="listen" aria-label="Listen to this dog's profile">Listen</button>` : ""}
    <div class="hr"></div>
    <div class="plate">${escapeHtml(p.slug)}</div>
    <div class="hr"></div>
    ${p.wardId ? `<div class="ward">Ward ${escapeHtml(p.wardId)}</div>` : ""}
    <div class="status-block">
      ${statusRow("Vaccinated", vaccine.ok, vaccine.text)}
      ${statusRow("Sterilised", abc.ok, abc.text)}
    </div>
    <details class="full-record">
      <summary>Full record</summary>
      <div class="fr-body">
        ${metaBits ? `<div class="fr-row"><span>${escapeHtml(metaBits)}</span></div>` : ""}
        ${lastSeen}
        <p class="fr-story">${story}</p>
      </div>
    </details>
    ${stale ? `<p class="stale-note">Showing a saved copy from before you went offline.</p>` : ""}
  `;
}

function statusRow(label: string, ok: boolean, text: string): string {
  return `<div class="status-row${ok ? " ok" : ""}">
    <span class="status-icon">${ok ? CHECK_SVG : ""}</span>
    <span class="status-label">${escapeHtml(label)}</span>
    <span class="status-value">${escapeHtml(text)}</span>
  </div>`;
}

function photoMarkup(p: DogProfile): string {
  if (p.photoUrl) return `<img src="${escapeAttr(p.photoUrl)}" alt="${escapeAttr(p.name)}" loading="eager" />`;
  const initial = (p.name || "?").charAt(0).toUpperCase();
  return `<div class="placeholder">${escapeHtml(initial)}</div>`;
}

function fmtAbc(v?: string): { text: string; ok: boolean } {
  if (!v) return { text: "Unknown", ok: false };
  const low = v.toLowerCase();
  const ok = low === "sterilized" || low === "done" || low === "abc_done";
  return { text: ok ? "Yes" : v, ok };
}

function fmtVaccine(v?: { upToDate: boolean; rabvLast?: string; dhppLast?: string; lastUpdatedAt: string }): {
  text: string;
  ok: boolean;
} {
  if (!v) return { text: "Unknown", ok: false };
  if (!v.upToDate) return { text: "Unknown / pending", ok: false };
  const parts = [v.rabvLast ? `Rabies ${v.rabvLast}` : undefined, v.dhppLast ? `DHPP ${v.dhppLast}` : undefined].filter(
    (s): s is string => !!s,
  );
  return { text: parts.length > 0 ? parts.join(", ") : "Up to date", ok: true };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
