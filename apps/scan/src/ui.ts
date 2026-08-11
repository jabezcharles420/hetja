import type { DogProfile } from "./api";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

export function setStatus(text: string): void {
  $("#status").textContent = text;
}

export function setSub(text: string): void {
  $("#sub").textContent = text;
}

export function setNet(online: boolean): void {
  const el = $("#net");
  el.textContent = online ? "online" : "offline";
  el.classList.toggle("on", online);
  el.classList.toggle("off", !online);
}

export function renderProfile(p: DogProfile, stale: boolean): void {
  const app = $("#profile");
  app.classList.remove("hidden");
  app.innerHTML = buildCard(p, stale);
  if (stale) {
    setNote("You're offline — showing a saved profile. Vaccination and ABC status may be outdated.");
  }
}

export function setNote(html: string): void {
  const el = $("#note");
  el.innerHTML = `<p class="banner">${html}</p>`;
}

export function clearNote(): void {
  $("#note").innerHTML = "";
}

export function renderError(message: string): void {
  setStatus("Unavailable");
  setSub(message);
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
  const ward = p.wardId ? `<span class="chip">Ward ${escapeHtml(p.wardId)}</span>` : "";
  const status = p.status ? `<span class="chip ${p.status === "active" ? "acc" : "warn"}">${escapeHtml(p.status)}</span>` : "";
  const metaBits = [p.sex, p.approxAge !== undefined ? `~${p.approxAge}y` : undefined, p.coatPattern]
    .filter((s): s is string => !!s)
    .join(" · ");
  const abc = fmtAbc(p.abcStatus);
  const vaccine = fmtVaccine(p.vaccine);
  const lastSeen = p.lastSeenAt ? `<div class="row"><dt>Last seen</dt><dd>${escapeHtml(p.lastSeenAt)}</dd></div>` : "";
  const story = p.microStory
    ? `<div class="story">${escapeHtml(p.microStory)}</div>`
    : `<div class="story">No story yet — help us learn about ${escapeHtml(p.name)}.</div>`;

  return `
  <article class="card${stale ? " stale" : ""}">
    <div class="photo">${photoMarkup(p)}</div>
    <div class="body">
      <div class="name-row"><h2 class="name">${escapeHtml(p.name)}</h2>${status}${ward}</div>
      ${metaBits ? `<p class="meta">${escapeHtml(metaBits)}</p>` : ""}
      <div class="row"><dt>ABC</dt><dd class="${abc.ok ? "ok" : ""}">${abc.html}</dd></div>
      <div class="row"><dt>Vaccinations</dt><dd class="${vaccine.ok ? "ok" : ""}">${vaccine.html}</dd></div>
      ${lastSeen}
      ${story}
    </div>
  </article>`;
}

function photoMarkup(p: DogProfile): string {
  if (p.photoUrl) return `<img src="${escapeAttr(p.photoUrl)}" alt="${escapeAttr(p.name)}" />`;
  const initial = (p.name || "?").charAt(0).toUpperCase();
  return `<div class="placeholder">${escapeHtml(initial)}</div>`;
}

function fmtAbc(v?: string): { html: string; ok: boolean } {
  if (!v) return { html: "Unknown", ok: false };
  const low = v.toLowerCase();
  const ok = low === "sterilized" || low === "done" || low === "abc_done";
  return { html: escapeHtml(v), ok };
}

function fmtVaccine(v?: { upToDate: boolean; rabvLast?: string; dhppLast?: string; lastUpdatedAt: string }): { html: string; ok: boolean } {
  if (!v) return { html: "Unknown", ok: false };
  if (!v.upToDate) return { html: "Unknown / pending", ok: false };
  const parts = [v.rabvLast ? `Rabies ${v.rabvLast}` : undefined, v.dhppLast ? `DHPP ${v.dhppLast}` : undefined]
    .filter((s): s is string => !!s);
  const text = parts.length > 0 ? parts.join(", ") : "Up to date";
  return { html: text, ok: true };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
