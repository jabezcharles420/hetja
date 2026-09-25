/**
 * Design v5, "When a tag breaks": F4 (the "What's wrong with the tag?" bottom
 * sheet, opened from a quiet link under the profile) and F5 (the answer).
 *
 * No sign-in: POST /api/v1/dogs/:slug/tag-reports carries the same attested
 * device token the SOS flow mints (device.ts), in the `x-device-token` header
 * the scans route reads. The body is exactly `{ kind }`.
 *
 * A "wrong dog" report never pauses SOS (docs/design/v5-handoff/CONTRACT.md,
 * adapted list): the API marks the tag as under review and the red button on
 * the profile stays exactly as it is.
 *
 * Offline: a report is kept in localStorage (metadata only, a slug and a
 * kind) and sent on the next page open or `online` event. Unlike a feed
 * photo, a tag report attests nothing about when it was captured, so minting
 * the device token at send time is fine here.
 */
import type { DogProfile } from "./api";
import { getPosition } from "./care";
import { getDeviceToken } from "./device";
import { pronouns, tagChoices, tagFootnote, tagSentCopy, type Pronouns, type TagKind, type TagOutcome } from "./format";
import { uuid } from "./idb";
import { closeSheet, escapeHtml, icon, openSheet, sheetOpen, showView, toast } from "./ui";

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

let profile: DogProfile | undefined;
let onDone: (() => void) | undefined;

/* ------------------------------------------------------------------------- */
/* F4: the sheet                                                             */
/* ------------------------------------------------------------------------- */

export function openTagSheet(p: DogProfile, done?: () => void): void {
  profile = p;
  onDone = done;
  const pr = pronouns(p.sex);
  history.pushState({ hv: "sheet" }, "");
  openSheet(
    `<h2 id="sheet-t" class="sheet-t" tabindex="-1">What's wrong with the tag?</h2>
      <div class="group">${tagChoices(pr)
        .map(
          (c) =>
            `<button type="button" class="grow" data-kind="${c.kind}"><span class="gtx"><span class="g-t">${escapeHtml(
              c.title,
            )}</span><span class="g-s">${escapeHtml(c.sub)}</span></span><span class="chev" aria-hidden="true">›</span></button>`,
        )
        .join("")}</div>
      <p class="fn">${escapeHtml(tagFootnote(pr, p.feederCount))}</p>`,
    "#v-profile",
    () => history.back(),
  );
  document.querySelectorAll<HTMLButtonElement>(".grow").forEach((b) =>
    b.addEventListener("click", () => void choose(b.dataset.kind as TagKind)),
  );
}

/** Back button and Escape close the sheet. Call once from main.ts. */
export function wireTag(): void {
  window.addEventListener("popstate", (ev) => {
    if ((ev.state as { hv?: string } | null)?.hv !== "sheet") closeSheet();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !sheetOpen()) return;
    if ((history.state as { hv?: string } | null)?.hv === "sheet") history.back();
    else closeSheet();
  });
  window.addEventListener("online", () => void flushTagQueue());
}

async function choose(kind: TagKind): Promise<void> {
  const p = profile;
  if (!p) return;
  const rows = document.querySelectorAll<HTMLButtonElement>(".grow");
  rows.forEach((b) => (b.disabled = true));
  const o = await sendTagReport(p.slug, kind);
  if (o === "error") {
    rows.forEach((b) => (b.disabled = false));
    toast("Couldn't send that. Please try again.");
    return;
  }
  closeSheet();
  q("#v-tag")!.innerHTML = tagSentMarkup(kind, p, o);
  history.replaceState({ hv: "tag" }, "");
  showView("tag");
  q("#tag-done")!.addEventListener("click", () => {
    if ((history.state as { hv?: string } | null)?.hv) history.back();
    else showView("profile");
    onDone?.();
  });
  q<HTMLButtonElement>("#seen")?.addEventListener("click", (ev) => void seenNow(p.slug, ev.currentTarget as HTMLButtonElement));
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                   */
/* ------------------------------------------------------------------------- */

export async function sendTagReport(slug: string, kind: TagKind): Promise<TagOutcome | "error"> {
  if (!navigator.onLine) return queueTagReport(slug, kind);
  try {
    const token = await getDeviceToken();
    if (!token && !navigator.onLine) return queueTagReport(slug, kind);
    const res = await postTagReport(slug, kind, token);
    return readTagReport(res.status, await res.json().catch(() => null));
  } catch {
    // Never reached the server: keep it for later rather than lose it.
    return queueTagReport(slug, kind);
  }
}

function postTagReport(slug: string, kind: TagKind, token?: string): Promise<Response> {
  return fetch(`/api/v1/dogs/${encodeURIComponent(slug)}/tag-reports`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(token ? { "x-device-token": token } : {}) },
    body: JSON.stringify({ kind }),
  });
}

/** `{ ok, data: { reportId, feedersNotified, wardCode } }`, a 429, or anything else. */
export function readTagReport(status: number, body: unknown): TagOutcome | "error" {
  if (status === 429) return { kind: "rate_limited" };
  if (status < 200 || status >= 300) return "error";
  const d = (body as { data?: { feedersNotified?: unknown; wardCode?: unknown } } | null)?.data;
  const n = d?.feedersNotified;
  return {
    kind: "sent",
    feedersNotified: typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null,
    wardCode: typeof d?.wardCode === "string" && d.wardCode ? d.wardCode : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Offline queue                                                             */
/* ------------------------------------------------------------------------- */

export const TAG_QUEUE_KEY = "hetja.scan.tagReports";

interface QueuedTag {
  slug: string;
  kind: TagKind;
}

export function listTagQueue(): QueuedTag[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TAG_QUEUE_KEY) ?? "[]");
    return Array.isArray(v) ? (v as QueuedTag[]) : [];
  } catch {
    return [];
  }
}

function saveTagQueue(items: QueuedTag[]): void {
  try {
    if (items.length) localStorage.setItem(TAG_QUEUE_KEY, JSON.stringify(items.slice(-10)));
    else localStorage.removeItem(TAG_QUEUE_KEY);
  } catch {
    /* storage blocked: the report is lost, and the F5 copy said it was saved */
  }
}

export function queueTagReport(slug: string, kind: TagKind): TagOutcome {
  // The API deduplicates per device, dog and kind for a day; so does this.
  saveTagQueue([...listTagQueue().filter((t) => t.slug !== slug || t.kind !== kind), { slug, kind }]);
  return { kind: "queued" };
}

/** Sends queued reports in order. Stops at the first one the network or the server wants to wait on. */
export async function flushTagQueue(): Promise<number> {
  let items = listTagQueue();
  if (!items.length || !navigator.onLine) return 0;
  let sent = 0;
  const token = await getDeviceToken();
  if (!token) return 0;
  for (const t of [...items]) {
    try {
      const res = await postTagReport(t.slug, t.kind, token);
      if (res.status === 429 || res.status >= 500) break;
      if (res.ok) sent++;
      // A permanent refusal (unknown dog, bad kind) will never succeed: drop it.
    } catch {
      break;
    }
    items = items.filter((x) => x !== t);
    saveTagQueue(items);
  }
  return sent;
}

/* ------------------------------------------------------------------------- */
/* F5                                                                        */
/* ------------------------------------------------------------------------- */

function dogName(p: DogProfile): string | undefined {
  return p.name && p.name !== "Unknown dog" ? p.name : undefined;
}

export function tagSentMarkup(kind: TagKind, p: DogProfile, o: TagOutcome): string {
  const pr = pronouns(p.sex);
  const name = dogName(p);
  const c = tagSentCopy(kind, name, pr, o);
  const found = kind === "found_on_ground";
  return `
    <div class="top end"><button type="button" class="back" id="tag-done">Done</button></div>
    <div class="body tag-body">
      <span class="big-ic lg ${c.ok ? "ok" : "warn"}">${c.ok ? icon("check", 30) : icon("alert", 30)}</span>
      <h1 class="title" tabindex="-1" data-focus>${escapeHtml(c.title)}</h1>
      <p class="lead">${escapeHtml(c.msg)}</p>
      ${found && o.kind !== "rate_limited" ? stepsCard(pr) : ""}
      ${found && o.kind === "sent" ? seenRow(name, pr) : ""}
    </div>`;
}

function stepsCard(pr: Pronouns): string {
  const steps = [
    "Leave it tied to a pole or gate near where you found it, at eye level.",
    `Or bin it. The code still works on ${pr.poss} spare tags.`,
  ];
  return `<div class="wcard"><p class="wc-t">What to do with the tag</p><ol class="steps">${steps
    .map((s, i) => `<li><span class="num">${i + 1}</span><span>${escapeHtml(s)}</span></li>`)
    .join("")}</ol></div>`;
}

function seenRow(name: string | undefined, pr: Pronouns): string {
  return `<div class="wcard seen"><div class="gtx"><p class="g-t">${escapeHtml(
    name ? `Seen ${name} nearby?` : "Seen this dog nearby?",
  )}</p><p class="g-s" id="seen-s">${escapeHtml(`Helps feeders find ${pr.obj} faster`)}</p></div><button type="button" class="chip" id="seen">Yes, just now</button></div>`;
}

/**
 * "Yes, just now": a view scan through POST /api/v1/scans, the path the feed
 * queue already uses, with the device's position when it gives one. A view
 * scan moves the dog's last-seen point; the public page still shows the ward
 * only.
 */
async function seenNow(slug: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = "Sending…";
  const pos = await getPosition();
  let ok = false;
  try {
    const token = await getDeviceToken();
    const res = await fetch("/api/v1/scans", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-device-token": token } : {}) },
      body: JSON.stringify({ clientUuid: uuid(), dogSlug: slug, type: "view", geo: pos, capturedAt: new Date().toISOString() }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    btn.disabled = false;
    btn.textContent = "Yes, just now";
    toast("Couldn't send that. Please try again.");
    return;
  }
  btn.textContent = "Thanks";
  const s = q("#seen-s");
  if (s) s.textContent = pos ? "That helps." : "Location was off, so only the time was sent.";
}

