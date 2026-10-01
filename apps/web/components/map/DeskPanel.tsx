"use client";

import { useEffect, useState } from "react";
import { StatusIcon } from "@/components/ds";
import type { Me, WardDetail } from "@/app/map/api";
import { AckedView, SignInSheet, WardFoot, type FootState } from "./SheetViews";
import { deskHeadline, dogStatuses, feedProgress, istClock } from "./desk";
import {
  callLabel,
  hungriest,
  placeSub,
  relTime,
  severityLabel,
  telHref,
  totals,
  type CitySos,
  type CitySummary,
  type Filter,
  type Filters,
  type MapPlace,
  type MapWard,
} from "./logic";
import styles from "./DeskPanel.module.css";

/**
 * The desktop inspector (design v8, docs/design/v8-desktop): the owner's
 * Stitch map page, every section of it, in the design system and on real
 * data. Shown instead of the phone sheet's contents from 900px (MapScreen);
 * the phone sheet is untouched.
 *
 *   city   "Mumbai right now" + the IST clock, the two-line headline, the
 *          three stat tiles, the filter chips with counts, the open SOS
 *          cases, the hungriest wards
 *   ward   back to all of Mumbai, the ward's name and dog count, the status
 *          pills, each open case (respond, share), the feeding round, the
 *          ward's vets and NGOs with Call, the dogs with collars and
 *          whether each is logged today, and the same respond / alerts foot
 *          as the phone (WardFoot)
 *   foot   "Field actions happen on the street" and the collar lookup
 *
 * Ward level only (INVARIANT 2): a case is "in K/W ward", never a street.
 */

function Clock(): React.JSX.Element {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(istClock());
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => window.clearInterval(t);
  }, []);
  return <span className={styles.clock}>{now ?? ""}</span>;
}

function Chips({
  filters,
  counts,
  onToggle,
  onAll,
}: {
  filters: Filters;
  counts: { sos: number; hungry: number; vet: number; ngo: number };
  onToggle: (f: Filter) => void;
  onAll: () => void;
}): React.JSX.Element {
  const all = filters.sos && filters.hungry && filters.vet && filters.ngo;
  const chip = (f: Filter, label: string, tone: string) => (
    <button
      type="button"
      key={f}
      className={[styles.chip, styles[tone], filters[f] && !all ? styles.on : ""].filter(Boolean).join(" ")}
      aria-pressed={filters[f]}
      onClick={() => onToggle(f)}
    >
      {label}
    </button>
  );
  return (
    <div className={styles.chips} role="group" aria-label="Show on the map">
      <button type="button" className={[styles.chip, styles.all, all ? styles.on : ""].join(" ")} aria-pressed={all} onClick={onAll}>
        All wards
      </button>
      {chip("sos", `SOS (${counts.sos})`, "danger")}
      {chip("hungry", `Unfed (${counts.hungry})`, "warn")}
      {chip("vet", `Vets (${counts.vet})`, "blue")}
      {chip("ngo", `NGOs (${counts.ngo})`, "ink")}
    </div>
  );
}

function Tile({ n, label, icon, tone }: { n: number; label: string; icon: "check" | "clock" | "alert"; tone: string }): React.JSX.Element {
  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <span className={styles.tileN}>{new Intl.NumberFormat("en-IN").format(n)}</span>
      <span className={styles.tileL}>
        <StatusIcon name={icon} size={14} />
        {label}
      </span>
    </div>
  );
}

export interface DeskPanelProps {
  wards: MapWard[] | null;
  summary: CitySummary | null;
  citySos: CitySos[] | null;
  places: MapPlace[];
  filters: Filters;
  onToggle: (f: Filter) => void;
  onAll: () => void;
  ward: MapWard | null;
  detail: WardDetail | null;
  detailError: boolean;
  foot: FootState;
  me: Me | null | undefined;
  loginHref: string;
  onWard: (id: string) => void;
  onBack: () => void;
  onHelp: () => void;
  onFeedHere: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onPlace: (p: MapPlace) => void;
  onLookup: () => void;
}

export function DeskPanel(p: DeskPanelProps): React.JSX.Element {
  const t = totals(p.wards ?? []);
  const sosCount = p.citySos?.length ?? t.sos;
  const hungry = p.summary?.notLoggedToday ?? t.hungry;
  const collars = p.summary?.withCollars ?? t.dogs;
  const counts = {
    sos: sosCount,
    hungry,
    vet: p.places.filter((x) => x.kind === "vet").length,
    ngo: p.places.filter((x) => x.kind === "ngo").length,
  };

  return (
    <div className={styles.panel}>
      <div className={styles.scroll}>
        {p.ward ? (
          <WardBody {...p} ward={p.ward} />
        ) : (
          <>
            <div className={styles.now}>
              <span className={styles.nowLabel}>
                <span className={styles.liveDot} aria-hidden="true" />
                Mumbai right now
              </span>
              <Clock />
            </div>
            <h1 className={styles.h1}>
              {deskHeadline(sosCount, hungry).help}
              <span className={styles.h1Sub}> {deskHeadline(sosCount, hungry).dinner}</span>
            </h1>
            <div className={styles.tiles}>
              <Tile n={collars} label="Collars" icon="check" tone="okT" />
              <Tile n={hungry} label="Hungry" icon="clock" tone="warnT" />
              <Tile n={sosCount} label="SOS" icon="alert" tone="dangerT" />
            </div>
            <Chips filters={p.filters} counts={counts} onToggle={p.onToggle} onAll={p.onAll} />
            <CityBody {...p} />
          </>
        )}
      </div>
      {!p.ward && (
        <div className={styles.field}>
          <div className={styles.fieldText}>
            <span className={styles.fieldTitle}>Field actions happen on the street</span>
            <span className={styles.fieldSub}>Point your phone&apos;s camera at a collar to log a feed, or type the code printed under its QR.</span>
          </div>
          <button type="button" className={styles.lookupBtn} onClick={p.onLookup}>
            Look up a collar code
          </button>
        </div>
      )}
    </div>
  );
}

function CityBody(p: DeskPanelProps): React.JSX.Element {
  const open = p.citySos ?? [];
  const hungry = hungriest(p.wards ?? []);
  return (
    <>
      {open.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.label}>Needs help now</h2>
          {open.map((s, i) => (
            <button type="button" key={`${s.wardId}-${i}`} className={styles.caseRow} onClick={() => p.onWard(s.wardId)}>
              <span className={styles.caseIcon} aria-hidden="true">
                <StatusIcon name="alert" size={18} />
              </span>
              <span className={styles.caseText}>
                <span className={styles.caseTitle}>{s.dogName ? `${s.dogName}: ${severityLabel(s.severity)}` : severityLabel(s.severity)}</span>
                <span className={styles.caseSub}>
                  {s.wardCode} ward · {relTime(s.raisedAt)} · {s.taken ? "someone is on the way" : "nobody on it yet"}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}
      {hungry.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.label}>Hungriest wards</h2>
          <ul className={styles.list}>
            {hungry.map((w) => (
              <li key={w.id}>
                <button type="button" className={styles.row} onClick={() => p.onWard(w.id)}>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{w.code} ward</span>
                    <span className={styles.rowSub}>{w.name}</span>
                  </span>
                  <span className={styles.pillWarn}>
                    <StatusIcon name="clock" size={12} />
                    {w.notFedToday} not fed today
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={styles.note}>Dogs are shown by ward, never by street. Vets and NGOs are public places, so they get a pin.</p>
    </>
  );
}

function share(url: string, title: string): void {
  const nav = navigator as Navigator & { share?: (d: { url: string; title: string }) => Promise<void> };
  if (typeof nav.share === "function") {
    void nav.share({ url, title }).catch(() => undefined);
    return;
  }
  void navigator.clipboard?.writeText(url).catch(() => undefined);
}

function WardBody(p: DeskPanelProps & { ward: MapWard }): React.JSX.Element {
  const w = p.ward;
  const d = p.detail;
  if (p.foot.kind === "acked") return <AckedView foot={p.foot} />;
  const sos = d?.sos ?? [];
  const progress = feedProgress(w.dogs, w.notFedToday);
  const dogs = dogStatuses(d?.dogNames, d?.notLoggedToday);
  const waitingNames = (d?.notLoggedToday ?? []).map((x) => x.name).filter((n): n is string => !!n);
  const nearby = d?.nearby ?? [];
  const firstCase = sos[0];

  return (
    <>
      <button type="button" className={styles.back} onClick={p.onBack}>
        ‹ Back to all of Mumbai
      </button>
      <div className={styles.wardHead}>
        <div>
          <h1 className={styles.wardName}>{w.name}</h1>
          <p className={styles.wardCode}>{w.code} municipal ward</p>
        </div>
        <span className={styles.dogPill}>
          <span className={styles.blueDot} aria-hidden="true" />
          {w.dogs === 1 ? "1 dog" : `${w.dogs} dogs`}
        </span>
      </div>
      <div className={styles.pills}>
        {w.sosOpen > 0 && (
          <span className={styles.pillDanger}>
            <StatusIcon name="alert" size={12} />
            {w.sosOpen} needs urgent care
          </span>
        )}
        {w.notFedToday > 0 && (
          <span className={styles.pillWarn}>
            <StatusIcon name="clock" size={12} />
            {w.notFedToday} not fed today
          </span>
        )}
        {progress.fed > 0 && (
          <span className={styles.pillOk}>
            <StatusIcon name="check" size={12} />
            {progress.fed} fed today
          </span>
        )}
      </div>

      {p.detailError && (
        <p className={styles.note}>
          Couldn&apos;t load this ward.{" "}
          <button type="button" className={styles.inlineBtn} onClick={p.onRetry}>
            Try again
          </button>
        </p>
      )}

      {sos.map((s, i) => (
        <article key={s.caseId ?? i} className={styles.sosCard}>
          <div className={styles.sosTop}>
            <span className={styles.sosIcon} aria-hidden="true">
              <StatusIcon name="alert" size={20} />
            </span>
            <div className={styles.sosText}>
              <h2 className={styles.sosTitle}>{severityLabel(s.severity)}</h2>
              <p className={styles.sosDog}>{s.dogName ? `Collared dog · "${s.dogName}"` : "A dog without a collar"}</p>
            </div>
            <span className={styles.ago}>{relTime(s.raisedAt)}</span>
          </div>
          <p className={styles.sosBody}>
            Reported in {w.code} ward. {s.feedersTold ? "Its feeders have been told. " : ""}
            {(s.taken ?? s.state === "acked") ? "Someone is on the way." : "Nobody has taken it yet. The exact spot unlocks for whoever does."}
          </p>
          {s.caseId && (
            <button
              type="button"
              className={styles.shareBtn}
              aria-label="Share this case"
              onClick={() => share(`${window.location.origin}/map#ward=${encodeURIComponent(w.code)}`, `${severityLabel(s.severity)} in ${w.code} ward`)}
            >
              Share
            </button>
          )}
        </article>
      ))}

      {w.dogs > 0 && (
        <section className={styles.roundCard}>
          <div className={styles.roundHead}>
            <h2 className={styles.roundTitle}>Today&apos;s feeding round</h2>
            <span className={styles.roundMeta}>{istClock()}</span>
          </div>
          <p className={styles.roundBody}>
            {w.notFedToday === 0
              ? "Every dog here has been logged today."
              : `${w.notFedToday === 1 ? "1 dog here hasn't" : `${w.notFedToday} dogs here haven't`} been logged today${waitingNames.length ? `: ${waitingNames.slice(0, 4).join(", ")}` : ""}. They've probably eaten. Nobody has said so.`}
          </p>
          <div className={styles.bar} role="img" aria-label={`${progress.fed} of ${w.dogs} fed today`}>
            <span style={{ width: `${progress.pct}%` }} />
          </div>
          <div className={styles.roundFoot}>
            <span>
              {progress.fed} fed ({progress.pct}%)
            </span>
            <span>Goal: {w.dogs === 1 ? "1 dog" : `${w.dogs} dogs`}</span>
          </div>
        </section>
      )}

      {nearby.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.label}>Vets and shelters near {w.code}</h2>
          <ul className={styles.list}>
            {nearby.map((pl) => (
              <li key={pl.id} className={styles.placeRow}>
                <button type="button" className={styles.placeMain} onClick={() => p.onPlace(pl)}>
                  <span className={pl.kind === "vet" ? styles.placeVet : styles.placeNgo} aria-hidden="true">
                    {pl.kind === "vet" ? "+" : "N"}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{pl.name}</span>
                    <span className={styles.rowSub}>{placeSub(pl)}</span>
                  </span>
                </button>
                {pl.phoneE164 && (
                  <a className={styles.callBtn} href={telHref(pl.phoneE164)} aria-label={callLabel(pl)}>
                    Call
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dogs.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.label}>Dogs with collars in {w.code}</h2>
          <ul className={styles.dogs}>
            {dogs.map((dg, i) => (
              <li key={`${dg.name}-${i}`} className={styles.dog}>
                <span className={styles.dogAv} aria-hidden="true">
                  {dg.name.charAt(0).toUpperCase()}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{dg.name}</span>
                  <span className={dg.fed ? styles.dogFed : styles.dogWait}>{dg.fed ? "Fed today" : "Waiting for dinner"}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className={styles.note}>Dogs are placed by ward, never by street. Exact spots stay with the person who takes a case.</p>

      <div className={styles.wardFoot}>
        <WardFoot ward={w} detail={d} foot={p.foot} me={p.me} onHelp={p.onHelp} onFeedHere={p.onFeedHere} onDismiss={p.onDismiss} />
      </div>
      {p.foot.kind === "needSignIn" && (
        <SignInSheet
          dogName={firstCase?.dogName?.trim() || null}
          place={nearby.find((x) => x.phoneE164) ?? null}
          loginHref={p.loginHref}
          onClose={p.onDismiss}
        />
      )}
    </>
  );
}
