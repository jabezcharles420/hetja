"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DogProfile } from "@/lib/api";
import { normaliseCode, prettyCode } from "@/lib/scan-code";
import { PageQr, useHereUrl } from "@/components/DesktopInvite";
import { relTime } from "./logic";
import styles from "./DeskModals.module.css";

/**
 * The desktop map's two dialogs (design v8, from the owner's Stitch page):
 * "Look up a collar" (type the code printed under a QR, see the dog, open its
 * page) and "Open on your phone" (a QR of this page). Centred dialogs are a
 * desktop affordance; the phone keeps its sheets. Escape and the scrim close
 * them, focus moves in and goes back to the opener.
 */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function CollarLookup({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "none" | "error" } | { kind: "found"; dog: DogProfile }>({
    kind: "idle",
  });
  const slug = normaliseCode(code);

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slug.length < 9) return;
    setState({ kind: "busy" });
    try {
      setState({ kind: "found", dog: await api.getDog(slug) });
    } catch (err) {
      setState({ kind: err instanceof ApiError && err.status === 404 ? "none" : "error" });
    }
  };

  return (
    <Dialog title="Look up a collar" onClose={onClose}>
      <p className={styles.lead}>Type the 9 letters printed under the QR on the collar.</p>
      <form onSubmit={look} className={styles.form}>
        <label className={styles.fieldLabel} htmlFor="desk-collar">
          Collar code
        </label>
        <input
          id="desk-collar"
          className={styles.codeInput}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (state.kind !== "idle" && state.kind !== "busy") setState({ kind: "idle" });
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="DDR 017 XK2"
          maxLength={14}
        />
        {state.kind === "none" && <p className={styles.msg}>No dog has this code. Check the letters under the QR.</p>}
        {state.kind === "error" && <p className={styles.msg}>Couldn&apos;t reach Hetja. Try again.</p>}
        {state.kind === "found" && <DogCard dog={state.dog} />}
        <div className={styles.actions}>
          <button type="button" className={styles.quiet} onClick={onClose}>
            Cancel
          </button>
          {state.kind === "found" ? (
            <a className={styles.primary} href={`/dog/${encodeURIComponent(state.dog.slug)}`}>
              Open health ledger
            </a>
          ) : (
            <button type="submit" className={styles.primary} disabled={slug.length < 9 || state.kind === "busy"}>
              {state.kind === "busy" ? "Looking…" : "Look up"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function DogCard({ dog }: { dog: DogProfile }): React.JSX.Element {
  const rabies = dog.vaccinated === "yes" ? "Vaccinated" : "Vaccination unknown";
  const fed = dog.lastFedAt ? `Fed ${relTime(dog.lastFedAt)}` : "Not logged yet";
  return (
    <div className={styles.dogCard}>
      <span className={styles.av} aria-hidden="true">
        {(dog.name ?? "?").charAt(0).toUpperCase()}
      </span>
      <div className={styles.dogText}>
        <span className={styles.dogName}>
          {dog.name ?? "A collared dog"}
          {dog.wardName ? ` (${dog.wardName})` : ""}
        </span>
        <span className={styles.dogSub}>
          {prettyCode(dog.slug)} · {rabies} · {fed}
        </span>
      </div>
    </div>
  );
}

export function PhoneHandoff({ onClose }: { onClose: () => void }): React.JSX.Element {
  const url = useHereUrl();
  return (
    <Dialog title="Open on your phone" onClose={onClose}>
      <div className={styles.qrWrap}>
        <PageQr url={url} size={184} label="QR code that opens this page on your phone" />
      </div>
      <p className={styles.center}>Scan with your phone&apos;s camera. It opens in the browser, iPhone or Android, no app to install.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
