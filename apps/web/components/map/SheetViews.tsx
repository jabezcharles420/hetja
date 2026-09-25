"use client";

import { Button, Label } from "@/components/ds";
import type { Me, WardDetail } from "@/app/map/api";
import type { AckMessage } from "@/lib/sos-ack";
import {
  callLabel,
  dogsLabel,
  formatPhone,
  headline,
  hoursPill,
  hungriest,
  kindWord,
  needsHelp,
  needsHelpLabel,
  placeLead,
  placeSub,
  placeWhere,
  relTime,
  severityLabel,
  sosSubline,
  telHref,
  totals,
  wardLead,
  type MapPlace,
  type MapWard,
  type Severity,
} from "./logic";
import styles from "./MapScreen.module.css";

/**
 * The sheet's three views (city, ward, place), each a body + a footer, as in
 * the mock's renderCity / renderWard / renderPlace. All copy is the mock's
 * unless a comment says why it changed.
 */

/** Trust floors of the SOS fan-out (apps/api routes/sos.ts), for the explanation only. */
const FLOOR: Record<Severity, number> = { minor: 40, serious: 40, critical: 60 };

/** Final wording of the caption under "I can go and help" (see the report: the app never shows the exact spot). */
export const HELP_CAPTION = "Trusted responders only. The exact spot stays private.";

/**
 * Caption under "Get alerts for {code} ward" (audit B-03). The button sets the
 * home ward AND turns SOS paging on, and paging follows where the feeder has
 * recently fed, not the home ward. Saying only "alerts for K/W" promised
 * something the fan-out does not do.
 */
export const ALERTS_CAPTION = "Turns on SOS alerts. Alerts follow where you feed.";

export type FootState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "needSignIn" }
  | { kind: "notResponder"; viewer: NonNullable<WardDetail["viewer"]>; severity: Severity }
  | { kind: "acked"; caseId?: string | null }
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

function Privacy(): React.JSX.Element {
  return (
    <div className={styles.note}>
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M8 1.5l5.5 2v4c0 3.4-2.4 6-5.5 7-3.1-1-5.5-3.6-5.5-7v-4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span>Dogs are shown by ward, never by street. Vets and NGOs are public places, so they get a pin.</span>
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <button type="button" className={styles.back} onClick={onBack}>
      ‹ All of Mumbai
    </button>
  );
}

// ---------------------------------------------------------------------------

export function CityView({
  wards,
  error,
  peek,
  onRetry,
  onWard,
}: {
  wards: MapWard[] | null;
  error: boolean;
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

  if (!wards) {
    return (
      <>
        <div className={styles.body} aria-live="polite">
          <Label className={styles.label}>Mumbai right now</Label>
          {error ? (
            <>
              <h1 className={styles.h1}>The map is here. The numbers are not.</h1>
              <p className={styles.lead}>
                Hetja could not be reached just now, so the ward counts are missing. The map still works. Try again in a
                minute.
              </p>
              <Button variant="quiet" onClick={onRetry} className={styles.retry}>
                Try again
              </Button>
            </>
          ) : (
            <h1 className={styles.h1}>Counting the dogs.</h1>
          )}
        </div>
        {foot}
      </>
    );
  }

  const t = totals(wards);
  const sosW = needsHelp(wards);
  const hunW = hungriest(wards);
  // In peek only the headline shows; the rest is clipped, so keep it out of
  // the tab order and the accessibility tree until the sheet is opened.
  const rest = peek ? { inert: "" as unknown as boolean, "aria-hidden": true } : {};

  return (
    <>
      <div className={styles.body}>
        <Label className={styles.label}>Mumbai right now</Label>
        <h1 className={styles.h1}>{headline(t.sos, t.hungry)}</h1>
        <div style={{ display: "contents" }} {...rest}>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <b>{t.dogs}</b>
              <span>
                <Check size={14} />
                with collars
              </span>
            </div>
            <div className={styles.stat}>
              <b>{t.hungry}</b>
              <span className={styles.statWarn}>
                <Clock />
                not fed today
              </span>
            </div>
            <div className={styles.stat}>
              <b>{t.sos}</b>
              <span className={styles.statDang}>
                <Ic />
                need help
              </span>
            </div>
          </div>
          {sosW.length > 0 && (
            <>
              <Label className={`${styles.label} ${styles.listLabel}`}>Needs help</Label>
              <div className={styles.rows}>
                {sosW.map((w) => (
                  <button key={w.id} type="button" className={styles.row} onClick={() => onWard(w.id)}>
                    <div className={styles.t}>
                      <b>
                        {w.code} ward · {w.name}
                      </b>
                      {w.latestSos && (
                        <span>
                          {severityLabel(w.latestSos.severity)} · {relTime(w.latestSos.raisedAt)}
                        </span>
                      )}
                    </div>
                    <span className={`${styles.pill} ${styles.dang}`}>
                      <Ic />
                      SOS
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <Label className={`${styles.label} ${styles.listLabel}`}>Hungriest wards</Label>
          {hunW.length > 0 ? (
            <div className={styles.rows}>
              {hunW.map((w) => (
                <button key={w.id} type="button" className={styles.row} onClick={() => onWard(w.id)}>
                  <div className={styles.t}>
                    <b>
                      {w.code} ward · {w.name}
                    </b>
                    <span>{dogsLabel(w.dogs)}</span>
                  </div>
                  <span className={`${styles.pill} ${styles.warn}`}>
                    <Clock />
                    {w.notFedToday} not fed
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.lead}>Every dog with a collar has a feed logged today. Somebody here is very organised.</p>
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

function WardFoot({
  ward,
  detail,
  foot,
  me,
  loginHref,
  onHelp,
  onAlerts,
  onDismiss,
}: {
  ward: MapWard;
  detail: WardDetail | null;
  foot: FootState;
  me: Me | null | undefined;
  loginHref: string;
  onHelp: () => void;
  onAlerts: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const cases = detail?.sos ?? [];
  // Open cases with nobody on them yet; a ward whose cases are all taken
  // needs alerts, not another volunteer.
  const needsSomeone = ward.sosOpen > 0 && (detail ? cases.some((s) => s.state !== "acked" || s.mine) : true);
  const busy = foot.kind === "busy";

  if (foot.kind === "needSignIn") {
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>
          <b>Sign in first.</b> Responders are feeders who sign in, keep feeding, and turn on SOS paging in Me.
        </p>
        <Button href={loginHref} fullWidth>
          Sign in
        </Button>
        <div className={styles.footLinks}>
          <button type="button" className={styles.linkBtn} onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (foot.kind === "notResponder") {
    const floor = FLOOR[foot.severity];
    const text = !foot.viewer.sosOptIn
      ? (
          <>
            <b>Turn on SOS paging in Me first.</b> Responders are feeders with paging on and a steady feeding record
            (trust {floor} or more; you have {foot.viewer.trustScore}).
          </>
        )
      : (
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
  if (foot.kind === "acked" && foot.caseId) {
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>
          <b>It&apos;s yours.</b> The person who raised it can now see someone is on the way.
        </p>
        <Button href={`/sos/${encodeURIComponent(foot.caseId)}`} fullWidth>
          Open the case
        </Button>
      </div>
    );
  }
  if (foot.kind === "acked" || foot.kind === "taken" || foot.kind === "alertsOn") {
    const msg =
      foot.kind === "acked" ? (
        <>
          <b>It&apos;s yours.</b> The person who raised it can now see someone is on the way.
        </>
      ) : foot.kind === "taken" ? (
        <>
          <b>Someone else just took this one.</b> Thank you for offering.
        </>
      ) : (
        <>
          <b>Alerts are on.</b> {ward.code} is your home ward. SOS alerts follow where you feed, not the ward.
        </>
      );
    return (
      <div className={styles.foot} aria-live="polite">
        <p className={styles.footMsg}>{msg}</p>
      </div>
    );
  }

  const already = !!me && me.homeWard === ward.id && me.sosOptIn;
  return (
    <div className={styles.foot} aria-live="polite">
      {foot.kind === "error" && <p className={styles.footMsg}>Hetja could not be reached. Try again in a minute.</p>}
      {needsSomeone ? (
        <>
          <Button fullWidth onClick={onHelp} disabled={busy || !detail}>
            I can go and help
          </Button>
          <div className={styles.caption}>{HELP_CAPTION}</div>
        </>
      ) : (
        <>
          <Button fullWidth onClick={onAlerts} disabled={busy}>
            Get alerts for {ward.code} ward
          </Button>
          <div className={styles.caption}>
            {already ? `${ward.code} is your home ward. ${ALERTS_CAPTION}` : ALERTS_CAPTION}
          </div>
        </>
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
  onAlerts,
  onRetry,
  onDismiss,
}: {
  ward: MapWard;
  detail: WardDetail | null;
  detailError: boolean;
  foot: FootState;
  me: Me | null | undefined;
  loginHref: string;
  onBack: () => void;
  onHelp: () => void;
  onAlerts: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  // The ward list's numbers show at once; the detail (cases, nearby) follows.
  const w = detail ?? ward;
  const cases = detail?.sos ?? [];
  const nearby = detail?.nearby ?? [];
  return (
    <>
      <div className={styles.body}>
        <Back onBack={onBack} />
        <Label className={styles.label}>{w.code} ward</Label>
        <h1 className={styles.h1}>{w.name}</h1>
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
              {w.notFedToday} not fed today
            </span>
          ) : w.dogs > 0 ? (
            <span className={`${styles.pill} ${styles.ok}`}>
              <Check />
              Everyone fed
            </span>
          ) : null}
          <span className={`${styles.pill} ${styles.neu}`}>{dogsLabel(w.dogs)}</span>
        </div>
        {cases.map((s, i) => (
          <div key={s.caseId ?? `${s.raisedAt}-${i}`} className={styles.sosCard}>
            <div className={styles.sosTitle}>{severityLabel(s.severity)}</div>
            <div className={styles.sosSub}>{sosSubline(s)}</div>
          </div>
        ))}
        <p className={styles.lead}>{wardLead(w)}</p>
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
            <Label className={styles.label}>Nearby vets and NGOs</Label>
            <div className={styles.rows}>
              {nearby.map((p) => (
                <div key={p.id} className={styles.row}>
                  <div className={styles.t}>
                    <b>{p.name}</b>
                    <span>{placeSub(p)}</span>
                  </div>
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
        <Privacy />
      </div>
      <WardFoot
        ward={w}
        detail={detail}
        foot={foot}
        me={me}
        loginHref={loginHref}
        onHelp={onHelp}
        onAlerts={onAlerts}
        onDismiss={onDismiss}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

export function PlaceView({ place: p, onBack }: { place: MapPlace; onBack: () => void }): React.JSX.Element {
  const where = placeWhere(p);
  const hours = hoursPill(p);
  const wardLabel = p.wardId ? where?.replace(/ ward$/, "") ?? null : null;
  return (
    <>
      <div className={styles.body}>
        <Back onBack={onBack} />
        <Label className={styles.label}>{[kindWord(p.kind), where].filter(Boolean).join(" · ")}</Label>
        <h1 className={styles.h1}>{p.name}</h1>
        <div className={styles.pills}>
          <span className={`${styles.pill} ${hours.tone === "ok" ? styles.ok : styles.neu}`}>
            {hours.tone === "ok" ? <Check /> : <Clock />}
            {hours.text}
          </span>
          {p.is24x7 && p.hasAmbulance && (
            <span className={`${styles.pill} ${styles.ok}`}>
              <Check />
              Ambulance on call
            </span>
          )}
          {p.kind === "vet" && <span className={`${styles.pill} ${styles.neu}`}>Treats street dogs</span>}
        </div>
        <div className={styles.phoneCard}>
          <Label className={styles.label}>Phone</Label>
          <div className={styles.phoneNum}>{p.phoneE164 ? formatPhone(p.phoneE164) : "Not listed"}</div>
        </div>
        <p className={styles.lead}>{placeLead(p, wardLabel)}</p>
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
