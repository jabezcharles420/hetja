"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { wardDisplay } from "@hetja/contracts";
import { Button, DogAvatar, Label, StickyFooter } from "@/components/ds";
import { mapApi } from "@/app/map/api";
import { api, ApiError, getAccessToken, type SosCase, type SosCaseV5, type SosSeverity } from "@/lib/api";
import { agoWords } from "@/lib/care-copy";
import { telHref } from "@/lib/care-cache";
import { ackRefusal, casePill, isClosed, isTakeable, type AckMessage } from "@/lib/sos-ack";
import { dogName } from "@/lib/streak";
import styles from "./sos-case.module.css";

/**
 * N2 "SOS alert" (design v5): where an SOS push lands. A red status band with
 * the ward and the time, a title built from the severity, the dog's name and
 * the reporter's note, the reporter's photo, who is responding, the nearest
 * vet with a Call link, and where. One loud button, red "I'm going", and a
 * quiet "I can't go right now".
 *
 * The exact spot is filled by the API only for the caller who acked the case
 * ("The exact spot unlocks when you tap I'm going"), so this page never has
 * a location to leak before then. Declining marks the caller's page only and
 * never affects escalation (CONTRACT). The server decides who may take a
 * case; lib/sos-ack.ts words its refusals, shared with the map.
 */

type Load =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error" }
  | { kind: "ready"; c: SosCaseV5; mine: boolean };

export const HIDDEN_TITLE = "This case isn't yours to see.";
export const SPOT_FOOTNOTE = "The exact spot unlocks when you tap I'm going. Other feeders see that it's covered.";
export const DECLINED_TITLE = "Thanks for saying.";
export const DECLINED_BODY = "Other feeders nearby are still being asked, and vets are told if nobody goes.";

/** "12 min ago", "3 h ago"; "just now" under a minute. */
export const raisedAgo = agoWords;

/** "K/W ward · Andheri West", "K/W ward", or null with no ward. */
export function caseWardLine(c: Pick<SosCase, "wardId" | "wardName">): string | null {
  if (!c.wardId) return null;
  const d = wardDisplay(c.wardId);
  return [`${d.code} ward`, c.wardName ?? d.name].filter(Boolean).join(" · ");
}

/** "SOS · K/W · 4 min ago" (the band's small uppercase line). */
export function bandLine(c: Pick<SosCase, "wardId" | "openedAt">, now = Date.now()): string {
  const code = c.wardId ? wardDisplay(c.wardId).code : null;
  return ["SOS", code, agoWords(c.openedAt, now)].filter(Boolean).join(" · ");
}

function sentence(note: string): string {
  const t = note.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/**
 * The title: severity, dog and note. "Rani is hurt. Bleeding from a leg."
 * Critical is "badly hurt", serious "hurt", minor "needs checking".
 */
export function caseTitle(severity: SosSeverity, name: string | null | undefined, note?: string | null): string {
  const who = (name ?? "").trim() || "A dog";
  const what = severity === "critical" ? "is badly hurt" : severity === "serious" ? "is hurt" : "needs checking";
  const tail = note ? sentence(note) : "";
  return [`${who} ${what}.`, tail].filter(Boolean).join(" ");
}

/** The plain sentence for a case that is past the "Nobody yet" moment. */
export function caseLead(c: SosCase, mine: boolean): string {
  switch (c.state) {
    case "open":
      return "Nobody has taken this yet. If you can get there, say so, and the person who raised it will see someone is on the way.";
    case "acked":
      return mine
        ? "You said you'd go. When the dog has been seen to, mark it resolved."
        : "Someone else is on the way. Thank you for looking.";
    case "escalated":
      return mine
        ? "Vets nearby have been told as well. When the dog has been seen to, mark it resolved."
        : "Nobody took this in time, so vets nearby have been told. You can still go.";
    case "resolved":
      return "This one is finished. Thank you.";
    case "false_alarm":
    default:
      return "This case was closed without a rescue.";
  }
}

/** Google Maps search link for an exact point. */
export function mapsHref(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * Does the viewer hold this case? In order: the case's own `mine`, then a
 * `location` (the API fills it only for the acker), then `ackedBy` against
 * the caller's id, then the map's ward detail (which marks the viewer's own
 * case `mine`).
 */
async function resolveMine(c: SosCaseV5): Promise<boolean> {
  if (typeof c.mine === "boolean") return c.mine;
  if (c.location) return true;
  if (c.state !== "acked" && c.state !== "escalated") return false;
  if (!c.ackedAt) return false;
  if (c.ackedBy) {
    try {
      const me = await api.getFeederMe();
      return me.feederId === c.ackedBy;
    } catch {
      return false;
    }
  }
  if (!c.wardId) return false;
  try {
    const w = await mapApi.ward(c.wardId);
    return w.sos.some((s) => s.caseId === c.id && s.mine);
  } catch {
    return false;
  }
}

/** The "Responding" value. */
export function respondingWords(c: SosCaseV5, mine: boolean): string {
  if (mine) return "You";
  if (c.respondingName) return c.respondingName;
  if (c.ackedAt && (c.state === "acked" || c.state === "escalated")) return casePill("acked", false).text;
  if (c.state === "escalated") return casePill("escalated", false).text;
  if (isClosed(c.state)) return casePill(c.state, false).text;
  return "Nobody yet";
}

export default function SosCaseScreen({ caseId }: { caseId: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<AckMessage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(`/sos/${caseId}`)}`);
  }, [caseId]);

  const fetchCase = useCallback(async () => {
    try {
      const c = await api.getSosCaseV5(caseId);
      const mine = await resolveMine(c);
      setLoad({ kind: "ready", c, mine });
      if (c.declinedByMe) setDeclined(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 400)) {
        setLoad({ kind: "hidden" });
      } else setLoad({ kind: "error" });
    }
  }, [caseId, toLogin]);

  useEffect(() => {
    if (!getAccessToken()) {
      toLogin();
      return;
    }
    void fetchCase();
  }, [fetchCase, toLogin]);

  const ack = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await api.ackSosCase(caseId);
      setDeclined(false);
      setLoad({
        kind: "ready",
        c: { ...load.c, state: load.c.state === "open" ? "acked" : load.c.state, ackedAt: new Date().toISOString() },
        mine: true,
      });
      // The exact spot is only served to the acker: read the case again for it.
      try {
        const fresh = await api.getSosCaseV5(caseId);
        setLoad({ kind: "ready", c: fresh, mine: true });
      } catch {
        /* keep the optimistic state; the spot shows on the next load */
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      const msg = ackRefusal(err);
      setRefusal(msg);
      // Taken or closed meanwhile: show the case as it now stands.
      if (msg.kind === "taken" || msg.kind === "closed") void fetchCase();
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, fetchCase, load, toLogin]);

  const decline = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setDeclineError(null);
    try {
      await api.declineSosCase(caseId);
      setDeclined(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setDeclineError("Hetja could not be reached. You don't need to do anything else.");
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, load, toLogin]);

  const resolve = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setResolveError(null);
    try {
      const r = await api.resolveSosCase(caseId, {
        resolution: "Marked resolved by the responder on the case page.",
        outcome: "resolved",
      });
      setConfirming(false);
      setLoad({ kind: "ready", c: { ...load.c, state: r.state, resolvedAt: r.resolvedAt }, mine: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setResolveError(
        err instanceof ApiError && err.status === 403
          ? "Only the responder who took this case can close it."
          : "Hetja could not be reached. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, load, toLogin]);

  const back = (
    <Link href="/alerts" className={styles.back}>
      ‹ Alerts
    </Link>
  );

  if (load.kind === "loading" || load.kind === "hidden" || load.kind === "error") {
    const hidden = load.kind === "hidden";
    return (
      <div className={styles.page}>
        <div className={styles.top}>
          <Link href="/alerts" className={styles.backPlain}>
            ‹ Alerts
          </Link>
        </div>
        <div className={styles.body} aria-busy={load.kind === "loading" || undefined}>
          <Label>SOS case</Label>
          {load.kind === "loading" ? (
            <p className={styles.lead}>Loading the case.</p>
          ) : (
            <>
              <h1 className={styles.plainTitle}>{hidden ? HIDDEN_TITLE : "Hetja could not be reached."}</h1>
              <p className={styles.lead}>
                {hidden
                  ? "A case is shown to the responders who were alerted for it, and to whoever took it."
                  : "The case did not load. Check your connection and try again."}
              </p>
              {!hidden && (
                <Button variant="quiet" onClick={() => void fetchCase()} className={styles.retry}>
                  Try again
                </Button>
              )}
            </>
          )}
        </div>
        {load.kind !== "loading" && (
          <StickyFooter>
            <Button href="/map" fullWidth>
              Open the map
            </Button>
          </StickyFooter>
        )}
      </div>
    );
  }

  const { c, mine } = load;
  const closed = isClosed(c.state);
  const canTake = isTakeable(c.state) && !mine;
  const canResolve = mine && !closed;
  const name = c.dog?.name ? dogName(c.dog.name) : null;
  const care = c.nearestCare ?? null;

  return (
    <div className={styles.page}>
      <header className={[styles.band, closed ? styles.bandClosed : ""].filter(Boolean).join(" ")}>
        {back}
        <p className={styles.bandLine}>{bandLine(c)}</p>
        <h1 className={styles.title}>{caseTitle(c.severity, c.dog?.name, c.note)}</h1>
      </header>

      <div className={styles.content}>
        {c.reporterPhotoUrl ? (
          <div className={styles.photoRow}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.photo} src={c.reporterPhotoUrl} alt={`Photo sent with the SOS${name ? ` for ${name}` : ""}`} />
            <div className={styles.photoText}>
              <span className={styles.photoTitle}>Photo from the person who sent it</span>
              <span className={styles.photoSub}>
                {c.reporterAnonymous === true
                  ? "Sent by a passer-by, no account"
                  : "Sent with the SOS"}
              </span>
            </div>
          </div>
        ) : c.dog ? (
          <div className={styles.photoRow}>
            <DogAvatar id={c.dog.slug} name={name ?? "Dog"} photoUrl={c.dog.photoUrl} size={56} className={styles.avatar} />
            <div className={styles.photoText}>
              <span className={styles.photoTitle}>{name ? `${name}'s profile photo` : "The dog's profile photo"}</span>
              <span className={styles.photoSub}>No photo came with the SOS</span>
            </div>
          </div>
        ) : null}

        <dl className={styles.info} aria-live="polite">
          <div className={styles.infoRow}>
            <dt>Responding</dt>
            <dd className={styles.strong}>
              {respondingWords(c, mine)}
            </dd>
          </div>
          <div className={styles.infoRow}>
            <dt>Nearest vet</dt>
            <dd>
              {care ? (
                care.phoneE164 ? (
                  <a href={telHref(care.phoneE164)} className={styles.link}>
                    {care.name} · Call
                  </a>
                ) : (
                  care.name
                )
              ) : (
                <span className={styles.muted}>None listed nearby</span>
              )}
            </dd>
          </div>
          <div className={styles.infoRow}>
            <dt>Where</dt>
            <dd>
              {mine && c.location ? (
                <span className={styles.where}>
                  <span className={styles.coords}>
                    {c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}
                  </span>
                  <a href={mapsHref(c.location)} className={styles.link} target="_blank" rel="noopener noreferrer">
                    Open in Maps
                  </a>
                </span>
              ) : mine ? (
                <span className={styles.muted}>{caseWardLine(c) ?? "Loading the spot"}</span>
              ) : (
                <span className={styles.muted}>Shared only with you if you go</span>
              )}
            </dd>
          </div>
        </dl>

        {!mine && !closed && <p className={styles.footnote}>{SPOT_FOOTNOTE}</p>}
        {(mine || c.state !== "open") && <p className={styles.lead}>{caseLead(c, mine)}</p>}
      </div>

      {(canTake || canResolve || refusal) && (
        <StickyFooter divider={false}>
          {refusal && (
            <p className={styles.footMsg} role="alert">
              <b>{refusal.title}</b>
              {refusal.body ? ` ${refusal.body}` : null}
            </p>
          )}
          {refusal?.action ? (
            <Button href={refusal.action.href} fullWidth>
              {refusal.action.label}
            </Button>
          ) : canTake ? (
            declined ? (
              <>
                <p className={styles.footMsg} role="status">
                  <b>{DECLINED_TITLE}</b> {DECLINED_BODY}
                </p>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => void ack()}
                  disabled={busy || refusal?.kind === "tooMany"}
                >
                  I can go after all
                </button>
              </>
            ) : (
              <>
                <Button
                  variant="sos"
                  bang={false}
                  fullWidth
                  className={styles.going}
                  onClick={() => void ack()}
                  disabled={busy || refusal?.kind === "tooMany"}
                  aria-busy={busy || undefined}
                >
                  I&rsquo;m going
                </Button>
                {declineError && (
                  <p className={styles.footMsg} role="alert">
                    {declineError}
                  </p>
                )}
                <button type="button" className={styles.linkBtn} onClick={() => void decline()} disabled={busy}>
                  I can&rsquo;t go right now
                </button>
              </>
            )
          ) : canResolve ? (
            confirming ? (
              <>
                <p className={styles.footMsg}>
                  <b>Has the dog been seen to?</b> This closes the case for everyone.
                </p>
                {resolveError && (
                  <p className={styles.footMsg} role="alert">
                    {resolveError}
                  </p>
                )}
                <Button fullWidth onClick={() => void resolve()} disabled={busy} aria-busy={busy || undefined}>
                  Yes, mark resolved
                </Button>
                <button type="button" className={styles.linkBtn} onClick={() => setConfirming(false)}>
                  Not yet
                </button>
              </>
            ) : (
              <Button fullWidth onClick={() => setConfirming(true)}>
                Mark resolved
              </Button>
            )
          ) : null}
        </StickyFooter>
      )}
    </div>
  );
}
