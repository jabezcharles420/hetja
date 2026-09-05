"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type FeederMe, type StreakData } from "@/lib/api";
import StreakBadge from "@/components/StreakBadge";
import styles from "./me.module.css";

/**
 * Trust floor the SOS fan-out applies before paging a feeder for a minor or
 * serious case (routes/sos.ts; critical needs 60). Shown here so a newly
 * signed-up feeder who opts in understands why nothing pages them yet.
 */
const SOS_PAGE_TRUST_FLOOR = 40;

export default function MePage(): React.JSX.Element {
  const [data, setData] = useState<StreakData | null>(null);
  const [me, setMe] = useState<FeederMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [optBusy, setOptBusy] = useState(false);
  const [optStatus, setOptStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [streak, feeder] = await Promise.all([api.getStreak(), api.getFeederMe()]);
      setData(streak);
      setMe(feeder);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
        setError("Sign in as a feeder to see your streak.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not load your profile.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * SOS responder consent. `feeders.sos_opt_in` defaults to false, the fan-out
   * filters on it, and PATCH /api/v1/feeders/me is its only writer — until this
   * checkbox existed no feeder could ever be paged, so the "neighbours on it"
   * promise the SOS flow makes had nobody behind it. Optimistic flip, reverted
   * on failure, with the outcome spoken via role="status".
   */
  const setSosOptIn = async (next: boolean) => {
    if (!me) return;
    const previous = me.sosOptIn;
    setMe({ ...me, sosOptIn: next });
    setOptBusy(true);
    setOptStatus(null);
    try {
      const res = await api.updateFeederMe({ sosOptIn: next });
      const stored = res.sosOptIn ?? next;
      setMe((cur) => (cur ? { ...cur, sosOptIn: stored } : cur));
      setOptStatus(
        stored
          ? "You'll be paged when a dog near where you feed needs help."
          : "You won't be paged for SOS cases.",
      );
    } catch (err) {
      setMe((cur) => (cur ? { ...cur, sosOptIn: previous } : cur));
      setOptStatus(err instanceof ApiError ? err.message : "Could not update SOS paging.");
    } finally {
      setOptBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <nav className={styles.topnav}>
        <Link href="/">← Scan a collar</Link>
      </nav>

      <h1 className={styles.title}>My feeder profile</h1>

      {loading && <p className={styles.muted}>Loading…</p>}

      {error && (
        <div className={styles.state}>
          <p className={styles.error}>{error}</p>
          <Link className={styles.login} href="/login">
            Sign in
          </Link>
        </div>
      )}

      {data && (
        <>
          <StreakBadge data={data} />

          <dl className={styles.trust}>
            <div className={styles.trustRow}>
              <dt>Trust score</dt>
              <dd>
                <strong>{data.trustScore}</strong>/100
              </dd>
            </div>
            <div className={styles.trustRow}>
              <dt>Streak days</dt>
              <dd>
                <strong>{data.streakDays}</strong>
              </dd>
            </div>
            <div className={styles.trustRow}>
              <dt>Badges</dt>
              <dd>{data.badges.length}</dd>
            </div>
          </dl>
        </>
      )}

      {me && (
        <section className={styles.consent} aria-labelledby="sos-paging-heading">
          <h2 id="sos-paging-heading" className={styles.consentTitle}>
            SOS paging
          </h2>
          <label className={styles.consentRow}>
            <input
              type="checkbox"
              checked={me.sosOptIn}
              disabled={optBusy}
              onChange={(e) => void setSosOptIn(e.target.checked)}
            />
            <span>Page me when a dog near where I feed needs help</span>
          </label>
          <p className={styles.consentHint}>
            Pages go out as a push notification to feeders who have fed nearby recently.
            {me.trustScore < SOS_PAGE_TRUST_FLOOR
              ? ` Only feeders with a trust score of ${SOS_PAGE_TRUST_FLOOR} or more are paged — yours is ${me.trustScore}, so keep logging feeds.`
              : " You can switch this off at any time."}
          </p>
          {optStatus && (
            <p className={styles.consentStatus} role="status">
              {optStatus}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
