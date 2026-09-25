"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Label, Progress, StickyFooter } from "@/components/ds";
import { SettingsGroup, SettingsRow } from "@/components/ds/SettingsList";
import { api, ApiError, getAccessToken, type FeederMe, type MyDog } from "@/lib/api";
import {
  badgeSlots,
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
 * Me, a tab root (design v4 screen 09, reshaped by the v5 audit).
 *
 * Signed out: "Me", what signing in unlocks, a one-line grey reason and one
 * blue Sign in. Signed in: the feeder's name and streak, the trust bar, and
 * links to My dogs, Register a dog, Alerts and Settings, with the one button
 * (log the next feed) pinned above the tab bar.
 */

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; streak: SafeStreak; me: FeederMe; dogs: MyDog[] };

const UNLOCKS = [
  "A streak for every day you feed",
  "SOS alerts for hurt dogs in your wards",
  "Register a dog and print their tag",
  "Your dogs, and who fed them today",
];

export default function MePage(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState<Date | null>(null);

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
        // The dog list only names the button: its failure must not cost the page.
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

  if (state.kind === "signed-out") {
    return (
      <div className={styles.page}>
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Me</h1>
          <Label as="h2" className={styles.label}>
            Signing in gets you
          </Label>
          <ul className={styles.unlocks}>
            {UNLOCKS.map((u) => (
              <li key={u} className={styles.unlock}>
                <span className={styles.tick} aria-hidden="true">
                  ✓
                </span>
                {u}
              </li>
            ))}
          </ul>
          <p className={styles.aside}>The dogs will not notice either way.</p>
        </div>
        <StickyFooter
          background="none"
          className={styles.footer}
          captionPosition="above"
          caption="No password, just a 6-digit code by email."
        >
          <Button href="/login?next=%2Fme" fullWidth>
            Sign in
          </Button>
        </StickyFooter>
      </div>
    );
  }

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

  const { streak, me, dogs } = state;
  const sorted = sortUnfedFirst(dogs, now);
  const firstUnfed = sorted.find((d) => !isFedToday(d.lastFedAt, now)) ?? null;
  const trust = trustView(streak.trustScore, streak.trustLevel);
  const scanHref = `/scan?intent=feed${firstUnfed ? `&dog=${encodeURIComponent(firstUnfed.slug)}` : ""}`;

  return (
    <div className={styles.page}>
      <div className={`h-container ${styles.body}`}>
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

        <SettingsGroup className={styles.links} label="Your Hetja">
          <SettingsRow
            label="My dogs"
            value={dogs.length ? String(dogs.length) : undefined}
            href="/me/dogs"
          />
          <SettingsRow label="Register a dog" href="/register" />
          <SettingsRow label="Alerts" href="/alerts" />
          <SettingsRow label="Settings" href="/settings" />
        </SettingsGroup>
      </div>

      <StickyFooter background="fade" className={styles.footer}>
        <Button href={scanHref} fullWidth>
          {nextFeedLabel(firstUnfed)}
        </Button>
      </StickyFooter>
    </div>
  );
}
