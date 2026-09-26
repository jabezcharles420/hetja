"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Aurora, Button, DogAvatar, StatusIcon, StickyFooter } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { api, ApiError, setSession } from "@/lib/api";
import {
  clearCachedDeviceToken,
  deviceTokenFailureMessage,
  getDeviceToken,
  isBadDeviceTokenError,
  readCachedDeviceToken,
} from "@/lib/device";
import {
  cancelHref,
  formatCountdown,
  formatRetryAt,
  isAdminNext,
  OTP_LENGTH,
  OTP_MINUTES,
  RESEND_COOLDOWN_S,
  safeNext,
  verifyErrorMessage,
  welcomeHref,
} from "@/lib/login";
import styles from "./login.module.css";

/**
 * Sign in (design v4 screens 07 / 08, v5 audit, v6 V4 / V5 / V6): email,
 * then a 6-digit code. A full-screen step with Cancel: no card, no tab bar,
 * no footer. A feeder who has not been through N1 yet lands on /welcome.
 *
 * Errors sit on the field they are about, with an icon (V4, V5). A 429 on
 * asking for a code shows V6 with the clock time from Retry-After.
 *
 * The code boxes are ONE hidden input (autocomplete="one-time-code",
 * inputmode numeric) under six painted boxes, so iOS / Android autofill and
 * paste work as they would on any field. Six digits auto-submit. Resend has a
 * 30 s cooldown, the same as the mock's "Resend in 0:24" countdown.
 */

const CONSENT_VERSION = 1;

function FieldError({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <p id={id} className={styles.fieldError} role="alert">
      <StatusIcon name="alert" size={16} />
      {children}
    </p>
  );
}

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code" | "limited">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  /** Progress and device messages (not errors about a field). */
  const [status, setStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** The code step's error came from the server (V5): offer a new code. */
  const [codeRejected, setCodeRejected] = useState(false);
  const [retryAfterSec, setRetryAfterSec] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [cancelTo, setCancelTo] = useState("/");
  const codeRef = useRef<HTMLInputElement | null>(null);
  const submittedFor = useRef<string | null>(null);
  const inFlight = useRef(false);

  // Read after hydration: the server render has no query string to read.
  useEffect(() => {
    setCancelTo(cancelHref(new URLSearchParams(window.location.search).get("next")));
  }, []);

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

  /** Ask for a code. Returns false on failure; a 429 moves to V6. */
  const sendCode = async (onError: (message: string) => void): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.requestOtp(email.trim());
      setDevCode(res.devCode);
      setResendIn(RESEND_COOLDOWN_S);
      void warmDeviceToken();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setRetryAfterSec(err.retryAfterSec);
        setStep("limited");
      } else {
        onError(err instanceof ApiError ? err.message : "Could not send the code. Try again.");
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setEmailError("Type your email first.");
      return;
    }
    setEmailError(null);
    if (await sendCode(setEmailError)) {
      setCode("");
      setCodeError(null);
      submittedFor.current = null;
      setStep("code");
    }
  };

  const resend = async () => {
    setCode("");
    setCodeError(null);
    setCodeRejected(false);
    submittedFor.current = null;
    await sendCode(setCodeError);
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
      setCodeError(null);
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
        const next = safeNext(new URLSearchParams(window.location.search).get("next"));
        // N1 comes first for a feeder who has not chosen wards yet. An older
        // API without `onboarded`, or a failed read, goes straight on. A
        // sign-in for the admin portal always goes back to /admin.
        const onboarded = await api
          .getFeederMe()
          .then((me) => me.onboarded)
          .catch(() => undefined);
        router.push(onboarded === false && !isAdminNext(next) ? welcomeHref(next) : next);
      } catch (err) {
        setStatus(null);
        setCodeRejected(true);
        setCodeError(
          err instanceof ApiError ? verifyErrorMessage(err.code, err.message) : "That code didn't work. Try again.",
        );
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
    if (codeError && !busy) {
      setCodeError(null);
      setCodeRejected(false);
    }
    if (status && !busy) setStatus(null);
    // Auto-submit once per complete code.
    if (next.length === OTP_LENGTH && submittedFor.current !== next) void verify(next);
  };

  /** V5: after a wrong code, tapping any box clears all six. */
  const onBoxesTap = () => {
    if (!codeRejected || busy) return;
    setCode("");
    setCodeError(null);
    setCodeRejected(false);
    submittedFor.current = null;
  };

  if (step === "limited") {
    const at = formatRetryAt(retryAfterSec);
    return (
      <Aurora variant="light" className={styles.page}>
        <div className={styles.form}>
          <div className={`${styles.body} ${styles.bodyLimited}`}>
            <span className={styles.breath} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.2l2 1.3" />
              </svg>
            </span>
            <h1 className={`${styles.title} ${styles.titleBreath}`}>Let&apos;s take a breath.</h1>
            <p className={styles.leadLg}>
              That&apos;s a lot of codes in a short time.{" "}
              {at ? (
                <>
                  You can ask for a new one at <b className={styles.ink}>{at.clock}</b>, {at.relative}.
                </>
              ) : (
                <>You can ask for a new one in a few minutes.</>
              )}
            </p>
            <p className={styles.note}>A code from earlier may still be in your inbox and still work.</p>
          </div>
          <StickyFooter background="none" className={styles.footer}>
            <Button
              fullWidth
              onClick={() => {
                setCode("");
                setCodeError(null);
                submittedFor.current = null;
                setStep("code");
              }}
            >
              I have a code
            </Button>
            <Button variant="link" href="/scan" fullWidth>
              Scan a collar meanwhile
            </Button>
          </StickyFooter>
        </div>
      </Aurora>
    );
  }

  if (step === "email") {
    return (
      <Aurora variant="light" className={styles.page}>
        <AppHeader cancel={{ href: cancelTo }} />
        <form className={styles.form} onSubmit={(e) => void requestCode(e)} noValidate>
          <div className={styles.body}>
            <div className={styles.dogs} aria-hidden="true">
              <DogAvatar id="rani" name="Rani" palette="rose" size={48} ring="var(--h-aurora-light-base)" />
              <DogAvatar id="kalu" name="Kalu" palette="lilac" size={48} ring="var(--h-aurora-light-base)" />
              <DogAvatar id="bruno" name="Bruno" palette="sky" size={48} ring="var(--h-aurora-light-base)" />
            </div>
            <h1 className={styles.title}>
              Sign in.
              <br />
              No password.
            </h1>
            <p className={styles.leadLg}>
              We&apos;ll email you a 6-digit code. You already remember enough, like which dog hates the red scooter.
            </p>
            <div className={styles.field}>
              <input
                id="login-email"
                className={[styles.input, emailError ? styles.inputError : ""].filter(Boolean).join(" ")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                aria-label="Email"
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "login-email-error" : status ? "login-status" : undefined}
              />
              {emailError && <FieldError id="login-email-error">{emailError}</FieldError>}
            </div>
            {status && (
              <p id="login-status" className={styles.status} role="status">
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
      <AppHeader
        cancel={{
          label: "‹ Change email",
          onClick: () => {
            setStep("email");
            setStatus(null);
            setCodeError(null);
            setCodeRejected(false);
            setCode("");
          },
        }}
      />
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (codeRejected) {
            void resend();
            return;
          }
          if (code.length !== OTP_LENGTH) {
            setCodeError("Type all 6 digits from the email.");
            codeRef.current?.focus();
            return;
          }
          void verify(code);
        }}
        noValidate
      >
        <div className={styles.body}>
          <h1 className={`${styles.title} ${styles.titleCode}`}>Check your email.</h1>
          <p className={styles.lead}>
            Sent to <span className={styles.ink}>{email.trim()}</span>. It works for {OTP_MINUTES} minutes.
          </p>
          {devCode && <p className={styles.dev}>Dev build: your code is {devCode}</p>}
          <div className={styles.otp} onPointerDown={onBoxesTap}>
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
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? "login-code-error" : status ? "login-status" : undefined}
            />
            {Array.from({ length: OTP_LENGTH }, (_, i) => (
              <div
                key={i}
                className={[
                  styles.box,
                  codeRejected ? styles.boxError : i === active ? styles.boxActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
                data-testid="otp-box"
              >
                {code[i] ?? (i === active ? <span className={styles.caret} /> : null)}
              </div>
            ))}
          </div>
          {codeError && <FieldError id="login-code-error">{codeError}</FieldError>}
          {codeRejected ? (
            <p className={styles.note}>
              Asked more than once? Only the latest code works. Not there? Look in Promotions or Spam.
            </p>
          ) : (
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
          )}
          {status && (
            <p id="login-status" className={styles.status} role="status">
              {status}
            </p>
          )}
        </div>
        <StickyFooter background="none" className={styles.footer}>
          <Button type="submit" fullWidth disabled={busy} aria-busy={busy || undefined}>
            {codeRejected ? "Send a new code" : "Verify"}
          </Button>
        </StickyFooter>
      </form>
    </Aurora>
  );
}
