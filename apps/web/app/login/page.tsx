"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { uuid } from "@/lib/idb";
import styles from "./login.module.css";

const DEVICE_TOKEN_KEY = "straynet.deviceToken";
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

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
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
      const res = await api.requestOtp(phone.trim());
      setDevCode(res.devCode);
      setExpiresAt(res.expiresAt);
      setStep("code");
      setStatus(res.devCode ? `Dev build — your code is ${res.devCode}` : "Code sent to your phone.");
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
        phone: phone.trim(),
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
      <p className={styles.subtitle}>Phone-based OTP — no password needed.</p>

      {step === "phone" ? (
        <form className={styles.form} onSubmit={(e) => void requestCode(e)}>
          <label className={styles.field}>
            <span>Mobile number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              autoComplete="tel"
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
          <button type="button" className={styles.linkBtn} onClick={() => setStep("phone")}>
            Change number
          </button>
        </form>
      )}
    </div>
  );
}
