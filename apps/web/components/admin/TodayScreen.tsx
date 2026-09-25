"use client";

/** A1 Today: a task list, not a dashboard of charts. */
import Link from "next/link";
import { useShortcutLabel } from "./AdminShell";
import { firstName, greeting, longDate, needsYouRows, todayCards } from "./format";
import type { AdminPermission, NeedsYouItem } from "@/lib/api";
import { can, canSee } from "./permissions";

/** A row shows only to someone who can clear it. */
const NEEDS: Record<NeedsYouItem["kind"], AdminPermission> = {
  sos: "sos",
  vet: "vets",
  duplicate: "merge",
  avatars: "avatars",
  ngo: "ngos",
  report: "reports",
};
import { cx, styles as s, useAdmin } from "./ui";


export function TodayScreen(): React.JSX.Element {
  const { me, today, now, openSearch } = useAdmin();
  const key = useShortcutLabel();
  const at = now();
  const rows = today ? needsYouRows(today.needsYou.filter((i) => can(me, NEEDS[i.kind])), at) : [];
  const cards = today ? todayCards(today).filter((c) => canSee(me, c.key)) : [];
  const w = today?.week;

  return (
    <div className={cx(s.page, s.pageToday)}>
      <header className={s.head}>
        <div className={s.headText}>
          <span className={s.eyebrow}>{longDate(at)}</span>
          <h1 className={s.h1}>{greeting(firstName(me.name), at)}</h1>
        </div>
        <button type="button" className={s.searchBox} onClick={openSearch} aria-keyshortcuts="Meta+K Control+K">
          <span>Search dogs, feeders, vets, collar IDs</span>
          <kbd className={s.kbd}>{key}</kbd>
        </button>
      </header>

      {!today ? (
        <p className={s.muted} role="status">
          Loading today…
        </p>
      ) : (
        <>
          <ul className={s.stats} style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Waiting on the team">
            {cards.map((c) => (
              <li key={c.key} style={{ display: "contents" }}>
                <Link href={c.href} className={s.stat}>
                  <span className={s.statLabel}>{c.label}</span>
                  <span className={s.statValue}>{c.value}</span>
                  <span className={cx(s.statSub, c.subTone === "warn" && s.warnText, c.subTone === "danger" && s.dangerText)}>{c.sub}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className={s.todayGrid}>
            <section className={s.listCard} aria-labelledby="needs-you">
              <h2 id="needs-you" className={s.listCardTitle}>
                Needs you
              </h2>
              {rows.length === 0 ? (
                <p className={s.emptyRow}>Nothing is waiting on you. New tasks land here first.</p>
              ) : (
                <ul className={s.listCardList}>
                  {rows.map((r) => (
                    <li key={r.key} className={s.taskRow}>
                      <span
                        className={cx(s.dot, r.tone === "urgent" && s.dotUrgent, r.tone === "waiting" && s.dotWaiting)}
                        aria-hidden="true"
                      />
                      <span className="h-sr-only">{r.tone === "urgent" ? "Urgent: " : r.tone === "waiting" ? "Waiting: " : ""}</span>
                      <div className={s.taskText}>
                        <span className={s.taskTitle}>{r.title}</span>
                        <span className={s.taskSub}>{r.detail}</span>
                      </div>
                      <Link
                        href={r.href}
                        className={cx(s.btn, s.btnXs, r.loud ? s.btnDark : s.btnQuiet)}
                        aria-label={`${r.action}: ${r.title}`}
                      >
                        {r.action}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {w && (
              <section className={s.weekCard} aria-labelledby="this-week">
                <h2 id="this-week" className={s.cardTitle}>
                  This week
                </h2>
                <dl className={s.kvList}>
                  <div className={s.kv}>
                    <dt>New dogs</dt>
                    <dd>{w.newDogs}</dd>
                  </div>
                  <div className={s.kv}>
                    <dt>Records signed by vets</dt>
                    <dd>{w.vetSignedRecords}</dd>
                  </div>
                  <div className={s.kv}>
                    <dt>SOS resolved</dt>
                    <dd>
                      {w.sosResolved} of {w.sosTotal}
                    </dd>
                  </div>
                  <div className={s.kv}>
                    <dt>Collars issued</dt>
                    <dd>{w.collarsIssued}</dd>
                  </div>
                  <div className={s.kv}>
                    <dt>Vaccinations due in 14 days</dt>
                    <dd className={w.vaccinationsDue14d ? s.warnText : undefined}>{w.vaccinationsDue14d}</dd>
                  </div>
                </dl>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
