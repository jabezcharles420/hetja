"use client";

/**
 * Admin building blocks: the context the shell provides, a data hook, the
 * pill tabs, the list-with-detail table, the detail rows and the confirm
 * dialog every destructive action goes through.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { api, ApiError, type AdminMe, type AdminPermission, type AdminToday, type Ward } from "@/lib/api";
import { MUMBAI_WARDS } from "./format";
import { can as canDo } from "./permissions";
import s from "./admin.module.css";

export { s as styles };

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AdminCtx {
  me: AdminMe;
  today: AdminToday | null;
  /** Why GET /admin/today failed, until a retry works. */
  todayError: string | null;
  refreshToday: () => void;
  toast: (message: string) => void;
  openSearch: () => void;
  /** Panels register here so Esc closes the innermost open thing first. */
  now: () => Date;
}

const Ctx = createContext<AdminCtx | null>(null);

export const AdminProvider = Ctx.Provider;

export function useAdmin(): AdminCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAdmin outside the admin shell");
  return c;
}

export function useCan(permission: AdminPermission): boolean {
  return canDo(useAdmin().me, permission);
}

/** "K/W" -> "K-West": the canonical id the API stores, for the offline fallback list. */
function wardIdFromCode(code: string): string {
  const m = /^([A-Z])\/([NSEWC])$/.exec(code);
  if (!m) return code;
  const side: Record<string, string> = { N: "North", S: "South", E: "East", W: "West", C: "Central" };
  return `${m[1]}-${side[m[2]]}`;
}

const FALLBACK_WARDS: Ward[] = MUMBAI_WARDS.map((code) => ({ id: wardIdFromCode(code), code, name: code }));
let wardsCache: Promise<Ward[]> | null = null;

/** The 24 BMC wards (GET /wards, public), with an id -> "K/W" map. */
export function useWards(): { wards: Ward[]; codes: Map<string, string> } {
  const [wards, setWards] = useState<Ward[]>(FALLBACK_WARDS);
  useEffect(() => {
    let live = true;
    wardsCache ??= api.getWards().then(
      (r) => (r.wards.length ? r.wards : FALLBACK_WARDS),
      () => {
        wardsCache = null;
        return FALLBACK_WARDS;
      },
    );
    wardsCache.then((w) => live && setWards(w));
    return () => {
      live = false;
    };
  }, []);
  const codes = new Map([...FALLBACK_WARDS, ...wards].map((w) => [w.id, w.code]));
  return { wards, codes };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T) => void;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fn().then(
      (d) => {
        if (!live) return;
        setData(d);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(errorText(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** One URL query value (selection, tab) that survives a reload and a shared link. */
export function useQueryParam(name: string): [string | null, (v: string | null, extra?: Record<string, string | null>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const value = params?.get(name) ?? null;
  const set = useCallback(
    (v: string | null, extra: Record<string, string | null> = {}) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      for (const [k, val] of Object.entries({ [name]: v, ...extra })) {
        if (val === null || val === "") next.delete(k);
        else next.set(k, val);
      }
      const qs = next.toString();
      router.replace(`${path}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, path, name],
  );
  return [value, set];
}

// ---------------------------------------------------------------------------
// Headings and states
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string;
  href?: string;
}

export function Crumbs({ items }: { items: Crumb[] }): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className={s.eyebrow}>
      {items.map((c, i) => (
        <span key={i}>
          {i > 0 && " › "}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Loading({ what = "Loading" }: { what?: string }): React.JSX.Element {
  return (
    <p className={s.muted} role="status">
      {what}…
    </p>
  );
}

export function ErrorLine({ message, retry }: { message: string; retry?: () => void }): React.JSX.Element {
  return (
    <p className={s.error} role="alert">
      {message}{" "}
      {retry && (
        <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={retry}>
          Try again
        </button>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Tabs (pill filters). Arrow keys move between tabs, as a tablist should.
// ---------------------------------------------------------------------------

export interface TabDef<K extends string> {
  key: K;
  label: string;
  warn?: boolean;
}

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === value);
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    if (j < 0) return;
    e.preventDefault();
    onChange(tabs[j].key);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={s.tabs} onKeyDown={onKey}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          className={cx(s.tab, t.warn && t.key !== value && s.tabWarn)}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List-with-detail table
// ---------------------------------------------------------------------------

export interface Column<R> {
  key: string;
  label: string;
  /** CSS width for <col>, e.g. "110px" or "32%". */
  width?: string;
  cell: (row: R) => ReactNode;
}

/**
 * A real <table> (headers announced per cell). The first cell holds a button
 * that opens the row, so keyboard users Tab to a row and press Enter; ↑ ↓
 * move the selection while focus is in the table. The open row carries
 * aria-current, which screen readers read as "current".
 */
export function SelectTable<R>({
  caption,
  columns,
  rows,
  rowKey,
  selected,
  onSelect,
  empty,
}: {
  caption: string;
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  selected: string | null;
  onSelect: (key: string) => void;
  empty: string;
}): React.JSX.Element {
  const btns = useRef<Map<string, HTMLButtonElement>>(new Map());
  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.findIndex((r) => rowKey(r) === selected);
    const j = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    const k = rowKey(rows[j]);
    onSelect(k);
    btns.current.get(k)?.focus();
  };
  return (
    <table className={s.table} onKeyDown={onKey}>
      <caption className="h-sr-only">{caption}</caption>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr className={s.tableEmpty}>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((r) => {
            const k = rowKey(r);
            const on = k === selected;
            return (
              <tr key={k} aria-current={on ? "true" : undefined} data-selected={on || undefined} onClick={() => onSelect(k)}>
                {columns.map((c, ci) =>
                  ci === 0 ? (
                    <td key={c.key}>
                      <button
                        type="button"
                        className={cx(s.linkBtn, s.rowLink)}
                        style={{ fontSize: "inherit", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}
                        ref={(el) => {
                          if (el) btns.current.set(k, el);
                          else btns.current.delete(k);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(k);
                        }}
                      >
                        {c.cell(r)}
                      </button>
                    </td>
                  ) : (
                    <td key={c.key}>{c.cell(r)}</td>
                  ),
                )}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Detail pieces
// ---------------------------------------------------------------------------

export function Rows({ rows }: { rows: [string, ReactNode][] }): React.JSX.Element {
  return (
    <dl className={s.rows}>
      {rows.map(([k, v]) => (
        <div key={k} className={s.row}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Chips({ items, label }: { items: { text: string; on: boolean }[]; label: string }): React.JSX.Element {
  return (
    <ul className={s.chips} aria-label={label}>
      {items.map((c) => (
        <li key={c.text} className={cx(s.chip, !c.on && s.chipOff)}>
          {c.on ? `✓ ${c.text}` : c.text}
          {!c.on && <span className="h-sr-only"> (not yet)</span>}
        </li>
      ))}
    </ul>
  );
}

export function Initials({ name, square }: { name: string; square?: boolean }): React.JSX.Element {
  const letters = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={cx(s.whoPic, square && s.whoPicSquare)} aria-hidden="true">
      {letters}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dialogs. Esc closes, focus moves in and comes back, Tab stays inside.
// ---------------------------------------------------------------------------

export function Dialog({
  title,
  onClose,
  children,
  labelledBy,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  /** The document viewer: room for a PDF page. */
  wide?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const titleId = labelledBy ?? `${autoId}-t`;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("textarea, input, select, button:not([data-close])");
    (first ?? el)?.focus();
    return () => back?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const f = Array.from(
      ref.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, textarea, select") ?? [],
    );
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={s.dialog} style={wide ? { width: "min(960px, calc(100vw - 32px))" } : undefined} tabIndex={-1} onKeyDown={onKey}>
        <h2 id={titleId} className={s.dialogTitle}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmChoice {
  value: string;
  title: string;
  detail: string;
}

export interface ConfirmSpec {
  title: string;
  /** What will happen, in plain words. Required: every confirm names it. */
  body: ReactNode;
  confirm: string;
  tone?: "danger" | "dark";
  reason?: { label: string; placeholder?: string; required?: boolean; hint?: string };
  choices?: { label: string; options: ConfirmChoice[]; initial: string };
  run: (reason: string, choice: string) => Promise<unknown>;
  done?: string;
}

/** Every destructive action goes through this: it names what will happen. */
export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: (ok: boolean) => void }): React.JSX.Element {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState(spec.choices?.initial ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useAdmin();
  const rid = useId();
  const need = spec.reason?.required !== false && !!spec.reason;
  const ok = !need || reason.trim().length >= 3;
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await spec.run(reason.trim(), choice);
      if (spec.done) toast(spec.done);
      onClose(true);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={spec.title} onClose={() => onClose(false)}>
      <div className={s.dialogBody}>{spec.body}</div>
      {spec.choices && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend className={s.fieldLabel} style={{ marginBottom: 8 }}>
            {spec.choices.label}
          </legend>
          {spec.choices.options.map((o) => (
            <label key={o.value} className={s.radio}>
              <input type="radio" name={`${rid}-c`} value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} />
              <span>
                <b>{o.title}</b>
                {o.detail}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {spec.reason && (
        <label className={s.field}>
          <span className={s.fieldLabel}>{spec.reason.label}</span>
          <textarea
            className={s.textarea}
            value={reason}
            placeholder={spec.reason.placeholder}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={spec.reason.hint ? `${rid}-h` : undefined}
            required={need}
          />
          {spec.reason.hint && (
            <span id={`${rid}-h`} className={s.note}>
              {spec.reason.hint}
            </span>
          )}
        </label>
      )}
      {err && (
        <p className={s.error} role="alert">
          {err}
        </p>
      )}
      <div className={s.dialogActions}>
        <button type="button" data-close className={cx(s.btn, s.btnOutline)} onClick={() => onClose(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={cx(s.btn, spec.tone === "dark" ? s.btnDark : s.btnDangerSolid)}
          disabled={!ok || busy}
          onClick={submit}
        >
          {busy ? "Working…" : spec.confirm}
        </button>
      </div>
    </Dialog>
  );
}

/** State for one pending confirm on a screen. */
export function useConfirm(): [ReactNode, (spec: ConfirmSpec, after?: () => void) => void] {
  const [spec, setSpec] = useState<{ spec: ConfirmSpec; after?: () => void } | null>(null);
  const node = spec ? (
    <ConfirmDialog
      spec={spec.spec}
      onClose={(ok) => {
        const after = spec.after;
        setSpec(null);
        if (ok) after?.();
      }}
    />
  ) : null;
  return [node, (sp, after) => setSpec({ spec: sp, after })];
}

/** Esc closes the open detail panel when no dialog has taken it. */
export function useEscape(onEscape: (() => void) | null): void {
  useEffect(() => {
    if (!onEscape) return;
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      onEscape();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onEscape]);
}

/**
 * An action the API would refuse for this viewer: shown, disabled, with the
 * reason beside it, so nobody wonders where a button went.
 */
export function Refused({ label, why, small }: { label: string; why: string; small?: boolean }): React.JSX.Element {
  const id = useId();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <button type="button" className={cx(s.btn, small ? s.btnXs : undefined, s.btnOutline)} disabled aria-describedby={id}>
        {label}
      </button>
      <span id={id} className={s.note} style={{ fontSize: 12 }}>
        {why}
      </span>
    </span>
  );
}
