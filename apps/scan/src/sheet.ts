/**
 * The emergency bottom sheet — replaces the old `/sos/<slug>` navigation.
 * Opens in place at roughly half viewport height (Material's 0.5 detent /
 * iOS `.medium()`); a navigation step under stress is a step lost.
 *
 * Step 1: three severities in plain language, mapped to the `severity_t`
 * enum. Step 2: files the report AND shows nearby help in the same view.
 *
 * Only transform + opacity are animated, both driven by --h-dur/--h-ease so
 * prefers-reduced-motion (which zeroes --h-dur in tokens.css) is respected
 * automatically. Dismissible by backdrop tap or Escape; traps focus while
 * open; restores focus to the trigger on close.
 */
import type { DogProfile } from "./api";
import { fetchNearbyCare, getPosition, eyebrow, telHref, directionsHref, fmtDistance, type CareProvider } from "./care";
import { getDeviceToken } from "./device";
import { renderFirstAid, type Severity } from "./firstaid";
import { escapeHtml } from "./ui";

export interface SheetContext {
  slug: string;
  profile?: DogProfile;
}

const SEVERITIES: Array<{ key: Severity; label: string }> = [
  { key: "minor", label: "Hurt but standing" },
  { key: "serious", label: "Can’t get up / bleeding" },
  { key: "critical", label: "Life-threatening" },
];

const EMERGENCY_FALLBACK_NAME = "Hetja emergency line";
const EMERGENCY_FALLBACK_PHONE = "+919000000000";

let backdrop: HTMLElement | null = null;
let sheetEl: HTMLElement | null = null;
let sheetBody: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;
let ctx: SheetContext | null = null;
let initialized = false;

function els(): { backdrop: HTMLElement; sheet: HTMLElement; body: HTMLElement } {
  if (!backdrop) backdrop = document.querySelector("#sheet-backdrop");
  if (!sheetEl) sheetEl = document.querySelector("#sheet");
  if (!sheetBody) sheetBody = document.querySelector("#sheet-body");
  return { backdrop: backdrop!, sheet: sheetEl!, body: sheetBody! };
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const { backdrop: bd, sheet: sh } = els();
  bd.addEventListener("click", close);
  sh.querySelector("#sheet-close")?.addEventListener("click", close);
}

export function openSeverity(context: SheetContext): void {
  ctx = context;
  ensureInit();
  const { backdrop: bd, sheet: sh } = els();
  lastFocused = document.activeElement as HTMLElement | null;
  renderSeverityStep();
  bd.classList.remove("hidden");
  sh.classList.remove("hidden");
  sh.setAttribute("aria-hidden", "false");
  void sh.offsetHeight; // force reflow so the transform transition runs
  bd.classList.add("open");
  sh.classList.add("open");
  document.addEventListener("keydown", onKeydown, true);
  focusFirst();
}

function close(): void {
  const { backdrop: bd, sheet: sh, body: b } = els();
  bd.classList.remove("open");
  sh.classList.remove("open");
  sh.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onKeydown, true);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const done = (): void => {
    bd.classList.add("hidden");
    sh.classList.add("hidden");
    b.innerHTML = "";
  };
  if (reduced) done();
  else setTimeout(done, 200);
  lastFocused?.focus();
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    close();
    return;
  }
  if (ev.key === "Tab") trapTab(ev);
}

function focusable(): HTMLElement[] {
  const { sheet: sh } = els();
  return Array.from(sh.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

function focusFirst(): void {
  const list = focusable();
  (list[0] ?? els().sheet).focus();
}

function trapTab(ev: KeyboardEvent): void {
  const list = focusable();
  if (list.length === 0) return;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement;
  if (ev.shiftKey && active === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && active === last) {
    ev.preventDefault();
    first.focus();
  }
}

function q(sel: string): Element | null {
  return sheetBody ? sheetBody.querySelector(sel) : null;
}

function renderSeverityStep(): void {
  const { body: b } = els();
  b.innerHTML = `
    <h2 id="sheet-h" class="sheet-title">How badly is the dog hurt?</h2>
    <div class="sev-list" role="group" aria-label="Severity">
      ${SEVERITIES.map((s) => `<button type="button" class="sev-btn" data-sev="${s.key}">${escapeHtml(s.label)}</button>`).join("")}
    </div>
  `;
  b.querySelectorAll<HTMLButtonElement>(".sev-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sev = btn.dataset.sev as Severity;
      void onSeverityChosen(sev);
    });
  });
}

async function onSeverityChosen(sev: Severity): Promise<void> {
  const { body: b } = els();
  const online = navigator.onLine;
  b.innerHTML = `
    <h2 id="sheet-h" class="sheet-title">Help is here</h2>
    <p class="sheet-status" id="sheet-report-status">Filing report&hellip;</p>
    <div id="sheet-care"><p class="sheet-status">Finding help near you&hellip;</p></div>
  `;

  const slug = ctx?.slug ?? "";

  void fileReport(slug, sev).then((r) => {
    const el = q("#sheet-report-status");
    if (!el) return;
    if (r.ok) {
      el.textContent = "Report filed. Responders nearby have been notified.";
    } else if (online) {
      el.textContent = "Couldn't confirm the report automatically — please also call below.";
    } else {
      el.textContent = "No signal — opening a text message to send instead.";
      sendSmsFallback(sev);
    }
  });

  const careEl = q("#sheet-care");
  if (!careEl) return;
  if (!online) {
    careEl.innerHTML = fallbackCareHtml();
    return;
  }

  const pos = await getPosition();
  const careEl2 = q("#sheet-care");
  if (!careEl2) return;
  if (!pos) {
    careEl2.innerHTML = `<p class="sheet-status">Turn on location to see help nearby.</p>${fallbackCareHtml()}`;
    return;
  }

  const result = await fetchNearbyCare(pos.lat, pos.lng);
  const careEl3 = q("#sheet-care");
  if (!careEl3) return;
  if (!result.ok || result.providers.length === 0) {
    careEl3.innerHTML = `<p class="sheet-status">Couldn't load nearby help right now.</p>${fallbackCareHtml()}`;
  } else {
    careEl3.innerHTML = result.providers.map(careRowHtml).join("") + renderFirstAid(sev);
  }
}

function careRowHtml(p: CareProvider): string {
  const phoneLine = p.phone
    ? p.phoneVerified
      ? escapeHtml(p.phone)
      : `${escapeHtml(p.phone)} — unconfirmed number`
    : "No phone listed";
  const dist = p.distanceKm != null ? `<span class="care-dist">${escapeHtml(fmtDistance(p.distanceKm))}</span>` : "";
  return `
    <article class="care-row">
      <div class="care-eyebrow"><span>${escapeHtml(eyebrow(p))}</span>${dist}</div>
      <div class="care-name">${escapeHtml(p.name)}</div>
      <div class="care-phone">${phoneLine}</div>
      <div class="care-actions">
        ${p.phone ? `<a class="care-btn" href="${telHref(p.phone)}">Call</a>` : `<span class="care-btn disabled">Call</span>`}
        <a class="care-btn" href="${directionsHref(p)}" target="_blank" rel="noopener">Directions</a>
      </div>
    </article>`;
}

function fallbackCareHtml(): string {
  return `
    <article class="care-row">
      <div class="care-eyebrow"><span>ALWAYS AVAILABLE</span></div>
      <div class="care-name">${escapeHtml(EMERGENCY_FALLBACK_NAME)}</div>
      <div class="care-actions">
        <a class="care-btn" href="tel:${EMERGENCY_FALLBACK_PHONE}">Call</a>
      </div>
    </article>`;
}

function sendSmsFallback(sev: Severity): void {
  const p = ctx?.profile;
  const parts = ["Hetja EMERGENCY", SEVERITIES.find((s) => s.key === sev)?.label ?? sev];
  if (ctx?.slug) parts.push(`dog ${ctx.slug}`);
  if (p?.name) parts.push(p.name);
  if (p?.wardId) parts.push(`ward ${p.wardId}`);
  const smsBody = encodeURIComponent(parts.join(" — "));
  location.assign(`sms:?body=${smsBody}`);
}

async function fileReport(dogSlug: string, severity: Severity): Promise<{ ok: boolean; caseId?: string }> {
  try {
    // Lazy mint: only happens here, on an actual report attempt, never on
    // page load. Cached after the first success, so repeat reports from
    // this browser skip the challenge/PoW round-trip entirely. A failed
    // mint (network, no PoW solution in time, storage unavailable) resolves
    // to undefined -- the request below still goes out without a token and
    // falls into the existing "Couldn't confirm..." degrade path.
    const deviceToken = await getDeviceToken();
    const res = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dogSlug, severity, ...(deviceToken ? { deviceToken } : {}) }),
    });
    if (!res.ok) return { ok: false };
    const parsed: unknown = await res.json();
    const data =
      parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data?: unknown }).data : undefined;
    const caseId =
      data && typeof data === "object" && "caseId" in data ? ((data as { caseId?: unknown }).caseId as string) : undefined;
    return { ok: true, caseId };
  } catch {
    return { ok: false };
  }
}
