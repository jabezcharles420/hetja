"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { wardDisplay } from "@hetja/contracts";
import { Button, Label, StatusPill, StickyFooter } from "@/components/ds";
import { mapApi } from "@/app/map/api";
import { wardHash } from "@/components/map/logic";
import { api, ApiError, getAccessToken, type SosCase } from "@/lib/api";
import {
  ackRefusal,
  casePill,
  isClosed,
  isTakeable,
  severityWords,
  type AckMessage,
} from "@/lib/sos-ack";
import styles from "./sos-case.module.css";

/**
 * The responder's case page (audit B-01 / hardening T15). SOS pushes link
 * here; it used to be a 404 for every paged responder.
 *
 * Plain white, no motion, like screens 04 and 05. One loud button at most:
 * "I can go and help" while the case is takeable, "Mark resolved" while the
 * viewer holds it. The server decides who may take a case; this page only
 * explains its answer (lib/sos-ack.ts, shared with the map).
 */

type Load =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error" }
  | { kind: "ready"; c: SosCase; mine: boolean };

export const HIDDEN_TITLE = "This case isn't yours to see.";

/** "12 min ago", "3 h ago"; "just now" under a minute. */
export function raisedAgo(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "K/W ward · Andheri West", "K/W ward", or null with no ward. */
export function caseWardLine(c: Pick<SosCase, "wardId" | "wardName">): string | null {
  if (!c.wardId) return null;
  const d = wardDisplay(c.wardId);
  return [`${d.code} ward`, c.wardName ?? d.name].filter(Boolean).join(" · ");
}

/** The one plain sentence under the pills. */
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

/**
 * Does the viewer hold this case? GET /sos/cases/:id does not promise to say,
 * so, in order: the case's own `mine` / `ackedBy` when a server sends them,
 * then the map's ward detail (which marks the viewer's own case `mine`).
 */
async function resolveMine(c: SosCase): Promise<boolean> {
  if (typeof c.mine === "boolean") return c.mine;
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

export default function SosCaseScreen({ caseId }: { caseId: string }): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<AckMessage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(`/sos/${caseId}`)}`);
  }, [caseId]);

  const fetchCase = useCallback(async () => {
    try {
      const c = await api.getSosCase(caseId);
      const mine = await resolveMine(c);
      setLoad({ kind: "ready", c, mine });
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
      setLoad({
        kind: "ready",
        c: { ...load.c, state: load.c.state === "open" ? "acked" : load.c.state, ackedAt: new Date().toISOString() },
        mine: true,
      });
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

  const top = (
    <div className={styles.top}>
      <Link href="/map" className={styles.back}>
        ‹ Map
      </Link>
    </div>
  );

  if (load.kind === "loading") {
    return (
      <div className={styles.page}>
        {top}
        <div className={styles.body} aria-busy="true">
          <Label>SOS case</Label>
          <p className={styles.lead}>Loading the case.</p>
        </div>
      </div>
    );
  }

  if (load.kind === "hidden" || load.kind === "error") {
    const hidden = load.kind === "hidden";
    return (
      <div className={styles.page}>
        {top}
        <div className={styles.body}>
          <Label>SOS case</Label>
          <h1 className={styles.title}>{hidden ? HIDDEN_TITLE : "Hetja could not be reached."}</h1>
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
        </div>
        <StickyFooter>
          <Button href="/map" fullWidth>
            Open the map
          </Button>
        </StickyFooter>
      </div>
    );
  }

  const { c, mine } = load;
  const pill = casePill(c.state, mine);
  const ward = caseWardLine(c);
  const code = c.wardId ? wardDisplay(c.wardId).code : null;
  const canTake = isTakeable(c.state) && !mine;
  const canResolve = mine && !isClosed(c.state);

  return (
    <div className={styles.page}>
      {top}
      <div className={styles.body}>
        <Label>SOS case</Label>
        <h1 className={styles.title}>{severityWords(c.severity)}</h1>
        {ward && <p className={styles.ward}>{ward}</p>}
        <div className={styles.pills} aria-live="polite">
          <StatusPill variant={pill.variant} icon={pill.icon} size="row">
            {pill.text}
          </StatusPill>
          <StatusPill variant="neutral" icon="clock" size="row">
            Raised {raisedAgo(c.openedAt)}
          </StatusPill>
        </div>
        <p className={styles.lead}>{caseLead(c, mine)}</p>
        {code && c.wardId && (
          <Link href={`/map${wardHash(code)}`} className={styles.mapLink}>
            See {code} on the map ›
          </Link>
        )}
      </div>

      {(canTake || canResolve || refusal) && (
        <StickyFooter
          caption={canTake && !refusal ? "Trusted responders only. The exact spot stays private." : undefined}
        >
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
            <Button
              fullWidth
              onClick={() => void ack()}
              disabled={busy || refusal?.kind === "tooMany"}
              aria-busy={busy || undefined}
            >
              I can go and help
            </Button>
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
