"use client";

import { useId, useState } from "react";
import { StickyFooter } from "@/components/ds";
import { ngoApi, type Ngo, type NgoOffer, type NgoRole } from "./ngo-api";
import { normalisePhone, OFFERS, offerLabel, phoneWords, regTypeLabel, wardsLine } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, NgoFrame } from "./NgoGate";
import { WardChips, WardSheet, useWards } from "./WardSheet";
import styles from "./ngo.module.css";

/**
 * NGO profile (designed, not in the board): the public phone, contact,
 * opening and ambulance hours, wards and what the NGO offers. An NGO's number is public by owner
 * decision (it shows on the map, SOS pages and dog pages, like the care
 * directory's). Coordinators edit; everyone else reads. Registration
 * details are shown, not edited: an admin checked them. Wards (Mumbai
 * only) decide where SOS cases go, so a change is audited and the admin
 * sees it (A7).
 */

export default function NgoProfileScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/profile" frame={{ href: "/ngo", label: "NGO" }}>
      {(ngo, role) => <Profile initial={ngo} role={role} />}
    </ActiveNgo>
  );
}

function Profile({ initial, role }: { initial: Ngo; role: NgoRole | null }): React.JSX.Element {
  const ids = { phone: useId(), contact: useId(), open: useId(), hours: useId(), wards: useId(), offers: useId() };
  const wardsList = useWards();
  const edit = isCoordinator(role);
  const [ngo, setNgo] = useState(initial);
  const [phone, setPhone] = useState(initial.publicPhone ? phoneWords(initial.publicPhone) : "");
  const [contact, setContact] = useState(initial.contactName ?? "");
  const [hours, setHours] = useState(initial.ambulance?.hours ?? "");
  const [open, setOpen] = useState(initial.hours ?? "");
  const [wards, setWards] = useState(initial.wards);
  const [wardsOpen, setWardsOpen] = useState(false);
  const [offers, setOffers] = useState<NgoOffer[]>(initial.offers);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    (normalisePhone(phone) ?? phone) !== (ngo.publicPhone ?? "") ||
    contact !== (ngo.contactName ?? "") ||
    hours !== (ngo.ambulance?.hours ?? "") ||
    open !== (ngo.hours ?? "") ||
    wards.join() !== ngo.wards.join() ||
    offers.join() !== ngo.offers.join();

  const touch = () => {
    setProblem(null);
    setSaved(false);
  };

  const save = async () => {
    const p = normalisePhone(phone);
    if (!p) return setProblem("Add a phone number people can call, 10 digits.");
    if (wards.length === 0) return setProblem("Keep at least one ward.");
    setBusy(true);
    setProblem(null);
    try {
      const next = await ngoApi.updateNgo({
        publicPhone: p,
        contactName: contact.trim(),
        ambulanceHours: offers.includes("ambulance") ? hours.trim() || null : undefined,
        hours: open.trim() || null,
        wards: wards.join() !== ngo.wards.join() ? wards : undefined,
        offers,
      });
      const merged: Ngo = next
        ? { ...ngo, ...next }
        : { ...ngo, publicPhone: p, contactName: contact.trim(), hours: open.trim() || null, wards, offers };
      setWards(merged.wards);
      setNgo(merged);
      setPhone(merged.publicPhone ? phoneWords(merged.publicPhone) : "");
      setSaved(true);
    } catch (err) {
      setProblem(errorWords(err, "Could not save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const reg = [
    `${regTypeLabel(ngo.regType)} · ${ngo.regNo}`,
    ngo.has80G ? "80G" : null,
    ngo.since ? `since ${ngo.since}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <NgoFrame back={{ href: "/ngo", label: "NGO" }}>
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>{ngo.name}</h1>
          <p className={styles.sub}>{reg}</p>
        </div>

        {!edit ? (
          <>
            <ul className={styles.list}>
              <li className={styles.row}>
                <span className={styles.rowTitle}>Public phone</span>
                <span className={styles.rowValue}>{phoneWords(ngo.publicPhone)}</span>
              </li>
              <li className={styles.row}>
                <span className={styles.rowTitle}>Contact</span>
                <span className={styles.rowValue}>{ngo.contactName || "Not set"}</span>
              </li>
              <li className={styles.row}>
                <span className={styles.rowTitle}>Open</span>
                <span className={styles.rowValue}>{ngo.hours || "Not set"}</span>
              </li>
              {ngo.ambulance && (
                <li className={styles.row}>
                  <span className={styles.rowTitle}>Ambulance hours</span>
                  <span className={styles.rowValue}>{ngo.ambulance.hours || "Not set"}</span>
                </li>
              )}
              <li className={styles.row}>
                <span className={styles.rowTitle}>Wards</span>
                <span className={styles.rowValue}>{wardsLine(ngo.wards)}</span>
              </li>
              <li className={styles.row}>
                <span className={styles.rowTitle}>Offers</span>
                <span className={styles.rowValue}>{ngo.offers.map(offerLabel).join(", ") || "None yet"}</span>
              </li>
            </ul>
            <p className={styles.note}>Coordinators change these details.</p>
          </>
        ) : (
          <>
            <div className={styles.stack6}>
              <label className={styles.label} htmlFor={ids.phone}>
                Public phone
              </label>
              <input
                id={ids.phone}
                className={`${styles.input} ${styles.chipWhite}`}
                value={phone}
                inputMode="tel"
                autoComplete="tel"
                maxLength={16}
                onChange={(e) => {
                  setPhone(e.target.value);
                  touch();
                }}
                placeholder="98200 12231"
              />
              <p className={styles.note}>Shown on the map, SOS pages and dog pages, so people can call you.</p>
            </div>
            <div className={styles.stack6}>
              <label className={styles.label} htmlFor={ids.contact}>
                Contact person
              </label>
              <input
                id={ids.contact}
                className={`${styles.input} ${styles.chipWhite}`}
                value={contact}
                maxLength={60}
                onChange={(e) => {
                  setContact(e.target.value);
                  touch();
                }}
                placeholder="Kavita Nair"
              />
            </div>
            <div className={styles.stack6}>
              <label className={styles.label} htmlFor={ids.open}>
                Opening hours
              </label>
              <input
                id={ids.open}
                className={`${styles.input} ${styles.chipWhite}`}
                value={open}
                maxLength={60}
                onChange={(e) => {
                  setOpen(e.target.value);
                  touch();
                }}
                placeholder="9am to 7pm"
              />
            </div>
            {offers.includes("ambulance") && (
              <div className={styles.stack6}>
                <label className={styles.label} htmlFor={ids.hours}>
                  Ambulance hours
                </label>
                <input
                  id={ids.hours}
                  className={`${styles.input} ${styles.chipWhite}`}
                  value={hours}
                  maxLength={60}
                  onChange={(e) => {
                    setHours(e.target.value);
                    touch();
                  }}
                  placeholder="8am to 10pm"
                />
              </div>
            )}
            <div className={styles.stack6}>
              <span className={styles.label} id={ids.wards}>
                Wards you cover
              </span>
              <WardChips
                selected={wards}
                onChange={(w) => {
                  setWards(w);
                  touch();
                }}
                onAdd={() => setWardsOpen(true)}
                wards={wardsList}
                labelId={ids.wards}
              />
              <p className={styles.note}>Your wards decide which SOS cases come to you. Hetja&apos;s admins see every change.</p>
            </div>
            <div className={styles.stack6}>
              <span className={styles.label} id={ids.offers}>
                What you can offer
              </span>
              <div className={styles.chips} role="group" aria-labelledby={ids.offers}>
                {OFFERS.map((o) => {
                  const on = offers.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      aria-pressed={on}
                      className={`${styles.chip} ${on ? styles.chipOn : styles.chipWhite}`}
                      onClick={() => {
                        setOffers(on ? offers.filter((x) => x !== o.key) : [...offers, o.key]);
                        touch();
                      }}
                    >
                      {on ? `✓ ${o.label}` : o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {edit && (
        <StickyFooter background="mist" divider={false}>
          <div className={styles.footer}>
            {problem && (
              <p className={styles.error} role="alert">
                {problem}
              </p>
            )}
            {saved && !dirty && (
              <p className={`${styles.note} ${styles.center}`} role="status">
                Saved.
              </p>
            )}
            <button type="button" className={styles.inkBtn} onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </StickyFooter>
      )}

      <WardSheet
        open={wardsOpen}
        onClose={() => setWardsOpen(false)}
        selected={wards}
        onChange={(w) => {
          setWards(w);
          touch();
        }}
        wards={wardsList}
      />
    </NgoFrame>
  );
}
