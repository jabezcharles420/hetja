"use client";

/**
 * The admin portal's frame (A1): the sidebar with counts that match the
 * rows on Today, the ⌘K search, the toast, and the three states that come
 * before any of it: signed out, not an admin, and a narrow screen.
 *
 * Access is checked with GET /admin/me: 401 is signed out, 403 is "not an
 * admin". The API is the boundary; this is the courtesy (as in
 * components/RequireCapability).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ds";
import { api, ApiError, clearSession, getAccessToken, type AdminMe, type AdminSearchResult, type AdminToday } from "@/lib/api";
import { collarNumber, plural, ROLE_LABEL, SITE_URL, VET_STATUS_LABEL, wardCode } from "./format";
import { canSee, isAdmin, type Section } from "./permissions";
import { AdminProvider, cx, errorText, styles as s, useWards } from "./ui";

interface NavDef {
  section: Section;
  label: string;
  href: string;
  count?: (t: AdminToday) => { n: number; loud: boolean };
}

const NAV_MAIN: NavDef[] = [
  { section: "today", label: "Today", href: "/admin" },
  { section: "vets", label: "Vets", href: "/admin/vets", count: (t) => ({ n: t.sidebar.vets, loud: true }) },
  { section: "ngos", label: "NGOs", href: "/admin/ngos", count: (t) => ({ n: t.sidebar.ngos, loud: false }) },
  { section: "dogs", label: "Dogs", href: "/admin/dogs" },
  { section: "avatars", label: "Avatars", href: "/admin/avatars", count: (t) => ({ n: t.sidebar.avatars, loud: false }) },
  { section: "feeders", label: "Feeders", href: "/admin/feeders" },
  { section: "collars", label: "Collars", href: "/admin/collars" },
  {
    section: "sos",
    label: "SOS cases",
    href: "/admin/sos",
    count: (t) => ({ n: t.sidebar.sos, loud: t.cards.openSos.unassigned > 0 }),
  },
  { section: "reports", label: "Reports", href: "/admin/reports", count: (t) => ({ n: t.sidebar.reports, loud: false }) },
];

const NAV_TEAM: NavDef[] = [
  { section: "team", label: "Team & roles", href: "/admin/team" },
  { section: "audit", label: "Audit log", href: "/admin/audit" },
  { section: "settings", label: "Settings", href: "/admin/settings" },
];

function isCurrent(path: string, href: string): boolean {
  if (href === "/admin") return path === "/admin" || path === "/admin/";
  if (href === "/admin/reports" && path.startsWith("/admin/merge")) return true;
  return path === href || path.startsWith(href + "/");
}

type Gate = { kind: "loading" } | { kind: "signed_out" } | { kind: "not_admin" } | { kind: "error"; message: string } | { kind: "ok"; me: AdminMe };

export function AdminShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (!getAccessToken()) {
      setGate({ kind: "signed_out" });
      return;
    }
    setGate({ kind: "loading" });
    api.getAdminMe().then(
      (me) => {
        if (!live) return;
        setGate(isAdmin(me) ? { kind: "ok", me } : { kind: "not_admin" });
      },
      (e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) setGate({ kind: "signed_out" });
        else if (e instanceof ApiError && (e.status === 403 || e.code === "ADMIN_REQUIRED")) setGate({ kind: "not_admin" });
        else setGate({ kind: "error", message: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  let body: ReactNode;
  if (gate.kind === "loading") {
    body = (
      <div className={s.gate}>
        <p className={s.muted} role="status">
          Checking your account…
        </p>
      </div>
    );
  } else if (gate.kind === "signed_out") {
    body = <SignedOut />;
  } else if (gate.kind === "not_admin") {
    body = <NotAdmin />;
  } else if (gate.kind === "error") {
    body = (
      <div className={s.gate}>
        <div className={s.gateCard}>
          <h1 className={s.gateTitle}>The admin portal did not load</h1>
          <p className={s.gateBody}>{gate.message}</p>
          <div className={s.actionsInline}>
            <button type="button" className={cx(s.btn, s.btnDark)} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    body = <Portal me={gate.me}>{children}</Portal>;
  }

  return (
    <div className={s.root} data-admin="">
      {body}
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  const next = typeof window === "undefined" ? "/admin" : window.location.pathname + window.location.search;
  return (
    <div className={s.gate}>
      <div className={s.gateCard}>
        <LogoMark size={30} />
        <h1 className={s.gateTitle}>Sign in to the admin portal</h1>
        <p className={s.gateBody}>Use the email your Hetja team account is on. We send you a code; there is no password.</p>
        <div className={s.actionsInline}>
          <Link className={cx(s.btn, s.btnDark)} href={`/login?next=${encodeURIComponent(next)}`}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NotAdmin(): React.JSX.Element {
  return (
    <div className={s.gate}>
      <div className={s.gateCard} data-testid="not-admin">
        <LogoMark size={30} />
        <h1 className={s.gateTitle}>This account is not an admin</h1>
        <p className={s.gateBody}>
          The admin portal is for the Hetja team. If you should have access, ask the Owner to add you under Team &amp; roles. Everything
          else you do on Hetja is in the app.
        </p>
        <div className={s.actionsInline}>
          <a className={cx(s.btn, s.btnDark)} href={`${SITE_URL}/`}>
            Go to Hetja
          </a>
          <button
            type="button"
            className={cx(s.btn, s.btnOutline)}
            onClick={() => {
              clearSession();
              window.location.assign("/login?next=/admin");
            }}
          >
            Use another account
          </button>
        </div>
      </div>
    </div>
  );
}

/** Narrower than 1024px: the portal is a laptop tool, and says so. */
export function LaptopOnly(): React.JSX.Element {
  return (
    <div className={cx(s.gate, s.narrow)} data-testid="admin-laptop">
      <div className={s.gateCard}>
        <LogoMark size={30} />
        <h1 className={s.gateTitle}>Admin works on a laptop</h1>
        <p className={s.gateBody}>
          Bulk uploads, reviewing vets and fixing records need a keyboard and a big screen. Open admin.hetja.in on a laptop or a desktop,
          at least 1024 pixels wide.
        </p>
        <p className={s.gateBody}>An SOS still reaches you on your phone, in the Hetja app.</p>
        <div className={s.actionsInline}>
          <a className={cx(s.btn, s.btnDark)} href={`${SITE_URL}/`}>
            Open the Hetja app
          </a>
        </div>
      </div>
    </div>
  );
}

function Portal({ me, children }: { me: AdminMe; children: ReactNode }): React.JSX.Element {
  const path = usePathname() ?? "/admin";
  const [today, setToday] = useState<AdminToday | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const refreshToday = useCallback(() => {
    setTodayError(null);
    api.getAdminToday().then(
      (t) => {
        setToday(t);
        setTodayError(null);
      },
      (e) => setTodayError(errorText(e)),
    );
  }, []);
  useEffect(refreshToday, [refreshToday]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(
    () => ({ me, today, todayError, refreshToday, toast, openSearch: () => setSearching(true), now: () => new Date() }),
    [me, today, todayError, refreshToday, toast],
  );

  const nav = (items: NavDef[]) =>
    items
      .filter((n) => canSee(me, n.section))
      .map((n) => {
        const c = today && n.count ? n.count(today) : null;
        return (
          <Link key={n.href} href={n.href} className={s.navItem} aria-current={isCurrent(path, n.href) ? "page" : undefined}>
            <span>{n.label}</span>
            {c && c.n > 0 && (
              <span className={c.loud ? s.navBadge : s.navCount}>
                {c.n}
                <span className="h-sr-only"> waiting</span>
              </span>
            )}
          </Link>
        );
      });

  const mainRole = me.roles[0];

  return (
    <AdminProvider value={ctx}>
      <div className={s.frame}>
        <nav className={s.sidebar} aria-label="Admin">
          <Link href="/admin" className={s.brand} aria-label="Hetja Admin, Today">
            <LogoMark size={24} />
            <span className={s.brandName}>Hetja</span>
            <span className={s.brandTag}>Admin</span>
          </Link>
          {nav(NAV_MAIN)}
          <span className={s.navRule} aria-hidden="true" />
          {nav(NAV_TEAM)}
          <div className={s.sidebarFoot}>
            <span>
              {me.name}
              {mainRole ? ` · ${ROLE_LABEL[mainRole.role]}` : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                clearSession();
                window.location.assign("/login?next=/admin");
              }}
            >
              Sign out
            </button>
          </div>
        </nav>
        <div className={s.content}>{children}</div>
      </div>
      <LaptopOnly />
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {toastMsg && (
        <div className={s.toast} role="status">
          {toastMsg}
        </div>
      )}
    </AdminProvider>
  );
}

// ---------------------------------------------------------------------------
// ⌘K search
// ---------------------------------------------------------------------------

export type SearchKind = "dog" | "feeder" | "vet" | "ngo" | "collar";

export interface SearchHit {
  kind: SearchKind;
  key: string;
  title: string;
  detail: string;
  href: string;
}

const KIND_LABEL: Record<SearchKind, string> = { dog: "Dog", feeder: "Feeder", vet: "Vet", ngo: "NGO", collar: "Collar" };

/** GET /admin/search groups its results; the palette shows them as one list. */
export function searchHits(r: AdminSearchResult, codes?: Map<string, string>): SearchHit[] {
  const e = encodeURIComponent;
  return [
    ...r.dogs.map((d) => ({
      kind: "dog" as const,
      key: `dog:${d.slug}`,
      title: d.name ?? "A dog with no name",
      detail: [wardCode(d.wardId, codes), d.collar?.batchNo ? `collar ${d.collar.batchNo}` : d.slug].filter(Boolean).join(" · "),
      href: `/admin/dogs/${e(d.slug)}`,
    })),
    ...r.collars.map((c) => ({
      kind: "collar" as const,
      key: `collar:${c.slug}`,
      title: collarNumber(c.batchNo, c.code),
      detail: [c.dogName ?? "A dog with no name", wardCode(c.wardId, codes)].filter(Boolean).join(" · "),
      href: `/admin/collars?id=${e(c.slug)}`,
    })),
    ...r.vets.map((v) => ({
      kind: "vet" as const,
      key: `vet:${v.id}`,
      title: v.name,
      detail: [v.regLabel, VET_STATUS_LABEL[v.status]].filter(Boolean).join(" · "),
      href: `/admin/vets?id=${e(v.id)}`,
    })),
    ...r.feeders.map((f) => ({
      kind: "feeder" as const,
      key: `feeder:${f.id}`,
      title: f.name,
      detail: [f.wards.map((w) => wardCode(w, codes)).join(", "), plural(f.dogs, "dog")].filter(Boolean).join(" · "),
      href: `/admin/feeders/${e(f.id)}`,
    })),
    ...r.ngos.map((n) => ({
      kind: "ngo" as const,
      key: `ngo:${n.id}`,
      title: n.name,
      detail: n.citywide ? "Citywide" : n.wards.map((w) => wardCode(w, codes)).join(", "),
      href: `/admin/ngos?id=${e(n.id)}`,
    })),
  ];
}

/** The ⌘K hint as the keyboard in front of you spells it. */
export function useShortcutLabel(): string {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
    if (!/mac|iphone|ipad/i.test(p)) setLabel("Ctrl K");
  }, []);
  return label;
}

function SearchPalette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const { codes } = useWards();
  const [text, setText] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => back.current?.focus?.();
  }, []);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    setState("loading");
    let live = true;
    const h = setTimeout(() => {
      api.adminSearch(t).then(
        (r) => {
          if (!live) return;
          setResults(searchHits(r, codes));
          setActive(0);
          setState("done");
        },
        () => live && setState("error"),
      );
    }, 180);
    return () => {
      live = false;
      clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const go = (r: SearchHit) => {
    onClose();
    router.push(r.href);
  };
  return (
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={s.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Search dogs, feeders, vets, collar IDs"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            go(results[active]);
          }
        }}
      >
        <input
          ref={input}
          className={s.paletteInput}
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="admin-search-results"
          aria-activedescendant={results[active] ? `admin-sr-${active}` : undefined}
          aria-label="Search dogs, feeders, vets, collar IDs"
          placeholder="Search dogs, feeders, vets, collar IDs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {results.length > 0 ? (
          <ul id="admin-search-results" role="listbox" className={s.paletteList} aria-label="Results">
            {results.map((r, i) => (
              <li
                key={r.key}
                id={`admin-sr-${i}`}
                role="option"
                aria-selected={i === active}
                className={s.paletteItem}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
              >
                <span className={s.paletteKind}>{KIND_LABEL[r.kind]}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className={s.muted} style={{ fontSize: 13 }}>
                    {r.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.paletteHint} role="status">
            {state === "loading"
              ? "Searching…"
              : state === "error"
                ? "Search did not work. Try again."
                : state === "done"
                  ? `Nothing matches “${text.trim()}”.`
                  : "Type a dog's name, a feeder, a vet, an NGO, a dog ID (r4n7kw2ab) or a collar number. ↑ ↓ to choose, Enter to open, Esc to close."}
          </p>
        )}
      </div>
    </div>
  );
}
