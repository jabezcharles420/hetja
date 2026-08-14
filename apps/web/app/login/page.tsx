"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setAccessToken } from "@/lib/api";
import {
  clearCachedDeviceToken,
  deviceTokenFailureMessage,
  getDeviceToken,
  isBadDeviceTokenError,
  readCachedDeviceToken,
} from "@/lib/device";
import styles from "./login.module.css";

const CONSENT_VERSION = 1;

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [expiresAt, setExpiresAt] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Mint the attested device token in the background, while the feeder is off
   * reading their email for the code.
   *
   * `POST /api/v1/auth/verify` refuses to look at an OTP without one
   * (routes/auth.ts gates on `verifyDeviceToken`), and minting costs a
   * proof-of-work solve — about a second on a desktop, a few on a cheap phone.
   * Doing it here overlaps that cost with the wait for the email instead of
   * stacking it on top of the tap the feeder is watching.
   *
   * Deliberately fire-and-forget for transient failures: the verify step calls
   * `getDeviceToken()` again and will retry then. The two permanent failures are
   * the exception — if this browser cannot do Web Crypto at all, saying so now is
   * far kinder than letting someone type a code that cannot possibly be
   * accepted, so those overwrite the "code sent" message.
   */
  const warmDeviceToken = async () => {
    if (readCachedDeviceToken()) return;
    const outcome = await getDeviceToken();
    if (!outcome.ok && (outcome.reason === "insecure-context" || outcome.reason === "no-web-crypto")) {
      setStatus(deviceTokenFailureMessage(outcome.reason));
    }
  };

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
      void warmDeviceToken();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Submits the OTP with an attested device token, retrying once with a freshly
   * minted token if the server says it does not recognise the one we sent.
   *
   * The realistic cause of BAD_DEVICE_TOKEN on a well-formed token is a
   * HETJA_DEVICE_SECRET rotation, which invalidates every token cached in every
   * browser at once. Without this retry, the fix for that would be "ask every
   * feeder to clear their site data".
   *
   * The retry is safe *because of the order of the checks in auth.ts*: the device
   * token is verified (line 73) BEFORE the OTP is consumed (line 80), so a
   * rejection on that ground has not burned the code the feeder just typed. If
   * that order is ever reversed, this retry starts quietly eating one-time codes
   * and must go.
   */
  const submitVerify = async (deviceToken: string) => {
    const base = {
      email: email.trim(),
      code: code.trim(),
      consentVersion: CONSENT_VERSION,
      isMinor: false,
    };
    try {
      return await api.verifyOtp({ ...base, deviceToken });
    } catch (err) {
      if (!isBadDeviceTokenError(err)) throw err;
      clearCachedDeviceToken();
      const fresh = await getDeviceToken();
      if (!fresh.ok) throw err;
      return await api.verifyOtp({ ...base, deviceToken: fresh.token });
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Usually instant: either the token is cached, or the mint kicked off when
      // the code was requested has already finished (`getDeviceToken` shares one
      // in-flight solve rather than starting a second).
      setStatus("Confirming this device…");
      const device = await getDeviceToken();
      if (!device.ok) {
        setStatus(deviceTokenFailureMessage(device.reason));
        return;
      }

      setStatus("Verifying…");
      const res = await submitVerify(device.token);
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
