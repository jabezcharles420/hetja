"use client";

/**
 * R4 "About her" (step 3 of 4): name, sex, how to spot the dog, and the
 * registrator's own word on health. The health answers are stored as a
 * self-report only (vaccinatedReported / sterilisedReported, migration 0025):
 * the public profile shows Vaccinated / Sterilised from vet records alone.
 */

import { useId, useState } from "react";
import { dogCopy, type DogSex } from "@/lib/dog-copy";
import s from "../register.module.css";
import styles from "./flow.module.css";

export type Tri = "yes" | "no" | "unsure";

/** Chips offered before the person adds their own. */
export const MARKING_PRESETS = ["Brown", "Black", "White", "Spotted", "White chest", "Limps"] as const;
/** POST /registrations accepts at most 8 markings. */
export const MAX_MARKINGS = 8;
export const MAX_MARKING_CHARS = 24;

export function Segment<T extends string>({
  legend,
  legendNode,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  legendNode?: React.ReactNode;
  name: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={styles.segField} role="radiogroup" aria-labelledby={id}>
      <div className={styles.segLegend} id={id}>
        {legendNode ?? legend}
      </div>
      <div className={s.segment}>
        {options.map((o) => (
          <label key={o.value} className={s.segOpt}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const SEX_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "unknown", label: "Not sure" },
] as const;

const TRI_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
] as const;

export default function AboutStep({
  name,
  setName,
  sex,
  setSex,
  markings,
  setMarkings,
  vaccinated,
  setVaccinated,
  sterilised,
  setSterilised,
}: {
  name: string;
  setName: (v: string) => void;
  sex: DogSex | null;
  setSex: (v: DogSex) => void;
  markings: string[];
  setMarkings: (v: string[]) => void;
  vaccinated: Tri;
  setVaccinated: (v: Tri) => void;
  sterilised: Tri;
  setSterilised: (v: Tri) => void;
}): React.JSX.Element {
  const [options, setOptions] = useState<string[]>(() => {
    const extra = markings.filter((m) => !(MARKING_PRESETS as readonly string[]).includes(m));
    return [...MARKING_PRESETS, ...extra];
  });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const full = markings.length >= MAX_MARKINGS;

  const toggle = (m: string) => {
    if (markings.includes(m)) setMarkings(markings.filter((x) => x !== m));
    else if (!full) setMarkings([...markings, m]);
  };

  const addDraft = () => {
    const m = draft.trim().replace(/\s+/g, " ").slice(0, MAX_MARKING_CHARS);
    setDraft("");
    setAdding(false);
    if (!m) return;
    const existing = options.find((o) => o.toLowerCase() === m.toLowerCase());
    const chip = existing ?? m;
    if (!existing) setOptions([...options, chip]);
    if (!markings.includes(chip) && !full) setMarkings([...markings, chip]);
  };

  return (
    <>
      <h1 className={s.title}>{dogCopy.aboutTitle(sex)}</h1>
      <div className={styles.formCard}>
        <label className={styles.nameRow} htmlFor="reg-name">
          <span className={styles.fieldLabel}>{dogCopy.nameLabel(sex)}</span>
          <input
            id="reg-name"
            className={styles.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoCapitalize="words"
            autoComplete="off"
          />
        </label>
        <div className={styles.formRow}>
          <Segment<DogSex> legend="Sex" name="reg-sex" value={sex} options={SEX_OPTIONS} onChange={setSex} />
        </div>
        <div className={styles.formRow} role="group" aria-labelledby="reg-spot">
          <div className={styles.segLegend} id="reg-spot">
            {dogCopy.spotLabel(sex)}
          </div>
          <div className={styles.chips}>
            {options.map((m) => {
              const on = markings.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  className={[styles.chip, on ? styles.chipOn : ""].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(m)}
                >
                  {m}
                </button>
              );
            })}
            {adding ? (
              <input
                className={styles.chipInput}
                autoFocus
                value={draft}
                maxLength={MAX_MARKING_CHARS}
                aria-label="Add a way to spot this dog"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={addDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  } else if (e.key === "Escape") {
                    setDraft("");
                    setAdding(false);
                  }
                }}
              />
            ) : (
              <button type="button" className={styles.chip} disabled={full} onClick={() => setAdding(true)}>
                + Add
              </button>
            )}
          </div>
        </div>
      </div>

      <h2 className={styles.sectionLabel}>Health, if you know</h2>
      <div className={[styles.formCard, styles.health].join(" ")}>
        <div className={styles.formRow}>
          <Segment<Tri>
            legend="Vaccinated"
            name="reg-vacc"
            value={vaccinated}
            options={TRI_OPTIONS}
            onChange={setVaccinated}
          />
        </div>
        <div className={styles.formRow}>
          <Segment<Tri>
            legend="Sterilised (ear notch)"
            legendNode={
              <>
                Sterilised <span className={styles.muted}>(ear notch)</span>
              </>
            }
            name="reg-ster"
            value={sterilised}
            options={TRI_OPTIONS}
            onChange={setSterilised}
          />
        </div>
      </div>
    </>
  );
}
