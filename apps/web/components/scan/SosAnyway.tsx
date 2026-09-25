"use client";

import { useState } from "react";
import { wardDisplay } from "@hetja/contracts";
import { Button } from "@/components/ds";
import { api, ApiError, type NearbyCareProvider, type OpenCaseRef, type SosSeverity } from "@/lib/api";
import { careLine, nearestWard, telHref } from "@/lib/scan-code";
import styles from "./FindScreen.module.css";

/**
 * F1 "Dog is hurt · Send SOS anyway" at /scan/find?sos=1 (design v5 F1,
 * v6 P8: the dogless SOS).
 *
 * With a location inside Mumbai the person picks how bad it is (the collar
 * page's three choices, same copy) and sends an SOS with no dog: POST
 * /reports without dogSlug, geo required. The case is located to their ward
 * and pages that ward's feeders and vets. Then "Your SOS is out." with who
 * was told and the numbers to call. Without a location (or outside Mumbai)
 * there is nothing to locate the case to, so it says so and offers the care
 * list. Either way the ward-and-photo finder follows on the page: picking the
 * dog opens its own page, where its SOS reaches that dog's own feeders.
 */

export type Care =
  | { kind: "loading" }
  | { kind: "ok"; providers: NearbyCareProvider[] }
  | { kind: "nolocation" }
  | { kind: "error" };

type Choice = "moving" | "urgent" | "other";

/** The collar page's choices (apps/scan/src/format.ts CHOICES), same copy and severities. */
export const SOS_CHOICES: ReadonlyArray<{ key: Choice; title: string; sub: string; severity: SosSeverity }> = [
  { key: "moving", title: "Hurt, but moving", sub: "Limping, a wound, not eating", severity: "serious" },
  { key: "urgent", title: "Can't get up, or bleeding", sub: "Needs a vet now", severity: "critical" },
  { key: "other", title: "Something else", sub: "Missing, scared, or being harmed", severity: "serious" },
];

type Send =
  | { kind: "choose" }
  | { kind: "sending" }
  | { kind: "sent"; wardCode: string; feeders: number | null; vets: number | null }
  | { kind: "open"; open: OpenCaseRef | null }
  | { kind: "failed"; reason: "offline" | "outside" | "limited" | "failed" };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function timeOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** "Your SOS is out." and who got it, from GET /reports/:id/status when it answers. */
export function toldCopy(s: { wardCode: string; feeders: number | null; vets: number | null }): {
  title: string;
  lead: string;
} {
  if (s.feeders === null || s.vets === null) {
    return { title: "Your SOS is out.", lead: `Feeders and vets in ${s.wardCode} got it just now.` };
  }
  if (s.feeders === 0 && s.vets === 0) {
    return { title: "Nobody nearby was reached.", lead: "Please call someone below." };
  }
  const who = [s.feeders ? plural(s.feeders, "feeder") : "", s.vets ? plural(s.vets, "vet") : ""]
    .filter(Boolean)
    .join(" and ");
  return { title: "Your SOS is out.", lead: `${who} in ${s.wardCode} got it just now.` };
}

export default function SosAnyway({
  geo,
  care,
  onCare,
}: {
  /** undefined while locating, null when the phone gave no position. */
  geo: { lat: number; lng: number } | null | undefined;
  care: Care;
  onCare: (care: Care) => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [send, setSend] = useState<Send>({ kind: "choose" });

  const ward = geo ? nearestWard(geo.lat, geo.lng) : null;
  const wardCode = ward ? wardDisplay(ward).code : null;

  const submit = async () => {
    if (!geo || !choice) return;
    const pick = SOS_CHOICES.find((c) => c.key === choice)!;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSend({ kind: "failed", reason: "offline" });
      return;
    }
    setSend({ kind: "sending" });
    try {
      const res = await api.createReportV6({ severity: pick.severity, geo: { lat: geo.lat, lng: geo.lng } });
      if (res.nearbyCare?.length) onCare({ kind: "ok", providers: res.nearbyCare.slice(0, 5) });
      const code = res.wardId ? wardDisplay(res.wardId).code : (wardCode ?? "your ward");
      setSend({ kind: "sent", wardCode: code, feeders: null, vets: null });
      try {
        const status = await api.getReportStatus(res.caseId);
        setSend({ kind: "sent", wardCode: code, feeders: status.feedersNotified, vets: status.vetsNotified });
      } catch {
        // The SOS is out either way; the counts are a nicety.
      }
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      const data = (e?.data ?? null) as { openCase?: OpenCaseRef; nearbyCare?: NearbyCareProvider[] } | null;
      if (data?.nearbyCare?.length) onCare({ kind: "ok", providers: data.nearbyCare.slice(0, 5) });
      if (e?.code === "SOS_CASE_OPEN" || data?.openCase) {
        setSend({ kind: "open", open: data?.openCase ?? null });
        return;
      }
      const status = e?.status ?? 0;
      setSend({
        kind: "failed",
        reason:
          e?.code === "GEO_OUTSIDE_MUMBAI"
            ? "outside"
            : status === 0 || status === 408
              ? "offline"
              : status === 429
                ? "limited"
                : "failed",
      });
    }
  };

  let head: React.ReactNode;
  if (geo === undefined) {
    head = <Intro title="Get the dog help now." lead={"Finding where you are…"} />;
  } else if (geo === null) {
    head = (
      <Intro
        title="Get the dog help now."
        lead="Hetja needs your location to send an SOS without the dog's code. Turn on location for this site, or call someone below."
      />
    );
  } else if (!ward) {
    head = (
      <Intro title="Get the dog help now." lead="Hetja only covers Mumbai for now, so it can't send this SOS. Please call someone below." />
    );
  } else if (send.kind === "sent") {
    const t = toldCopy(send);
    head = <Intro title={t.title} lead={t.lead} done={t.title === "Your SOS is out."} />;
  } else if (send.kind === "open") {
    const at = send.open ? timeOf(send.open.raisedAt) : null;
    const who = send.open?.responderFirstName && send.open.takenAt ? `${send.open.responderFirstName} is on the way.` : "Feeders and vets in your ward have it.";
    head = <Intro title="Your SOS is already out." lead={`${at ? `You sent one from here at ${at}. ` : ""}${who}`} done />;
  } else if (send.kind === "failed") {
    const lead =
      send.reason === "outside"
        ? "Hetja only covers Mumbai for now. Please call someone below."
        : send.reason === "offline"
          ? "No signal, so it didn't go out. Please call someone below, and try again when you can."
          : send.reason === "limited"
            ? "This phone has sent the most SOS reports allowed for now. Please call someone below."
            : "Hetja couldn't send it. Please call someone below.";
    head = (
      <>
        <Intro title="SOS not sent." lead={lead} failed />
        {send.reason !== "outside" && send.reason !== "limited" && (
          <Button variant="quiet" onClick={() => void submit()} className={styles.retry}>
            Try again
          </Button>
        )}
      </>
    );
  } else {
    const sending = send.kind === "sending";
    head = (
      <>
        <Intro title="How bad is it?" lead="Pick the closest one." />
        <div className={styles.choices} role="radiogroup" aria-label="How bad is it?">
          {SOS_CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={choice === c.key}
              className={[styles.choice, choice === c.key ? styles.choiceOn : ""].filter(Boolean).join(" ")}
              onClick={() => setChoice(c.key)}
              disabled={sending}
            >
              <span className={styles.radio} aria-hidden="true">
                {choice === c.key && (
                  <svg width="14" height="14" viewBox="0 0 16 16">
                    <path
                      d="M3 8.5l3 3 7-7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className={styles.choiceText}>
                <span className={styles.choiceTitle}>{c.title}</span>
                <span className={styles.choiceSub}>{c.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <p className={styles.privacy}>Shares {wardCode} ward with feeders and vets. Never your exact spot.</p>
        <Button variant="sos" bang={false} fullWidth disabled={!choice || sending} onClick={() => void submit()}>
          {sending ? "Sending SOS…" : "Send SOS"}
        </Button>
      </>
    );
  }

  const beforeSend = geo && ward && (send.kind === "choose" || send.kind === "sending");
  return (
    <section className={styles.care} aria-labelledby="sos-title">
      {head}
      <p className={styles.callLabel}>{beforeSend ? "Or call now" : "Call now"}</p>
      <CareList care={care} />
    </section>
  );
}

function Intro({
  title,
  lead,
  done,
  failed,
}: {
  title: string;
  lead: string;
  done?: boolean;
  failed?: boolean;
}): React.JSX.Element {
  return (
    <>
      {(done || failed) && (
        <span className={[styles.bigIcon, failed ? styles.bigIconDanger : ""].filter(Boolean).join(" ")} aria-hidden="true">
          {failed ? (
            "!"
          ) : (
            <svg width="26" height="26" viewBox="0 0 16 16">
              <path
                d="M3 8.5l3 3 7-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}
      <h1 id="sos-title" className={styles.title} tabIndex={-1}>
        {title}
      </h1>
      <p className={styles.lead} role={done || failed ? "status" : undefined}>
        {lead}
      </p>
    </>
  );
}

export function CareList({ care }: { care: Care }): React.JSX.Element {
  return (
    <ul className={styles.careList} aria-live="polite">
      {care.kind === "loading" && (
        <li className={styles.careRow}>
          <span className={styles.careText}>
            <span className={styles.careName}>Finding help near you&hellip;</span>
          </span>
        </li>
      )}
      {care.kind === "ok" &&
        care.providers.map((p) => (
          <li key={p.id} className={styles.careRow}>
            <span className={styles.careText}>
              <span className={styles.careName}>{p.name}</span>
              <span className={styles.careSub}>{careLine(p)}</span>
            </span>
            {p.phoneE164 && (
              <Button variant="tinted" size="lg" href={telHref(p.phoneE164)} aria-label={`Call ${p.name}`}>
                Call
              </Button>
            )}
          </li>
        ))}
      {(care.kind === "nolocation" || care.kind === "error" || (care.kind === "ok" && care.providers.length === 0)) && (
        <li className={styles.careRow}>
          <span className={styles.careText}>
            <span className={styles.careName}>No nearby help loaded</span>
            <span className={styles.careSub}>
              {care.kind === "nolocation"
                ? "Turn on location, or pick your ward below, to see help nearby. "
                : care.kind === "error"
                  ? "Couldn't load nearby help right now. "
                  : ""}
              Call a local vet or animal helpline from your phone. If the dog is in traffic and you can do so safely,
              move yourself out of the road first.
            </span>
          </span>
        </li>
      )}
    </ul>
  );
}
