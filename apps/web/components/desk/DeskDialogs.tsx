"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, ApiError, type DogProfile } from "@/lib/api";
import { normaliseCode, prettyCode } from "@/lib/scan-code";
import { PageQr } from "@/components/DesktopInvite";
import styles from "./DeskDialogs.module.css";

/**
 * The desktop's two dialogs (design v9, the owner's "Hetja Desktop" export):
 * "Open on your phone" (a QR of this page, or of a dog's page) and "Look up
 * a collar" (type the code, see the dog, open it on your phone). One pair
 * for the whole desktop site: the header's "Look up a collar" and "Open on
 * phone", the home page's links and the role cards all open these.
 */
interface DeskDialogApi {
  openPhone: (dog?: { name: string; slug: string }) => void;
  openLookup: () => void;
}

const Ctx = createContext<DeskDialogApi>({ openPhone: () => undefined, openLookup: () => undefined });

export function useDeskDialogs(): DeskDialogApi {
  return useContext(Ctx);
}

type Open = { kind: "phone"; dog?: { name: string; slug: string } } | { kind: "lookup" } | null;

export function DeskDialogs({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<Open>(null);
  const pathname = usePathname();
  // Moving to another page closes whatever was open.
  useEffect(() => setOpen(null), [pathname]);
  const value = useMemo<DeskDialogApi>(
    () => ({ openPhone: (dog) => setOpen({ kind: "phone", dog }), openLookup: () => setOpen({ kind: "lookup" }) }),
    [],
  );
  const close = useCallback(() => setOpen(null), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open?.kind === "phone" && <PhoneDialog dog={open.dog} onClose={close} />}
      {open?.kind === "lookup" && <LookupDialog onClose={close} onDog={(dog) => setOpen({ kind: "phone", dog })} />}
    </Ctx.Provider>
  );
}

function Dialog({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean }): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={[styles.dialog, wide ? styles.wide : ""].join(" ")}>
        {children}
      </div>
    </div>
  );
}

function PhoneDialog({ dog, onClose }: { dog?: { name: string; slug: string }; onClose: () => void }): React.JSX.Element {
  const [url, setUrl] = useState("https://hetja.in/");
  useEffect(() => {
    setUrl(dog ? `${window.location.origin}/dog/${encodeURIComponent(dog.slug)}` : window.location.href);
  }, [dog]);
  let typed = "hetja.in";
  try {
    const u = new URL(url);
    typed = `hetja.in${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    /* keep hetja.in */
  }
  const title = dog ? `Open ${dog.name} on your phone` : "Open on your phone";
  return (
    <Dialog label={title} onClose={onClose}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.qr}>
        <PageQr url={url} size={172} label={dog ? `QR code that opens ${dog.name}'s page on your phone` : "QR code that opens this page on your phone"} />
      </div>
      <p className={styles.text}>Point your phone&apos;s camera at the code. It opens in the browser, iPhone or Android, no app to install.</p>
      <p className={styles.small}>
        Or type <b className={styles.mono}>{typed}</b>
      </p>
      <button type="button" className={`${styles.btn} ${styles.quiet} ${styles.full}`} onClick={onClose}>
        Done
      </button>
    </Dialog>
  );
}

function LookupDialog({ onClose, onDog }: { onClose: () => void; onDog: (dog: { name: string; slug: string }) => void }): React.JSX.Element {
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "missing" | "error" } | { kind: "found"; dog: DogProfile }>({ kind: "idle" });
  const slug = normaliseCode(code);
  const seq = useRef(0);

  // The design looks the code up as soon as all 9 letters are in.
  useEffect(() => {
    if (slug.length < 9) {
      setState({ kind: "idle" });
      return;
    }
    const n = ++seq.current;
    setState({ kind: "busy" });
    api.getDog(slug).then(
      (dog) => n === seq.current && setState({ kind: "found", dog }),
      (err) => n === seq.current && setState({ kind: err instanceof ApiError && err.status === 404 ? "missing" : "error" }),
    );
  }, [slug]);

  const found = state.kind === "found" ? state.dog : null;
  const name = found?.name ?? "this dog";
  const meta = found
    ? [found.wardName ? `${prettyWard(found)} · ${found.wardName}` : prettyWard(found), found.vaccinated === "yes" ? "Vaccinated" : "Vaccination unknown"]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Dialog label="Look up a collar" onClose={onClose} wide>
      <div className={styles.head}>
        <h2 className={styles.title}>Look up a collar.</h2>
        <p className={styles.text}>Type the 9 letters printed under the QR on the tag.</p>
      </div>
      <label className={styles.fieldLabel} htmlFor="desk-code">
        Collar code
      </label>
      <input
        id="desk-code"
        className={styles.code}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="DDR 017 XK2"
        maxLength={14}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      <p className={styles.small}>The 9 letters printed under the QR.</p>
      {found && (
        <div className={styles.dog}>
          <span className={styles.av} aria-hidden="true">
            {(found.name ?? "?").charAt(0).toUpperCase()}
          </span>
          <span className={styles.dogText}>
            <span className={styles.dogName}>{found.name ?? "A collared dog"}</span>
            <span className={styles.dogMeta}>
              {meta} · {prettyCode(found.slug)}
            </span>
          </span>
        </div>
      )}
      {state.kind === "missing" && <p className={styles.text}>No dog has that code yet. Check the letters on the tag.</p>}
      {state.kind === "error" && <p className={styles.text}>Couldn&apos;t reach Hetja. Try again.</p>}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          disabled={!found}
          onClick={() => found && onDog({ name: found.name ?? "this dog", slug: found.slug })}
        >
          {found ? `Open ${name} on phone` : "Open on phone"}
        </button>
      </div>
    </Dialog>
  );
}

/** "K/W ward" from the dog's ward id ("K-West"). */
function prettyWard(d: DogProfile): string {
  const [l, half] = d.wardId.split("-");
  return `${half ? `${l}/${half.charAt(0)}` : l} ward`;
}
