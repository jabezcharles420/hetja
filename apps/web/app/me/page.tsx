"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Button, DogAvatar, Label, Progress, StickyFooter } from "@/components/ds";
import { SettingsGroup, SettingsRow } from "@/components/ds/SettingsList";
import { Switch } from "@/components/ds/Switch";
import { AlertsAsk } from "@/components/AlertsAsk";
import { PauseAlertsSheet } from "@/components/PauseAlertsSheet";
import { api, API_BASE, ApiError, getAccessToken, type Alert, type FeederMe, type MyDog } from "@/lib/api";
import { wardCode } from "@/lib/feeder-prefs";
import {
  dayOneSteps,
  fedWhenLabel,
  readAlertsSeenAt,
  readMeSnapshot,
  saveMeSnapshot,
  staleCopyLabel,
  unreadCount,
} from "@/lib/me-hub";
import { isPaused, resumeLabel } from "@/lib/sos-pause";
import { portalStatus, rememberTabRole } from "@/lib/tab-role";
import {
  badgeSlots,
  dogName,
  firstName,
  greetingLine,
  isFedToday,
  nextFeedLabel,
  safeStreak,
  sortUnfedFirst,
  streakSubline,
  trustView,
  type SafeStreak,
} from "@/lib/streak";
import styles from "./me.module.css";

/**
 * Me, a tab root (v4 screen 09, the v5 audit, v6 V7 / V8 / V9 / L1).
 *
 *   signed out   V7: what signing in is for, and one "Sign in with email".
 *   day one      V8: a four-step checklist until the feeder has scanned a
 *                dog, logged a feed and picked wards.
 *   signed in    the name and streak, the trust bar, the dogs, and rows for
 *                My dogs, Alerts (with an unread count), SOS alerts, Register
 *                a dog and Settings. The SOS alerts switch opens L1 (pause)
 *                when turned off and N13 (the alerts ask) when turned on.
 *   offline      V9: the last good copy from this phone, with a banner.
 */

type Loaded = { streak: SafeStreak; me: FeederMe; dogs: MyDog[]; staleSince: string | null };

type State = { kind: "loading" } | { kind: "signed-out" } | { kind: "error"; message: string } | ({ kind: "ready" } & Loaded);

function useCityDogCount(enabled: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(`${API_BASE}/stats/impact`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; data?: { dogsTracked?: unknown } } | null) => {
        const v = j?.ok ? j.data?.dogsTracked : null;
        if (alive && typeof v === "number" && Number.isFinite(v) && v > 0) setN(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);
  return n;
}

function ClockIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.2l2 1.3" />
    </svg>
  );
}

function SignedOut(): React.JSX.Element {
  const dogs = useCityDogCount(true);
  return (
    <div className={styles.page}>
      <div className={`h-container ${styles.body} ${styles.bodyTall}`}>
        <h1 className={styles.titleLg}>You probably already feed someone.</h1>
        <p className={styles.lead}>
          Sign in to put it on the record, so a stranger who scans the collar knows the dog is looked after.
        </p>
        <ul className={styles.why}>
          <li>
            <span className={`${styles.whyIcon} ${styles.whyOk}`} aria-hidden="true">
              <ClockIcon />
            </span>
            Log a feed in two taps. Keep a streak.
          </li>
          <li>
            <span className={`${styles.whyIcon} ${styles.whySos}`} aria-hidden="true">
              !
            </span>
            Hear when a dog in your ward is hurt.
          </li>
          <li>
            <span className={`${styles.whyIcon} ${styles.whyAdd}`} aria-hidden="true">
              +
            </span>
            Give a dog without a collar a name and a code.
          </li>
        </ul>
        {dogs !== null && (
          <p className={styles.small}>{new Intl.NumberFormat("en-IN").format(dogs)} dogs in Mumbai so far.</p>
        )}
      </div>
      <StickyFooter background="none" className={styles.footer}>
        <Button href="/login?next=%2Fme" fullWidth>
          Sign in with email
        </Button>
      </StickyFooter>
    </div>
  );
}

export default function MePage(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [seenAt, setSeenAt] = useState(0);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sosId = useId();

  const load = useCallback(async () => {
    setNow(new Date());
    if (!getAccessToken()) {
      setState({ kind: "signed-out" });
      return;
    }
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    setSeenAt(readAlertsSeenAt());
    // Alerts only feed the row's count: never let them cost the page.
    api.getAlerts().then(
      (r) => setAlerts(Array.isArray(r?.items) ? r.items : []),
      () => setAlerts(null),
    );
    try {
      const [streak, me, dogs] = await Promise.all([
        api.getStreak(),
        api.getFeederMe(),
        // The dog list is a nice-to-have: its failure must not cost the page.
        api.getMyDogs().catch(() => ({ dogs: [] as MyDog[] })),
      ]);
      const list = Array.isArray(dogs?.dogs) ? dogs.dogs : [];
      saveMeSnapshot({ streak, me, dogs: list });
      rememberTabRole(me);
      setState({ kind: "ready", streak: safeStreak(streak), me, dogs: list, staleSince: null });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
        setState({ kind: "signed-out" });
        return;
      }
      const cached = readMeSnapshot();
      if (cached) {
        setState({
          kind: "ready",
          streak: safeStreak(cached.streak),
          me: cached.me,
          dogs: cached.dogs,
          staleSince: cached.savedAt,
        });
        return;
      }
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load your profile." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchMe = (patch: Partial<FeederMe>) =>
    setState((s) => (s.kind === "ready" ? { ...s, me: { ...s.me, ...patch } } : s));

  if (state.kind === "signed-out") return <SignedOut />;

  if (state.kind !== "ready" || !now) {
    return (
      <div className={styles.page}>
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Me</h1>
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
            <p className={styles.loading} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  const { streak, me, dogs, staleSince } = state;
  const sorted = sortUnfedFirst(dogs, now);
  const firstUnfed = sorted.find((d) => !isFedToday(d.lastFedAt, now)) ?? null;
  const trust = trustView(streak.trustScore, streak.trustLevel);
  const scanHref = `/scan?intent=feed${firstUnfed ? `&dog=${encodeURIComponent(firstUnfed.slug)}` : ""}`;
  const steps = dayOneSteps({ me, dogs, streakDays: streak.streakDays });
  const dayOne = steps.some((s) => !s.done);
  const current = steps.find((s) => !s.done)?.key;
  const paused = me.sosOptIn && isPaused(me.sosPausedUntil, now);
  const sosOn = me.sosOptIn && !paused;
  const unread = alerts ? unreadCount(alerts, seenAt) : 0;
  const first = firstName(me.displayName);
  const vetStatus = portalStatus(me, "vet");
  const ngoStatus = portalStatus(me, "ngo");
  const dogNames = sorted.map((d) => dogName(d.name)).filter((n) => n !== "This dog");

  const resume = async () => {
    setResumeBusy(true);
    setNotice(null);
    try {
      await api.patchFeederMe({ sosPausedUntil: null });
      patchMe({ sosPausedUntil: null });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not resume alerts. Try again.");
    } finally {
      setResumeBusy(false);
    }
  };

  const banner = staleSince ? (
    <div className={styles.stale} role="status">
      <ClockIcon />
      <span className={styles.staleText}>Showing {staleCopyLabel(staleSince, now)} copy. Can&apos;t reach Hetja.</span>
      <button type="button" className={styles.staleRetry} onClick={() => void load()}>
        Retry
      </button>
    </div>
  ) : null;

  const pausedRow = paused && me.sosPausedUntil ? (
    <div className={styles.paused}>
      <span>Alerts paused until {resumeLabel(me.sosPausedUntil, now)}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className={styles.pausedResume} onClick={() => void resume()} disabled={resumeBusy}>
        Resume
      </button>
    </div>
  ) : null;

  const links = (
    <SettingsGroup className={styles.links} label="Your Hetja">
      <SettingsRow label="My dogs" value={dogs.length ? String(dogs.length) : undefined} href="/me/dogs" />
      <SettingsRow
        label="Alerts"
        value={
          unread > 0 ? (
            <span className={styles.unread} aria-label={`${unread} new`}>
              {unread}
            </span>
          ) : undefined
        }
        href="/alerts"
      />
      <SettingsRow
        label="SOS alerts"
        labelId={`${sosId}-l`}
        sub={paused ? "Paused" : sosOn ? "Hurt dogs in your wards" : "Off"}
        subId={`${sosId}-d`}
        control={
          <Switch
            checked={sosOn}
            labelledBy={`${sosId}-l`}
            describedBy={`${sosId}-d`}
            onChange={(next) => {
              setNotice(null);
              if (next) setAskOpen(true);
              else setPauseOpen(true);
            }}
          />
        }
      />
      <SettingsRow label="Register a dog" href="/register" />
      {vetStatus !== "done" && (
        <SettingsRow label="Sign records as a vet" value={vetStatus ?? undefined} href="/vet/apply" />
      )}
      {ngoStatus !== "done" && (
        <SettingsRow label="Bring your NGO to Hetja" value={ngoStatus ?? undefined} href="/ngo/register" />
      )}
      <SettingsRow label="Settings" href="/settings" />
    </SettingsGroup>
  );

  const sheets = (
    <>
      <PauseAlertsSheet
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        dogNames={dogNames}
        wardCodes={(me.wards ?? []).map(wardCode)}
        onDone={(next) => {
          patchMe(next);
          setPauseOpen(false);
        }}
      />
      <AlertsAsk
        open={askOpen}
        me={me}
        dogName={dogNames[0] ?? null}
        onClose={() => setAskOpen(false)}
        onDone={() => {
          patchMe({ sosOptIn: true, sosPausedUntil: null });
          setAskOpen(false);
          void load();
        }}
      />
    </>
  );

  if (dayOne) {
    return (
      <div className={styles.page}>
        <div className={`h-container ${styles.body} ${styles.bodyTall}`}>
          {banner}
          <h1 className={styles.titleLg}>{first ? `Day one, ${first}.` : "Day one."}</h1>
          <p className={styles.lead}>Three things and you&apos;re set. The dogs won&apos;t notice. Their next stranger will.</p>
          <ol className={styles.steps}>
            {steps.map((s, i) => {
              const cls = [styles.step, s.done ? styles.stepDone : "", s.key === current ? styles.stepNow : ""]
                .filter(Boolean)
                .join(" ");
              const inner = (
                <>
                  <span className={styles.stepMark} aria-hidden="true">
                    {s.done ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5l3 3 7-7" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className={styles.stepText}>
                    <span className={styles.stepTitle}>
                      {s.title}
                      {s.done ? <span className="h-sr-only"> (done)</span> : null}
                    </span>
                    {s.sub ? <span className={styles.stepSub}>{s.sub}</span> : null}
                  </span>
                  {s.key === current && s.href ? (
                    <span className={styles.chev} aria-hidden="true">
                      ›
                    </span>
                  ) : null}
                </>
              );
              return (
                <li key={s.key}>
                  {!s.done && s.href ? (
                    <Link href={s.href} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className={styles.register}>
            No collar on your dog yet?{" "}
            <Link href="/register" className={styles.inlineLink}>
              Register one ›
            </Link>
          </p>
          {pausedRow}
          {links}
          {notice && (
            <p className={styles.error} role="alert">
              {notice}
            </p>
          )}
        </div>
        <StickyFooter background="fade" className={styles.footer}>
          <Button href="/scan" fullWidth>
            Scan a collar
          </Button>
        </StickyFooter>
        {sheets}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={`h-container ${styles.body}`}>
        {banner}
        <h1 className={styles.titleLg}>{greetingLine(now, me.displayName)}</h1>
        {pausedRow}

        <section className={styles.streak} aria-label="Streak">
          <div className={styles.streakTop}>
            <span className={styles.streakNum}>{streak.streakDays}</span>
            <span className={styles.streakUnit}>day streak</span>
          </div>
          {!staleSince && (
            <>
              <p className={styles.streakSub}>{streakSubline(streak, dogs[0]?.name)}</p>
              <div className={styles.badges}>
                {badgeSlots(streak.badges, streak.streakDays).map((b) => (
                  <Badge
                    key={b.key}
                    mark={b.mark}
                    label={b.label}
                    palette={b.palette}
                    locked={b.locked}
                    remaining={b.remaining}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {!staleSince && (
          <Progress label={trust.label} target={trust.target} value={trust.value} valueText={trust.valueText} />
        )}

        {sorted.length > 0 && (
          <>
            <Label as="h2" className={styles.label}>
              My dogs
            </Label>
            <ul className={styles.dogs}>
              {sorted.slice(0, 3).map((d) => (
                <li key={d.slug}>
                  <Link href={`/me/dogs/${encodeURIComponent(d.slug)}`} className={styles.dog}>
                    <DogAvatar id={d.slug} name={dogName(d.name)} size={44} />
                    <span className={styles.dogName}>{dogName(d.name)}</span>
                    <span className={styles.dogFed}>{fedWhenLabel(d.lastFedAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {staleSince && (
          <p className={styles.small}>Feeds you log now are saved on this phone and sent when you&apos;re back.</p>
        )}

        {links}
        {notice && (
          <p className={styles.error} role="alert">
            {notice}
          </p>
        )}
      </div>

      <StickyFooter background="fade" className={styles.footer}>
        <Button href={scanHref} fullWidth>
          {nextFeedLabel(firstUnfed)}
        </Button>
      </StickyFooter>
      {sheets}
    </div>
  );
}
