"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, StickyFooter } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { api, ApiError, getAccessToken, type Alert } from "@/lib/api";
import { groupAlerts, relativeTime, type AlertDot } from "@/lib/alerts";
import { markAlertsSeen } from "@/lib/me-hub";
import styles from "./alerts.module.css";

/**
 * N5 Alerts (design v5), a focused screen reached from Me since v6 (Alerts
 * left the tab bar): the last 14 days of what happened to the
 * dogs this feeder looks after, newest first, grouped by day. Every row opens
 * the screen that deals with it (alert.href).
 */

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: Alert[]; now: Date };

const DOT_CLASS: Record<AlertDot, string> = {
  sos: styles.dotSos!,
  attention: styles.dotAttention!,
  ok: styles.dotOk!,
  off: styles.dotOff!,
};

const DOT_WORDS: Record<AlertDot, string> = {
  sos: "Urgent",
  attention: "Needs a look",
  ok: "Good news",
  off: "Update",
};

export default function AlertsPage(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setState({ kind: "signed-out" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await api.getAlerts();
      setState({ kind: "ready", items: Array.isArray(res?.items) ? res.items : [], now: new Date() });
      // Me's Alerts row counts what arrived after this visit.
      markAlertsSeen();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
        setState({ kind: "signed-out" });
      } else {
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message : "Could not load your alerts.",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "signed-out") {
    return (
      <div className={styles.page}>
        <AppHeader back={{ href: "/me", label: "Me", history: true }} surface="mist" />
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Alerts</h1>
          <p className={styles.lead}>
            When a dog you feed is hurt, loses a tag or sees a vet, you hear about it here.
          </p>
        </div>
        <StickyFooter
          background="none"
          className={styles.footer}
          captionPosition="above"
          caption="No password, just a code by email."
        >
          <Button href="/login?next=%2Falerts" fullWidth>
            Sign in
          </Button>
        </StickyFooter>
      </div>
    );
  }

  if (state.kind !== "ready") {
    return (
      <div className={styles.page}>
        <AppHeader back={{ href: "/me", label: "Me", history: true }} surface="mist" />
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Alerts</h1>
          {state.kind === "error" ? (
            <>
              <p className={styles.error} role="alert">
                {state.message}
              </p>
              <div>
                <Button variant="quiet" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            </>
          ) : (
            <p className={styles.lead} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  const sections = groupAlerts(state.items, state.now);

  return (
    <div className={styles.page}>
      <AppHeader back={{ href: "/me", label: "Me", history: true }} surface="mist" />
      <div className={`h-container ${styles.body}`}>
        <h1 className={styles.title}>Alerts</h1>
        {sections.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing yet.</p>
            <p className={styles.lead}>
              Quiet is good. When a dog you feed needs you, it shows up here first.
            </p>
          </div>
        ) : (
          sections.map((sec) => (
            <section key={sec.label} className={styles.section} aria-label={sec.label}>
              <h2 className={styles.label}>{sec.label}</h2>
              <ul className={styles.card}>
                {sec.items.map((a) => (
                  <li key={a.id} className={styles.item}>
                    <Link href={a.href} className={styles.row}>
                      <span className={`${styles.dot} ${DOT_CLASS[a.dot]}`} aria-hidden="true" />
                      <span className="h-sr-only">{DOT_WORDS[a.dot]}: </span>
                      <span className={styles.text}>
                        <span className={styles.rowTitle}>{a.title}</span>
                        {a.detail ? <span className={styles.rowDetail}>{a.detail}</span> : null}
                      </span>
                      <time className={styles.when} dateTime={a.at}>
                        {relativeTime(a.at, state.now)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
