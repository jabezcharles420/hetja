/**
 * The SOS flow, design v6 (docs/design/v6-handoff):
 *
 *   V18  "What's happened to Rani?": three cards, photo and note side by
 *        side, "Send SOS for Rani", then "Sending to Priya…" (still red).
 *   N12  a sheet that says why before the browser's location prompt, since
 *        a denied prompt cannot be asked again.
 *   P12  no location: copyable text, "Share location and send", "Send to
 *        Rani's feeders only".
 *   P13  no signal: the message shown, "Open Messages" (no recipient: Hetja
 *        never stores feeders' numbers, INVARIANT 3), saved vet numbers
 *        offered, and the SOS sent by itself once online.
 *   V19  sent: who knows, a counting "Waiting for a reply" pill, Call rows
 *        (closed places lose Call, unconfirmed numbers are hidden).
 *   N10  help is coming, once someone takes it: timeline, first aid, "Send
 *        Priya an update", "I had to leave".
 *   N11  what happened, when the responder closes the case with an outcome.
 *   L7   this phone already has an SOS open on this dog: show that case.
 *
 * With no known dog (P8, an unknown collar) the SOS is dogless: it carries
 * the visitor's position, which is required, and the API pages the ward.
 *
 * There is NO feeder Call row (INVARIANT 3), and no invented emergency
 * number: when nothing real is known the page says so.
 *
 * The steps are in-page views with a history entry, so the phone's back
 * button leaves the SOS flow instead of leaving the page.
 */
import type { DogProfile } from "./api";
import { fetchNearbyCare, getPosition, normalizeList, telHref, type CareProvider } from "./care";
import { getCachedDeviceToken, getDeviceToken } from "./device";
import { firstAid } from "./firstaid";
import {
  apiSeverity,
  careRow,
  CHOICES,
  clock,
  doneCopy,
  plural,
  pronouns,
  sentCopy,
  sosSeeCap,
  sosText,
  type CaseState,
  type Choice,
  type SosDog,
} from "./format";
import { closeSheet, copyText, currentView, escapeHtml, icon, openSheet, photoMarkup, pill, showView, toast } from "./ui";

export interface SosContext {
  slug: string;
  profile?: DogProfile;
  /** No known dog (P8): a dogless SOS to the visitor's ward. */
  dogless?: boolean;
}

type Pos = { lat: number; lng: number };

const NOTE_MAX = 500;
const POLL_MS = 15_000;
const POLL_FOR_MS = 60 * 60_000;
const PENDING_KEY = "hetja.scan.sosPending";
const CARE_KEY = "hetja.scan.care";
const PENDING_TTL_MS = 30 * 60_000;

let ctx: SosContext = { slug: "" };
let choice: Choice | undefined;
let photoBase64: string | undefined;
let note: string | undefined;
let lastPos: Pos | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let caseId: string | undefined;
let raisedAt = "";
let screen = "";
let left = false;
let status: Status = {};

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const on = (sel: string, fn: () => void): void => q(sel)?.addEventListener("click", fn);

function dogName(): string | undefined {
  const n = ctx.profile?.name;
  return !ctx.dogless && n && n !== "Unknown dog" ? n : undefined;
}

function dog(): SosDog {
  const p = ctx.profile;
  return { name: dogName(), sex: p?.sex, dogless: ctx.dogless, feederCount: p?.feederCount, feederNames: p?.feederNames };
}

/** Wires the back button once. Call from main.ts at startup. */
export function wireHistory(): void {
  window.addEventListener("popstate", (ev) => {
    const v = (ev.state as { hv?: string } | null)?.hv;
    if (v === "sos" && q("#v-sos")?.innerHTML) showView("sos");
    else if (v === "sent" && q("#v-sent")?.innerHTML) showView("sent");
    else if (v === "tag" && q("#v-tag")?.innerHTML) showView("tag");
    else if (v === "sheet") return; // the tag sheet sits over the profile (tag.ts)
    else {
      closeSheet();
      showView("profile");
    }
  });
  window.addEventListener("online", () => {
    if (screen === "offline") void post(lastPos);
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
/* V18: What's happened to Rani?                                            */
/* ------------------------------------------------------------------------- */

function renderStep1(): void {
  const el = q("#v-sos")!;
  const name = dogName();
  const capText = ctx.dogless
    ? "Feeders and vets in your ward will see it. Never your exact spot."
    : ctx.profile
      ? sosSeeCap(dog(), ctx.profile.wardId)
      : "Shares the dog's ward with feeders. Never your exact spot.";
  el.innerHTML = `
    <div class="top"><button type="button" class="back" id="sos-back">‹ ${escapeHtml(name ?? "Back")}</button></div>
    <div class="body sos-body">
      <h1 class="title" tabindex="-1" data-focus>${escapeHtml(name ? `What's happened to ${name}?` : "What's happened?")}</h1>
      <p class="lead">Pick the closest. You're doing the right thing.</p>
      <fieldset class="opts">
        <legend class="sr">What's happened?</legend>
        ${CHOICES.map(
          (c) => `<label class="opt">
            <input type="radio" name="sev" value="${c.key}" />
            <span class="dot">${icon("check", 12, 2.6)}</span>
            <span class="opt-txt"><span class="opt-t">${escapeHtml(c.title)}</span><span class="opt-s">${escapeHtml(c.sub)}</span></span>
          </label>`,
        ).join("")}
      </fieldset>
      <div class="pn">
        <button type="button" class="ph" id="ph">Add a photo</button>
        <textarea id="sos-note" class="field" maxlength="${NOTE_MAX}" aria-label="Note" placeholder="Where it is hurt, which way it went, anything that helps"></textarea>
      </div>
    </div>
    <div class="foot">
      <p class="cap">${escapeHtml(capText)}</p>
      <button type="button" class="btn sos" id="send" disabled>${escapeHtml(name ? `Send SOS for ${name}` : "Send SOS")}</button>
    </div>`;

  on("#sos-back", back);
  el.querySelectorAll<HTMLInputElement>('input[name="sev"]').forEach((r) =>
    r.addEventListener("change", () => {
      choice = r.value as Choice;
      el.querySelectorAll(".opt").forEach((o) => o.classList.toggle("on", o.contains(r)));
      q<HTMLButtonElement>("#send")!.disabled = false;
    }),
  );
  on("#ph", () => void pickPhoto());
  on("#send", () => void send());
}

async function pickPhoto(): Promise<void> {
  const btn = q("#ph")!;
  if (photoBase64) {
    photoBase64 = undefined;
  } else {
    const file = await chooseFile();
    if (!file) return;
    btn.textContent = "Adding…";
    photoBase64 = await compressToBase64(file);
    if (!photoBase64) toast("Couldn't read that photo");
  }
  // V18: "Remove photo" becomes an × on the thumbnail.
  btn.innerHTML = photoBase64
    ? `<img src="data:image/jpeg;base64,${photoBase64}" alt="" /><span class="x" aria-hidden="true">×</span>`
    : "Add a photo";
  btn.setAttribute("aria-label", photoBase64 ? "Remove photo" : "Add a photo");
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
/* Location: N12 before the prompt, P12 without it                          */
/* ------------------------------------------------------------------------- */

async function send(): Promise<void> {
  if (!choice) return;
  note = q<HTMLTextAreaElement>("#sos-note")?.value.trim().slice(0, NOTE_MAX) || undefined;
  if (!navigator.onLine) return show(renderOffline);
  let perm = "prompt";
  try {
    perm = (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    /* no Permissions API: ask first, as for "prompt" */
  }
  if (perm === "granted") return locate("#send");
  if (perm === "denied") return show(renderNoLocation);
  openSheet(
    `<span class="big-ic tintb">${icon("pin", 24)}</span>
    <div class="ask"><h2 id="sheet-t" class="sheet-t lg" tabindex="-1">Share where you are, once.</h2><p class="lead2">Your phone will ask next. It lets Hetja find the nearest open vet.</p></div>
    <ul class="ticks">${[
      "Feeders see the ward. The exact spot goes only to the one person who comes.",
      "Deleted when the case closes.",
      "Not tracked. Asked only for this SOS.",
    ]
      .map((t) => `<li>${icon("check", 18)}<span>${t}</span></li>`)
      .join("")}</ul>
    <div class="sh-f"><button type="button" class="btn blue" id="ask-go">Continue</button>${
      ctx.dogless ? "" : `<button type="button" class="link-btn" id="ask-no">Send without location</button>`
    }</div>`,
    "#v-sos",
    closeSheet,
  );
  on("#ask-go", () => {
    closeSheet();
    void locate("#send");
  });
  on("#ask-no", () => {
    closeSheet();
    void post(undefined, "#send");
  });
}

async function locate(btn: string): Promise<void> {
  busy(btn);
  const pos = await getPosition(10_000);
  if (pos) return post(pos, btn);
  show(renderNoLocation);
}

function busy(sel: string): void {
  const b = q<HTMLButtonElement>(sel);
  if (!b) return;
  const first = ctx.profile?.feederNames?.[0];
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  b.textContent = first && !ctx.dogless ? `Sending to ${first}…` : "Sending…";
}

/** Renders one of the after-send screens into #v-sent and shows it. */
function show(render: () => void): void {
  render();
  q("#v-sent")!.classList.toggle("warm", screen === "done");
  on("#sent-back", back);
  history.replaceState({ hv: "sent" }, "");
  showView("sent");
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                  */
/* ------------------------------------------------------------------------- */

export interface OpenCase {
  caseId: string;
  raisedAt?: string;
  responderFirstName?: string;
  takenAt?: string;
}

export interface ReportResult {
  ok: boolean;
  rateLimited?: boolean;
  /** Never reached the server. */
  network?: boolean;
  caseId?: string;
  openCase?: OpenCase;
  care: CareProvider[];
}

async function post(pos?: Pos, btn = "#retry"): Promise<void> {
  if (!choice) return;
  if (ctx.dogless && !pos) pos = await getPosition(10_000);
  if (ctx.dogless && !pos) return show(renderNoLocation);
  lastPos = pos;
  busy(btn);
  savePending();
  const r = await fileReport(choice, note, pos);
  if (!r.network) clearPending();
  saveCare(r.care);
  if (r.ok) {
    raisedAt = new Date().toISOString();
    caseId = r.caseId;
    status = {};
    left = false;
    show(() => renderSent(r.care));
    if (caseId) startPolling();
  } else if (r.openCase) {
    caseId = r.openCase.caseId;
    raisedAt = r.openCase.raisedAt ?? "";
    status = { responderFirstName: r.openCase.responderFirstName, takenAt: r.openCase.takenAt };
    show(renderOpenCase);
    startPolling();
  } else if (r.network || !navigator.onLine) show(renderOffline);
  else show(() => renderFailed(r));
}

async function fileReport(c: Choice, text?: string, pos?: Pos): Promise<ReportResult> {
  try {
    // Lazy mint: only on an actual report attempt, never on page load, and
    // cached after the first success. A failed mint resolves undefined and
    // the request still goes out, into the "not sent" path.
    const deviceToken = await getDeviceToken();
    const res = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(ctx.dogless ? {} : { dogSlug: ctx.slug }),
        severity: apiSeverity(c),
        ...(text ? { note: text } : {}),
        ...(photoBase64 ? { photoBase64 } : {}),
        ...(deviceToken ? { deviceToken } : {}),
        ...(pos ? { geo: pos } : {}),
      }),
    });
    return readReport(res.status, await res.json().catch(() => null));
  } catch {
    return { ok: false, network: true, care: [] };
  }
}

/**
 * The report's answer. A 429 still carries `nearbyCare` when the dog's
 * position is known (hardening T11), and, when this phone already has an SOS
 * open on the dog, `openCase` (L7).
 */
export function readReport(status: number, body: unknown): ReportResult {
  type D = { caseId?: unknown; nearbyCare?: unknown; openCase?: Record<string, unknown> };
  const b = (body ?? {}) as { data?: D; error?: { data?: D } };
  const d = b.data;
  const care = normalizeList(d?.nearbyCare ?? b.error?.data?.nearbyCare ?? []);
  if (status < 200 || status >= 300) {
    const oc = d?.openCase ?? b.error?.data?.openCase;
    const openCase =
      status === 429 && oc && typeof oc.caseId === "string"
        ? { caseId: oc.caseId, raisedAt: str(oc.raisedAt), responderFirstName: str(oc.responderFirstName), takenAt: str(oc.takenAt) }
        : undefined;
    return { ok: false, rateLimited: status === 429, care: status === 429 ? care : [], ...(openCase ? { openCase } : {}) };
  }
  return { ok: true, caseId: typeof d?.caseId === "string" ? d.caseId : undefined, care };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function savePending(): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ slug: ctx.slug, dogless: !!ctx.dogless, choice, note, at: Date.now() }));
  } catch {
    /* storage blocked: the in-page auto-send still works */
  }
}

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * P13's promise, kept across a closed tab: an SOS written with no signal in
 * the last 30 minutes is sent when this page next opens online.
 */
export function resumeSos(slug: string, profile?: DogProfile, dogless = false): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as {
      slug: string;
      dogless: boolean;
      choice: Choice;
      note?: string;
      at: number;
    } | null;
    if (!p || p.slug !== slug || Date.now() - p.at > PENDING_TTL_MS || !navigator.onLine) return false;
    ctx = { slug, profile, dogless: dogless || p.dogless };
    choice = p.choice;
    note = p.note;
    history.pushState({ hv: "sent" }, "");
    void post();
    return true;
  } catch {
    return false;
  }
}

/** Numbers this phone has been shown, so P13 can offer them with no signal. */
function saveCare(list: CareProvider[]): void {
  const keep = list.filter((p) => p.phone && p.phoneVerified).map((p) => ({ name: p.name, phone: p.phone }));
  if (!keep.length) return;
  try {
    localStorage.setItem(CARE_KEY, JSON.stringify(keep.slice(0, 5)));
  } catch {
    /* storage blocked */
  }
}

function savedCare(): Array<{ name: string; phone: string }> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CARE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------- */
/* P12 and P13                                                              */
/* ------------------------------------------------------------------------- */

function asText(sms: boolean): string {
  const p = ctx.profile;
  return sosText(
    sms,
    ctx.dogless ? {} : { name: dogName(), slug: ctx.slug, wardId: p?.wardId, wardName: p?.wardName },
    CHOICES.find((x) => x.key === choice)?.title ?? "",
    note,
  );
}

function renderNoLocation(): void {
  screen = "noloc";
  const name = dogName();
  const whose = name ? `${name}'s` : "this dog's";
  const feeders = !ctx.dogless && ctx.profile?.feederCount !== 0;
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <span class="big-ic danger">${icon("alert", 26)}</span>
      <h1 class="title xl" tabindex="-1" data-focus>Not sent yet.</h1>
      <p class="lead2">Your phone didn't share where you are, so Hetja can't tell which vets are near.${
        feeders ? ` ${escapeHtml(whose.charAt(0).toUpperCase() + whose.slice(1))} feeders can still be told.` : ""
      }</p>
      <div class="mcard"><p class="label">Or pass it on yourself</p><p class="mtxt">${escapeHtml(asText(false))}</p><button type="button" class="quiet" id="cp">Copy details</button></div>
    </div>
    <div class="foot">
      <button type="button" class="btn sos" id="retry">Share location and send</button>
      ${feeders ? `<button type="button" class="link-btn" id="f-only">${escapeHtml(`Send to ${whose} feeders only`)}</button>` : ""}
    </div>`;
  on("#cp", () => void copyText(asText(false), q<HTMLButtonElement>("#cp")!, "Couldn't copy. Press and hold the text to copy it."));
  on("#retry", async () => {
    const pos = await getPosition(10_000);
    if (pos) void post(pos);
    else toast("Location is still off. Turn it on for this site in your browser settings, then try again.", 6000);
  });
  on("#f-only", () => void post(undefined, "#f-only"));
}

function renderOffline(): void {
  screen = "offline";
  savePending();
  const text = asText(true);
  const saved = savedCare();
  const body = encodeURIComponent(text);
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <h1 class="title xl" tabindex="-1" data-focus>No signal. The message is written.</h1>
      <p class="lead2">An SMS often gets through when data doesn't. Hetja will also send the SOS by itself once you're back online.</p>
      <div class="bub"><p>${escapeHtml(text)}</p></div>
      ${
        saved.length
          ? `<p class="label">Or text a vet</p><div class="rows">${saved
              .map((p) => rowHtml(p.name, "", `sms:${telHref(p.phone).slice(4)}?body=${body}`, "Text"))
              .join("")}</div>`
          : ""
      }
      <p class="wait">${icon("clock")}Waiting to send online</p>
    </div>
    <div class="foot">
      <a class="btn sos" href="sms:?body=${body}">Open Messages</a>
      <button type="button" class="link-btn" id="sent-back">${escapeHtml(`Back to ${dogName() ?? "this dog"}`)}</button>
    </div>`;
}

/* ------------------------------------------------------------------------- */
/* V19 sent, and the failure that follows its layout                        */
/* ------------------------------------------------------------------------- */

function renderSent(care: CareProvider[]): void {
  screen = "sent";
  const c = sentCopy(dog(), status.feedersNotifiedNames, status.vetsNotified);
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <h1 class="title xl" tabindex="-1" data-focus>${escapeHtml(c.title)}</h1>
      <p class="lead2">${escapeHtml(c.lead)}</p>
      <div class="pills" aria-live="polite" id="wait">${waitPill()}</div>
      <div id="care">${careBlock(care)}</div>
    </div>
    <div class="foot"><button type="button" class="link-btn" id="sent-back">${escapeHtml(`Back to ${dogName() ?? "this dog"}`)}</button></div>`;
  if (!care.length && lastPos) void fetchNearbyCare(lastPos.lat, lastPos.lng).then((r) => putCare(careBlock(r.providers)));
}

function waitPill(): string {
  const mins = raisedAt ? Math.floor((Date.now() - Date.parse(raisedAt)) / 60000) : 0;
  return pill("warn", "clock", mins >= 1 ? `Waiting for a reply · ${mins} min` : "Waiting for a reply", true);
}

function renderFailed(r: ReportResult): void {
  screen = "fail";
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <span class="big-ic danger">${icon("alert", 26)}</span>
      <h1 class="title xl" tabindex="-1" data-focus>SOS not sent.</h1>
      <p class="lead2">${
        r.rateLimited
          ? "This phone has sent the most SOS reports allowed for now. Please call someone below."
          : "Hetja couldn't confirm it. Please call someone below."
      }</p>
      <div id="care">${careBlock(r.care) || rowHtml("Finding help near you…", "")}</div>
    </div>
    <div class="foot">
      ${r.rateLimited ? "" : `<button type="button" class="btn sos" id="retry">Try again</button>`}
      <button type="button" class="link-btn" id="sent-back">${escapeHtml(`Back to ${dogName() ?? "this dog"}`)}</button>
    </div>`;
  on("#retry", () => void post(lastPos));
  if (!r.care.length) void loadCareFallback();
}

/** "Can't wait? Call": confirmed numbers only; a closed place keeps its row but loses Call. */
function careBlock(list: CareProvider[]): string {
  const rows = list
    .filter((p) => p.phone && p.phoneVerified)
    .map((p) => {
      const r = careRow(p);
      return rowHtml(p.name, r.meta, r.closed ? undefined : telHref(p.phone!), "Call", r.closed);
    });
  return rows.length ? `<p class="label call-l">Can't wait? Call</p><div class="rows">${rows.join("")}</div>` : "";
}

function putCare(html: string): void {
  const el = q("#care");
  if (el && html) el.innerHTML = html;
}

function rowHtml(title: string, sub: string, href?: string, label = "Call", muted = false): string {
  return `<div class="row"><div class="row-txt"><p class="row-t${muted ? " muted" : ""}">${escapeHtml(title)}</p>${
    sub ? `<p class="row-s">${escapeHtml(sub)}</p>` : ""
  }</div>${href ? `<a class="tint" href="${escapeHtml(href)}" aria-label="${label} ${escapeHtml(title)}">${label}</a>` : ""}</div>`;
}

/**
 * When there is no care list, look it up from the visitor's own position,
 * then fall back to honest guidance. Carries NO phone number of its own.
 */
async function loadCareFallback(): Promise<void> {
  const guidance = (lead: string): string =>
    rowHtml(
      "No nearby help loaded",
      `${lead}Call a local vet or animal helpline from your phone. If the dog is in traffic and you can do so safely, move yourself out of the road first.`,
    );
  const pos = lastPos ?? (await getPosition());
  if (!pos) return putCare(guidance("Turn on location to see help nearby. "));
  const res = await fetchNearbyCare(pos.lat, pos.lng);
  saveCare(res.providers);
  putCare(careBlock(res.providers) || guidance("Couldn't load nearby help right now. "));
}

/* ------------------------------------------------------------------------- */
/* Reporter status: N10, N11, L7                                            */
/* ------------------------------------------------------------------------- */

interface Status {
  state?: CaseState;
  responderFirstName?: string;
  takenAt?: string;
  closeByAt?: string;
  arrivedAt?: string;
  outcome?: string;
  vetName?: string;
  resolvedAt?: string;
  feedersNotifiedNames?: string[];
  vetsNotified?: number;
}

/** GET /reports/:caseId/status, v6 fields. Anything unexpected is left out. */
export function readStatus(body: unknown): Status {
  const s = ((body as { data?: unknown })?.data ?? body ?? {}) as Record<string, unknown>;
  const names = Array.isArray(s.feedersNotifiedNames) ? s.feedersNotifiedNames.filter((n): n is string => typeof n === "string" && !!n) : undefined;
  return {
    state: str(s.state) as CaseState | undefined,
    responderFirstName: str(s.responderFirstName),
    takenAt: str(s.takenAt),
    closeByAt: str(s.closeByAt),
    arrivedAt: str(s.arrivedAt),
    outcome: str(s.outcome),
    vetName: str(s.vetName),
    resolvedAt: str(s.resolvedAt),
    feedersNotifiedNames: names,
    vetsNotified: typeof s.vetsNotified === "number" ? s.vetsNotified : undefined,
  };
}

const isDone = (s: Status): boolean => s.state === "resolved" || s.state === "false_alarm" || !!s.outcome;
const isTaken = (s: Status): boolean => !!s.responderFirstName && (s.state === "acked" || !!s.takenAt);

/**
 * Polls the case every 15 s while the screen is visible, for up to an hour,
 * and moves V19 to N10 once someone takes it and to N11 once it is closed.
 * A 404/401/403 (no such case, or the route not deployed) stops quietly.
 */
function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  const until = Date.now() + POLL_FOR_MS;
  const stop = (): void => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  };
  const tick = async (): Promise<void> => {
    if (Date.now() > until) return stop();
    if (document.visibilityState !== "visible" || currentView() !== "sent" || !caseId) return;
    try {
      const token = getCachedDeviceToken();
      const res = await fetch(`/api/v1/reports/${encodeURIComponent(caseId)}/status`, {
        headers: { accept: "application/json", ...(token ? { "x-device-token": token } : {}) },
      });
      if (res.status === 404 || res.status === 401 || res.status === 403) return stop();
      if (!res.ok) return;
      const s = readStatus(await res.json());
      const changed = JSON.stringify(s) !== JSON.stringify(status);
      status = s;
      if (isDone(s)) {
        stop();
        return show(renderDone);
      }
      if (isTaken(s) && (changed || screen !== "coming") && screen !== "open") return show(renderComing);
      if (screen === "sent") {
        const el = q("#wait");
        if (el) el.innerHTML = waitPill();
        if (changed) {
          const c = sentCopy(dog(), s.feedersNotifiedNames, s.vetsNotified);
          q("#v-sent h1")!.textContent = c.title;
          q("#v-sent .lead2")!.textContent = c.lead;
        }
      }
    } catch {
      /* offline for a moment: try again next tick */
    }
  };
  pollTimer = setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 3000);
}

function renderComing(): void {
  screen = "coming";
  const s = status;
  const first = s.responderFirstName ?? "";
  const pr = pronouns(ctx.profile?.sex);
  const name = dogName();
  const knows = name && ctx.profile?.feederNames?.includes(first) ? `${first} feeds ${name} and knows ${pr.obj}. ` : "";
  const step = (done: boolean, text: string, at?: string): string =>
    `<li${done ? ' class="done"' : ""}><span>${escapeHtml(text)}</span><time>${clock(at, true)}</time></li>`;
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <h1 class="title xl" tabindex="-1" data-focus>${escapeHtml(s.arrivedAt ? `${first} is there.` : `${first} is on the way.`)}</h1>
      <p class="lead2">${escapeHtml(s.arrivedAt ? "Thank you for waiting. You can go when you're ready." : `${knows}If you can, stay until ${first} arrives.`)}</p>
      <ol class="tl">
        ${step(true, "You sent the SOS", raisedAt)}
        ${step(true, `${first} took it`, s.takenAt)}
        ${s.closeByAt ? step(true, `${first} is close`, s.closeByAt) : ""}
        ${step(!!s.arrivedAt, s.arrivedAt ? `${first} arrived` : `${first} arrives`, s.arrivedAt)}
      </ol>
      <div class="mcard"><p class="label">While you wait</p><ol class="fa">${firstAid(pr)
        .map((t, i) => `<li><b>${i + 1}</b><span>${escapeHtml(t)}</span></li>`)
        .join("")}</ol></div>
    </div>
    <div class="foot">
      <button type="button" class="btn blue" id="upd">${escapeHtml(`Send ${first} an update`)}</button>
      ${left ? "" : `<button type="button" class="link-btn" id="left">I had to leave</button>`}
    </div>`;
  on("#upd", () => updateSheet(`Send ${first} an update`, `Sent to ${first}.`));
  on("#left", async () => {
    if (await caseCall("left")) {
      left = true;
      q("#left")?.remove();
      toast(`Thanks. ${first} knows you had to leave.`);
    } else toast("Couldn't send that. Please try again.");
  });
}

function updateSheet(title: string, done: string): void {
  openSheet(
    `<h2 id="sheet-t" class="sheet-t" tabindex="-1">${escapeHtml(title)}</h2>
    <textarea id="upd-note" class="field" maxlength="280" aria-label="Update" placeholder="What's changed?"></textarea>
    <div class="sh-f"><button type="button" class="btn blue" id="upd-go">Send</button></div>`,
    "#v-sent",
    closeSheet,
  );
  on("#upd-go", async () => {
    const text = q<HTMLTextAreaElement>("#upd-note")!.value.trim();
    if (!text) return;
    if (await caseCall("updates", { note: text })) {
      closeSheet();
      toast(done);
    } else toast("Couldn't send that. Please try again.");
  });
}

/** POST /reports/:caseId/{updates,left} with the device token. */
async function caseCall(path: "updates" | "left", body?: { note: string }): Promise<boolean> {
  if (!caseId) return false;
  try {
    const token = await getDeviceToken();
    const res = await fetch(`/api/v1/reports/${encodeURIComponent(caseId)}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-device-token": token } : {}) },
      body: JSON.stringify(body ?? {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function renderDone(): void {
  screen = "done";
  const s = status;
  const p = ctx.profile;
  const name = dogName();
  const c = doneCopy(s.outcome, dog(), s.responderFirstName, s.vetName, clock(s.resolvedAt ?? s.arrivedAt));
  const kv = (k: string, v: string): string => `<div><span>${k}</span>${v}</div>`;
  q("#v-sent")!.innerHTML = `
    <div class="body done-body">
      ${p && name ? `<div class="av120">${photoMarkup(p)}</div>` : ""}
      <h1 class="title xxl" tabindex="-1" data-focus>${escapeHtml(c.title)}</h1>
      <p class="lead3">${escapeHtml(c.lead)}</p>
      <div class="wcard kv">
        ${raisedAt ? kv("Raised", `<span>${clock(raisedAt)}, by you</span>`) : ""}
        ${s.arrivedAt ? kv("Help arrived", `<span>${clock(s.arrivedAt)}</span>`) : ""}
        ${kv("Outcome", pill(c.ok ? "ok" : "neutral", c.ok ? "check" : "clock", c.pill, true))}
      </div>
    </div>
    <div class="foot">
      ${name ? `<button type="button" class="btn blue" id="sent-back">${escapeHtml(`See ${name}'s page`)}</button>` : ""}
      <a class="link-btn" href="/welcome">Want to feed dogs near you?</a>
    </div>`;
}

function renderOpenCase(): void {
  screen = "open";
  const s = status;
  const first = s.responderFirstName;
  const name = dogName();
  const mins = s.takenAt && raisedAt ? Math.max(1, Math.round((Date.parse(s.takenAt) - Date.parse(raisedAt)) / 60000)) : 0;
  const lead = `You raised it${raisedAt ? ` at ${clock(raisedAt)}` : ""}.${
    first && s.takenAt ? ` ${first} took it ${plural(mins, "minute")} later and is on the way.` : " Nobody has taken it yet."
  }`;
  const feeds = name && first && ctx.profile?.feederNames?.includes(first);
  q("#v-sent")!.innerHTML = `
    <div class="body sent-body">
      <h1 class="title xl" tabindex="-1" data-focus>${escapeHtml(`${name ?? "This dog"} already has an SOS open.`)}</h1>
      <p class="lead2">${escapeHtml(lead)}</p>
      ${
        first
          ? `<div class="mcard rcard"><span class="av48">${escapeHtml(first.charAt(0))}</span><span class="gtx"><span class="row-t">${escapeHtml(
              first,
            )}</span><span class="g-s">${escapeHtml(`${feeds ? `Feeds ${name} · took` : "Took"} it at ${clock(s.takenAt, true)}`)}</span></span>${pill(
              "ok",
              "check",
              "Going",
              true,
            )}</div>`
          : ""
      }
      <p class="by">${escapeHtml(`Something new happened? Add it to the open case and ${first ?? "the feeders"} ${first ? "sees" : "see"} it.`)}</p>
      <div id="care"></div>
    </div>
    <div class="foot">
      <button type="button" class="btn blue" id="upd">Add an update</button>
      <button type="button" class="link-btn" id="call-vet">Call a vet</button>
    </div>`;
  on("#upd", () => updateSheet("Add an update", first ? `Sent to ${first}.` : "Added to the open case."));
  on("#call-vet", () => {
    putCare(rowHtml("Finding help near you…", ""));
    void loadCareFallback();
  });
}
