"use client";

/**
 * /register (design v6): three screens on one route.
 *
 *   L3  signed out            "There's a dog without a name near you."
 *   V13 no dogs yet           "Every dog on Hetja started with someone like you."
 *                             Also the enable-registration screen: for an
 *                             account without the registrator capability the
 *                             button self-elects the surface (POST
 *                             /feeders/me/surface) and goes on to /register/new.
 *   V12 the caller's dogs     sentences about each dog, sorted by what needs doing
 *
 * Route protection is a UX boundary, not a security boundary: the API is the
 * boundary (see RequireCapability, whose own gate states this screen replaces).
 *
 * V13's figures come from the real rules: the registration budget from
 * GET /feeders/me and the pending window from the API's
 * PENDING_REGISTRATION_TTL_DAYS (apps/api/src/lib/enrol.ts, mirrored below
 * because no endpoint returns it before a first registration exists).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusPill, StickyFooter } from "@/components/ds";
import {
  api,
  ApiError,
  type FeederMe,
  type RegistrationSummary,
  type RegistrationV6Fields,
} from "@/lib/api";
import { readPrinted } from "@/lib/collar-sheet";
import { dogCopyV6, nameOr, possessive, recallDogSex, scanTally } from "@/lib/dog-copy";
import s from "./register.module.css";
import styles from "./registrations.module.css";

/** apps/api/src/lib/enrol.ts PENDING_REGISTRATION_TTL_DAYS: keep in step. */
export const PENDING_TTL_DAYS = 30;

type Reg = RegistrationSummary & RegistrationV6Fields;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** V13 fine print, from the real window and budget. */
export function firstDogFinePrint(ttlDays: number, maxPending: number): string {
  const dogs =
    maxPending === 1
      ? "One dog at a time."
      : `Up to ${NUMBER_WORDS[maxPending] ?? String(maxPending)} dogs at a time.`;
  return `You'll have ${ttlDays} days to put the collar on. ${dogs}`;
}

export function canRegister(me: Pick<FeederMe, "capabilities" | "role">): boolean {
  return (
    (me.capabilities ?? []).includes("register") ||
    ["registrator", "vet", "bmc_officer", "admin"].includes(me.role)
  );
}

export function daysLeftOf(r: Pick<Reg, "daysLeft" | "expiresAt">, now = Date.now()): number | null {
  if (typeof r.daysLeft === "number") return r.daysLeft;
  if (!r.expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - now) / 86_400_000));
}

function isPrinted(r: Pick<Reg, "printedAt" | "slug">, printed: Record<string, number>): boolean {
  return !!r.printedAt || !!printed[r.slug];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface RowModel {
  slug: string;
  name: string | null;
  title: string;
  sub: string;
  warn: boolean;
  live: boolean;
  href: string;
  /** The primary action when this row is first in "Needs you". */
  action: { label: string; href: string } | null;
}

/** V12: one sentence per dog, grouped and sorted by what needs doing. */
export function registrationRows(regs: Reg[], printed: Record<string, number>, now = Date.now()) {
  const needs: (RowModel & { rank: number })[] = [];
  const live: RowModel[] = [];
  const other: RowModel[] = [];
  for (const r of regs) {
    const sex = recallDogSex(r.slug);
    const days = daysLeftOf(r, now);
    const base = { slug: r.slug, name: r.name ?? null, href: `/register/${r.slug}` };
    if (r.status === "pending_activation") {
      if (isPrinted(r, printed)) {
        needs.push({
          ...base,
          title: dogCopyV6.needsCollar(r.name, sex),
          sub: days === null ? "Printed" : `Printed · ${plural(days, "day", "days")} to put it on`,
          warn: days !== null && days <= 3,
          live: false,
          action: { label: `Put ${possessive(r.name)} collar on`, href: `/register/${r.slug}` },
          rank: 0,
        });
      } else {
        needs.push({
          ...base,
          title: `${possessive(r.name)} tag isn't printed`,
          sub: days === null ? "Print it, then put it on" : `${plural(days, "day", "days")} left, then the code expires`,
          warn: days !== null && days <= 7,
          live: false,
          action: { label: `Print ${possessive(r.name)} tag`, href: `/register/${r.slug}/print` },
          rank: 1,
        });
      }
    } else if (r.status === "expired") {
      needs.push({
        ...base,
        title: `${possessive(r.name)} code expired`,
        sub: "Scanning the tag still switches it on",
        warn: true,
        live: false,
        action: { label: `Put ${possessive(r.name)} collar on`, href: `/register/${r.slug}` },
        rank: 2,
      });
    } else if (r.status === "active") {
      live.push({ ...base, title: nameOr(r.name), sub: scanTally(r.scanCount, r.liveSince), warn: false, live: true, action: null });
    } else {
      const word: Record<string, string> = { lost: "Missing", deceased: "Passed away", adopted: "Adopted", relocated: "Moved" };
      other.push({ ...base, title: nameOr(r.name), sub: word[r.status] ?? r.status, warn: false, live: false, action: null });
    }
  }
  needs.sort((a, b) => a.rank - b.rank || (daysLeftOf(regs.find((r) => r.slug === a.slug)!, now) ?? 99) - (daysLeftOf(regs.find((r) => r.slug === b.slug)!, now) ?? 99));
  return { needs, live, other };
}

function Row({ row }: { row: RowModel }): React.JSX.Element {
  return (
    <li>
      <Link href={row.href} className={[s.linkRow, styles.row].join(" ")}>
        <DogAvatar id={row.slug} name={nameOr(row.name)} size={48} />
        <span className={s.linkText}>
          <span className={styles.rowTitle}>{row.title}</span>
          <span className={[s.linkSub, row.warn ? s.linkWarn : ""].filter(Boolean).join(" ")}>{row.sub}</span>
        </span>
        {row.live ? (
          <StatusPill variant="ok" icon="check" size="row">
            Live
          </StatusPill>
        ) : (
          <span className={s.chev} aria-hidden="true">
            ›
          </span>
        )}
      </Link>
    </li>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "first"; me: FeederMe; allowed: boolean }
  | { kind: "list"; me: FeederMe; regs: Reg[]; pending: number; max: number }
  | { kind: "error"; message: string };

function SignedOut(): React.JSX.Element {
  return (
    <div className={[s.page, s.aurora].join(" ")}>
      <div className={[s.body, styles.l3Body].join(" ")}>
        <span className={styles.unknown} aria-hidden="true">
          ?
        </span>
        <h1 className={s.hero}>There&apos;s a dog without a name near you.</h1>
        <p className={s.heroLead}>
          Sign in to give them one, and a collar code that tells strangers they&apos;re somebody&apos;s.
        </p>
      </div>
      <StickyFooter background="none" className={s.footerTight}>
        {/* After sign-in, straight back here (V13), not to Me. */}
        <Button href={`/login?next=${encodeURIComponent("/register")}`} fullWidth>
          Sign in to register a dog
        </Button>
        <Link href="/how-it-works" className={s.linkBtn}>
          How registering works
        </Link>
      </StickyFooter>
    </div>
  );
}

function FirstDog({ me, allowed }: { me: FeederMe; allowed: boolean }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = me.registrationBudget?.max ?? 2;

  const start = async () => {
    setError(null);
    if (allowed) {
      router.push("/register/new");
      return;
    }
    setBusy(true);
    try {
      // One screen for "no registrations" and "enable registration".
      await api.electRegisterSurface();
      router.push("/register/new");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch registration on. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className={[s.page, s.aurora].join(" ")}>
      <div className={s.top}>
        <Link href="/me" className={s.topLink}>
          ‹ Me
        </Link>
      </div>
      <div className={[s.body, s.v6Body].join(" ")}>
        <h1 className={[s.hero, styles.firstTitle].join(" ")}>Every dog on Hetja started with someone like you.</h1>
        <p className={s.heroLead}>Pick a dog you see every day. Naming them is the hard part.</p>
        <ul className={styles.needs}>
          <li className={styles.need}>
            <span className={styles.needTitle}>A clear face photo</span>
            <span className={styles.needSub}>1 min</span>
          </li>
          <li className={styles.need}>
            <span className={styles.needTitle}>Print the tag</span>
            <span className={styles.needSub}>Home printer or a shop</span>
          </li>
          <li className={styles.need}>
            <span className={styles.needTitle}>A soft collar with a breakaway</span>
            <span className={styles.needSub}>About ₹150</span>
          </li>
        </ul>
        <p className={s.note}>{firstDogFinePrint(PENDING_TTL_DAYS, max)}</p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <StickyFooter background="none">
        <Button fullWidth onClick={() => void start()} disabled={busy} aria-busy={busy || undefined}>
          Register your first dog
        </Button>
      </StickyFooter>
    </div>
  );
}

function List({ regs, pending, max }: { regs: Reg[]; pending: number; max: number }): React.JSX.Element {
  const [printed, setPrinted] = useState<Record<string, number>>({});
  useEffect(() => setPrinted(readPrinted()), []);
  const { needs, live, other } = registrationRows(regs, printed);
  const first = needs[0]?.action ?? null;
  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link href="/me" className={s.topLink}>
          ‹ Me
        </Link>
      </div>
      <div className={[s.body, styles.listBody].join(" ")}>
        <h1 className={s.titleXL}>Dogs you put on Hetja</h1>
        {needs.length > 0 && (
          <>
            <h2 className={s.sectionHead}>Needs you</h2>
            <ul className={s.group}>
              {needs.map((r) => (
                <Row key={r.slug} row={r} />
              ))}
            </ul>
          </>
        )}
        {live.length > 0 && (
          <>
            <h2 className={s.sectionHead}>Live</h2>
            <ul className={s.group}>
              {live.map((r) => (
                <Row key={r.slug} row={r} />
              ))}
            </ul>
          </>
        )}
        {other.length > 0 && (
          <ul className={s.group}>
            {other.map((r) => (
              <Row key={r.slug} row={r} />
            ))}
          </ul>
        )}
      </div>
      <StickyFooter background="mist">
        {first ? (
          <Button href={first.href} fullWidth>
            {first.label}
          </Button>
        ) : pending < max ? (
          <Button href="/register/new" fullWidth>
            Register a dog
          </Button>
        ) : null}
      </StickyFooter>
    </div>
  );
}

export default function RegistrationsClient(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    let me: FeederMe;
    try {
      me = await api.getFeederMe();
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401 && err.code !== "UNAUTHENTICATED" && err.status !== 0) {
        setState({ kind: "error", message: err.message });
      } else {
        setState({ kind: "signed_out" });
      }
      return;
    }
    const allowed = canRegister(me);
    if (!allowed) {
      setState({ kind: "first", me, allowed });
      return;
    }
    try {
      let regs: Reg[];
      let pending = me.registrationBudget?.pending ?? 0;
      let max = me.registrationBudget?.max ?? 2;
      try {
        const r = await api.getRegistrationsV6();
        regs = r.registrations;
        if (r.budget) {
          pending = r.budget.pending;
          max = r.budget.max;
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw err;
        regs = (await api.getRegistrations()).registrations;
      }
      setState(regs.length === 0 ? { kind: "first", me, allowed } : { kind: "list", me, regs, pending, max });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setState({ kind: "signed_out" });
      else setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load your dogs." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "signed_out") return <SignedOut />;
  if (state.kind === "first") return <FirstDog me={state.me} allowed={state.allowed} />;
  if (state.kind === "list") return <List regs={state.regs} pending={state.pending} max={state.max} />;
  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link href="/me" className={s.topLink}>
          ‹ Me
        </Link>
      </div>
      <div className={s.body}>
        {state.kind === "error" ? (
          <>
            <p className={s.error} role="alert">
              {state.message}
            </p>
            <button type="button" className={s.inlineLink} onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <p className={s.status} role="status">
            Loading…
          </p>
        )}
      </div>
    </div>
  );
}
