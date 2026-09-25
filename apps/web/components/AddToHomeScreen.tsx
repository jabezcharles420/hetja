"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ds";
import { useInstallOffer } from "@/lib/install-offer";
import styles from "./AddToHomeScreen.module.css";

/**
 * V23 Add to home screen (design v6), a bottom sheet over the feed-logged
 * screen. Two ways to use it:
 *
 *   <AddToHomeScreenAfterFeed dogName="Rani" />
 *       Drop it on the screen that confirms a logged feed. It opens itself
 *       once per browser, only when Hetja can be installed here (the held
 *       beforeinstallprompt, or iOS Safari's Share steps), and never again
 *       after "Add to home screen" or "Not now".
 *
 *   <AddToHomeScreen open dogName onClose />
 *       The sheet alone, when the caller decides the moment
 *       (useInstallOffer() from lib/install-offer tells it whether it may).
 */

export interface AddToHomeScreenProps {
  open: boolean;
  /** The dog just fed: "Keep Rani one tap away." */
  dogName?: string | null;
  onClose: (result: "installed" | "dismissed") => void;
}

export function AddToHomeScreen({ open, dogName, onClose }: AddToHomeScreenProps): React.JSX.Element | null {
  const offer = useInstallOffer();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current("dismissed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const name = dogName?.trim() || null;
  const ios = offer.platform === "ios";

  const add = async () => {
    offer.markOffered();
    const outcome = await offer.install();
    onClose(outcome === "accepted" ? "installed" : "dismissed");
  };

  return (
    <div className={styles.root}>
      <div className={styles.scrim} aria-hidden="true" onClick={() => onClose("dismissed")} />
      <div ref={panel} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className={styles.grab} aria-hidden="true" />
        <div className={styles.icons} aria-hidden="true">
          <span className={styles.icon} />
          <span className={`${styles.icon} ${styles.hetja}`}>Hetja</span>
          <span className={styles.icon} />
          <span className={styles.icon} />
        </div>
        <div className={styles.text}>
          <h2 id={titleId} className={styles.title}>
            {name ? `Keep ${name} one tap away.` : "Keep your dogs one tap away."}
          </h2>
          <p className={styles.sub}>
            Put Hetja on your home screen. It opens straight to the scanner, even on a slow network.
          </p>
        </div>
        {ios ? (
          <ol className={styles.steps}>
            <li>
              <span className={styles.num}>1</span>Tap Share at the bottom of Safari
            </li>
            <li>
              <span className={styles.num}>2</span>Choose Add to Home Screen
            </li>
          </ol>
        ) : null}
        <div className={styles.actions}>
          {ios ? (
            <Button
              fullWidth
              onClick={() => {
                offer.markOffered();
                onClose("dismissed");
              }}
            >
              Done
            </Button>
          ) : (
            <Button fullWidth onClick={() => void add()}>
              Add to home screen
            </Button>
          )}
          <Button
            variant="link"
            fullWidth
            onClick={() => {
              offer.markOffered();
              onClose("dismissed");
            }}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

/** V23 at the earned moment: opens itself once, only where Hetja can be installed. */
export function AddToHomeScreenAfterFeed({ dogName }: { dogName?: string | null }): React.JSX.Element | null {
  const offer = useInstallOffer();
  const shown = useRef(false);
  const [open, setOpen] = useStateOnce(offer.shouldOffer, shown);
  return <AddToHomeScreen open={open} dogName={dogName} onClose={() => setOpen(false)} />;
}


function useStateOnce(
  should: boolean,
  shown: React.MutableRefObject<boolean>,
): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (should && !shown.current) {
      shown.current = true;
      setOpen(true);
    }
  }, [should, shown]);
  return [open, setOpen];
}
