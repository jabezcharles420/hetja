"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { StickyFooter, Switch } from "@/components/ds";
import { ngoApi, type InviteRole } from "./ngo-api";
import { INVITE_ROLES } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * Invite to the team (designed, not in the board; opened from N4's
 * "Invite"). Coordinators only. The invite goes by email, because Hetja
 * signs people in by email and never holds a volunteer's phone number. A
 * vet invited here applies once with their registration (V1) and arrives
 * in the admin's queue already vouched for.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/team/invite" frame={{ href: "/ngo/team", label: "Team" }}>
      {(ngo, role) => (
        <NgoFrame back={{ href: "/ngo/team", label: "Team" }} mist={false}>
          {isCoordinator(role) ? (
            <InviteForm ngoName={ngo.name} />
          ) : (
            <div className={`h-container ${styles.body}`}>
              <h1 className={styles.title}>Invite to the team</h1>
              <p className={styles.lead}>Only coordinators can invite people. Ask a coordinator at {ngo.name}.</p>
            </div>
          )}
        </NgoFrame>
      )}
    </ActiveNgo>
  );
}

function InviteForm({ ngoName }: { ngoName: string }): React.JSX.Element {
  const emailId = useId();
  const roleId = useId();
  const transportId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("volunteer");
  const [transport, setTransport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async () => {
    const e = email.trim();
    if (!EMAIL.test(e)) {
      setProblem("Add their email address.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await ngoApi.inviteMember({ email: e, role, hasTransport: role !== "vet" && transport });
      setSentTo(e);
    } catch (err) {
      setProblem(errorWords(err, "Could not send the invite. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <div className={`h-container ${styles.body}`}>
        <span className={`${styles.statusIcon} ${styles.statusOk}`} aria-hidden="true">
          ✓
        </span>
        <h1 className={styles.title} role="status">
          Invite sent
        </h1>
        <p className={styles.lead}>
          {sentTo} gets an email from Hetja. Once they sign in, the NGO tab shows up for them.
        </p>
        <Link href="/ngo/team" className={styles.inkBtn}>
          Back to Team
        </Link>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => {
            setSentTo(null);
            setEmail("");
          }}
        >
          Invite someone else
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>Invite to the team</h1>
          <p className={styles.lead}>
            They get an email with a link. Once they sign in, they see {ngoName}&apos;s NGO tab and can take its cases.
          </p>
        </div>
        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={emailId}>
            Their email
          </label>
          <input
            id={emailId}
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setProblem(null);
            }}
            placeholder="rahul@example.com"
          />
        </div>
        <div className={styles.stack6}>
          <span className={styles.label} id={roleId}>
            Role
          </span>
          <div className={styles.chips} role="group" aria-labelledby={roleId}>
            {INVITE_ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`${styles.chip} ${role === r.key ? styles.chipOn : ""}`}
                aria-pressed={role === r.key}
                onClick={() => setRole(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className={styles.note}>
            {role === "coordinator"
              ? "Coordinators send people to SOS cases, invite and remove, and vouch for vets."
              : role === "vet"
                ? "Vets apply once with their registration. Coming through you, they reach the admin already vouched for."
                : "They take cases you send them and help on drives."}
          </p>
        </div>
        {role !== "vet" && (
          <div className={`${styles.stepper} ${styles.onMist}`}>
            <span id={transportId} className={styles.rowTitle}>
              Has transport
            </span>
            <Switch checked={transport} onChange={setTransport} labelledBy={transportId} />
          </div>
        )}
      </div>
      <StickyFooter background="white" divider={false}>
        <div className={styles.footer}>
          {problem && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      </StickyFooter>
    </>
  );
}
