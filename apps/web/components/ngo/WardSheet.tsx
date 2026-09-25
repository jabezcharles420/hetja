"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ds";
import { api, type Ward } from "@/lib/api";
import sheet from "@/components/FeederPrefs.module.css";
import styles from "./ngo.module.css";

/**
 * "＋ Add" on N1 and the NGO profile: the BMC wards from GET /wards. Hetja
 * is Mumbai only, so an NGO can only cover these (CONTRACT, A7 adapted).
 */

let cache: Ward[] | null = null;

export function useWards(): Ward[] | null {
  const [wards, setWards] = useState<Ward[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    let live = true;
    api.getWards().then(
      (r) => {
        cache = r.wards;
        if (live) setWards(r.wards);
      },
      () => live && setWards([]),
    );
    return () => {
      live = false;
    };
  }, []);
  return wards;
}

export function WardSheet({
  open,
  onClose,
  selected,
  onChange,
  wards,
  title = "Wards you cover",
}: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onChange: (next: string[]) => void;
  wards: Ward[] | null;
  title?: string;
}): React.JSX.Element {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      closeLabel="Done"
      footer={<p className={styles.note}>Mumbai wards only. Pick every ward your team can reach.</p>}
    >
      {wards === null ? (
        <p className={styles.lead} role="status">
          Loading wards…
        </p>
      ) : wards.length === 0 ? (
        <p className={styles.error} role="alert">
          Could not load the wards. Close this and try again.
        </p>
      ) : (
        <ul className={sheet.wardList}>
          {wards.map((w) => {
            const on = selected.includes(w.id);
            return (
              <li key={w.id}>
                <button
                  type="button"
                  className={sheet.wardRow}
                  aria-pressed={on}
                  onClick={() => onChange(on ? selected.filter((x) => x !== w.id) : [...selected, w.id])}
                >
                  <span className={sheet.wardCode}>{w.code}</span>
                  <span className={sheet.wardName}>{w.name}</span>
                  <span className={[sheet.tick, on ? sheet.tickOn : ""].filter(Boolean).join(" ")} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/** The ward chips: the chosen wards (tap to drop one) and "＋ Add". */
export function WardChips({
  selected,
  onChange,
  onAdd,
  wards,
  labelId,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  onAdd: () => void;
  wards: Ward[] | null;
  labelId: string;
}): React.JSX.Element {
  const code = (id: string) => wards?.find((w) => w.id === id)?.code ?? id;
  return (
    <div className={styles.chips} role="group" aria-labelledby={labelId}>
      {selected.map((id) => (
        <button
          key={id}
          type="button"
          className={`${styles.chip} ${styles.chipBold} ${styles.chipOn}`}
          aria-pressed="true"
          aria-label={`${code(id)}, tap to remove`}
          onClick={() => onChange(selected.filter((x) => x !== id))}
        >
          {code(id)}
        </button>
      ))}
      <button type="button" className={`${styles.chip} ${styles.chipBold}`} onClick={onAdd}>
        ＋ Add
      </button>
    </div>
  );
}
