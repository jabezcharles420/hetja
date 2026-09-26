"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DogAvatar } from "@/components/ds";
import { ApiError } from "@/lib/api";
import { prettyCode } from "@/lib/dog-copy";
import { compressPhoto } from "@/lib/photo";
import { dogName } from "@/lib/streak";
import { PasskeyError, passkeyMessage, setUpPasskey, signLabel, signWithPasskey, unlockWord } from "./passkey";
import { aYearAfter, dogFacts, longDate, today } from "./vet-copy";
import {
  vetApi,
  type HealthRecord,
  type RecordKind,
  type RecordPayload,
  type SignRequest,
  type VetDogView,
  type VetProfile,
} from "./vet-api";
import { fileToBase64, PhotoGlyph, useOnMount, useSignedIn, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V3 "Sign a record" (design v7): Vaccination, Sterilisation or Treatment,
 * filled in from a feeder's request where there is one ("Filled in from
 * Priya's request. Change anything that's wrong."), signed with a passkey.
 *
 * The button says "Sign with Face ID" on an iPhone or iPad and "Sign with
 * your screen lock" elsewhere (the adapted list: a passkey is what Face ID
 * signing is on the web). A vet with no passkey on this phone sets one up
 * inline, from the same button: a note above it says so, and the phone asks
 * twice (create, then sign). "I didn't give this" declines the request.
 *
 * Nothing is preselected that the vet did not see: every field shows its
 * value, and the date defaults are visible before signing.
 */

/**
 * The board's "Photo of vaccine sticker (optional)". The photo is uploaded
 * first (POST /vet/record-photos) and its id goes into the signed draft, so
 * it is covered by the signature. Private to the record: vets, the dog's
 * feeders and admins. A switch so it can be turned off in one place.
 */
export const SIGN_PHOTO = true;

export const VACCINES = ["Anti-rabies", "DHPPi", "DHPPi booster", "Leptospirosis", "Other"] as const;

const KIND_TABS: { kind: RecordKind; label: string }[] = [
  { kind: "vaccination", label: "Vaccination" },
  { kind: "sterilisation", label: "Sterilisation" },
  { kind: "treatment", label: "Treatment" },
];

export function kindFromParam(v: string | null | undefined): RecordKind {
  return v === "sterilisation" || v === "treatment" ? v : "vaccination";
}

/** "Anti-rabies" from "anti-rabies", "rabies"; the list's own spelling otherwise. */
export function matchVaccine(title: string | null | undefined): string {
  const t = (title ?? "").trim().toLowerCase();
  if (!t) return "Anti-rabies";
  if (t.includes("rabies")) return "Anti-rabies";
  const hit = VACCINES.find((v) => v.toLowerCase() === t);
  if (hit) return hit;
  if (t.includes("dhppi") && t.includes("booster")) return "DHPPi booster";
  if (t.includes("dhppi")) return "DHPPi";
  if (t.includes("lepto")) return "Leptospirosis";
  return title!.trim();
}

interface Draft {
  vaccine: string;
  brand: string;
  batch: string;
  givenOn: string;
  nextDue: string;
  sterDate: string;
  earNotched: boolean;
  sterNote: string;
  treatDate: string;
  diagnosis: string;
  treatment: string;
  nextCheck: string;
}

export function draftFrom(req: SignRequest | null, note: HealthRecord | null, now = new Date()): Draft {
  const p = req?.proposed ?? {};
  const given = p.givenOn || note?.date || today(now);
  const vaccine = matchVaccine(p.vaccine || req?.title || note?.title);
  const nextDue = p.dueOn || note?.dueOn || "";
  return {
    vaccine,
    brand: p.brand || note?.brand || "",
    batch: p.batch || note?.batch || "",
    givenOn: given,
    nextDue: nextDue || (given.length === 10 ? aYearAfter(given) : ""),
    sterDate: given,
    earNotched: p.earNotched ?? note?.earNotched ?? true,
    sterNote: p.note || "",
    treatDate: given,
    diagnosis: p.diagnosis || (note && note.kind !== "vaccination" && note.kind !== "sterilisation" ? note.title : ""),
    treatment: p.treatment || note?.note || "",
    nextCheck: req?.kind === "treatment" ? p.dueOn || "" : "",
  };
}

export function payloadFor(kind: RecordKind, d: Draft): RecordPayload {
  if (kind === "vaccination") {
    return { kind, vaccine: d.vaccine, brand: d.brand.trim(), batch: d.batch.trim(), givenOn: d.givenOn, nextDue: d.nextDue || null };
  }
  if (kind === "sterilisation") return { kind, date: d.sterDate, earNotched: d.earNotched, note: d.sterNote.trim() || null };
  return { kind, date: d.treatDate, diagnosis: d.diagnosis.trim(), treatment: d.treatment.trim(), nextCheck: d.nextCheck || null };
}

export function payloadReady(p: RecordPayload): boolean {
  if (p.kind === "vaccination") return !!p.vaccine && !!p.givenOn && !!p.batch;
  if (p.kind === "sterilisation") return !!p.date;
  return !!p.date && !!p.diagnosis && !!p.treatment;
}

/** "Priya will be told when it's signed, and reminded a week before it's due." */
export function tellLine(kind: RecordKind, requester: string | null, name: string): string {
  const who = requester ?? `${name}'s feeders`;
  return kind === "vaccination"
    ? `${who} will be told when it's signed, and reminded a week before it's due.`
    : `${who} will be told when it's signed.`;
}

/** A label/value row whose value is an input, right-aligned like the board. */
function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={styles.kv}>
      <label className={styles.kvLabel} htmlFor={htmlFor}>
        {label}
      </label>
      <span className={styles.kvValue}>{children}</span>
    </div>
  );
}

/** A date row: "12 Sep 2026", with the native picker over it. */
function DateRow({ label, value, onChange, id, optional }: { label: string; value: string; onChange: (v: string) => void; id: string; optional?: boolean }) {
  return (
    <Row label={label} htmlFor={id}>
      <span className={styles.dateValue}>
        <span aria-hidden="true" className={value ? "" : styles.datePlaceholder}>
          {value ? longDate(value) : optional ? "None" : "Pick a date"}
        </span>
        <input id={id} type="date" className={styles.dateInput} value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </Row>
  );
}

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; vet: VetProfile; view: VetDogView; request: SignRequest | null; note: HealthRecord | null };

export default function SignRecordScreen({
  slug,
  kind: kindParam,
  requestId,
  noteId,
  driveId,
}: {
  slug: string;
  kind?: string | null;
  requestId?: string | null;
  noteId?: string | null;
  /** N5: opened from an NGO drive; signing checks the dog off and goes back there. */
  driveId?: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const ids = useId();
  const here = `/vet/dogs/${slug}/sign${requestId ? `?request=${encodeURIComponent(requestId)}` : ""}`;
  const { toLogin, signedIn } = useSignedIn(here);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [kind, setKind] = useState<RecordKind>(kindFromParam(kindParam));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null, null));
  const [photo, setPhoto] = useState<{ base64: string; url: string; id?: string } | null>(null);
  const driveDog = useRef<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [busy, setBusy] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [vet, view, request, dd] = await Promise.all([
        vetApi.getMyVet(),
        vetApi.getVetDog(slug),
        requestId ? vetApi.getRequest(requestId) : Promise.resolve(null),
        driveId ? vetApi.driveDogId(driveId, slug) : Promise.resolve(null),
      ]);
      driveDog.current = dd;
      if (!vet || vet.status !== "verified") {
        if (vet?.status === "suspended") {
          setLoad({ kind: "error", message: "Your vet account is paused, so you can't sign records for now. Records you already signed keep their badge." });
        } else router.replace("/vet/apply");
        return;
      }
      const note = noteId ? [...view.notesToConfirm, ...view.health].find((r) => r.id === noteId) ?? null : null;
      if (request) setKind(request.kind);
      else if (note && (note.kind === "vaccination" || note.kind === "sterilisation")) setKind(note.kind);
      setDraft(draftFrom(request, note));
      setNeedsSetup(!vet.hasPasskey);
      setLoad({ kind: "ready", vet, view, request, note });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setLoad({
        kind: "error",
        message:
          err instanceof ApiError && err.status === 404
            ? requestId
              ? "This request was answered or withdrawn."
              : "No dog has this code."
            : "Hetja could not be reached. Check your connection and try again.",
      });
    }
  }, [slug, requestId, noteId, driveId, router, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchAll();
  });

  const payload = useMemo(() => payloadFor(kind, draft), [kind, draft]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (load.kind === "loading") return <VetMessage back="Vet" href="/vet" lead="Loading." role="status" />;
  if (load.kind === "error") return <VetMessage back="Vet" href="/vet" title="Can't sign this now." lead={load.message} role="alert" />;

  const { view, request, note } = load;
  const name = dogName(view.dog.name);
  const requester = request?.requestedBy ?? null;
  const back = driveId
    ? { label: "Drive", href: `/ngo/drives/${encodeURIComponent(driveId)}` }
    : request
      ? { label: "Vet", href: "/vet" }
      : { label: name, href: `/vet/dogs/${slug}` };

  if (done) {
    return (
      <div className={styles.page}>
        <VetTop back={back.label} href={back.href} />
        <div className={styles.body}>
          <h1 className={styles.title}>{done === "signed" ? "Signed." : "Declined."}</h1>
          <p className={styles.lead} role="status">
            {done === "signed"
              ? `${name}'s page now shows it as Vet signed.${requester ? ` ${requester} has been told.` : ""}`
              : `${requester ?? "The feeder"} will see that you didn't give this. Nothing was added to ${name}'s record.`}
          </p>
        </div>
        <div className={styles.footer}>
          <Link href="/vet" className={styles.dark}>
            Back to Vet
          </Link>
          <Link href={`/vet/dogs/${slug}`} className={`${styles.textLink} ${styles.center}`}>
            Open {name}
          </Link>
        </div>
      </div>
    );
  }

  const ready = payloadReady(payload);

  const sign = async () => {
    if (!ready || busy) return;
    setBusy("sign");
    setError(null);
    try {
      if (needsSetup) {
        await setUpPasskey();
        setNeedsSetup(false);
      }
      let photoId = photo?.id ?? null;
      if (SIGN_PHOTO && photo && !photoId) {
        photoId = await vetApi.uploadRecordPhoto(photo.base64);
        setPhoto({ ...photo, id: photoId });
      }
      await signWithPasskey({
        dogSlug: slug,
        payload,
        requestId: request?.id ?? null,
        confirmsRecordId: !request && note ? note.id : null,
        driveDogId: driveDog.current,
        photoId,
      });
      if (driveId) {
        router.replace(`/ngo/drives/${encodeURIComponent(driveId)}`);
        return;
      }
      setDone("signed");
    } catch (err) {
      if (err instanceof PasskeyError) {
        if (err.reason === "no-passkey") setNeedsSetup(true);
        setError(passkeyMessage(err));
      } else if (err instanceof ApiError && err.status === 401) {
        toLogin();
      } else {
        setError(
          err instanceof ApiError && err.status === 403
            ? "Only verified vets can sign records."
            : err instanceof ApiError && err.status === 409
              ? "This was already signed or answered."
              : "Signing didn't go through. Nothing was saved. Try again.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    if (!request || busy) return;
    setBusy("decline");
    setError(null);
    try {
      await vetApi.declineRequest(request.id);
      setDone("declined");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      setPhoto({ base64: await fileToBase64(blob), url: URL.createObjectURL(blob) });
    } catch {
      setError("That photo couldn't be read. Try another.");
    }
  };

  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : KIND_TABS.length - 1)) % KIND_TABS.length;
    setKind(KIND_TABS[next]!.kind);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const vaccineOptions = VACCINES.includes(draft.vaccine as (typeof VACCINES)[number]) ? VACCINES : [draft.vaccine, ...VACCINES];
  const collar = view.dog.collarNo ?? prettyCode(slug);
  const photoLabel = kind === "vaccination" ? "Photo of vaccine sticker (optional)" : "Photo of the clinic slip (optional)";

  return (
    <div className={styles.page}>
      <VetTop back={back.label} href={back.href} />
      <div className={styles.body}>
        <div className={styles.dogHead}>
          <DogAvatar id={slug} name={name} photoUrl={view.dog.photoUrl} size={56} />
          <div>
            <h1 className={styles.dogHeadName}>{name}</h1>
            <p className={styles.dogHeadSub}>{dogFacts(collar, view.dog.sex, view.dog.ageYears)}</p>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Kind of record" ref={tabsRef}>
          {KIND_TABS.map((t, i) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              id={`${ids}-tab-${t.kind}`}
              aria-selected={kind === t.kind}
              aria-controls={`${ids}-panel`}
              tabIndex={kind === t.kind ? 0 : -1}
              className={styles.tab}
              onClick={() => setKind(t.kind)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${kind}`}>
          {kind === "vaccination" && (
            <div className={styles.rows}>
              <Row label="Vaccine" htmlFor={`${ids}-vac`}>
                <select id={`${ids}-vac`} className={styles.kvSelect} value={draft.vaccine} onChange={(e) => set("vaccine", e.target.value)}>
                  {vaccineOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Brand · batch" htmlFor={`${ids}-brand`}>
                <span className={styles.autosize} data-value={draft.brand || "Brand"}>
                  <input
                    id={`${ids}-brand`}
                    className={styles.kvInput}
                    value={draft.brand}
                    onChange={(e) => set("brand", e.target.value)}
                    placeholder="Brand"
                    aria-label="Brand"
                    maxLength={40}
                    size={1}
                  />
                </span>
                <span className={styles.kvSep} aria-hidden="true">
                  ·
                </span>
                <span className={styles.autosize} data-value={draft.batch || "Batch"}>
                  <input
                    className={styles.kvInput}
                    value={draft.batch}
                    onChange={(e) => set("batch", e.target.value.toUpperCase())}
                    placeholder="Batch"
                    aria-label="Batch"
                    autoCapitalize="characters"
                    maxLength={30}
                    size={1}
                  />
                </span>
              </Row>
              <DateRow
                label="Given on"
                id={`${ids}-given`}
                value={draft.givenOn}
                onChange={(v) => setDraft((d) => ({ ...d, givenOn: v, nextDue: d.nextDue === aYearAfter(d.givenOn) || !d.nextDue ? aYearAfter(v) : d.nextDue }))}
              />
              <DateRow label="Next due" id={`${ids}-due`} value={draft.nextDue} onChange={(v) => set("nextDue", v)} optional />
            </div>
          )}

          {kind === "sterilisation" && (
            <div className={styles.rows}>
              <DateRow label="Done on" id={`${ids}-ster`} value={draft.sterDate} onChange={(v) => set("sterDate", v)} />
              <Row label="Ear notched" htmlFor={`${ids}-ear`}>
                <select id={`${ids}-ear`} className={styles.kvSelect} value={draft.earNotched ? "yes" : "no"} onChange={(e) => set("earNotched", e.target.value === "yes")}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Row>
              <Row label="Note" htmlFor={`${ids}-sn`}>
                <input id={`${ids}-sn`} className={styles.kvInput} value={draft.sterNote} onChange={(e) => set("sterNote", e.target.value)} placeholder="Optional" maxLength={120} />
              </Row>
            </div>
          )}

          {kind === "treatment" && (
            <div className={styles.rows}>
              <DateRow label="Treated on" id={`${ids}-td`} value={draft.treatDate} onChange={(v) => set("treatDate", v)} />
              <Row label="What for" htmlFor={`${ids}-dx`}>
                <input id={`${ids}-dx`} className={styles.kvInput} value={draft.diagnosis} onChange={(e) => set("diagnosis", e.target.value)} placeholder="Limping, wound" maxLength={80} />
              </Row>
              <Row label="Treatment" htmlFor={`${ids}-tx`}>
                <input id={`${ids}-tx`} className={styles.kvInput} value={draft.treatment} onChange={(e) => set("treatment", e.target.value)} placeholder="Cleaned, dressed" maxLength={160} />
              </Row>
              <DateRow label="Next check" id={`${ids}-nc`} value={draft.nextCheck} onChange={(v) => set("nextCheck", v)} optional />
            </div>
          )}
        </div>

        {SIGN_PHOTO && (
        <label className={styles.photoSlot}>
          {photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className={styles.photoThumb} />
              <span className={styles.photoDone}>Photo added. Tap to change</span>
            </>
          ) : (
            <>
              <PhotoGlyph />
              <span>{photoLabel}</span>
            </>
          )}
          <input type="file" accept="image/*" capture="environment" className={styles.fileInput} onChange={(e) => void pickPhoto(e)} aria-label={photoLabel} />
        </label>
        )}

        <p className={styles.note}>
          {request || note
            ? `Filled in from ${requester ?? note?.addedBy ?? "the feeder"}'s ${request ? "request" : "note"}. Change anything that's wrong. ${tellLine(kind, requester ?? note?.addedBy ?? null, name)}`
            : tellLine(kind, null, name)}
        </p>
      </div>

      <div className={styles.footer}>
        {needsSetup && (
          <div className={styles.setup}>
            <p className={styles.setupTitle}>First, set up signing on this phone</p>
            <p className={styles.setupText}>
              Your signature is a passkey: {unlockWord() === "Face ID" ? "Face ID" : "your fingerprint, face or screen lock"}. It stays on this phone, and it
              makes every record you sign checkable. Your phone will ask twice.
            </p>
          </div>
        )}
        {error && (
          <p className={styles.footAlert} role="alert">
            {error}
          </p>
        )}
        <button type="button" className={styles.dark} onClick={() => void sign()} disabled={!ready || busy !== null} aria-busy={busy === "sign" || undefined}>
          {signLabel()}
        </button>
        {request && (
          <button type="button" className={styles.redLink} onClick={() => void decline()} disabled={busy !== null}>
            I didn&rsquo;t give this
          </button>
        )}
      </div>
    </div>
  );
}
