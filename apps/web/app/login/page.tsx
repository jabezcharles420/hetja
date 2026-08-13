"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { uuid } from "@/lib/idb";
import styles from "./login.module.css";

const DEVICE_TOKEN_KEY = "hetja.deviceToken";
const CONSENT_VERSION = 1;

function getDeviceToken(): string {
  try {
    if (typeof localStorage === "undefined") return uuid();
    const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (existing) return existing;
    const fresh = uuid();
    localStorage.setItem(DEVICE_TOKEN_KEY, fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [expiresAt, setExpiresAt] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus("Sending code…");
    try {
      const res = await api.requestOtp(email.trim());
      setDevCode(res.devCode);
      setExpiresAt(res.expiresAt);
      setStep("code");
      setStatus(res.devCode ? `Dev build — your code is ${res.devCode}` : "Code sent to your email.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus("Verifying…");
    try {
      const res = await api.verifyOtp({
        email: email.trim(),
        code: code.trim(),
        deviceToken: getDeviceToken(),
        consentVersion: CONSENT_VERSION,
        isMinor: false,
      });
      setAccessToken(res.accessToken);
      router.push("/me");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <nav className={styles.topnav}>
        <Link href="/">← Back</Link>
      </nav>

      <h1 className={styles.title}>Feeder sign-in</h1>
      <p className={styles.subtitle}>Email-based OTP — no password needed.</p>

      {step === "email" ? (
        <form className={styles.form} onSubmit={(e) => void requestCode(e)}>
          <label className={styles.field}>
            <span>Email address</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              inputMode="email"
              autoComplete="email"
            />
          </label>
          {status && <p className={styles.status}>{status}</p>}
          <button type="submit" className={styles.cta} disabled={busy}>
            {busy ? "Sending…" : "Request code"}
          </button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={(e) => void verifyCode(e)}>
          <label className={styles.field}>
            <span>6-digit code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          {expiresAt && (
            <p className={styles.muted}>Expires {new Date(expiresAt).toLocaleTimeString()}.</p>
          )}
          {status && <p className={styles.status}>{status}</p>}
          <button type="submit" className={styles.cta} disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => setStep("email")}>
            Change email
          </button>
        </form>
      )}
    </div>
  );
}
