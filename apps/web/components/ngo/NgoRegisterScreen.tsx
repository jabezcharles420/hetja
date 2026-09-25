"use client";

import { useId, useState, type ChangeEvent } from "react";
import { AppHeader, StickyFooter } from "@/components/ds";
import { compressPhoto } from "@/lib/photo";
import { ngoApi, type Ngo, type NgoOffer, type NgoRegType } from "./ngo-api";
import { normalisePhone, OFFERS, REG_TYPES } from "./ngo-copy";
import { errorWords, LoadError, Loading, SignedOut, useMyNgo } from "./NgoGate";
import { NgoStatusView } from "./NgoStatusView";
import { WardChips, WardSheet, useWards } from "./WardSheet";
import styles from "./ngo.module.css";

/**
 * N1 Register an NGO (design v7). Opened from Me's "Bring your NGO to
 * Hetja". One person applies for the NGO; an admin approves it (A7). The
 * certificate is a private document: encrypted at rest, admins only,
 * deleted 30 days after the decision (CONTRACT owner decisions).
 *
 * Once an application exists this route shows its status instead.
 */

/** POST /documents: a PDF up to 5 MB; a photo is re-encoded on the phone (EXIF stripped) and must end under 2 MB. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function certKind(file: Pick<File, "type" | "name">): "pdf" | "image" | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return "image";
  return null;
}

/** The certificate as the API takes it: a PDF as is, a photo re-encoded. */
async function prepareCertificate(file: File): Promise<{ fileName: string; mime: string; base64: string }> {
  if (certKind(file) === "pdf") {
    return { fileName: file.name, mime: "application/pdf", base64: await readBase64(file) };
  }
  const blob = await compressPhoto(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("too big");
  return { fileName: file.name, mime: blob.type || "image/jpeg", base64: await readBase64(blob) };
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export interface NgoDraft {
  name: string;
  regType: NgoRegType;
  regNo: string;
  contact: string;
  phone: string;
  wards: string[];
  offers: NgoOffer[];
  certificate: File | null;
}

/** The first thing missing, in the order the form asks for it, or null. */
export function draftProblem(d: NgoDraft): string | null {
  if (d.name.trim().length < 3) return "Add the NGO's registered name.";
  if (d.regNo.trim().length < 3) return "Add the registration number.";
  if (d.contact.trim().length < 2) return "Add the name of the person we should ask for.";
  if (!normalisePhone(d.phone)) return "Add a phone number we can call, 10 digits.";
  if (d.wards.length === 0) return "Pick at least one ward you cover.";
  if (!d.certificate) return "Add the registration certificate.";
  const kind = certKind(d.certificate);
  if (!kind) return "Add the certificate as a PDF or a photo.";
  if (kind === "pdf" && d.certificate.size > MAX_PDF_BYTES) return "That PDF is over 5 MB. Try a photo of the certificate.";
  return null;
}

export default function NgoRegisterScreen(): React.JSX.Element {
  const { load, reload } = useMyNgo();
  const [sent, setSent] = useState<Ngo | null>(null);

  const existing = load.kind === "ready" ? load.mine.ngo : null;
  const shown = sent ?? (existing && existing.status !== "removed" ? existing : null);

  return (
    <div className={styles.page}>
      <AppHeader back={{ href: "/me", label: "Me", history: true }} />
      {load.kind === "loading" && !sent ? (
        <div className={`h-container ${styles.body}`}>
          <Loading />
        </div>
      ) : load.kind === "signedOut" ? (
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Bring your NGO to Hetja</h1>
          <SignedOut next="/ngo/register" />
        </div>
      ) : load.kind === "error" && !sent ? (
        <div className={`h-container ${styles.body}`}>
          <LoadError message={load.message} onRetry={reload} />
        </div>
      ) : shown ? (
        <div className={`h-container ${styles.body}`}>
          <NgoStatusView ngo={shown} justSent={!!sent} />
        </div>
      ) : (
        <RegisterForm onSent={setSent} />
      )}
    </div>
  );
}

function RegisterForm({ onSent }: { onSent: (ngo: Ngo) => void }): React.JSX.Element {
  const ids = {
    name: useId(),
    reg: useId(),
    contact: useId(),
    phone: useId(),
    wards: useId(),
    offers: useId(),
  };
  const wards = useWards();
  const [draft, setDraft] = useState<NgoDraft>({
    name: "",
    regType: "trust",
    regNo: "",
    contact: "",
    phone: "",
    wards: [],
    offers: [],
    certificate: null,
  });
  const [wardsOpen, setWardsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = <K extends keyof NgoDraft>(k: K, v: NgoDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProblem(null);
  };

  const toggleOffer = (o: NgoOffer) =>
    set("offers", draft.offers.includes(o) ? draft.offers.filter((x) => x !== o) : [...draft.offers, o]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    set("certificate", f);
  };

  const submit = async () => {
    const p = draftProblem(draft);
    if (p) {
      setProblem(p);
      return;
    }
    const cert = draft.certificate!;
    setBusy(true);
    let certificate: { fileName: string; mime: string; base64: string };
    try {
      certificate = await prepareCertificate(cert);
    } catch {
      setProblem("Could not read that file. Try a clearer photo or a PDF.");
      setBusy(false);
      return;
    }
    try {
      const ngo = await ngoApi.registerNgo({
        name: draft.name.trim(),
        regType: draft.regType,
        regNo: draft.regNo.trim(),
        contactName: draft.contact.trim(),
        wards: draft.wards,
        offers: draft.offers,
        publicPhone: normalisePhone(draft.phone)!,
        certificate,
      });
      onSent(ngo);
    } catch (err) {
      setProblem(errorWords(err, "Could not send that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>Bring your NGO to Hetja</h1>
          <p className={styles.lead}>We check your registration and call you before switching it on.</p>
        </div>

        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={ids.name}>
            Registered name
          </label>
          <input
            id={ids.name}
            className={styles.input}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Andheri Paws Trust"
            autoComplete="organization"
            maxLength={120}
          />
        </div>

        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={ids.reg}>
            Registration type · number
          </label>
          <div className={styles.pairField}>
            <select
              className={styles.pairSelect}
              aria-label="Registration type"
              value={draft.regType}
              onChange={(e) => set("regType", e.target.value as NgoRegType)}
            >
              {REG_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className={styles.pairDot} aria-hidden="true">
              ·
            </span>
            <input
              id={ids.reg}
              className={styles.pairInput}
              value={draft.regNo}
              onChange={(e) => set("regNo", e.target.value)}
              placeholder="E-21904 (Mum)"
              maxLength={60}
              autoCapitalize="characters"
            />
          </div>
        </div>

        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={ids.contact}>
            Contact name
          </label>
          <input
            id={ids.contact}
            className={styles.input}
            value={draft.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="Kavita Nair"
            autoComplete="name"
            maxLength={60}
          />
        </div>

        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={ids.phone}>
            Phone for SOS calls
          </label>
          <input
            id={ids.phone}
            className={styles.input}
            value={draft.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="98200 12231"
            inputMode="tel"
            autoComplete="tel"
            maxLength={16}
            aria-describedby={`${ids.phone}-note`}
          />
          <p id={`${ids.phone}-note`} className={styles.note}>
            Public, so people can call you about a dog.
          </p>
        </div>

        <div className={styles.stack6}>
          <span className={styles.label} id={ids.wards}>
            Wards you cover
          </span>
          <WardChips
            selected={draft.wards}
            onChange={(w) => set("wards", w)}
            onAdd={() => setWardsOpen(true)}
            wards={wards}
            labelId={ids.wards}
          />
        </div>

        <div className={styles.stack6}>
          <span className={styles.label} id={ids.offers}>
            What you can offer
          </span>
          <div className={styles.chips} role="group" aria-labelledby={ids.offers}>
            {OFFERS.map((o) => {
              const on = draft.offers.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleOffer(o.key)}
                >
                  {on ? `✓ ${o.label}` : o.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className={`${styles.upload} ${draft.certificate ? styles.uploadDone : ""}`}>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={onFile} aria-label="Registration certificate" />
          {draft.certificate ? (
            <>
              <span className={`${styles.uploadPlus} ${styles.ok}`} aria-hidden="true">
                ✓
              </span>
              <span>
                Registration certificate · {draft.certificate.name}
                <br />
                <span className={styles.muted}>Tap to change</span>
              </span>
            </>
          ) : (
            <>
              <span className={styles.uploadPlus} aria-hidden="true">
                ＋
              </span>
              <span>Registration certificate</span>
            </>
          )}
        </label>
        <p className={styles.note}>Only Hetja&apos;s admins see it. It is deleted 30 days after we decide.</p>
      </div>

      <StickyFooter background="white" divider={false}>
        <div className={styles.footer}>
          {problem && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void submit()} disabled={busy}>
            {busy ? "Sending…" : "Send for checking"}
          </button>
        </div>
      </StickyFooter>

      <WardSheet
        open={wardsOpen}
        onClose={() => setWardsOpen(false)}
        selected={draft.wards}
        onChange={(w) => set("wards", w)}
        wards={wards}
      />
    </>
  );
}
