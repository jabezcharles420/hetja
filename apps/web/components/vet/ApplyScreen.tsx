"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { WardPickerSheet } from "@/components/FeederPrefs";
import { ApiError } from "@/lib/api";
import { wardsSummary } from "@/lib/feeder-prefs";
import { compressPhoto } from "@/lib/photo";
import { ago, hoursLabel, STATUS_TITLE } from "./vet-copy";
import { vetApi, type ApplyDoc, type ApplyInput, type VetProfile } from "./vet-api";
import { fileToBase64, useOnMount, useSignedIn, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V1 "Sign records as a vet" (design v7), opened from Me. One form: the
 * council, the registration number, the clinic, the certificate and a photo
 * ID, and whether they take SOS calls. "Send for checking" leads to the
 * wards they choose ("in the wards I choose next"), then sends it all.
 *
 * The same route shows where an application stands (designed, not in the
 * board): waiting, asked for more (with the admin's reason), declined,
 * suspended, removed. A verified vet is sent to the Vet tab.
 *
 * Documents stay private (owner decision): encrypted at rest, admins only,
 * deleted 30 days after the decision. The page says so under the uploads.
 */

/** Hetja is Mumbai only, and the API checks the Maharashtra council's register (MSVC). */
export const COUNCILS = [{ value: "MSVC", label: "Maharashtra (MSVC)" }] as const;

/** The API's limits (POST /documents): PDF up to 5 MB, images up to 2 MB. */
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type Doc = Omit<ApplyDoc, "kind">;

async function readDoc(file: File): Promise<Doc> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is over 5 MB. A photo of the certificate works too.");
    return { fileName: file.name, mime: "application/pdf", base64: await fileToBase64(file) };
  }
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo or a PDF.");
  // Re-encoded through a canvas: smaller, and the EXIF (location) is gone.
  const blob = await compressPhoto(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("That photo is too big. Try a closer, plainer shot.");
  const mime = blob.type === "image/webp" || blob.type === "image/png" ? blob.type : "image/jpeg";
  return { fileName: file.name, mime, base64: await fileToBase64(blob) };
}

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "status"; vet: VetProfile }
  | { kind: "form"; vet: VetProfile | null };

export default function ApplyScreen(): React.JSX.Element {
  const router = useRouter();
  const ids = useId();
  const { toLogin, signedIn } = useSignedIn("/vet/apply");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [stage, setStage] = useState<"form" | "wards">("form");
  const [council, setCouncil] = useState<string>("MSVC");
  const [regNo, setRegNo] = useState("");
  const [clinic, setClinic] = useState("");
  const [cert, setCert] = useState<Doc | null>(null);
  const [photoId, setPhotoId] = useState<Doc | null>(null);
  const [sos, setSos] = useState(true);
  const [wards, setWards] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("21:00");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = (vet: VetProfile | null) => {
    if (!vet) return;
    if (vet.council) setCouncil(vet.council);
    setRegNo(vet.regNo);
    setClinic(vet.clinic ?? "");
    setSos(vet.sosAvailable || vet.status === "invited");
    setWards(vet.wards);
    if (vet.sosHours) {
      setFrom(vet.sosHours.from);
      setTo(vet.sosHours.to);
    }
    setPhone(vet.publicPhone ?? "");
  };

  const fetchVet = useCallback(async () => {
    try {
      const vet = await vetApi.getMyVet();
      if (vet?.status === "verified") {
        router.replace("/vet");
        return;
      }
      if (!vet || vet.status === "invited") {
        fill(vet);
        setLoad({ kind: "form", vet });
      } else setLoad({ kind: "status", vet });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setLoad({ kind: "error" });
    }
  }, [router, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchVet();
  });

  const pick = (which: "cert" | "id") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const doc = await readDoc(file);
      if (which === "cert") setCert(doc);
      else setPhotoId(doc);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That file couldn't be read. Try another.");
    }
  };

  const formReady = regNo.trim().length > 0 && !!cert && !!photoId;

  const send = async () => {
    if (!formReady || busy || !cert || !photoId) return;
    setBusy(true);
    setError(null);
    const input: ApplyInput = {
      regNo: regNo.trim(),
      clinic: clinic.trim() || null,
      sosAvailable: sos,
      wards,
      sosHours: sos ? { from, to } : null,
      publicPhone: phone.trim(),
      documents: [
        { kind: "certificate", ...cert },
        { kind: "photo_id", ...photoId },
      ],
    };
    try {
      const vet = await vetApi.apply(input);
      setLoad({
        kind: "status",
        vet: vet ?? {
          status: "waiting",
          name: "",
          council,
          regNo: input.regNo,
          regLabel: `${council} ${input.regNo}`,
          clinic: input.clinic,
          wards,
          sosAvailable: sos,
          sosHours: input.sosHours,
          publicPhone: input.publicPhone,
          isGovernment: false,
          appliedAt: new Date().toISOString(),
          decidedAt: null,
          reason: null,
          hasPasskey: false,
          canSign: false,
          canAcceptSos: false,
          documents: ["certificate", "photo_id"],
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setError(
        err instanceof ApiError && err.status === 409
          ? "You've already applied. Hetja is checking it."
          : err instanceof ApiError && err.status === 413
            ? "The files are too big together. Try photos instead of PDFs."
            : err instanceof ApiError && err.status === 400
              ? "Something in the form wasn't accepted. Check the registration number and try again."
              : "Hetja could not be reached. Nothing was sent. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (load.kind === "loading") return <VetMessage back="Profile" href="/me" lead="Loading." role="status" />;
  if (load.kind === "error") {
    return (
      <VetMessage back="Profile" href="/me" title="Hetja could not be reached." lead="Check your connection and try again.">
        <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchVet()}>
          Try again
        </button>
      </VetMessage>
    );
  }

  if (load.kind === "status") {
    return (
      <StatusView
        vet={load.vet}
        onEdit={() => {
          fill(load.vet);
          setCert(null);
          setPhotoId(null);
          setStage("form");
          setLoad({ kind: "form", vet: load.vet });
        }}
      />
    );
  }

  if (stage === "wards") {
    return (
      <div className={styles.page}>
        <VetTop back="Back" href="/vet/apply" onBack={() => setStage("form")} />
        <div className={styles.body}>
          <h1 className={styles.title}>Which wards do you work in?</h1>
          <p className={styles.lead}>
            {sos
              ? "SOS calls in these wards come to you, and you'll see which dogs here are due a booster."
              : "You'll see which dogs in these wards are due a booster."}
          </p>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id={`${ids}-w`}>
              Wards
            </span>
            <button type="button" className={`${styles.input} ${styles.selectBox}`} aria-labelledby={`${ids}-w`} onClick={() => setPicker(true)}>
              {wards.length ? wardsSummary(wards) : "Choose wards"}
            </button>
          </div>
          {sos && (
            <div className={styles.field}>
              <span className={styles.fieldLabel} id={`${ids}-h`}>
                When you take SOS calls
              </span>
              <div className={styles.hours} role="group" aria-labelledby={`${ids}-h`}>
                <input className={styles.input} type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" required />
                <span className={styles.hoursTo}>to</span>
                <input className={styles.input} type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" required />
              </div>
            </div>
          )}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{sos ? "Phone for SOS calls" : "Clinic phone"}</span>
            <input
              className={styles.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91"
              maxLength={20}
              required
            />
            <span className={styles.hint}>Vets are called, so this number is public: it shows on SOS pages and the map, like the care directory&rsquo;s.</span>
          </label>
          {error && (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.dark} onClick={() => void send()} disabled={busy || wards.length === 0 || phone.replace(/\D/g, "").length < 10 || (sos && (!from || !to))} aria-busy={busy || undefined}>
            Send for checking
          </button>
        </div>
        <WardPickerSheet open={picker} onClose={() => setPicker(false)} selected={wards} onChange={setWards} />
      </div>
    );
  }

  const councilLabel = COUNCILS.find((c) => c.value === council)?.label ?? council;
  const reason = load.vet?.status === "more_info" ? load.vet.reason : null;

  return (
    <div className={styles.page}>
      <VetTop back="Profile" href="/me" />
      <div className={styles.body}>
        <h1 className={styles.title}>Sign records as a vet</h1>
        <p className={styles.lead}>We check your registration with the state council. Usually within 2 days.</p>
        {reason && (
          <p className={styles.reason}>
            <span className={styles.reasonFrom}>The Hetja team asked</span>
            {reason}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${ids}-c`}>
            Council
          </label>
          <div className={`${styles.input} ${styles.selectBox}`}>
            <span aria-hidden="true">{councilLabel} ▾</span>
            <select
              id={`${ids}-c`}
              className={styles.fileInput}
              value={council}
              onChange={(e) => setCouncil(e.target.value)}
            >
              {COUNCILS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Registration number</span>
          <input
            className={styles.input}
            value={regNo}
            onChange={(e) => setRegNo(e.target.value)}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={30}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Clinic, if any</span>
          <input className={styles.input} value={clinic} onChange={(e) => setClinic(e.target.value)} maxLength={80} autoComplete="organization" />
        </label>

        <div className={styles.uploads}>
          <label className={[styles.upload, cert ? styles.uploadDone : ""].filter(Boolean).join(" ")}>
            <span className={styles.uploadMark} aria-hidden="true">
              {cert ? "✓" : "＋"}
            </span>
            <span>Certificate</span>
            {cert && <span className={styles.uploadName}>{cert.fileName}</span>}
            <input type="file" accept="image/*,application/pdf" className={styles.fileInput} onChange={(e) => void pick("cert")(e)} aria-label={cert ? "Certificate, added. Replace it" : "Certificate"} />
          </label>
          <label className={[styles.upload, photoId ? styles.uploadDone : ""].filter(Boolean).join(" ")}>
            <span className={styles.uploadMark} aria-hidden="true">
              {photoId ? "✓" : "＋"}
            </span>
            <span>Photo ID</span>
            {photoId && <span className={styles.uploadName}>{photoId.fileName}</span>}
            <input type="file" accept="image/*,application/pdf" className={styles.fileInput} onChange={(e) => void pick("id")(e)} aria-label={photoId ? "Photo ID, added. Replace it" : "Photo ID"} />
          </label>
        </div>
        <p className={styles.hint}>Only Hetja&rsquo;s admins see these. They are deleted 30 days after we decide.</p>

        <label className={styles.check}>
          <input type="checkbox" className={styles.checkInput} checked={sos} onChange={(e) => setSos(e.target.checked)} />
          <span className={styles.checkBox} aria-hidden="true">
            {sos ? "✓" : ""}
          </span>
          <span>I&rsquo;m available for SOS calls in the wards I choose next.</span>
        </label>

        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.dark} onClick={() => setStage("wards")} disabled={!formReady}>
          Send for checking
        </button>
      </div>
    </div>
  );
}

/** Where an application stands (designed: waiting, asked for more, declined, suspended, removed). */
export function StatusView({ vet, onEdit }: { vet: VetProfile; onEdit: () => void }): React.JSX.Element {
  const title = STATUS_TITLE[vet.status as keyof typeof STATUS_TITLE] ?? STATUS_TITLE.waiting;
  const sent = vet.appliedAt ? ago(vet.appliedAt) : "";
  const summary = (
    <div className={styles.summary}>
      <div className={styles.kv}>
        <span className={styles.kvLabel}>Registration</span>
        <span className={styles.kvValue}>{vet.regLabel}</span>
      </div>
      {vet.clinic && (
        <div className={styles.kv}>
          <span className={styles.kvLabel}>Clinic</span>
          <span className={styles.kvValue}>{vet.clinic}</span>
        </div>
      )}
      <div className={styles.kv}>
        <span className={styles.kvLabel}>Wards</span>
        <span className={styles.kvValue}>{wardsSummary(vet.wards)}</span>
      </div>
      <div className={styles.kv}>
        <span className={styles.kvLabel}>Takes SOS calls</span>
        <span className={styles.kvValue}>{vet.sosAvailable ? (vet.sosHours ? `Yes, ${hoursLabel(vet.sosHours)}` : "Yes") : "No"}</span>
      </div>
    </div>
  );

  let lead: string;
  let action: React.JSX.Element | null = null;
  let steps: React.JSX.Element | null = null;
  switch (vet.status) {
    case "more_info":
      lead = "Hetja checked your application and needs one more thing before you can sign.";
      action = (
        <button type="button" className={styles.dark} onClick={onEdit}>
          Update and send again
        </button>
      );
      break;
    case "declined":
      lead = "Hetja couldn't match your registration with the council. Nothing you did as a feeder changes.";
      action = (
        <button type="button" className={styles.dark} onClick={onEdit}>
          Apply again
        </button>
      );
      break;
    case "suspended":
      lead = "An admin paused your vet account, so you can't sign records or take SOS calls for now. Records you already signed keep their badge.";
      break;
    case "removed":
      lead = "You can still feed, add dogs and send SOS like any feeder. Records you signed stay on the dogs' pages unless an admin flags them.";
      break;
    default:
      lead = `${vet.regLabel}${sent ? `, sent ${sent}` : ""}. Usually within 2 days. You'll see it here as soon as it's decided.`;
      steps = (
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepDot} aria-hidden="true">
              ✓
            </span>
            <span>Registration and documents sent</span>
          </li>
          <li className={styles.step}>
            <span className={`${styles.stepDot} ${styles.stepDotNow}`} aria-hidden="true">
              2
            </span>
            <span>An admin checks the council register</span>
          </li>
          <li className={styles.step}>
            <span className={`${styles.stepDot} ${styles.stepDotTodo}`} aria-hidden="true">
              3
            </span>
            <span>You get a Vet tab, and can sign records</span>
          </li>
        </ol>
      );
  }

  return (
    <div className={styles.page}>
      <VetTop back="Profile" href="/me" />
      <div className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lead}>{lead}</p>
        {vet.reason && vet.status !== "waiting" && (
          <p className={styles.reason}>
            <span className={styles.reasonFrom}>{vet.status === "more_info" ? "The Hetja team asked" : "The reason"}</span>
            {vet.reason}
          </p>
        )}
        {steps}
        {summary}
      </div>
      {action && <div className={styles.footer}>{action}</div>}
    </div>
  );
}
