"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Aurora, Button, Label, StickyFooter } from "@/components/ds";
import { api, ApiError, setSession } from "@/lib/api";
import {
  clearCachedDeviceToken,
  deviceTokenFailureMessage,
  getDeviceToken,
  isBadDeviceTokenError,
  readCachedDeviceToken,
} from "@/lib/device";
import { formatCountdown, OTP_LENGTH, OTP_MINUTES, RESEND_COOLDOWN_S, safeNext } from "@/lib/login";
import styles from "./login.module.css";

/**
 * Screens 07 / 08, Login (design v4): email, then a 6-digit code.
 *
 * The code boxes are ONE hidden input (autocomplete="one-time-code",
 * inputmode numeric) under six painted boxes, so iOS / Android autofill and
 * paste work as they would on any field. Six digits auto-submit. Resend has a
 * 30 s cooldown, the same as the mock's "Resend in 0:24" countdown.
 */

const CONSENT_VERSION = 1;

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const submittedFor = useRef<string | null>(null);
  const inFlight = useRef(false);

  // Resend cooldown tick.
  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  /**
   * Mint the attested device token in the background, while the feeder is off
   * reading their email. POST /auth/verify refuses an OTP without one, and
   * minting is a proof-of-work solve (a second on a desktop, a few on a cheap
   * phone), so doing it now overlaps that cost with the wait for the email.
   * Transient failures are left for the verify step to retry; the permanent
   * ones (no Web Crypto) are said now, before anyone types a doomed code.
   */
  const warmDeviceToken = async () => {
    if (readCachedDeviceToken()) return;
    const outcome = await getDeviceToken();
    if (!outcome.ok && (outcome.reason === "insecure-context" || outcome.reason === "no-web-crypto")) {
      setStatus(deviceTokenFailureMessage(outcome.reason));
    }
  };

  const sendCode = async (): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.requestOtp(email.trim());
      setDevCode(res.devCode);
      setResendIn(RESEND_COOLDOWN_S);
      void warmDeviceToken();
      return true;
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not send the code. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setStatus("Type your email first.");
      return;
    }
    if (await sendCode()) {
      setCode("");
      submittedFor.current = null;
      setStep("code");
    }
  };

  const resend = async () => {
    setCode("");
    submittedFor.current = null;
    await sendCode();
    codeRef.current?.focus();
  };

  /**
   * Submits the OTP with an attested device token, retrying once with a
   * freshly minted token if the server does not recognise the one we sent
   * (a HETJA_DEVICE_SECRET rotation invalidates every cached token at once).
   * Safe because routes/auth.ts verifies the device token BEFORE it consumes
   * the OTP; if that order is ever reversed this retry starts eating codes.
   */
  const submitVerify = async (deviceToken: string, otp: string) => {
    const base = {
      email: email.trim(),
      code: otp,
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

  const verify = useCallback(
    async (otp: string) => {
      // A ref, not `busy`: auto-submit and a Verify tap can land in the same
      // tick, and a second submission of a one-time code burns an attempt.
      if (otp.length !== OTP_LENGTH || inFlight.current) return;
      inFlight.current = true;
      submittedFor.current = otp;
      setBusy(true);
      try {
        // Usually instant: cached, or the warm-up mint has already finished
        // (getDeviceToken shares one in-flight solve).
        setStatus("Confirming this device…");
        const device = await getDeviceToken();
        if (!device.ok) {
          setStatus(deviceTokenFailureMessage(device.reason));
          return;
        }
        setStatus("Checking the code…");
        const res = await submitVerify(device.token, otp);
        // BOTH halves: the refresh token is what outlives the 15-minute access token.
        setSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        setStatus(null);
        router.push(safeNext(new URLSearchParams(window.location.search).get("next")));
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : "That code didn't work. Try again.");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    // submitVerify closes over `email`, which is fixed on this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, email],
  );

  const onCodeChange = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(next);
    if (status && !busy) setStatus(null);
    // Auto-submit once per complete code.
    if (next.length === OTP_LENGTH && submittedFor.current !== next) void verify(next);
  };

  if (step === "email") {
    return (
      <Aurora variant="light" className={styles.page}>
        <form className={styles.form} onSubmit={(e) => void requestCode(e)} noValidate>
          <div className={styles.bodyEmail}>
            <h1 className={styles.title}>
              Sign in.
              <br />
              No password.
            </h1>
            <p className={styles.lead}>
              For feeders and vets. We email you a 6-digit code. You have enough to remember, like which dog
              hates the red scooter.
            </p>
            <div className={styles.field}>
              <Label as="label" htmlFor="login-email">
                Email
              </Label>
              <input
                id="login-email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={status ? "login-status" : undefined}
              />
            </div>
            {status && (
              <p id="login-status" className={styles.status} role="alert">
                {status}
              </p>
            )}
          </div>
          <StickyFooter background="none" className={styles.footer}>
            <Button type="submit" fullWidth disabled={busy} aria-busy={busy || undefined}>
              Send code
            </Button>
          </StickyFooter>
        </form>
      </Aurora>
    );
  }

  const active = codeFocused && code.length < OTP_LENGTH ? code.length : -1;

  return (
    <Aurora variant="light" className={styles.page}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length !== OTP_LENGTH) {
            setStatus("Type all 6 digits from the email.");
            codeRef.current?.focus();
            return;
          }
          void verify(code);
        }}
        noValidate
      >
        <div className={styles.top}>
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              setStep("email");
              setStatus(null);
              setCode("");
            }}
          >
            ‹ Change email
          </button>
        </div>
        <div className={styles.bodyCode}>
          <h1 className={styles.title}>Check your email.</h1>
          <p className={styles.lead}>
            6 digits sent to {email.trim()}. It works for {OTP_MINUTES} minutes.
          </p>
          {devCode && <p className={styles.dev}>Dev build: your code is {devCode}</p>}
          <div className={styles.otp}>
            <input
              ref={codeRef}
              id="login-code"
              className={styles.otpInput}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              onFocus={() => setCodeFocused(true)}
              onBlur={() => setCodeFocused(false)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={OTP_LENGTH}
              aria-label="6-digit code"
              aria-describedby={status ? "login-status" : undefined}
            />
            {Array.from({ length: OTP_LENGTH }, (_, i) => (
              <div
                key={i}
                className={[styles.box, i === active ? styles.boxActive : ""].filter(Boolean).join(" ")}
                aria-hidden="true"
                data-testid="otp-box"
              >
                {code[i] ?? (i === active ? <span className={styles.caret} /> : null)}
              </div>
            ))}
          </div>
          <p className={styles.resend}>
            Nothing yet?{" "}
            {resendIn > 0 ? (
              <span aria-live="off">Resend in {formatCountdown(resendIn)}</span>
            ) : (
              <button type="button" className={styles.resendBtn} onClick={() => void resend()} disabled={busy}>
                Resend
              </button>
            )}
          </p>
          {status && (
            <p id="login-status" className={styles.status} role="status">
              {status}
            </p>
          )}
        </div>
        <StickyFooter background="none" className={styles.footer}>
          <Button type="submit" fullWidth disabled={busy} aria-busy={busy || undefined}>
            Verify
          </Button>
        </StickyFooter>
      </form>
    </Aurora>
  );
}
