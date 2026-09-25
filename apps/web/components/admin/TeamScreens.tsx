"use client";

/**
 * A6 Team, roles and audit log; and the designed pages beside it: Add
 * someone to the team, the full Audit log, Invite a vet and Settings.
 *
 * The audit log is append-only for everyone, the Owner included. Vet
 * signatures appear in it too, so a disputed record can be traced.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, type AdminRole, type AdminTeam, type AuditEntry } from "@/lib/api";
import { auditWhen, fullDate, ROLE_LABEL, ROLE_TEXT, roleLabel } from "./format";
import { Crumbs, cx, ErrorLine, errorText, Loading, styles as s, useAdmin, useAsync, useCan, useConfirm, useWards } from "./ui";

const ROLES: AdminRole[] = ["owner", "moderator", "avatar_editor", "ward_lead"];

/** Save a Blob under a name, the browser way. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportCsv(): React.JSX.Element | null {
  const can = useCan("audit");
  const { toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  if (!can) return null;
  return (
    <button
      type="button"
      className={s.linkBtn}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { blob, fileName } = await api.downloadAuditCsv();
          saveBlob(blob, fileName ?? "hetja-audit-log.csv");
          toast("The audit log is downloading.");
        } catch (e) {
          toast(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Exporting…" : "Export CSV"}
    </button>
  );
}

export function AuditRows({ entries, now }: { entries: AuditEntry[]; now: Date }): React.JSX.Element {
  return (
    <ol className={s.plainList} aria-label="Audit log" style={{ fontSize: 14 }}>
      {entries.map((e) => (
        <li key={e.id} className={s.auditRow}>
          <time dateTime={e.at} className={s.muted} title={fullDate(e.at)}>
            {auditWhen(e.at, now)}
          </time>
          <span>
            <b>{e.actor.name ?? (e.actor.kind === "system" ? "Hetja" : "Someone")}</b> {e.summary}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// A6
// ---------------------------------------------------------------------------

export function TeamScreen(): React.JSX.Element {
  const team = useAsync(() => api.getAdminTeam(), []);
  const canAudit = useCan("audit");
  const audit = useAsync(() => (canAudit ? api.getAudit({ limit: 12 }) : Promise.resolve(null)), [canAudit]);
  const canManage = useCan("team");
  const { now, me, toast } = useAdmin();
  const { codes, wards } = useWards();
  const [confirmNode, confirm] = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className={s.page}>
      <div className={s.twoCol}>
        <section className={s.col} aria-labelledby="team-h">
          <div className={cx(s.head, s.headCenter)}>
            <h1 id="team-h" className={s.h2}>
              Team
            </h1>
            {canManage && (
              <Link href="/admin/team/add" className={s.linkBtn}>
                Add someone
              </Link>
            )}
          </div>
          {team.error ? (
            <ErrorLine message={team.error} retry={team.reload} />
          ) : !team.data ? (
            <Loading what="Loading the team" />
          ) : (
            <TeamList
              team={team.data}
              codes={codes}
              canManage={canManage}
              meId={me.feederId}
              editing={editing}
              setEditing={setEditing}
              wards={wards}
              onRole={async (feederId, name, role, w) => {
                try {
                  await api.setTeamRole(feederId, role, w);
                  toast(`${name} is now ${roleLabel(role, w, codes)}.`);
                  setEditing(null);
                  team.reload();
                  audit.reload();
                } catch (e) {
                  toast(errorText(e));
                }
              }}
              onRemove={(feederId, name) =>
                confirm(
                  {
                    title: `Remove ${name} from the team?`,
                    body: <>{name} loses every admin role at once and cannot open the admin portal. Their feeder account and everything they did stay, and the audit log keeps their entries.</>,
                    confirm: "Remove",
                    run: () => api.removeTeamMember(feederId),
                    done: `${name} is off the team.`,
                  },
                  () => {
                    team.reload();
                    audit.reload();
                  },
                )
              }
            />
          )}
          <div className={s.rolesCard}>
            <h2 className={s.cardTitle} style={{ fontSize: 15 }}>
              Roles
            </h2>
            {ROLES.map((r) => (
              <span key={r}>
                <b>{ROLE_LABEL[r]}</b> · {ROLE_TEXT[r]}
              </span>
            ))}
          </div>
        </section>

        {canAudit && (
          <section className={s.col} aria-labelledby="audit-h">
            <div className={cx(s.head, s.headCenter)}>
              <h2 id="audit-h" className={s.h2}>
                Audit log
              </h2>
              <ExportCsv />
            </div>
            {audit.error ? (
              <ErrorLine message={audit.error} retry={audit.reload} />
            ) : !audit.data ? (
              <Loading what="Loading the audit log" />
            ) : (
              <>
                <AuditRows entries={audit.data.entries} now={now()} />
                <Link href="/admin/audit" className={s.linkBtn}>
                  The whole log ›
                </Link>
              </>
            )}
          </section>
        )}
      </div>
      <p className={s.note}>The log can&apos;t be edited by anyone, including the Owner. Vet signatures appear here too, so a disputed record can be traced.</p>
      {confirmNode}
    </div>
  );
}

function TeamList({
  team,
  codes,
  canManage,
  meId,
  editing,
  setEditing,
  wards,
  onRole,
  onRemove,
}: {
  team: AdminTeam;
  codes: Map<string, string>;
  canManage: boolean;
  meId: string;
  editing: string | null;
  setEditing: (id: string | null) => void;
  wards: { id: string; code: string }[];
  onRole: (feederId: string, name: string, role: AdminRole, wards: string[]) => void;
  onRemove: (feederId: string, name: string) => void;
}): React.JSX.Element {
  return (
    <ul className={s.plainList} aria-label="Team">
      {team.members.map((m) => {
        const main = m.roles[0];
        const label = m.roles.map((g) => roleLabel(g.role, g.wards, codes)).join(", ");
        const fromConfig = m.roles.some((g) => g.source !== "granted");
        return (
          <li key={m.feederId} className={s.plainRow} style={{ flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{m.name}</span>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className={s.muted}>{label}</span>
              {canManage && m.feederId !== meId && !fromConfig && (
                <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={() => setEditing(editing === m.feederId ? null : m.feederId)} aria-expanded={editing === m.feederId}>
                  Change<span className="h-sr-only"> {m.name}&apos;s role</span>
                </button>
              )}
            </span>
            {editing === m.feederId && main && (
              <RoleEditor
                name={m.name}
                initial={main.role}
                initialWards={main.wards}
                wards={wards}
                onSave={(role, w) => onRole(m.feederId, m.name, role, w)}
                onRemove={() => onRemove(m.feederId, m.name)}
                onCancel={() => setEditing(null)}
              />
            )}
          </li>
        );
      })}
      {team.invites.map((i) => (
        <li key={i.id} className={s.plainRow}>
          <span className={s.muted}>Invited {fullDate(i.createdAt)}{i.invitedBy ? ` by ${i.invitedBy}` : ""}</span>
          <span className={s.muted}>{roleLabel(i.role, i.wards, codes)} · not signed in yet</span>
        </li>
      ))}
    </ul>
  );
}

function RoleEditor({
  name,
  initial,
  initialWards,
  wards,
  onSave,
  onRemove,
  onCancel,
}: {
  name: string;
  initial: AdminRole;
  initialWards: string[];
  wards: { id: string; code: string }[];
  onSave: (role: AdminRole, wards: string[]) => void;
  onRemove: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [role, setRole] = useState<AdminRole>(initial);
  const [w, setW] = useState<string[]>(initialWards);
  return (
    <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 }}>
      <label className={s.field}>
        <span className={s.fieldLabel}>{name}&apos;s role</span>
        <select className={s.select} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}: {ROLE_TEXT[r]}
            </option>
          ))}
        </select>
      </label>
      {role === "ward_lead" && <WardPicker value={w} onChange={setW} wards={wards} />}
      <div className={s.actionsInline}>
        <button type="button" className={cx(s.btn, s.btnDark, s.btnXs)} disabled={role === "ward_lead" && !w.length} onClick={() => onSave(role, role === "ward_lead" ? w : [])}>
          Save role
        </button>
        <button type="button" className={cx(s.btn, s.btnOutline, s.btnXs)} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={cx(s.btn, s.btnDanger, s.btnXs)} style={{ marginLeft: "auto" }} onClick={onRemove}>
          Remove from the team
        </button>
      </div>
    </div>
  );
}

function WardPicker({ value, onChange, wards }: { value: string[]; onChange: (w: string[]) => void; wards: { id: string; code: string }[] }): React.JSX.Element {
  return (
    <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={s.fieldLabel} style={{ marginBottom: 6 }}>
        Their wards
      </legend>
      <div className={s.checks}>
        {wards.map((x) => (
          <label key={x.id} className={s.checkChip}>
            <input type="checkbox" checked={value.includes(x.id)} onChange={() => onChange(value.includes(x.id) ? value.filter((v) => v !== x.id) : [...value, x.id])} />
            {x.code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Add someone to the team (designed)
// ---------------------------------------------------------------------------

export function AddTeamScreen(): React.JSX.Element {
  const router = useRouter();
  const { toast } = useAdmin();
  const { wards, codes } = useWards();
  const can = useCan("team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("moderator");
  const [w, setW] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = /.+@.+\..+/.test(email.trim()) && (role !== "ward_lead" || w.length > 0);

  if (!can) {
    return (
      <div className={s.page}>
        <h1 className={s.h1}>Add someone</h1>
        <p className={s.note}>Only the Owner adds people to the team.</p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.addTeamMember({ email: email.trim(), role, wards: role === "ward_lead" ? w : [] });
      toast(r.invited ? `Invited as ${roleLabel(role, w, codes)}. The role starts when they sign in.` : `Added as ${roleLabel(role, w, codes)}.`);
      router.push("/admin/team");
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <header className={s.headText}>
        <Crumbs items={[{ label: "Team", href: "/admin/team" }, { label: "Add someone" }]} />
        <h1 className={s.h1}>Add someone to the team</h1>
      </header>
      <form className={s.form} onSubmit={submit} aria-label="Add someone to the team">
        <label className={s.field}>
          <span className={s.fieldLabel}>Their email</span>
          <input className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          <span className={s.note}>
            If they already use Hetja, the role starts now. If not, it starts the first time they sign in with this address. Hetja keeps only a
            keyed fingerprint of it.
          </span>
        </label>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend className={s.fieldLabel} style={{ marginBottom: 8 }}>
            Role
          </legend>
          {ROLES.map((r) => (
            <label key={r} className={s.radio}>
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
              <span>
                <b>{ROLE_LABEL[r]}</b>
                {ROLE_TEXT[r].charAt(0).toUpperCase() + ROLE_TEXT[r].slice(1)}
              </span>
            </label>
          ))}
        </fieldset>
        {role === "ward_lead" && <WardPicker value={w} onChange={setW} wards={wards} />}
        {role === "owner" && <p className={s.note}>An Owner can remove vets and other team members, you included. Add one only if you mean it.</p>}
        {err && (
          <p className={s.error} role="alert">
            {err}
          </p>
        )}
        <div className={s.actionsInline}>
          <button type="submit" className={cx(s.btn, s.btnDark, s.btnWide)} disabled={!ok || busy}>
            {busy ? "Adding…" : "Add to the team"}
          </button>
          <Link href="/admin/team" className={cx(s.btn, s.btnOutline, s.btnWide)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log (designed: the whole log, paged)
// ---------------------------------------------------------------------------

export function AuditScreen(): React.JSX.Element {
  const { now } = useAdmin();
  const [pages, setPages] = useState<AuditEntry[][]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useAsync(async () => {
    const p = await api.getAudit({ limit: 50 });
    setPages([p.entries]);
    setNext(p.nextBefore);
    return p;
  }, []);
  const more = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const p = await api.getAudit({ limit: 50, before: next });
      setPages((x) => [...x, p.entries]);
      setNext(p.nextBefore);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.page}>
      <header className={cx(s.head, s.headCenter)}>
        <h1 className={s.h1}>Audit log</h1>
        <ExportCsv />
      </header>
      <p className={s.note}>Every admin action, every vet signature and every opened document, newest first. Nobody can edit or delete an entry, including the Owner.</p>
      <div style={{ maxWidth: 880 }}>
        {first.error ? <ErrorLine message={first.error} retry={first.reload} /> : !first.data ? <Loading what="Loading the audit log" /> : <AuditRows entries={pages.flat()} now={now()} />}
      </div>
      {next && (
        <div>
          <button type="button" className={cx(s.btn, s.btnOutline, s.btnMd)} onClick={more} disabled={busy}>
            {busy ? "Loading…" : "Show older"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite a vet (designed)
// ---------------------------------------------------------------------------

export function InviteVetScreen(): React.JSX.Element {
  const router = useRouter();
  const { toast } = useAdmin();
  const ngos = useAsync(() => api.getAdminNgos("active"), []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ngoId, setNgoId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = /.+@.+\..+/.test(email.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.inviteVet({ email: email.trim(), name: name.trim() || undefined, ngoId: ngoId || null });
      toast(r.existingAccount ? "Invited. They already use Hetja, so it shows in their Me tab." : "Invited. They get an email with a link.");
      router.push("/admin/vets?tab=invited");
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <header className={s.headText}>
        <Crumbs items={[{ label: "Vets", href: "/admin/vets" }, { label: "Invite a vet" }]} />
        <h1 className={s.h1}>Invite a vet</h1>
      </header>
      <p className={s.note} style={{ maxWidth: 640 }}>
        They get an email asking them to sign in and send their registration (V1). They show under Invited until they apply, then under
        Waiting like anyone else: an invitation is not a verification.
      </p>
      <form className={s.form} onSubmit={submit} aria-label="Invite a vet">
        <label className={s.field}>
          <span className={s.fieldLabel}>Their name</span>
          <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Farhan Qureshi" autoComplete="off" />
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>Their email</span>
          <input className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          <span className={s.note}>Hetja keeps only a keyed fingerprint of the address, never the address itself.</span>
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>Through an NGO, if any</span>
          <select className={s.select} value={ngoId} onChange={(e) => setNgoId(e.target.value)}>
            <option value="">No NGO</option>
            {(ngos.data?.ngos ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <span className={s.note}>They arrive linked to it; the NGO&apos;s coordinator can vouch for them.</span>
        </label>
        {err && (
          <p className={s.error} role="alert">
            {err}
          </p>
        )}
        <div className={s.actionsInline}>
          <button type="submit" className={cx(s.btn, s.btnBlue, s.btnWide)} disabled={!ok || busy}>
            {busy ? "Sending…" : "Send the invitation"}
          </button>
          <Link href="/admin/vets" className={cx(s.btn, s.btnOutline, s.btnWide)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings (designed: the rules, read-only)
// ---------------------------------------------------------------------------

export function SettingsScreen(): React.JSX.Element {
  const res = useAsync(() => api.getAdminSettings(), []);
  const r = res.data;
  const groups: { title: string; rows: [string, string][] }[] = r
    ? [
        {
          title: "SOS timings",
          rows: [
            ["Feeders nearby", "Told at once"],
            ["The NGO covering the ward", `Has ${r.sos.ngoWindowMin} min first`],
            ["Every vet nearby", `After ${r.sos.ngoWindowMin} min with nobody accepting`],
            ["Shows as escalated", `After ${r.sos.escalateAfterMin} min`],
            ["People paged per case", `Up to ${r.sos.maxPaged}`],
          ],
        },
        {
          title: "Who can take an SOS",
          rows: [
            ["Trust needed: minor", String(r.sos.trustFloors.minor)],
            ["Trust needed: serious", String(r.sos.trustFloors.serious)],
            ["Trust needed: critical", String(r.sos.trustFloors.critical)],
            ["Open cases one person can hold", String(r.sos.maxOpenAcks)],
            ["Pages a feeder gets", `${r.sos.dailyCap} a day, ${r.sos.weeklyCap} a week`],
          ],
        },
        {
          title: "Budgets",
          rows: [
            ["Collar page (the page a stranger scans)", `${r.budgets.scanPageKb} KB`],
            ["Trust a feeder can earn from feeds", `${r.budgets.feedTrustDailyCap} a day`],
          ],
        },
        {
          title: "Keeping and deleting",
          rows: [
            ["Feed photos", `${r.retention.photoDays} days`],
            ["Vet and NGO documents", `${r.retention.documentDaysAfterDecision} days after the decision`],
            ["An avatar that was replaced", `${r.retention.avatarPreviousDays} days, then gone`],
          ],
        },
        { title: "Limits", rows: r.limits.map((l) => [l.name, l.rule] as [string, string]) },
      ]
    : [];
  return (
    <div className={s.page}>
      <header className={s.headText}>
        <h1 className={s.h1}>Settings</h1>
        <p className={s.note}>The rules Hetja runs on, read-only. They change in code, reviewed and deployed, never from here, so nobody can quietly loosen one.</p>
      </header>
      {res.error ? (
        <ErrorLine message={res.error} retry={res.reload} />
      ) : !r ? (
        <Loading what="Loading the rules" />
      ) : (
        <div className={s.settingsGrid}>
          {groups.map((g) => (
            <section key={g.title} className={s.weekCard} aria-labelledby={`set-${g.title}`}>
              <h2 id={`set-${g.title}`} className={s.cardTitle}>
                {g.title}
              </h2>
              <dl className={s.kvList}>
                {g.rows.map(([k, v]) => (
                  <div key={k} className={s.kv}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
