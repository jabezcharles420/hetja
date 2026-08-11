"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function LandingPage(): React.JSX.Element {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [sig, setSig] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = slug.trim().toLowerCase();
    if (!/^[a-z2-7]{9}$/.test(trimmed)) {
      setError("Enter the 9-character code from the dog's collar (letters a–z + digits 2–7).");
      return;
    }
    setError(null);
    const q = sig.trim() ? `?s=${encodeURIComponent(sig.trim())}` : "";
    router.push(`/dog/${trimmed}${q}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>StrayNet Feeder</h1>
        <p className={styles.tagline}>Scan a collar, log a feed, raise an SOS.</p>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>Collar code</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. abc234567"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
          />
        </label>

        <label className={styles.field}>
          <span>Collar signature (s=)</span>
          <input
            value={sig}
            onChange={(e) => setSig(e.target.value)}
            placeholder="HMAC signature from the QR"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.cta}>
          View profile
        </button>
      </form>

      <p className={styles.hint}>
        <strong>Open camera:</strong> point it at the collar QR to read the code + signature
        automatically. <em>(Camera scanning lands in the next build — type the code for now.)</em>
      </p>

      <nav className={styles.nav}>
        <a href="/login">Feeder sign-in</a>
        <a href="/me">My streak</a>
      </nav>
    </div>
  );
}
