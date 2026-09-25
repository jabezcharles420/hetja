"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusPill, StickyFooter } from "@/components/ds";
import { SpotMap } from "@/components/care/SpotMap";
import { mapApi } from "@/app/map/api";
import {
  api,
  ApiError,
  getAccessToken,
  type SosCase,
  type SosCaseForbiddenData,
  type SosCaseV6,
  type SosOutcome,
} from "@/lib/api";
import { caseGlance, loadCareNumbers, rememberCase, telHref, type CareNumber, type CaseGlance } from "@/lib/care-cache";
import { pronouns, sexOf } from "@/lib/care-copy";
import {
  autoMinutes,
  checklistRows,
  clock,
  closedLead,
  closedTitle,
  distanceWords,
  duration,
  OUTCOMES,
  severityLine,
  since,
  timelineRows,
  wardCode,
  wardLabel,
  type TimelineRow,
} from "@/lib/sos-case";
import { ackRefusal, isClosed, isTakeable, type AckMessage } from "@/lib/sos-ack";
import { dogName } from "@/lib/streak";
import styles from "./sos-case.module.css";

/**
 * The SOS case page (design v6, which supersedes v5's N2 here): one layout
 * per state of the case.
 *
 *   P9   open, not yours          the dog, the note, the timeline, distance, "I can go and help"
 *   L5   escalated, nobody on it  "Nobody has reached Bruno yet." Still takeable.
 *   L4   someone else took it     green "Covered", named
 *   P10  yours                    exact spot + Directions, nearest vet, close-by, Mark resolved,
 *                                 "I can't make it after all" (a release)
 *   P11  closing                  how did it end; "didn't make it" goes on to N9
 *   V21  closed                   what happened, with the timeline
 *   V22  not your case (403)      reassurance, then the real responder rule as a checklist
 *   L6   didn't load              what the alert said, saved ward vets, Try again
 *
 * The exact spot is filled by the API only for the acker. The server decides
 * who may take a case; lib/sos-ack.ts words its refusals (403, 409, 429),
 * shared with the map. v5's "I can't go right now" stays as P9's quiet link
 * and never affects escalation.
 */

type Load =
  | { kind: "loading" }
  | { kind: "forbidden"; data: SosCaseForbiddenData | null; glance: CaseGlance | null }
  | { kind: "gone" }
  | { kind: "error"; glance: CaseGlance | null; care: CareNumber[] }
  | { kind: "ready"; c: SosCaseV6; mine: boolean };

export const HIDDEN_LEAD =
  "Cases stay with the people who were alerted, so the exact spot doesn't travel. It's being looked after.";
export const SPOT_CAPTION = "The exact spot unlocks when you take it.";
export const DECLINED_TITLE = "Thanks for saying.";
export const DECLINED_BODY = "Other feeders nearby are still being asked, and vets are told if nobody goes.";
export const RELEASED_LINE = "Handed back. Other responders have been asked again.";

/** Kept for the map and older callers: "12 min ago". */
export const raisedAgo = since;

/** "K/W ward · Andheri West", "K/W ward", or null with no ward. */
export function caseWardLine(c: Pick<SosCase, "wardId" | "wardName">): string | null {
  if (!c.wardId) return null;
  const label = wardLabel(c.wardId, c.wardName);
  const code = wardCode(c.wardId);
  return label && code && label !== code ? `${code} ward · ${label.slice(code.length + 1)}` : `${code} ward`;
}

/** Google Maps link for an exact point. */
export function mapsHref(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

async function resolveMine(c: SosCaseV6): Promise<boolean> {
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

/** Dogs in the ward nobody has logged today, when the map's ward detail says (L4). */
function notLoggedDogs(w: unknown): { name: string }[] {
  const d = w as { notLoggedTodayDogs?: unknown; notLoggedToday?: unknown };
  const list = Array.isArray(d.notLoggedTodayDogs) ? d.notLoggedTodayDogs : Array.isArray(d.notLoggedToday) ? d.notLoggedToday : [];
  return list
    .map((x) => ({ name: typeof (x as { name?: unknown }).name === "string" ? ((x as { name: string }).name) : "" }))
    .filter((x) => x.name);
}

/** "Moti and Goli", "Moti, Goli and 2 more". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function Timeline({ rows, meridiem }: { rows: TimelineRow[]; meridiem: boolean }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <ol className={styles.timeline} aria-label="What has happened">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className={styles.tlRow}>
          <span className={`${styles.dot} ${styles[`dot_${r.dot}`]}`} aria-hidden="true" />
          <span className={r.muted ? `${styles.tlText} ${styles.muted}` : styles.tlText}>{r.text}</span>
          <span className={styles.tlTime}>{clock(r.at, meridiem)}</span>
        </li>
      ))}
    </ol>
  );
}

export default function SosCaseScreen({ caseId }: { caseId: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<AckMessage | null>(null);
  const [declined, setDeclined] = useState(false);
  const [released, setReleased] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"] | null>(null);
  const [vetName, setVetName] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<{ name: string }[]>([]);

  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(`/sos/${caseId}`)}`);
  }, [caseId]);

  const fetchCase = useCallback(async () => {
    try {
      const c = await api.getSosCaseV6(caseId);
      const mine = await resolveMine(c);
      setLoad({ kind: "ready", c, mine });
      if (c.declinedByMe) setDeclined(true);
      void rememberCase({
        caseId,
        dogName: c.dog?.name ?? null,
        dogSlug: c.dog?.slug ?? null,
        severity: c.severity,
        wardId: c.wardId ?? null,
        wardName: c.wardName ?? null,
        openedAt: c.openedAt,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && err.status === 403) {
        const data = (err.data as SosCaseForbiddenData | undefined) ?? null;
        setLoad({ kind: "forbidden", data: data && data.checklist ? data : null, glance: await caseGlance(caseId) });
        return;
      }
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        setLoad({ kind: "gone" });
        return;
      }
      const [glance, saved] = await Promise.all([caseGlance(caseId), loadCareNumbers()]);
      setLoad({ kind: "error", glance, care: saved?.numbers ?? [] });
    }
  }, [caseId, toLogin]);

  useEffect(() => {
    if (!getAccessToken()) {
      toLogin();
      return;
    }
    void fetchCase();
  }, [fetchCase, toLogin]);

  // L4: something useful for the responder who got there second.
  const coveredWard = load.kind === "ready" && !load.mine && load.c.ackedAt && !isClosed(load.c.state) ? load.c.wardId : null;
  useEffect(() => {
    if (!coveredWard) return;
    let live = true;
    mapApi
      .ward(coveredWard)
      .then((w) => live && setNearby(notLoggedDogs(w)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [coveredWard]);

  const ack = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setRefusal(null);
    setActionError(null);
    try {
      await api.ackSosCase(caseId);
      setDeclined(false);
      setReleased(false);
      setLoad({
        kind: "ready",
        c: { ...load.c, state: load.c.state === "open" ? "acked" : load.c.state, ackedAt: new Date().toISOString() },
        mine: true,
      });
      // The exact spot is only served to the acker: read the case again for it.
      try {
        const fresh = await api.getSosCaseV6(caseId);
        setLoad({ kind: "ready", c: fresh, mine: true });
      } catch {
        /* keep the optimistic state; the spot shows on the next load */
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      const msg = ackRefusal(err);
      setRefusal(msg);
      if (msg.kind === "taken" || msg.kind === "closed") void fetchCase();
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, fetchCase, load, toLogin]);

  const decline = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.declineSosCase(caseId);
      setDeclined(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setActionError("Hetja could not be reached. You don't need to do anything else.");
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, load, toLogin]);

  const release = useCallback(async () => {
    if (load.kind !== "ready" || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.releaseSosCase(caseId);
      setReleased(true);
      setLoad({ kind: "ready", c: { ...load.c, state: "open", ackedAt: null, location: null, respondingName: null }, mine: false });
      void fetchCase();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setActionError("Hetja could not be reached, so the case is still yours. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, fetchCase, load, toLogin]);

  const step = useCallback(
    async (kind: "closeBy" | "arrived") => {
      if (load.kind !== "ready" || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        if (kind === "closeBy") {
          const r = await api.closeBySosCase(caseId);
          setLoad({ ...load, c: { ...load.c, closeByAt: r.closeByAt } });
        } else {
          const r = await api.arrivedSosCase(caseId);
          setLoad({ ...load, c: { ...load.c, arrivedAt: r.arrivedAt } });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return toLogin();
        setActionError("Hetja could not be reached. Try again in a minute.");
      } finally {
        setBusy(false);
      }
    },
    [busy, caseId, load, toLogin],
  );

  const resolve = useCallback(async () => {
    if (load.kind !== "ready" || busy || !outcome) return;
    setBusy(true);
    setResolveError(null);
    const choice: SosOutcome = outcome;
    try {
      const r = await api.resolveSosCaseV6(caseId, {
        outcome: choice,
        ...(choice === "taken_to_vet" && vetName.trim() ? { vetName: vetName.trim().slice(0, 80) } : {}),
      });
      setSheet(false);
      const slug = load.c.dog?.slug;
      if (choice === "died" && slug) {
        // The API opened a pending passed-away report: N9 carries it from here.
        routerRef.current.push(`/me/dogs/${slug}/status`);
        return;
      }
      setLoad({
        kind: "ready",
        c: {
          ...load.c,
          state: r.state,
          resolvedAt: r.resolvedAt,
          outcome: r.outcome ?? choice,
          vetName: choice === "taken_to_vet" ? vetName.trim() || null : null,
        },
        mine: true,
      });
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
  }, [busy, caseId, load, outcome, toLogin, vetName]);

  const back = (
    <Link href="/map" className={styles.back}>
      ‹ Map
    </Link>
  );

  // --- loading ------------------------------------------------------------
  if (load.kind === "loading") {
    return (
      <div className={styles.page}>
        <div className={styles.body} aria-busy="true">
          {back}
          <p className={styles.lead}>Loading the case.</p>
        </div>
      </div>
    );
  }

  // --- V22 not your case ------------------------------------------------
  if (load.kind === "forbidden") {
    const code = wardCode(load.glance?.wardId);
    const k = load.data?.checklist ?? null;
    const rows = k ? checklistRows(k, code) : [];
    const alertsOff = k ? !(k.sosOptIn && !k.paused && k.inMyWards !== false) : false;
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          <h1 className={`${styles.title34} ${styles.spaced}`}>
            {code ? `This case went to feeders in ${code}.` : "This case went to the feeders nearby."}
          </h1>
          <p className={styles.lead}>{HIDDEN_LEAD}</p>
          {k && (
            <div className={styles.checkCard}>
              <span className={styles.checkTitle}>Want cases like this?</span>
              <ul className={styles.checkList}>
                {rows.map((r) => (
                  <li key={r.text} className={styles.checkRow}>
                    <span className={r.done ? styles.tickOn : styles.tickOff} aria-hidden="true">
                      {r.done ? "✓" : ""}
                    </span>
                    <span>
                      {r.text}
                      <span className="h-sr-only">{r.done ? " (done)" : " (not yet)"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <StickyFooter divider={false}>
          {alertsOff ? (
            <Button href="/settings" fullWidth>
              {code ? `Turn on alerts for ${code}` : "Turn on SOS alerts"}
            </Button>
          ) : (
            <Button href="/map" fullWidth>
              Back to the map
            </Button>
          )}
        </StickyFooter>
      </div>
    );
  }

  // --- gone ---------------------------------------------------------------
  if (load.kind === "gone") {
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          <h1 className={`${styles.title34} ${styles.spaced}`}>This case isn&rsquo;t there any more.</h1>
          <p className={styles.lead}>It may have been closed. Nothing else is needed from you.</p>
        </div>
        <StickyFooter divider={false}>
          <Button href="/map" fullWidth>
            Back to the map
          </Button>
        </StickyFooter>
      </div>
    );
  }

  // --- L6 didn't load -------------------------------------------------------
  if (load.kind === "error") {
    const g = load.glance;
    const name = g?.dogName ? dogName(g.dogName) : null;
    const facts = [wardLabel(g?.wardId, g?.wardName), g?.openedAt ? `raised ${clock(g.openedAt)}` : null]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          <h1 className={`${styles.title34} ${styles.spacedSm}`}>
            {name ? `Couldn't load ${name}'s case.` : "Couldn't load this case."}
          </h1>
          <p className={styles.lead}>{g ? "The signal dropped. Here's what your alert said:" : "The signal dropped."}</p>
          {g && (g.severity || g.pushBody) && (
            <div className={styles.glance}>
              <DogAvatar id={g.dogSlug ?? caseId} name={name ?? "Dog"} size={52} />
              <div className={styles.glanceText}>
                <span className={styles.glanceTitle}>{g.severity ? severityLine(g.severity) : g.pushBody}</span>
                {facts && <span className={styles.sub14}>{facts}</span>}
              </div>
            </div>
          )}
          {load.care.length > 0 && (
            <ul className={styles.careList} aria-label="Vets saved on this phone">
              {load.care.map((n) => (
                <li key={n.id} className={styles.careRow}>
                  <span className={styles.careText}>
                    <span className={styles.careName}>{n.name}</span>
                    <span className={styles.sub14}>
                      {[n.kind === "vet" ? "Vet" : "NGO", n.is24x7 ? "24 hours" : null, "saved on this phone"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Button href={telHref(n.phoneE164)} variant="tinted">
                    Call
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <StickyFooter divider={false}>
          <Button fullWidth onClick={() => void fetchCase()}>
            Try again
          </Button>
        </StickyFooter>
      </div>
    );
  }

  // --- a loaded case --------------------------------------------------------
  const { c, mine } = load;
  const name = c.dog?.name ? dogName(c.dog.name) : null;
  const p = pronouns(sexOf(c.dog));
  const avatarId = c.dog?.slug ?? c.id;
  const where = wardLabel(c.wardId, c.wardName);
  const code = wardCode(c.wardId);
  const closed = isClosed(c.state);
  const rows = timelineRows(c, name, { mine });

  // --- V21 closed ---------------------------------------------------------
  if (closed) {
    const good = c.outcome !== "died" && c.state !== "false_alarm" && c.outcome !== "false_alarm";
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          <StatusPill variant={good ? "ok" : "neutral"} icon={good ? "check" : "cross"} size="row" className={styles.pill}>
            {good ? "Resolved" : "Closed"}
            {c.resolvedAt ? ` · ${since(c.resolvedAt)}` : ""}
          </StatusPill>
          <h1 className={styles.title34}>{closedTitle(c, name)}</h1>
          <p className={styles.lead}>{closedLead(c, p, mine)}</p>
          <Timeline rows={rows} meridiem={false} />
        </div>
        <StickyFooter divider={false}>
          {c.dog?.slug ? (
            <Button href={`/d/${c.dog.slug}`} fullWidth>
              See {name ?? "the dog"}&rsquo;s page
            </Button>
          ) : (
            <Button href="/map" fullWidth>
              Back to the map
            </Button>
          )}
        </StickyFooter>
      </div>
    );
  }

  // --- P10 yours ----------------------------------------------------------
  if (mine) {
    const care = c.nearestCare ?? null;
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          <h1 className={styles.title30}>{name ? `${name} is waiting for you.` : "The dog is waiting for you."}</h1>
          <div className={styles.pills} aria-live="polite">
            <StatusPill variant="ok" icon="check" size="row">
              You took this{c.ackedAt ? ` · ${since(c.ackedAt)}` : ""}
            </StatusPill>
          </div>
          {c.location ? (
            <SpotMap lat={c.location.lat} lng={c.location.lng} />
          ) : (
            <p className={styles.sub14}>{where ? `${where}. The exact spot is loading.` : "The exact spot is loading."}</p>
          )}
          {c.note && <p className={styles.quote}>&ldquo;{c.note.trim()}&rdquo;</p>}
          <div className={styles.mist}>
            {care && (
              <div className={styles.mistRow}>
                <span className={styles.careText}>
                  <span className={styles.careName}>{care.name}</span>
                  <span className={styles.sub14}>Nearest vet</span>
                </span>
                {care.phoneE164 && (
                  <Button href={telHref(care.phoneE164)} variant="tinted" aria-label={`Call ${care.name}`}>
                    Call
                  </Button>
                )}
              </div>
            )}
            {!c.closeByAt ? (
              <button type="button" className={styles.mistBtn} onClick={() => void step("closeBy")} disabled={busy}>
                <span>Tell the reporter you&rsquo;re close</span>
                <span className={styles.chev} aria-hidden="true">
                  ›
                </span>
              </button>
            ) : !c.arrivedAt ? (
              <button type="button" className={styles.mistBtn} onClick={() => void step("arrived")} disabled={busy}>
                <span>
                  I&rsquo;m with {name ?? "the dog"}
                  <span className={styles.mistSub}>The reporter knows you&rsquo;re close</span>
                </span>
                <span className={styles.chev} aria-hidden="true">
                  ›
                </span>
              </button>
            ) : (
              <div className={styles.mistRow} role="status">
                <span>With {name ?? "the dog"}</span>
                <span className={styles.sub14}>{clock(c.arrivedAt)}</span>
              </div>
            )}
          </div>
          {actionError && (
            <p className={styles.alert} role="alert">
              {actionError}
            </p>
          )}
        </div>
        <StickyFooter>
          <Button fullWidth onClick={() => setSheet(true)}>
            Mark resolved
          </Button>
          <button type="button" className={styles.linkBtn} onClick={() => void release()} disabled={busy}>
            I can&rsquo;t make it after all
          </button>
        </StickyFooter>

        {sheet && (
          <div className={styles.scrim} onClick={() => setSheet(false)}>
            <div
              className={styles.sheet}
              role="dialog"
              aria-modal="true"
              aria-labelledby="close-title"
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.grabber} aria-hidden="true" />
              <div className={styles.sheetHead}>
                <h2 id="close-title" className={styles.sheetTitle}>
                  How did it end?
                </h2>
                <p className={styles.sheetLead}>This closes the case for everyone, and tells the person who raised it.</p>
              </div>
              <div className={styles.options} role="radiogroup" aria-labelledby="close-title">
                {OUTCOMES.map((o) => {
                  const on = outcome === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? `${styles.option} ${styles.optionOn}` : styles.option}
                      onClick={() => setOutcome(o.value)}
                    >
                      <span className={on ? styles.radioOn : styles.radioOff} aria-hidden="true">
                        {on ? "✓" : ""}
                      </span>
                      {o.label(p)}
                    </button>
                  );
                })}
              </div>
              {outcome === "taken_to_vet" && (
                <input
                  className={styles.vetInput}
                  placeholder="Which vet? (optional)"
                  aria-label="Which vet? (optional)"
                  value={vetName}
                  maxLength={80}
                  onChange={(e) => setVetName(e.target.value)}
                />
              )}
              {resolveError && (
                <p className={styles.alert} role="alert">
                  {resolveError}
                </p>
              )}
              <div className={styles.sheetFoot}>
                <Button fullWidth onClick={() => void resolve()} disabled={!outcome || busy} aria-busy={busy || undefined}>
                  Close the case
                </Button>
                <button type="button" className={styles.linkBtn} onClick={() => setSheet(false)}>
                  Not yet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const header = (
    <div className={styles.dogRow}>
      <DogAvatar id={avatarId} name={name ?? "Dog"} photoUrl={c.dog?.photoUrl ?? null} size={56} />
      <span className={styles.dogLine}>
        {[name, where].filter(Boolean).join(" · ")}
        <br />
        {severityLine(c.severity)}
      </span>
    </div>
  );

  // --- L4 someone else took it -------------------------------------------
  if (c.ackedAt) {
    const who = c.respondingName;
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {back}
          {header}
          <h1 className={styles.title34}>
            {who ? `${who} is on the way to ${name ?? "the dog"}.` : `Someone is on the way to ${name ?? "the dog"}.`}
          </h1>
          <StatusPill variant="ok" icon="check" size="row" className={styles.pill}>
            Covered · taken {since(c.ackedAt)}
          </StatusPill>
          <p className={styles.lead}>Thanks for looking. If they need a hand, you&rsquo;ll get a note.</p>
          {nearby.length > 0 && code && (
            <Link href={`/map#ward=${encodeURIComponent(code)}`} className={styles.meanwhile}>
              <span className={styles.mwLabel}>Meanwhile, near you</span>
              <span className={styles.mwRow}>
                <span className={styles.mwFaces} aria-hidden="true">
                  {nearby.slice(0, 2).map((d) => (
                    <DogAvatar key={d.name} id={d.name} name={d.name} size={36} ring="var(--h-mist)" />
                  ))}
                </span>
                <span className={styles.mwText}>
                  {namesList(nearby.map((d) => d.name))} {nearby.length === 1 ? "hasn't" : "haven't"} been logged in {code} today.
                </span>
                <span className={styles.chev} aria-hidden="true">
                  ›
                </span>
              </span>
            </Link>
          )}
        </div>
        <StickyFooter divider={false}>
          <Button href="/map" fullWidth>
            Back to the map
          </Button>
        </StickyFooter>
      </div>
    );
  }

  // --- P9 open / L5 escalated: takeable ------------------------------------
  const escalated = c.state === "escalated";
  const canTake = isTakeable(c.state);
  const dist = typeof c.distanceM === "number" ? c.distanceM : null;
  const takeLabel = escalated && name ? `I can go and help ${name}` : "I can go and help";

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        {back}
        {escalated ? (
          <>
            {header}
            <h1 className={styles.title34}>{name ? `Nobody has reached ${name} yet.` : "Nobody has reached the dog yet."}</h1>
            <StatusPill variant="danger" icon="alert" size="row" className={styles.pill}>
              {duration(c.openedAt)} · vets told
            </StatusPill>
            <p className={styles.lead}>
              {cap(p.possessive)} feeders didn&rsquo;t answer, so every vet{code ? ` in ${code}` : " nearby"} was told
              {c.escalatedAt ? ` at ${clock(c.escalatedAt, false)}` : ""}. None has taken it. You still can.
            </p>
          </>
        ) : (
          <>
            <div className={styles.dogRow}>
              <DogAvatar id={avatarId} name={name ?? "Dog"} photoUrl={c.dog?.photoUrl ?? null} size={56} />
              <span className={styles.dogHead}>
                <span className={styles.eyebrow}>{[name, where].filter(Boolean).join(" · ")}</span>
                <h1 className={styles.title26}>{severityLine(c.severity)}</h1>
              </span>
            </div>
            <div className={styles.pills} aria-live="polite">
              <StatusPill variant="danger" icon="alert" size="row">
                Nobody has taken it
              </StatusPill>
              <StatusPill variant="neutral" icon="clock" size="row">
                {since(c.openedAt)}
              </StatusPill>
            </div>
            {(c.note || c.reporterPhotoUrl) && (
              <div className={styles.report}>
                {c.reporterPhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.reportPhoto} src={c.reporterPhotoUrl} alt="Photo sent with the SOS" />
                )}
                <div className={styles.reportText}>
                  {c.note && <span className={styles.reportNote}>&ldquo;{c.note.trim()}&rdquo;</span>}
                  <span className={styles.sub13}>
                    {c.reporterAnonymous === true
                      ? "From a passer-by, no account"
                      : c.reporterAnonymous === false
                        ? "From a feeder"
                        : "From the person who raised it"}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        <Timeline rows={rows} meridiem={!escalated} />

        {!escalated && dist !== null && (
          <div className={styles.distance}>
            <span className={styles.distMain}>{distanceWords(dist)}</span>
            <span className={styles.sub14}>{autoMinutes(dist)}</span>
          </div>
        )}
        {released && (
          <p className={styles.sub14} role="status">
            {RELEASED_LINE}
          </p>
        )}
      </div>

      {(canTake || refusal) && (
        <StickyFooter>
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
          ) : declined ? (
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
                fullWidth
                onClick={() => void ack()}
                disabled={busy || refusal?.kind === "tooMany"}
                aria-busy={busy || undefined}
              >
                {takeLabel}
              </Button>
              {!refusal && (
                <p className={styles.caption}>
                  {escalated && dist !== null ? `${distanceWords(dist)}. ${SPOT_CAPTION}` : SPOT_CAPTION}
                </p>
              )}
              {actionError && (
                <p className={styles.footMsg} role="alert">
                  {actionError}
                </p>
              )}
              {!escalated && (
                <button type="button" className={styles.linkBtn} onClick={() => void decline()} disabled={busy}>
                  I can&rsquo;t go right now
                </button>
              )}
            </>
          )}
        </StickyFooter>
      )}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
