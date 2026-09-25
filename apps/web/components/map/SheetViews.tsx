"use client";

import { useEffect, useRef, useState } from "react";
import { Button, DogAvatar, Label } from "@/components/ds";
import type { Me, WardDetail } from "@/app/map/api";
import type { DogSex } from "@/lib/api";
import type { AckMessage } from "@/lib/sos-ack";
import {
  ackBody,
  ackTitle,
  autoTrip,
  callLabel,
  cityStats,
  citySosRows,
  cityWords,
  directionsHref,
  distanceLabel,
  dogsLabel,
  feedHereLabel,
  firstLocality,
  formatPhone,
  hoursPill,
  hungriest,
  kindWord,
  lastLoggedLabel,
  needsHelpLabel,
  notLoggedLead,
  openNow,
  placeLead,
  placeWhere,
  severityLabel,
  shortAgo,
  sosCardSub,
  sosCardTitle,
  staleLead,
  telHref,
  wardDogsLine,
  wardLead,
  type CitySos,
  type CitySummary,
  type MapPlace,
  type MapWard,
  type Severity,
} from "./logic";
import styles from "./MapScreen.module.css";

/**
 * The sheet's views: city (M1, V20, M7), ward (M2, M6, with M3 and M4 for
 * taking a case) and place (M5). All copy is the v6 mocks' unless a comment
 * says why it changed.
 */

/** Trust floors of the SOS fan-out (apps/api routes/sos.ts), for the explanation only. */
const FLOOR: Record<Severity, number> = { minor: 40, serious: 40, critical: 60 };

export type FootState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "needSignIn" }
  | { kind: "notResponder"; viewer: NonNullable<WardDetail["viewer"]>; severity: Severity }
  | {
      kind: "acked";
      caseId?: string | null;
      dogName?: string | null;
      /** From GET /sos/cases/:id, for "her" / "his". */
      dogSex?: DogSex | null;
      location?: { lat: number; lng: number } | null;
      distanceM?: number | null;
    }
  | { kind: "refused"; msg: AckMessage }
  | { kind: "taken" }
  | { kind: "alertsOn" }
  | { kind: "error" };

function Check({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Clock({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Ic(): React.JSX.Element {
  return <i className={styles.ic} aria-hidden="true" />;
}

function Shield(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5l5.5 2v4c0 3.4-2.4 6-5.5 7-3.1-1-5.5-3.6-5.5-7v-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Privacy(): React.JSX.Element {
  return (
    <div className={styles.note}>
      <Shield />
      <span>Dogs are shown by ward, never by street. Vets and NGOs are public places, so they get a pin.</span>
    </div>
  );
}

/** M6's short form, under a ward's named dogs. */
function WardPrivacy(): React.JSX.Element {
  return (
    <div className={styles.note}>
      <Shield />
      <span>Shown by ward, never by street.</span>
    </div>
  );
}

function Back({ onBack, label = "All of Mumbai" }: { onBack: () => void; label?: string }): React.JSX.Element {
  return (
    <button type="button" className={styles.back} onClick={onBack}>
      ‹ {label}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function CityView({
  wards,
  summary,
  sos,
  error,
  staleAt,
  peek,
  onRetry,
  onWard,
}: {
  wards: MapWard[] | null;
  summary?: CitySummary | null;
  /** v6 city SOS rows (no case ids: a row opens its ward). */
  sos?: CitySos[] | null;
  error: boolean;
  /** When the counts on the map are the cached ones (M7), their time. */
  staleAt?: number | null;
  peek: boolean;
  onRetry: () => void;
  onWard: (id: string) => void;
}): React.JSX.Element {
  const foot = (
    <div className={styles.foot}>
      <Button href="/scan" fullWidth>
        Scan a collar
      </Button>
    </div>
  );

  if (!wards || staleAt) {
    return (
      <>
        {/* M7: the retry and the stale line never hide in the peek. */}
        <div className={`${styles.body} ${error || staleAt ? styles.noPeek : ""}`} aria-live="polite">
          {error || staleAt ? (
            <>
              <h1 className={styles.h1}>The map is here. The numbers are not.</h1>
              <p className={styles.lead}>
                {staleAt
                  ? staleLead(staleAt)
                  : "Hetja could not be reached just now, so the ward counts are missing. The map still works. Try again in a minute."}
              </p>
              <Button variant="quiet" onClick={onRetry} className={styles.retry}>
                Try again
              </Button>
            </>
          ) : (
            <>
              <Label className={styles.label}>Mumbai right now</Label>
              <h1 className={styles.h1}>Counting Mumbai&apos;s dogs…</h1>
            </>
          )}
        </div>
        {foot}
      </>
    );
  }

  const words = cityWords(wards, summary, Date.now(), sos);
  const stats = cityStats(wards, summary);
  const sosRows = citySosRows(wards, sos);
  const quiet = hungriest(wards);
  // In peek only the headline shows; the rest is clipped, so keep it out of
  // the tab order and the accessibility tree until the sheet is opened.
  const rest = peek ? { inert: "" as unknown as boolean, "aria-hidden": true } : {};

  return (
    <>
      <div className={styles.body}>
        <Label className={styles.label}>Mumbai right now</Label>
        <h1 className={styles.h1}>{words.h1}</h1>
        <div style={{ display: "contents" }} {...rest}>
          {words.lead && <p className={styles.lead}>{words.lead}</p>}
          <p className={styles.statLine}>
            {stats.map((s) => (
              <span key={s.label}>
                <b>{s.n}</b> {s.label}
              </span>
            ))}
          </p>
          {sosRows.length > 0 && (
            <>
              <Label className={`${styles.label} ${styles.listLabel}`}>Needs help</Label>
              <div className={styles.rows}>
                {sosRows.map((r) => (
                  <button key={r.key} type="button" className={styles.row} onClick={() => onWard(r.wardId)}>
                    <DogAvatar id={r.title} name={r.initial} size={44} />
                    <div className={styles.t}>
                      <b>{r.title}</b>
                      {r.severity && r.raisedAt && (
                        <span>
                          {severityLabel(r.severity)} · {shortAgo(r.raisedAt)}
                        </span>
                      )}
                    </div>
                    {r.taken ? (
                      <span className={`${styles.pill} ${styles.warn}`}>
                        <Clock />
                        Taken
                      </span>
                    ) : (
                      <span className={`${styles.pill} ${styles.dang}`}>
                        <Ic />
                        Open
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          {quiet.length > 0 && (
            <>
              <Label className={`${styles.label} ${styles.listLabel}`}>Not logged today</Label>
              <div className={styles.rows}>
                {quiet.map((w) => (
                  <button key={w.id} type="button" className={styles.row} onClick={() => onWard(w.id)}>
                    <div className={styles.t}>
                      <b>
                        {w.code} ward · {firstLocality(w.name)}
                      </b>
                      <span>{dogsLabel(w.dogs)}</span>
                    </div>
                    <span className={`${styles.pill} ${styles.warn}`}>
                      <Clock />
                      {w.notFedToday} not logged
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className={styles.legend}>
            <span>
              <i className={`${styles.sw} ${styles.swSos}`}>!</i>Needs help
            </span>
            <span>
              <i className={`${styles.sw} ${styles.swHun}`}>
                <Clock />
              </i>
              Not fed today
            </span>
            <span>
              <i className={`${styles.sw} ${styles.swOk}`}>
                <Check />
              </i>
              All fed
            </span>
            <span>
              <i className={`${styles.sw} ${styles.swVet}`}>+</i>Vet
            </span>
            <span>
              <i className={`${styles.sw} ${styles.swNgo}`}>N</i>NGO
            </span>
          </div>
          <Privacy />
        </div>
      </div>
      {foot}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * M3: help tapped while signed out. A sheet over the map, one line on why,
 * and something useful for a non-member right now (the nearest vet's Call).
 */
export function SignInSheet({
  dogName,
  place,
  loginHref,
  onClose,
}: {
  dogName: string | null;
  place: MapPlace | null;
  loginHref: string;
  onClose: () => void;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  const title = dogName ? `Sign in to take ${dogName}'s case.` : "Sign in to take this case.";
  return (
    <div className={styles.dialogRoot}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-signin-title"
        tabIndex={-1}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.dialogText}>
          <h2 id="map-signin-title" className={styles.dialogTitle}>
            {title}
          </h2>
          <p className={styles.dialogLead}>
            It takes a minute with your email. The exact spot is only shared with someone Hetja can reach again.
          </p>
        </div>
        {place?.phoneE164 && (
          <div className={styles.waitCard}>
            <div className={styles.t}>
              <span className={styles.waitLabel}>Can&apos;t wait?</span>
              <b>{place.name}</b>
            </div>
            <Button variant="tinted" href={telHref(place.phoneE164)} className={styles.callBtn} aria-label={`Call ${place.name}`}>
              Call
            </Button>
          </div>
        )}
        <div className={styles.dialogActions}>
          <Button href={loginHref} fullWidth>
            Sign in with email
          </Button>
          <button type="button" className={styles.linkBtn} onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

/** M4: the case is yours. The primary gets the responder moving. */
export function AckedView({ foot }: { foot: Extract<FootState, { kind: "acked" }> }): React.JSX.Element {
  const name = foot.dogName ?? null;
  const caseHref = foot.caseId ? `/sos/${encodeURIComponent(foot.caseId)}` : null;
  return (
    <>
      <div className={styles.body} aria-live="polite">
        <span className={styles.okCircle} aria-hidden="true">
          <Check size={24} />
        </span>
        <h1 className={styles.h1}>{ackTitle(name)}</h1>
        <p className={styles.lead}>{ackBody(name, foot.dogSex ?? null)}</p>
        {typeof foot.distanceM === "number" && (
          <p className={styles.trip}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 14.5s5-4.3 5-8.2A5 5 0 0 0 3 6.3c0 3.9 5 8.2 5 8.2z" />
              <circle cx="8" cy="6.3" r="1.8" />
            </svg>
            {autoTrip(foot.distanceM)}
          </p>
        )}
      </div>
      <div className={`${styles.foot} ${styles.footTask}`}>
        {foot.location ? (
          <>
            <Button href={directionsHref(foot.location)} fullWidth target="_blank" rel="noopener noreferrer">
              {name ? `Directions to ${name}` : "Directions"}
            </Button>
            {caseHref && (
              <Button variant="link" href={caseHref} className={styles.footLink}>
                Open the case
              </Button>
            )}
          </>
        ) : caseHref ? (
          <Button href={caseHref} fullWidth>
            Open the case
          </Button>
        ) : null}
      </div>
    </>
  );
}

function WardFoot({
  ward,
  detail,
  foot,
  me,
  onHelp,
  onFeedHere,
  onDismiss,
}: {
  ward: MapWard;
  detail: WardDetail | null;
  foot: FootState;
  me: Me | null | undefined;
  onHelp: () => void;
  onFeedHere: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const cases = detail?.sos ?? [];
  // Open cases with nobody on them yet; a ward whose cases are all taken
  // needs feeders, not another volunteer.
  const open = cases.filter((s) => !(s.taken ?? s.state === "acked") || s.mine);
  const needsSomeone = ward.sosOpen > 0 && (detail ? open.length > 0 : true);
  const busy = foot.kind === "busy";

  if (foot.kind === "notResponder") {
    const floor = FLOOR[foot.severity];
    const text = !foot.viewer.sosOptIn ? (
      <>
        <b>Turn on SOS paging in Me first.</b> Responders are feeders with paging on and a steady feeding record
        (trust {floor} or more; you have {foot.viewer.trustScore}).
      </>
    ) : (
      <>
        <b>Not yet.</b> Taking this case needs a trust score of {floor}. You have {foot.viewer.trustScore}. It grows
        every time you log a feed.
      </>
    );
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>{text}</p>
        <Button href={foot.viewer.sosOptIn ? "/scan" : "/me"} fullWidth>
          {foot.viewer.sosOptIn ? "Scan a collar" : "Open Me"}
        </Button>
        <div className={styles.footLinks}>
          <button type="button" className={styles.linkBtn} onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (foot.kind === "refused") {
    const m = foot.msg;
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>
          <b>{m.title}</b>
          {m.body ? ` ${m.body}` : null}
        </p>
        {m.action && (
          <Button href={m.action.href} fullWidth>
            {m.action.label}
          </Button>
        )}
        <div className={styles.footLinks}>
          <button type="button" className={styles.linkBtn} onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (foot.kind === "taken" || foot.kind === "alertsOn") {
    const msg =
      foot.kind === "taken" ? (
        <>
          <b>Someone else just took this one.</b> Thank you for offering.
        </>
      ) : (
        <>
          <b>{firstLocality(ward.name)} is one of your wards.</b> You&apos;ll hear about its dogs.
        </>
      );
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>{msg}</p>
      </div>
    );
  }

  const target = open.find((s) => s.caseId) ?? open[0] ?? null;
  const helpName = target?.dogName?.trim() || null;
  const already = !!me?.wards?.includes(ward.id);
  return (
    <div className={styles.foot} aria-live="polite">
      {foot.kind === "error" && <p className={styles.footMsg}>Hetja could not be reached. Try again in a minute.</p>}
      {needsSomeone ? (
        <Button fullWidth onClick={onHelp} disabled={busy || !detail}>
          {helpName ? `I can go and help ${helpName}` : "I can go and help"}
        </Button>
      ) : already ? (
        <p className={styles.footMsg}>
          <b>{firstLocality(ward.name)} is one of your wards.</b> You&apos;ll hear about its dogs.
        </p>
      ) : (
        <Button fullWidth onClick={onFeedHere} disabled={busy}>
          {feedHereLabel(ward)}
        </Button>
      )}
    </div>
  );
}

export function WardView({
  ward,
  detail,
  detailError,
  foot,
  me,
  loginHref,
  onBack,
  onHelp,
  onFeedHere,
  onRetry,
  onDismiss,
  onPlace,
}: {
  ward: MapWard;
  detail: WardDetail | null;
  detailError: boolean;
  foot: FootState;
  me: Me | null | undefined;
  loginHref: string;
  onBack: () => void;
  onHelp: () => void;
  onFeedHere: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onPlace?: (p: MapPlace) => void;
}): React.JSX.Element {
  if (foot.kind === "acked") return <AckedView foot={foot} />;

  // The ward list's numbers show at once; the detail (cases, nearby) follows.
  const w = detail ?? ward;
  const cases = detail?.sos ?? [];
  const nearby = detail?.nearby ?? [];
  const notLogged = detail?.notLoggedToday ?? [];
  const named = notLogged.filter((d) => d.name?.trim());
  const dogNames = detail?.dogNames ?? [];
  const dogsLine = wardDogsLine(dogNames, w.dogs, w.notFedToday);
  const m6 = cases.length === 0 && w.sosOpen === 0 && named.length > 0;
  const firstCase = cases.find((s) => !(s.taken ?? s.state === "acked")) ?? cases[0] ?? null;

  return (
    <>
      <div className={styles.body}>
        <Back onBack={onBack} />
        <div className={styles.wardHead}>
          <Label className={styles.label}>{w.code} ward</Label>
          <h1 className={`${styles.h1} ${styles.wardH1}`}>{w.name}</h1>
        </div>
        {m6 ? (
          <>
            <p className={styles.lead}>{notLoggedLead(named)}</p>
            <ul className={styles.dogGrid}>
              {named.slice(0, 8).map((d, i) => {
                const last = lastLoggedLabel(d.lastLoggedAt);
                const name = d.name!.trim();
                return (
                  <li key={`${name}-${i}`} className={styles.dogCell}>
                    <DogAvatar id={`${w.id}:${name}`} name={name} size={56} />
                    <span className={styles.dogName}>{name}</span>
                    <span className={last.warn ? styles.dogWhenWarn : styles.dogWhen}>{last.text}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : dogsLine ? (
          <div className={styles.dogsLine}>
            <span className={styles.stack} aria-hidden="true">
              {dogNames.slice(0, 3).map((n) => (
                <DogAvatar key={n} id={`${w.id}:${n}`} name={n} size={36} className={styles.stackAv} />
              ))}
            </span>
            <span>{dogsLine}</span>
          </div>
        ) : (
          <>
            <div className={styles.pills}>
              {w.sosOpen > 0 && (
                <span className={`${styles.pill} ${styles.dang}`}>
                  <Ic />
                  {needsHelpLabel(w.sosOpen)}
                </span>
              )}
              {w.notFedToday > 0 ? (
                <span className={`${styles.pill} ${styles.warn}`}>
                  <Clock />
                  {w.notFedToday} not logged today
                </span>
              ) : w.dogs > 0 ? (
                <span className={`${styles.pill} ${styles.ok}`}>
                  <Check />
                  Everyone fed
                </span>
              ) : null}
              <span className={`${styles.pill} ${styles.neu}`}>{dogsLabel(w.dogs)}</span>
            </div>
            <p className={styles.lead}>{wardLead(w)}</p>
          </>
        )}
        {cases.map((s, i) => {
          const inner = (
            <>
              <DogAvatar id={`${w.id}:${s.dogName ?? i}`} name={s.dogName?.trim() || "!"} size={48} className={styles.sosAv} />
              <span className={styles.t}>
                <b>{sosCardTitle(s)}</b>
                <span>{sosCardSub(s)}</span>
              </span>
              <span className={styles.sosChev} aria-hidden="true">
                ›
              </span>
            </>
          );
          return s.caseId ? (
            <a key={s.caseId} href={`/sos/${encodeURIComponent(s.caseId)}`} className={styles.sosCard}>
              {inner}
            </a>
          ) : (
            <div key={`${s.raisedAt}-${i}`} className={styles.sosCard}>
              {inner}
            </div>
          );
        })}
        {detailError && (
          <>
            <p className={styles.lead}>The ward&apos;s cases and nearby vets did not load.</p>
            <Button variant="quiet" onClick={onRetry} className={styles.retry}>
              Try again
            </Button>
          </>
        )}
        {nearby.length > 0 && (
          <>
            <Label className={styles.label}>Help nearby</Label>
            <div className={styles.rows}>
              {nearby.map((p) => (
                <div key={p.id} className={styles.row}>
                  {onPlace ? (
                    <button type="button" className={`${styles.t} ${styles.tBtn}`} onClick={() => onPlace(p)}>
                      <b>{p.name}</b>
                      <span>{[kindWord(p.kind), openNow(p)?.short ?? placeWhere(p)].filter(Boolean).join(" · ")}</span>
                    </button>
                  ) : (
                    <div className={styles.t}>
                      <b>{p.name}</b>
                      <span>{[kindWord(p.kind), openNow(p)?.short ?? placeWhere(p)].filter(Boolean).join(" · ")}</span>
                    </div>
                  )}
                  {p.phoneE164 && (
                    <Button variant="tinted" href={telHref(p.phoneE164)} className={styles.callBtn} aria-label={`Call ${p.name}`}>
                      Call
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <WardPrivacy />
      </div>
      <WardFoot
        ward={w}
        detail={detail}
        foot={foot}
        me={me}
        onHelp={onHelp}
        onFeedHere={onFeedHere}
        onDismiss={onDismiss}
      />
      {foot.kind === "needSignIn" && (
        <SignInSheet
          dogName={firstCase?.dogName?.trim() || null}
          place={nearby.find((p) => p.phoneE164) ?? null}
          loginHref={loginHref}
          onClose={onDismiss}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CopyNumber({ phone }: { phone: string }): React.JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={styles.inlineLink}
      onClick={() => {
        void navigator.clipboard?.writeText(phone).then(
          () => setDone(true),
          () => undefined,
        );
      }}
      aria-label={done ? "Number copied" : "Copy the number"}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** M5: a vet or NGO. Back goes to the ward it came from, not "All of Mumbai". */
export function PlaceView({
  place: p,
  from,
  distanceM,
  onBack,
}: {
  place: MapPlace;
  /** The ward the place was opened from. */
  from?: { name: string } | null;
  /** From the visitor's own position, only when they already shared it. */
  distanceM?: number | null;
  onBack: () => void;
}): React.JSX.Element {
  const where = placeWhere(p);
  const hours = openNow(p);
  const fallback = hoursPill(p);
  const wardLabel = p.wardId ? where?.replace(/ ward$/, "") ?? null : null;
  const label = [kindWord(p.kind), typeof distanceM === "number" ? distanceLabel(distanceM) : where]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className={styles.body}>
        <Back onBack={onBack} label={from ? firstLocality(from.name) : "All of Mumbai"} />
        <div className={styles.wardHead}>
          <Label className={styles.label}>{label}</Label>
          <h1 className={styles.h1}>{p.name}</h1>
        </div>
        <div className={styles.pills}>
          {hours ? (
            <span className={`${styles.pill} ${hours.open ? styles.ok : styles.neu}`}>
              {hours.open ? <Check /> : <Clock />}
              {hours.text}
            </span>
          ) : (
            <span className={`${styles.pill} ${fallback.tone === "ok" ? styles.ok : styles.neu}`}>
              {fallback.tone === "ok" ? <Check /> : <Clock />}
              {fallback.text}
            </span>
          )}
          {p.hasAmbulance && (
            <span className={`${styles.pill} ${styles.ok}`}>
              <Check />
              Ambulance
            </span>
          )}
          {p.kind === "vet" && <span className={`${styles.pill} ${styles.neu}`}>Treats street dogs</span>}
        </div>
        <div className={styles.infoCard}>
          {p.phoneE164 && (
            <div className={styles.infoRow}>
              <span className={styles.mono}>{formatPhone(p.phoneE164)}</span>
              <CopyNumber phone={p.phoneE164} />
            </div>
          )}
          <a className={styles.infoRow} href={directionsHref(p)} target="_blank" rel="noopener noreferrer">
            <span>Directions</span>
            <span className={styles.chev} aria-hidden="true">
              ›
            </span>
          </a>
        </div>
        <p className={styles.small}>{placeLead(p, wardLabel)}</p>
      </div>
      <div className={styles.foot}>
        {p.phoneE164 ? (
          <Button href={telHref(p.phoneE164)} fullWidth>
            {callLabel(p)}
          </Button>
        ) : (
          <Button fullWidth disabled>
            No number listed
          </Button>
        )}
      </div>
    </>
  );
}
