"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BMC_WARD_CODES, wardCentroid, wardDisplay } from "@hetja/contracts";
import { Button } from "@/components/ds";
import {
  api,
  ApiError,
  getAccessToken,
  type CoatColour,
  type DogCard,
  type NearbyCareProvider,
  type WardDogsResult,
} from "@/lib/api";
import {
  careLine,
  currentIntent,
  destinationFor,
  getPosition,
  nearestWard,
  telHref,
  withIntent,
} from "@/lib/scan-code";
import { DogPhoto, ScanHeader } from "./ScanParts";
import styles from "./FindScreen.module.css";

/**
 * F3 "Which dog is it?" (design v5, Tag Problems), and the F1 "Send SOS
 * anyway" path at `?sos=1`.
 *
 * The ward comes from the phone's location (nearest ward centre), else the
 * signed-in feeder's home ward, else the person picks one of the 24. Colour
 * chips narrow the ward's dogs (single select; tap again to clear). Tapping a
 * dog opens /d/<slug>, a full navigation to the profile app.
 *
 * With `?sos=1` the nearest vets and NGOs come first, with Call buttons, from
 * the same GET /care the SOS sent screen uses (the phone's position, or the
 * ward's centre when location is off). Then the finder: an SOS pages the
 * feeders of a known dog, so picking the dog opens its page, where the SOS
 * button is (CONTRACT.md, adapted list).
 */

const COLOURS: Array<{ id: CoatColour; label: string }> = [
  { id: "brown", label: "Brown" },
  { id: "black", label: "Black" },
  { id: "white", label: "White" },
  { id: "spotted", label: "Spotted" },
];

type WardSource = "geo" | "home" | "picked";

interface WardChoice {
  id: string;
  source: WardSource;
}

interface WardOption {
  id: string;
  code: string;
  name: string | null;
}

type Dogs =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: WardDogsResult }
  | { kind: "error"; reason: "offline" | "failed" };

type Care =
  | { kind: "loading" }
  | { kind: "ok"; providers: NearbyCareProvider[] }
  | { kind: "nolocation" }
  | { kind: "error" };

const FALLBACK_WARDS: WardOption[] = BMC_WARD_CODES.map((id) => ({ id, ...wardDisplay(id) }));

export function wardLabel(source: WardSource): string {
  if (source === "geo") return "Ward, from your location";
  if (source === "home") return "Your home ward";
  return "Ward";
}

/** "9 brown dogs registered in K/W", "1 dog registered in A". */
export function countLine(total: number, colour: CoatColour | null, wardCode: string): string {
  const noun = total === 1 ? "dog" : "dogs";
  const what = colour ? `${colour} ${noun}` : noun;
  if (total === 0) return `No ${what} registered in ${wardCode} yet.`;
  return `${total} ${what} registered in ${wardCode}`;
}

export default function FindScreen(): React.JSX.Element {
  const [sos, setSos] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
  const [ward, setWard] = useState<WardChoice | null>(null);
  const [resolving, setResolving] = useState(true);
  const [picking, setPicking] = useState(false);
  const [wards, setWards] = useState<WardOption[]>(FALLBACK_WARDS);
  const [colour, setColour] = useState<CoatColour | null>(null);
  const [dogs, setDogs] = useState<Dogs>({ kind: "idle" });
  const [care, setCare] = useState<Care>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const posRef = useRef<{ lat: number; lng: number } | undefined>(undefined);

  const loadCare = useCallback(async (at: { lat: number; lng: number } | null) => {
    if (!at) {
      setCare({ kind: "nolocation" });
      return;
    }
    setCare({ kind: "loading" });
    try {
      const res = await api.getCare(at.lat, at.lng);
      setCare({ kind: "ok", providers: (res.providers ?? []).slice(0, 5) });
    } catch {
      setCare({ kind: "error" });
    }
  }, []);

  // Where are we? Location first, then the feeder's home ward, then ask.
  useEffect(() => {
    let alive = true;
    const isSos = new URLSearchParams(window.location.search).get("sos") === "1";
    setSos(isSos);
    setIntent(currentIntent());
    (async () => {
      const pos = await getPosition();
      if (!alive) return;
      posRef.current = pos;
      const geoWard = pos ? nearestWard(pos.lat, pos.lng) : null;
      if (isSos && pos) void loadCare(pos);
      if (geoWard) {
        setWard({ id: geoWard, source: "geo" });
        setResolving(false);
        return;
      }
      let home: string | null = null;
      if (getAccessToken()) {
        try {
          home = (await api.getFeederMe()).homeWard;
        } catch {
          home = null;
        }
      }
      if (!alive) return;
      setResolving(false);
      if (home) {
        setWard({ id: home, source: "home" });
        if (isSos && !pos) void loadCare(wardCentroid(home));
      } else {
        if (isSos && !pos) setCare({ kind: "nolocation" });
        setPicking(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadCare]);

  // The ward list for the picker: the API's, else the 24 codes we ship.
  useEffect(() => {
    if (!picking) return;
    let alive = true;
    api
      .getWards()
      .then((res) => {
        if (alive && res.wards?.length) setWards(res.wards.map((w) => ({ id: w.id, code: w.code, name: w.name })));
      })
      .catch(() => {
        /* the built-in list stands */
      });
    return () => {
      alive = false;
    };
  }, [picking]);

  useEffect(() => {
    if (!ward) return;
    let alive = true;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setDogs({ kind: "error", reason: "offline" });
      return;
    }
    setDogs({ kind: "loading" });
    api
      .getWardDogs(ward.id, colour ?? undefined)
      .then((data) => {
        if (alive) setDogs({ kind: "ok", data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const status = err instanceof ApiError ? err.status : 0;
        setDogs({ kind: "error", reason: status === 0 || status === 408 ? "offline" : "failed" });
      });
    return () => {
      alive = false;
    };
  }, [ward, colour, retry]);

  useEffect(() => {
    const again = () => setRetry((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []);

  const pick = (id: string) => {
    setWard({ id, source: "picked" });
    setPicking(false);
    // SOS with location off: the picked ward's centre finds the nearest help.
    if (sos && !posRef.current) void loadCare(wardCentroid(id));
  };

  const shown = ward ? wardDisplay(ward.id) : null;
  const dogHref = (dog: DogCard) => destinationFor({ slug: dog.slug, sig: null }, intent);
  const Heading = sos ? "h2" : "h1";

  return (
    <div className={styles.screen}>
      <ScanHeader href={withIntent("/scan", intent)} />
      <div className={styles.body}>
        {sos && <CareSection care={care} />}

        <Heading className={styles.title}>Which dog is it?</Heading>
        {sos && <p className={styles.lead}>Pick the dog to send the SOS to their feeders.</p>}

        <div className={styles.wardCard}>
          <div className={styles.wardText}>
            <span className={styles.wardLabel}>{ward ? wardLabel(ward.source) : resolving ? "Ward, from your location" : "Ward"}</span>
            <span className={styles.wardValue}>
              {shown
                ? shown.name
                  ? `${shown.code} · ${shown.name}`
                  : shown.code
                : resolving
                  ? "Finding your ward…"
                  : "Pick a ward"}
            </span>
          </div>
          <button
            type="button"
            className={styles.change}
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            aria-controls="ward-picker"
          >
            {ward ? "Change" : "Pick"}
          </button>
        </div>

        {picking && (
          <div id="ward-picker" className={styles.picker}>
            <p className={styles.pickerLabel}>
              {ward ? "Pick a ward" : "We couldn't tell where you are. Pick the ward you're in."}
            </p>
            <ul className={styles.wardList}>
              {wards.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    className={styles.wardRow}
                    aria-pressed={ward?.id === w.id}
                    onClick={() => pick(w.id)}
                  >
                    <span className={styles.wardCode}>{w.code}</span>
                    {w.name && <span className={styles.wardName}>{w.name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.chips} role="group" aria-label="Coat colour">
          {COLOURS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={[styles.chip, colour === c.id ? styles.chipOn : ""].filter(Boolean).join(" ")}
              aria-pressed={colour === c.id}
              onClick={() => setColour((cur) => (cur === c.id ? null : c.id))}
            >
              {c.label}
            </button>
          ))}
        </div>

        {shown && <DogGrid dogs={dogs} colour={colour} wardCode={shown.code} dogHref={dogHref} onRetry={() => setRetry((n) => n + 1)} />}
      </div>
      <div className={styles.foot}>
        <Link href="/register" className={styles.footLink}>
          Not here? Register this dog
        </Link>
      </div>
    </div>
  );
}

function DogGrid({
  dogs,
  colour,
  wardCode,
  dogHref,
  onRetry,
}: {
  dogs: Dogs;
  colour: CoatColour | null;
  wardCode: string;
  dogHref: (dog: DogCard) => string;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (dogs.kind === "idle") return null;
  if (dogs.kind === "loading") {
    return (
      <>
        <p className={styles.count} role="status">
          Loading dogs in {wardCode}&hellip;
        </p>
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.tile}>
              <span className={styles.skeleton} />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (dogs.kind === "error") {
    return (
      <div className={styles.errorBox} role="alert">
        <p className={styles.count}>
          {dogs.reason === "offline"
            ? `No signal. The dogs in ${wardCode} load when you're back online.`
            : `Couldn't load the dogs in ${wardCode} right now.`}
        </p>
        {dogs.reason !== "offline" && (
          <Button variant="quiet" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  const { data } = dogs;
  const total = colour ? data.colourTotal : data.total;
  return (
    <>
      <p className={styles.count} role="status">
        {countLine(total, colour, wardCode)}
      </p>
      {data.dogs.length > 0 && (
        <ul className={styles.grid}>
          {data.dogs.map((dog) => (
            <li key={dog.slug}>
              <a href={dogHref(dog)} className={styles.tile}>
                <DogPhoto dog={dog} className={styles.tilePhoto} />
                <span className={styles.tileName}>{dog.name ?? "No name"}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CareSection({ care }: { care: Care }): React.JSX.Element {
  return (
    <section className={styles.care} aria-labelledby="care-title">
      <h1 id="care-title" className={styles.title}>
        Get the dog help now.
      </h1>
      <p className={styles.lead}>Call the nearest vet or NGO first. Then find the dog below, so their feeders hear too.</p>
      <p className={styles.callLabel}>Call now</p>
      <ul className={styles.careList} aria-live="polite">
        {care.kind === "loading" && (
          <li className={styles.careRow}>
            <span className={styles.careText}>
              <span className={styles.careName}>Finding help near you&hellip;</span>
            </span>
          </li>
        )}
        {care.kind === "ok" &&
          care.providers.map((p) => (
            <li key={p.id} className={styles.careRow}>
              <span className={styles.careText}>
                <span className={styles.careName}>{p.name}</span>
                <span className={styles.careSub}>{careLine(p)}</span>
              </span>
              {p.phoneE164 && (
                <Button variant="tinted" size="lg" href={telHref(p.phoneE164)} aria-label={`Call ${p.name}`}>
                  Call
                </Button>
              )}
            </li>
          ))}
        {(care.kind === "nolocation" ||
          care.kind === "error" ||
          (care.kind === "ok" && care.providers.length === 0)) && (
          <li className={styles.careRow}>
            <span className={styles.careText}>
              <span className={styles.careName}>No nearby help loaded</span>
              <span className={styles.careSub}>
                {care.kind === "nolocation"
                  ? "Turn on location, or pick your ward below, to see help nearby. "
                  : care.kind === "error"
                    ? "Couldn't load nearby help right now. "
                    : ""}
                Call a local vet or animal helpline from your phone. If the dog is in traffic and you can do so safely,
                move yourself out of the road first.
              </span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
