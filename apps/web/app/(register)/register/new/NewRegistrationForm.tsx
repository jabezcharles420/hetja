"use client";

/**
 * Route protection is a UX boundary, not a security boundary — see
 * RequireCapability header. The API is the boundary.
 *
 * Shape mirrors ScanEntry exactly: label + input + submit + role=alert error +
 * aria-describedby wiring + offline role=status notice. Warms the device token
 * on mount the way login/page.tsx's warmDeviceToken does, so PoW overlaps with
 * typing instead of stacking onto the submit tap.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BMC_WARD_CODES } from "@hetja/contracts";
import { api, ApiError } from "@/lib/api";
import { getDeviceToken, readCachedDeviceToken } from "@/lib/device";
import RequireCapability from "@/components/RequireCapability";
import PageHeader from "@/components/PageHeader";
import contentStyles from "@/components/Content.module.css";
import formStyles from "./new.module.css";

function NewFormInner(): React.JSX.Element {
  const router = useRouter();

  const [wardId, setWardId] = useState<string>(BMC_WARD_CODES[0]);
  const [name, setName] = useState("");
  const [sex, setSex] = useState<"" | "male" | "female" | "unknown">("");
  const [approxAge, setApproxAge] = useState("");
  const [coatPattern, setCoatPattern] = useState("");
  const [temperament, setTemperament] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  // Warm the device token on mount — same shape as login/page.tsx::warmDeviceToken.
  useEffect(() => {
    if (readCachedDeviceToken()) return;
    void getDeviceToken();
  }, []);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    sync();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Best-effort device token for the x-device-token header (INVARIANT 6 gate).
      let deviceToken: string | undefined;
      try {
        const { getDeviceToken: gdt } = await import("@/lib/device");
        const outcome = await gdt();
        if (outcome.ok) deviceToken = outcome.token;
        else {
          // Surface permanent failures; transient ones fall through to the API's 401.
          if (outcome.reason === "insecure-context" || outcome.reason === "no-web-crypto") {
            const { deviceTokenFailureMessage } = await import("@/lib/device");
            throw new Error(deviceTokenFailureMessage(outcome.reason));
          }
        }
      } catch (err) {
        // If we threw a named failure above, surface it.
        if (err instanceof Error && err.message.includes("secure connection")) {
          setError(err.message);
          setBusy(false);
          return;
        }
        // Otherwise ignore — request will 401 and we surface that message.
      }

      const input: Record<string, unknown> = { wardId };
      if (name.trim()) input.name = name.trim();
      if (sex) input.sex = sex;
      const ageNum = approxAge.trim() === "" ? undefined : Number(approxAge.trim());
      if (ageNum !== undefined && !Number.isNaN(ageNum)) input.approxAge = ageNum;
      if (coatPattern.trim()) input.coatPattern = coatPattern.trim();
      if (temperament.trim()) input.temperament = temperament.trim();

      const res = await api.createRegistration(input as never, deviceToken);
      router.push(`/register/${res.slug}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "REGISTRATION_BUDGET_EXCEEDED" || err.code === "DEVICE_REGISTRATION_BUDGET_EXCEEDED") {
          setError("Registration budget full — 2 pending at a time. Attach a collar to free a slot.");
        } else if (err.code === "REGISTRATION_DISABLED") {
          setError("Registration is disabled for this account.");
        } else if (err.code === "UNAUTHENTICATED_DEVICE") {
          setError("Could not confirm this device. Check your connection and try again.");
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Could not create registration.");
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldId = "register-ward";

  return (
    <>
      <PageHeader
        kicker="Register"
        title="Register a street dog"
        intro="File a dog you look after. You’ll get a signed QR to laser-etch — the registration stays inert until you scan it on the dog."
      />

      <section className={`${contentStyles.section} h-container`}>
        <form className={formStyles.form} onSubmit={(e) => void submit(e)} noValidate>
          {offline && (
            <p className={formStyles.offline} role="status">
              No signal — this form needs a connection to mint the collar. It will retry when you’re back.
            </p>
          )}

          <label className={formStyles.field} htmlFor={fieldId}>
            <span className={formStyles.label}>Ward (BMC) *</span>
            <select
              id={fieldId}
              className={formStyles.input}
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
              aria-describedby={error ? `${fieldId}-error` : undefined}
            >
              {BMC_WARD_CODES.map((code: string) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Dog name (optional)</span>
            <input
              className={formStyles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kalu"
              maxLength={80}
              autoCapitalize="words"
              aria-describedby={error ? `${fieldId}-error` : undefined}
            />
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Sex</span>
            <select
              className={formStyles.input}
              value={sex}
              onChange={(e) => setSex(e.target.value as never)}
            >
              <option value="">Unknown</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Approx. age (years, optional)</span>
            <input
              className={formStyles.input}
              value={approxAge}
              onChange={(e) => setApproxAge(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              placeholder="e.g. 2"
              inputMode="numeric"
              maxLength={2}
            />
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Coat / pattern (optional)</span>
            <input
              className={formStyles.input}
              value={coatPattern}
              onChange={(e) => setCoatPattern(e.target.value)}
              placeholder="e.g. brown with white patch"
              maxLength={120}
            />
          </label>

          <label className={formStyles.field}>
            <span className={formStyles.label}>Temperament (optional)</span>
            <input
              className={formStyles.input}
              value={temperament}
              onChange={(e) => setTemperament(e.target.value)}
              placeholder="e.g. friendly, shy in crowds"
              maxLength={120}
            />
          </label>

          <button type="submit" className={formStyles.submit} disabled={busy}>
            {busy ? "Registering…" : "Register and get QR"}
          </button>

          {error && (
            <p className={formStyles.error} id={`${fieldId}-error`} role="alert">
              {error}
            </p>
          )}

          <p className={formStyles.hint}>
            Two pending registrations at a time. Attaching a tag frees a slot. The QR is signed under the server’s secret — reprinting keeps the
            same slug.
          </p>
        </form>

        <p style={{ marginTop: "var(--h-s5)" }}>
          <Link href="/register" style={{ color: "var(--h-ink-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}>
            ← Back to registrations
          </Link>
        </p>
      </section>
    </>
  );
}

export default function NewRegistrationForm(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <NewFormInner />
    </RequireCapability>
  );
}
