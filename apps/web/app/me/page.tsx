"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DogAvatar,
  Label,
  ListGroup,
  ListRow,
  Progress,
  StatusPill,
  StickyFooter,
} from "@/components/ds";
import { api, ApiError, getAccessToken, type FeederMe, type MyDog } from "@/lib/api";
import {
  badgeSlots,
  dogName,
  fedAgoLabel,
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
 * Screen 09, Me (design v4): greeting, streak card with four badges, trust
 * level, my dogs (not fed today first), and one button to log the next feed.
 * The TabBar comes from the global chrome (ChromeShell shows only it here).
 */

/**
 * Trust floor the SOS fan-out applies before paging a feeder for a minor or
 * serious case (routes/sos.ts; critical needs 60).
 */
const SOS_PAGE_TRUST_FLOOR = 40;

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; streak: SafeStreak; me: FeederMe; dogs: MyDog[] };

export default function MePage(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState<Date | null>(null);
  const [optBusy, setOptBusy] = useState(false);
  const [optStatus, setOptStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNow(new Date());
    if (!getAccessToken()) {
      setState({ kind: "signed-out" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const [streak, me, dogs] = await Promise.all([
        api.getStreak(),
        api.getFeederMe(),
        // The dog list is a nice-to-have: its failure must not cost the page.
        api.getMyDogs().catch(() => ({ dogs: [] as MyDog[] })),
      ]);
      setState({ kind: "ready", streak: safeStreak(streak), me, dogs: Array.isArray(dogs?.dogs) ? dogs.dogs : [] });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
        setState({ kind: "signed-out" });
      } else {
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message : "Could not load your profile.",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * SOS responder consent. feeders.sos_opt_in defaults to false, the fan-out
   * filters on it, and PATCH /feeders/me is its only writer: without this
   * switch nobody can ever be paged. Optimistic, reverted on failure.
   */
  const setSosOptIn = async (next: boolean) => {
    if (state.kind !== "ready") return;
    const previous = state.me.sosOptIn;
    const patch = (v: boolean) =>
      setState((s) => (s.kind === "ready" ? { ...s, me: { ...s.me, sosOptIn: v } } : s));
    patch(next);
    setOptBusy(true);
    setOptStatus(null);
    try {
      const res = await api.updateFeederMe({ sosOptIn: next });
      const stored = res.sosOptIn ?? next;
      patch(stored);
      setOptStatus(
        stored
          ? "You'll be paged when a dog near where you feed needs help."
          : "You won't be paged for SOS cases.",
      );
    } catch (err) {
      patch(previous);
      setOptStatus(err instanceof ApiError ? err.message : "Could not update SOS paging.");
    } finally {
      setOptBusy(false);
    }
  };

  if (state.kind === "signed-out") {
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          <h1 className={styles.title}>Hello, stranger.</h1>
          <Card className={styles.signedOut}>
            <p className={styles.signedOutText}>
              Sign in to see your streak, your badges and the dogs you feed. No password, just a code by
              email. The dogs will not notice either way.
            </p>
            <Button href="/login?next=%2Fme" fullWidth>
              Sign in
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (state.kind !== "ready" || !now) {
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {state.kind === "error" ? (
            <>
              <h1 className={styles.title}>Me</h1>
              <p className={styles.error} role="alert">
                {state.message}
              </p>
              <Button variant="quiet" onClick={() => void load()}>
                Try again
              </Button>
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

  const { streak, me, dogs } = state;
  const sorted = sortUnfedFirst(dogs, now);
  const firstUnfed = sorted.find((d) => !isFedToday(d.lastFedAt, now)) ?? null;
  const trust = trustView(streak.trustScore, streak.trustLevel);
  const scanHref = `/scan?intent=feed${firstUnfed ? `&dog=${encodeURIComponent(firstUnfed.slug)}` : ""}`;

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <h1 className={styles.title}>{greetingLine(now, me.displayName)}</h1>

        <section className={styles.streak} aria-label="Streak">
          <div className={styles.streakTop}>
            <span className={styles.streakNum}>{streak.streakDays}</span>
            <span className={styles.streakUnit}>day streak</span>
          </div>
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
        </section>

        <Progress label={trust.label} target={trust.target} value={trust.value} valueText={trust.valueText} />

        <Label className={styles.dogsLabel}>My dogs</Label>
        <ListGroup as="ul" className={styles.dogs}>
          {sorted.length === 0 ? (
            <li className={styles.empty}>No dogs yet. Scan a collar and log a feed, and they show up here.</li>
          ) : (
            sorted.map((d) => {
              const fed = isFedToday(d.lastFedAt, now);
              return (
                <ListRow
                  key={d.slug}
                  as="li"
                  density="compact"
                  leading={<DogAvatar id={d.slug} name={dogName(d.name)} size={44} />}
                  title={
                    <a href={`/d/${d.slug}`} className={styles.dogLink}>
                      {dogName(d.name)}
                    </a>
                  }
                  trailing={
                    fed && d.lastFedAt ? (
                      <StatusPill variant="ok" icon="check" size="row">
                        {fedAgoLabel(d.lastFedAt, now)}
                      </StatusPill>
                    ) : (
                      <StatusPill variant="warn" icon="clock" size="row">
                        Not fed today
                      </StatusPill>
                    )
                  }
                />
              );
            })
          )}
        </ListGroup>

        <section className={styles.settings} aria-labelledby="sos-paging-heading">
          <div className={styles.settingsRow}>
            <div className={styles.settingsText}>
              <h2 id="sos-paging-heading" className={styles.settingsTitle}>
                SOS paging
              </h2>
              <p className={styles.settingsSub} id="sos-paging-desc">
                Page me when a dog near where I feed needs help
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={me.sosOptIn}
              aria-labelledby="sos-paging-heading"
              aria-describedby="sos-paging-desc"
              className={[styles.switch, me.sosOptIn ? styles.switchOn : ""].filter(Boolean).join(" ")}
              disabled={optBusy}
              onClick={() => void setSosOptIn(!me.sosOptIn)}
            >
              <span className={styles.knob} />
            </button>
          </div>
          <p className={styles.settingsHint}>
            Pages go out as a push notification to feeders who have fed nearby recently.
            {me.trustScore < SOS_PAGE_TRUST_FLOOR
              ? ` Only feeders with a trust score of ${SOS_PAGE_TRUST_FLOOR} or more are paged. Yours is ${me.trustScore}, so keep logging feeds.`
              : " You can switch this off at any time."}
          </p>
          {optStatus && (
            <p className={styles.settingsHint} role="status">
              {optStatus}
            </p>
          )}
        </section>
      </div>

      <StickyFooter background="fade" className={styles.footer}>
        <Button href={scanHref} fullWidth>
          {nextFeedLabel(firstUnfed)}
        </Button>
      </StickyFooter>
    </div>
  );
}
