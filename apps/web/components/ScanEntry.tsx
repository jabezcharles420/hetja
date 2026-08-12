"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCollarCode } from "@/lib/collar";
import styles from "./ScanEntry.module.css";

export interface ScanEntryProps {
  /** Stable id so the label and any error stay associated with the input. */
  id?: string;
  /** Accessible label for the code input. */
  label?: string;
  /** Small helper line under the form. */
  hint?: string;
  placeholder?: string;
  buttonLabel?: string;
}

/**
 * Collar code entry used by both the /scan page and the landing hero CTA.
 *
 * Valid codes navigate to `/dog/[slug]` via `router.push`. Invalid codes show
 * the friendly parser error. While the device is offline a calm notice is
 * shown (the shell works from cache and logged feeds are queued for later).
 */
export default function ScanEntry({
  id = "collar-code",
  label = "Collar code",
  hint,
  placeholder = "e.g. abc234567",
  buttonLabel = "View profile",
}: ScanEntryProps): React.JSX.Element {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    sync();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = parseCollarCode(code);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setCode("");
    router.push(`/dog/${result.slug}`);
  };

  return (
    <div className={styles.wrap}>
      {offline && (
        <p className={styles.offline} role="status">
          No signal — profiles load from cache, and any feeds you log will sync
          when you&rsquo;re back.
        </p>
      )}
      <form className={styles.form} onSubmit={submit} noValidate>
        <label className={styles.field}>
          <span className={styles.label}>{label}</span>
          <input
            id={id}
            className={styles.input}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            pattern="[a-km-z2-9]{9}"
            maxLength={9}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </label>
        <button type="submit" className={styles.submit}>
          {buttonLabel}
        </button>
      </form>
      {error && (
        <p className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
