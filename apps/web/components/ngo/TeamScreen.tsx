"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Sheet, Switch } from "@/components/ds";
import { ngoApi, type NgoRole, type NgoTeam, type TeamMember, type TeamVet } from "./ngo-api";
import { memberRoleLine, moreLine, ROLES } from "./ngo-copy";
import { ActiveNgo, errorWords, LoadError, Loading, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * N4 Team (design v7). Vets linked to the NGO, with "Vouch for her" for one
 * still waiting (vouching sends a vet to the top of the admin's queue; the
 * admin still verifies), and volunteers with their roles. Coordinators can
 * invite and remove; others can only take cases, so they see the list and
 * nothing to press.
 */

/** Rows shown before "8 more ›". */
export const FIRST_ROWS = 3;

export function vetTrailing(v: TeamVet): { text: string; tone: "ok" | "muted" } | "vouch" {
  if (v.status === "verified") return { text: "✓ Verified", tone: "ok" };
  if ((v.status === "waiting" || v.status === "more_info") && !v.vouched) return "vouch";
  if (v.status === "waiting" || v.status === "more_info") return { text: "Vouched · waiting", tone: "muted" };
  const words: Record<string, string> = {
    invited: "Invited",
    suspended: "Suspended",
    declined: "Declined",
    removed: "Removed",
  };
  return { text: words[v.status] ?? "Waiting", tone: "muted" };
}

/** "Vouch for her" when the API knows the pronoun; "Vouch" needs none. */
export function vouchLabel(v: TeamVet): string {
  return v.pronoun === "her" || v.pronoun === "him" || v.pronoun === "them" ? `Vouch for ${v.pronoun}` : "Vouch";
}

export default function TeamScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/team" frame={{ href: "/ngo", label: "NGO" }}>{() => <Team />}</ActiveNgo>
  );
}

function Team(): React.JSX.Element {
  const [team, setTeam] = useState<NgoTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vouching, setVouching] = useState<string | null>(null);

  const fetchTeam = useCallback(() => {
    setError(null);
    ngoApi.getTeam().then(setTeam, (err: unknown) => setError(errorWords(err)));
  }, []);
  useEffect(() => fetchTeam(), [fetchTeam]);

  const vouch = async (v: TeamVet) => {
    setVouching(v.feederId);
    setNotice(null);
    try {
      await ngoApi.vouchVet(v.feederId);
      setTeam((t) => (t ? { ...t, vets: t.vets.map((x) => (x.feederId === v.feederId ? { ...x, vouched: true } : x)) } : t));
      setNotice(`Vouched for ${v.name}. They move to the top of the admin's queue.`);
    } catch (err) {
      setNotice(errorWords(err, "Could not vouch. Try again."));
    } finally {
      setVouching(null);
    }
  };

  const members = team?.members ?? [];
  const shown = expanded ? members : members.slice(0, FIRST_ROWS);
  const hidden = members.length - shown.length;

  return (
    <NgoFrame back={{ href: "/ngo", label: "NGO" }}>
      <div className={`h-container ${styles.body} ${styles.tight}`}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>Team</h1>
          {team?.canManage && (
            <Link href="/ngo/team/invite" className={styles.pillBlue}>
              Invite
            </Link>
          )}
        </div>

        {!team ? (
          error ? (
            <LoadError message={error} onRetry={fetchTeam} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <h2 className={styles.label}>Vets · {team.vets.length}</h2>
            {team.vets.length === 0 ? (
              <p className={`${styles.card} ${styles.cardSub}`}>No vets linked yet. Invite one with Invite.</p>
            ) : (
              <ul className={styles.list}>
                {team.vets.map((v) => {
                  const t = vetTrailing(v);
                  return (
                    <li key={v.feederId} className={styles.row}>
                      <span className={styles.rowTitle}>{v.name}</span>
                      {t === "vouch" ? (
                        team.canManage ? (
                          <button
                            type="button"
                            className={styles.pillInk}
                            onClick={() => void vouch(v)}
                            disabled={vouching === v.feederId}
                          >
                            {vouchLabel(v)}
                          </button>
                        ) : (
                          <span className={styles.rowEnd}>Waiting</span>
                        )
                      ) : (
                        <span className={`${styles.rowEnd} ${t.tone === "ok" ? styles.ok : ""}`}>{t.text}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {notice && (
              <p className={styles.note} role="status">
                {notice}
              </p>
            )}

            <h2 className={`${styles.label} ${styles.gapAbove}`}>
              Volunteers · {members.length}
            </h2>
            <ul className={styles.list}>
              {shown.map((m) =>
                team.canManage && !m.me ? (
                  <li key={m.id}>
                    <button type="button" className={styles.row} onClick={() => setEditing(m)}>
                      <span className={styles.rowTitle}>{m.name}</span>
                      <span className={styles.rowEnd}>{memberRoleLine(m)}</span>
                    </button>
                  </li>
                ) : (
                  <li key={m.id} className={styles.row}>
                    <span className={styles.rowTitle}>{m.name}</span>
                    <span className={styles.rowEnd}>{memberRoleLine(m)}</span>
                  </li>
                ),
              )}
              {hidden > 0 && (
                <li>
                  <button type="button" className={`${styles.row} ${styles.rowMore}`} onClick={() => setExpanded(true)}>
                    <span>{moreLine(hidden)}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              )}
            </ul>
            <p className={styles.note}>
              Vouching sends a vet to the top of the admin&apos;s queue. The admin still verifies them. Coordinators can invite
              and remove; others can only take cases.
            </p>
          </>
        )}
      </div>
      <MemberSheet
        member={editing}
        onClose={() => setEditing(null)}
        onSaved={(m) => setTeam((t) => (t ? { ...t, members: t.members.map((x) => (x.id === m.id ? m : x)) } : t))}
        onRemoved={(id) => setTeam((t) => (t ? { ...t, members: t.members.filter((x) => x.id !== id) } : t))}
      />
    </NgoFrame>
  );
}

function MemberSheet({
  member,
  onClose,
  onSaved,
  onRemoved,
}: {
  member: TeamMember | null;
  onClose: () => void;
  onSaved: (m: TeamMember) => void;
  onRemoved: (id: string) => void;
}): React.JSX.Element {
  const roleId = useId();
  const transportId = useId();
  const [role, setRole] = useState<NgoRole>("volunteer");
  const [transport, setTransport] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setRole(member.role);
    setTransport(member.hasTransport);
    setConfirm(false);
    setError(null);
  }, [member]);

  const save = async () => {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await ngoApi.updateMember(member.id, { role, hasTransport: transport });
      onSaved({ ...member, role, hasTransport: transport });
      onClose();
    } catch (err) {
      setError(errorWords(err, "Could not save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await ngoApi.removeMember(member.id);
      onRemoved(member.id);
      onClose();
    } catch (err) {
      setError(errorWords(err, "Could not remove them. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={member?.name ?? ""}
      footer={
        <div className={styles.footer}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {confirm ? (
            <button type="button" className={styles.inkBtn} onClick={() => void remove()} disabled={busy}>
              {busy ? "Removing…" : `Remove ${member?.name ?? ""}`}
            </button>
          ) : (
            <>
              <button type="button" className={styles.inkBtn} onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className={`${styles.linkBtn} ${styles.danger}`} onClick={() => setConfirm(true)}>
                Remove from the team
              </button>
            </>
          )}
        </div>
      }
    >
      {confirm ? (
        <p className={styles.lead}>
          They lose the NGO tab and stop getting your SOS cases. Cases they already took stay with them.
        </p>
      ) : (
        <>
          <div className={styles.sheetField}>
            <span className={styles.label} id={roleId}>
              Role
            </span>
            <div className={styles.chips} role="group" aria-labelledby={roleId}>
              {ROLES.map((r) => (
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
          </div>
          <div className={styles.stepper}>
            <span id={transportId} className={styles.rowTitle}>
              Has transport
            </span>
            <Switch checked={transport} onChange={setTransport} labelledBy={transportId} />
          </div>
        </>
      )}
    </Sheet>
  );
}
