/**
 * Screens 04 (SOS, step 1: "How bad is it?") and 05 (SOS sent). Replaces the
 * old half-height bottom sheet: the design gives each step the whole screen,
 * with the loud button pinned at the bottom.
 *
 * Step 1 is three radio cards mapped onto the API's severity enum (see
 * apiSeverity in format.ts), plus an optional note and photo. Step 2 shows
 * the case state (polled), and the nearby vets and NGOs that
 * POST /api/v1/reports returns as `nearbyCare`.
 *
 * There is NO feeder Call row, though the mock draws one (INVARIANT 3:
 * feeders' phone numbers are never stored or shared).
 *
 * The steps are in-page views with a history entry each, so the phone's back
 * button leaves the SOS flow instead of leaving the page.
 */
import type { DogProfile } from "./api";
import { fetchNearbyCare, getPosition, normalizeList, telHref, type CareProvider } from "./care";
import { getCachedDeviceToken, getDeviceToken } from "./device";
import { renderFirstAid } from "./firstaid";
import { apiSeverity, careMeta, casePill, CHOICES, wardShort, type CaseState, type Choice } from "./format";
import { currentView, escapeHtml, icon, pill, showView } from "./ui";

export interface SosContext {
  slug: string;
  profile?: DogProfile;
}

/*
 * There is no fallback emergency number, and this file must not invent one.
 *
 * It used to declare:
 *
 *     const EMERGENCY_FALLBACK_NAME = "Hetja emergency line";
 *     const EMERGENCY_FALLBACK_PHONE = "+919000000000";
 *
 * and render them as a card headed "ALWAYS AVAILABLE" with a working Call
 * button. `+91 9000000000` is a placeholder. It was shown on all three degraded
 * paths (offline, location denied, and care-lookup failed), which are exactly
 * the paths a stranger standing over an injured dog is most likely to hit.
 *
 * So the one moment the page had nothing real to offer was the moment it made
 * the strongest promise: an always-available emergency line that dials nothing.
 * That is the precise failure this project's charter names: "The system is
 * allowed to know less than it wants. It is not allowed to CLAIM more than it
 * knows." On this surface the cost of the claim is measured in an animal's
 * life, not a support ticket.
 *
 * Replaced with honest guidance and no dead Call button. If a real, verified,
 * genuinely 24/7 number is ever secured, it belongs in `care_providers` with a
 * non-null `phone_verified_at` like every other number the page shows, not as
 * a constant in the client that no gate can check.
 */

const NOTE_MAX = 500;
const POLL_MS = 15_000;
const POLL_FOR_MS = 10 * 60_000;

let ctx: SosContext = { slug: "" };
let choice: Choice | undefined;
let photoBase64: string | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

function dogName(): string | undefined {
  const n = ctx.profile?.name;
  return n && n !== "Unknown dog" ? n : undefined;
}

/** Wires the back button once. Call from main.ts at startup. */
export function wireHistory(): void {
  window.addEventListener("popstate", (ev) => {
    const v = (ev.state as { hv?: string } | null)?.hv;
    if (v === "sos" && q("#v-sos")?.innerHTML) showView("sos");
    else if (v === "sent" && q("#v-sent")?.innerHTML) showView("sent");
    else if (v === "tag" && q("#v-tag")?.innerHTML) showView("tag");
    else if (v === "sheet") return; // the tag sheet sits over the profile (tag.ts)
    else showView("profile");
  });
}

export function openSos(context: SosContext): void {
  ctx = context;
  choice = undefined;
  photoBase64 = undefined;
  renderStep1();
  history.pushState({ hv: "sos" }, "");
  showView("sos");
}

function back(): void {
  if ((history.state as { hv?: string } | null)?.hv) history.back();
  else showView("profile");
}

/* ------------------------------------------------------------------------- */
/* 04: How bad is it?                                                       */
/* ------------------------------------------------------------------------- */

function renderStep1(): void {
  const el = q("#v-sos")!;
  const name = dogName();
  const ward = ctx.profile?.wardId;
  const cap = ward
    ? `Shares ${wardShort(ward)} ward with feeders. Never your exact spot.`
    : "Shares the dog's ward with feeders. Never your exact spot.";
  el.innerHTML = `
    <div class="top"><button type="button" class="back" id="sos-back">‹ ${escapeHtml(name ?? "Back")}</button></div>
    <div class="body sos-body">
      <h1 class="title" tabindex="-1" data-focus>How bad is it?</h1>
      <p class="lead">Pick the closest one. You can add details after.</p>
      <fieldset class="opts">
        <legend class="sr">How bad is it?</legend>
        ${CHOICES.map(
          (c) => `<label class="opt">
            <input type="radio" name="sev" value="${c.key}" />
            <span class="dot">${icon("check", 14, 2.6)}</span>
            <span class="opt-txt"><span class="opt-t">${escapeHtml(c.title)}</span><span class="opt-s">${escapeHtml(c.sub)}</span></span>
          </label>`,
        ).join("")}
      </fieldset>
      <button type="button" class="add" id="add" aria-expanded="false">+ Add a photo or a note (optional)</button>
      <div class="extras hidden" id="extras">
        <textarea id="sos-note" class="field" maxlength="${NOTE_MAX}" rows="3" aria-label="Note" placeholder="Where it is hurt, which way it went, anything that helps"></textarea>
        <div class="photo-row">
          <button type="button" class="quiet" id="photo-btn">Add a photo</button>
          <span id="photo-state" class="by"></span>
        </div>
      </div>
    </div>
    <div class="foot">
      <p class="cap">${escapeHtml(cap)}</p>
      <button type="button" class="btn sos" id="send" disabled>Send SOS</button>
    </div>`;

  q("#sos-back")!.addEventListener("click", back);
  el.querySelectorAll<HTMLInputElement>('input[name="sev"]').forEach((r) =>
    r.addEventListener("change", () => {
      choice = r.value as Choice;
      el.querySelectorAll(".opt").forEach((o) => o.classList.toggle("on", o.contains(r)));
      q<HTMLButtonElement>("#send")!.disabled = false;
    }),
  );
  q("#add")!.addEventListener("click", () => {
    const x = q("#extras")!;
    const open = x.classList.toggle("hidden") === false;
    q("#add")!.setAttribute("aria-expanded", String(open));
    if (open) q("#sos-note")?.focus();
  });
  q("#photo-btn")!.addEventListener("click", () => void pickPhoto());
  q("#send")!.addEventListener("click", () => void send());
}

async function pickPhoto(): Promise<void> {
  if (photoBase64) {
    photoBase64 = undefined;
    setPhotoState("");
    return;
  }
  const file = await chooseFile();
  if (!file) return;
  setPhotoState("Adding photo…");
  photoBase64 = await compressToBase64(file);
  setPhotoState(photoBase64 ? "Photo added" : "Couldn't read that photo");
}

function setPhotoState(text: string): void {
  q("#photo-state")!.textContent = text;
  q("#photo-btn")!.textContent = photoBase64 ? "Remove photo" : "Add a photo";
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

/**
 * Downscales to 800px on the long edge at JPEG 0.6 (typically 40 to 90 KB),
 * then base64 without the `data:` prefix. The stranger may be on a weak 4G
 * signal, and a full-size camera photo would stall the report behind it.
 */
async function compressToBase64(file: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.6);
    const comma = data.indexOf(",");
    return comma > 0 ? data.slice(comma + 1) : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                  */
/* ------------------------------------------------------------------------- */

export interface ReportResult {
  ok: boolean;
  rateLimited?: boolean;
  caseId?: string;
  care: CareProvider[];
}

async function send(): Promise<void> {
  if (!choice) return;
  const btn = q<HTMLButtonElement>("#send")!;
  btn.disabled = true;
  btn.textContent = "Sending…";
  const online = navigator.onLine;
  const note = q<HTMLTextAreaElement>("#sos-note")?.value.trim().slice(0, NOTE_MAX) || undefined;
  const r = await fileReport(choice, note);
  renderSent(choice, r, online);
  history.replaceState({ hv: "sent" }, "");
  showView("sent");
  if (!r.ok && !online) sendSmsFallback(choice);
}

async function fileReport(c: Choice, note?: string): Promise<ReportResult> {
  try {
    // Lazy mint: only happens here, on an actual report attempt, never on
    // page load. Cached after the first success, so repeat reports from
    // this browser skip the challenge/PoW round-trip entirely. A failed
    // mint (network, no PoW solution in time, storage unavailable) resolves
    // to undefined -- the request below still goes out without a token and
    // falls into the "not sent" degrade path.
    const deviceToken = await getDeviceToken();
    const res = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dogSlug: ctx.slug,
        severity: apiSeverity(c),
        ...(note ? { note } : {}),
        ...(photoBase64 ? { photoBase64 } : {}),
        ...(deviceToken ? { deviceToken } : {}),
      }),
    });
    return readReport(res.status, await res.json().catch(() => null));
  } catch {
    return { ok: false, care: [] };
  }
}

/**
 * The report's answer. A 429 (this phone has hit the report limit) still
 * carries `data.nearbyCare` when the dog's position is known (hardening
 * T11): a capped reporter is exactly the person who needs a number to call.
 */
export function readReport(status: number, body: unknown): ReportResult {
  const b = (body ?? {}) as { data?: { caseId?: unknown; nearbyCare?: unknown }; error?: { data?: { nearbyCare?: unknown } } };
  const d = b.data;
  const care = normalizeList(d?.nearbyCare ?? b.error?.data?.nearbyCare ?? []);
  if (status < 200 || status >= 300) return { ok: false, rateLimited: status === 429, care: status === 429 ? care : [] };
  return { ok: true, caseId: typeof d?.caseId === "string" ? d.caseId : undefined, care };
}

function sendSmsFallback(c: Choice): void {
  const p = ctx.profile;
  const parts = ["Hetja EMERGENCY", CHOICES.find((x) => x.key === c)?.title ?? c];
  if (ctx.slug) parts.push(`dog ${ctx.slug}`);
  if (p?.name) parts.push(p.name);
  if (p?.wardId) parts.push(`ward ${wardShort(p.wardId)}`);
  location.assign(`sms:?body=${encodeURIComponent(parts.join(" · "))}`);
}

/* ------------------------------------------------------------------------- */
/* 05: SOS sent                                                             */
/* ------------------------------------------------------------------------- */

function renderSent(c: Choice, r: ReportResult, online: boolean): void {
  const el = q("#v-sent")!;
  const name = dogName();
  const whose = name ? `${name}'s` : "This dog's";
  const def = CHOICES.find((x) => x.key === c)!;
  // Nobody reports back how many people were paged, so no number is shown:
  // the mock's "3 of Bruno's feeders and 1 vet" needs counts the API does
  // not send. When it does, this is the one line to change.
  const msg = r.ok
    ? `${ctx.profile?.feederCount === 0 ? "A vet nearby is" : `${whose} feeders and a vet nearby are`} being told. If you can, stay nearby until someone arrives.`
    : !online
      ? "No signal. A text message with the details is ready for you to send."
      : r.rateLimited
        ? "This phone has sent the most SOS reports allowed for now. Please call someone below."
        : "Hetja couldn't confirm it. Please call someone below.";
  el.innerHTML = `
    <div class="body sent-body">
      <span class="big-ic ${r.ok ? "ok" : "danger"}">${r.ok ? icon("check", 26) : icon("alert", 26)}</span>
      <h1 class="title" tabindex="-1" data-focus>${r.ok ? "SOS sent." : "SOS not sent."}</h1>
      <p class="msg">${escapeHtml(msg)}</p>
      ${
        r.ok
          ? `<div class="pills" aria-live="polite">${pill(c === "urgent" ? "danger" : "warn", "alert", def.pill, true)}<span id="case-pill">${casePillHtml()}</span></div>`
          : ""
      }
      <p class="label call-l">Call now</p>
      <div class="rows" id="care">${r.care.length ? careRows(r.care) : rowHtml("Finding help near you…", "")}</div>
      ${renderFirstAid(apiSeverity(c))}
    </div>
    <div class="foot">
      <button type="button" class="link-btn" id="sent-back">Back to ${escapeHtml(name ?? "this dog")}</button>
    </div>`;
  q("#sent-back")!.addEventListener("click", back);
  if (!r.care.length) void loadCareFallback(online);
  if (r.ok && r.caseId) startPolling(r.caseId);
}

function casePillHtml(state?: CaseState): string {
  const p = casePill(state);
  return pill(p.tone, p.icon, p.text, true);
}

function careRows(list: CareProvider[]): string {
  return list.map((p) => rowHtml(p.name, careMeta(p), p.phone ? telHref(p.phone) : undefined)).join("");
}

function rowHtml(title: string, sub: string, tel?: string): string {
  return `<div class="row"><div class="row-txt"><p class="row-t">${escapeHtml(title)}</p>${
    sub ? `<p class="row-s">${escapeHtml(sub)}</p>` : ""
  }</div>${tel ? `<a class="tint" href="${escapeHtml(tel)}" aria-label="Call ${escapeHtml(title)}">Call</a>` : ""}</div>`;
}

/**
 * When the report returned no nearbyCare (the dog has no position on file,
 * or the report itself failed), look up care from the visitor's own
 * position, then fall back to honest guidance. Carries NO phone number and
 * NO Call button of its own; see the note at the top of this file.
 */
async function loadCareFallback(online: boolean): Promise<void> {
  const put = (html: string): void => {
    const el = q("#care");
    if (el) el.innerHTML = html;
  };
  const guidance = (lead: string): string =>
    rowHtml(
      "No nearby help loaded",
      `${lead}Call a local vet or animal helpline from your phone. If the dog is in traffic and you can do so safely, move yourself out of the road first.`,
    );
  if (!online) return put(guidance(""));
  const pos = await getPosition();
  if (!pos) return put(guidance("Turn on location to see help nearby. "));
  const res = await fetchNearbyCare(pos.lat, pos.lng);
  put(res.ok && res.providers.length ? careRows(res.providers) : guidance("Couldn't load nearby help right now. "));
}

/**
 * Polls the case state every 15 s while the "sent" screen is visible, for at
 * most 10 minutes, and stops for good once someone has it (acked) or it is
 * closed. A 404 (no such case, or the route not deployed yet) stops quietly
 * and leaves "Waiting for reply" up, which is still true.
 */
function startPolling(caseId: string): void {
  if (pollTimer) clearInterval(pollTimer);
  const until = Date.now() + POLL_FOR_MS;
  const stop = (): void => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  };
  const tick = async (): Promise<void> => {
    if (Date.now() > until) return stop();
    if (document.visibilityState !== "visible" || currentView() !== "sent") return;
    try {
      const token = getCachedDeviceToken();
      const res = await fetch(`/api/v1/reports/${encodeURIComponent(caseId)}/status`, {
        headers: { accept: "application/json", ...(token ? { "x-device-token": token } : {}) },
      });
      if (res.status === 404 || res.status === 401 || res.status === 403) return stop();
      if (!res.ok) return;
      const body = (await res.json()) as { data?: { state?: CaseState }; state?: CaseState };
      const state = body?.data?.state ?? body?.state;
      const p = casePill(state);
      const el = q("#case-pill");
      if (el) el.innerHTML = casePillHtml(state);
      if (p.final) stop();
    } catch {
      /* offline for a moment: try again next tick */
    }
  };
  pollTimer = setInterval(() => void tick(), POLL_MS);
}
