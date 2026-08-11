"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type StreakData } from "@/lib/api";
import StreakBadge from "@/components/StreakBadge";
import styles from "./me.module.css";

export default function MePage(): React.JSX.Element {
  const [data, setData] = useState<StreakData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const streak = await api.getStreak();
      setData(streak);
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
    </div>
  );
}
