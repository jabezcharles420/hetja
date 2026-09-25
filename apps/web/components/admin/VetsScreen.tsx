"use client";

/**
 * A2 Vets: verify, suspend, remove. The list with the selected application
 * open.
 *
 * Adapted (CONTRACT.md): there is no public API for the MSVC register, so the
 * mock's "Found on the MSVC register" is a checklist item, "Checked on the
 * MSVC register", with a link to the council's public list. The admin ticks
 * it (and can note the validity date) and Verify sends that tick with it
 * (POST /admin/vets/:id/verify { registerChecked: true, validTo }).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type AdminDocument, type AdminVetDetail, type AdminVetRow, type VetStatus } from "@/lib/api";
import { daysLabel, fullDate, isOverdue, monthLabel, shortDate, sosHoursLabel, VET_STATUS_LABEL, wardCode } from "./format";
import {
  Chips,
  cx,
  Dialog,
  ErrorLine,
  errorText,
  Initials,
  Loading,
  Rows,
  SelectTable,
  styles as s,
  Tabs,
  useAdmin,
  useAsync,
  useCan,
  useConfirm,
  useEscape,
  useQueryParam,
  useWards,
  type Column,
} from "./ui";

/** The council's public list ("List of Registered veterinary Practitioner"), when the API sends none. */
export const MSVC_REGISTER_URL = "https://msvc.maharashtra.gov.in/listofnew";

export type VetTab = "waiting" | "verified" | "suspended" | "invited";
const TABS: VetTab[] = ["waiting", "verified", "suspended", "invited"];
const TAB_LABEL: Record<VetTab, string> = { waiting: "Waiting", verified: "Verified", suspended: "Suspended", invited: "Invited" };

/** Waiting includes "asked for more": both are applications nobody has decided. */
export function vetTab(status: VetStatus): VetTab | null {
  if (status === "waiting" || status === "more_info") return "waiting";
  if (status === "verified" || status === "suspended" || status === "invited") return status;
  return null;
}

export function tabCount(counts: Record<VetStatus, number> | undefined, tab: VetTab): number | null {
  if (!counts) return null;
  return tab === "waiting" ? (counts.waiting ?? 0) + (counts.more_info ?? 0) : (counts[tab] ?? 0);
}

/** "Dr. Farhan Qureshi" -> "Dr. Qureshi". */
export function shortVetName(name: string): string {
  const m = /^(Dr\.?)\s+(.+)$/i.exec(name.trim());
  if (!m) return name;
  const last = m[2].split(/\s+/).pop();
  return `${m[1]} ${last}`;
}

export function VetsScreen(): React.JSX.Element {
  const [tabParam, setTab] = useQueryParam("tab");
  const [picked, setPicked] = useQueryParam("id");
  const tab = (TABS as string[]).includes(tabParam ?? "") ? (tabParam as VetTab) : "waiting";
  // One call for every status: the tabs are filters over it, and the counts come with it.
  const list = useAsync(() => api.getAdminVets(), []);
  const canInvite = useCan("vets");
  const now = useAdmin().now();

  const all = list.data?.vets ?? [];
  // A link to one vet opens their tab.
  const pickedRow = picked ? all.find((v) => v.id === picked) : undefined;
  const effectiveTab = pickedRow ? (vetTab(pickedRow.status) ?? tab) : tab;
  const shown = all
    .filter((v) => vetTab(v.status) === effectiveTab)
    .sort((a, b) => (a.appliedAt ?? "").localeCompare(b.appliedAt ?? ""));
  // The selected application is open; with none chosen, the one waiting longest is.
  const [closed, setClosed] = useState(false);
  const selected = picked ?? (closed ? null : (shown[0]?.id ?? null));
  const select = (v: string | null) => {
    setClosed(v === null);
    setPicked(v);
  };
  useEscape(selected ? () => select(null) : null);

  const columns: Column<AdminVetRow>[] = [
    { key: "name", label: "Name", width: "31%", cell: (v) => v.name },
    { key: "reg", label: "Registration", width: "21%", cell: (v) => v.regLabel || "Not given yet" },
    { key: "clinic", label: "Clinic", width: "30%", cell: (v) => v.clinic ?? "" },
    {
      key: "applied",
      label: effectiveTab === "invited" ? "Invited" : effectiveTab === "waiting" ? "Applied" : "Since",
      width: "96px",
      cell: (v) => (
        <span className={effectiveTab === "waiting" && isOverdue(v.appliedAt, now) ? s.warnText : undefined}>
          {v.status === "more_info" ? "Asked" : daysLabel(v.appliedAt, now)}
        </span>
      ),
    },
  ];

  return (
    <div className={s.split}>
      <div className={s.splitMain}>
        <header className={cx(s.head, s.headCenter)}>
          <h1 className={s.h1}>Vets</h1>
          {canInvite && (
            <Link href="/admin/vets/invite" className={cx(s.btn, s.btnSm, s.btnBlue)}>
              Invite a vet
            </Link>
          )}
        </header>
        <Tabs
          label="Vets by status"
          tabs={TABS.map((k) => ({ key: k, label: `${TAB_LABEL[k]} · ${tabCount(list.data?.counts, k) ?? "…"}` }))}
          value={effectiveTab}
          onChange={(k) => {
            setClosed(false);
            setTab(k, { id: null });
          }}
        />
        {list.error ? (
          <ErrorLine message={list.error} retry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading what="Loading vets" />
        ) : (
          <SelectTable
            caption={`${TAB_LABEL[effectiveTab]} vets`}
            columns={columns}
            rows={shown}
            rowKey={(v) => v.id}
            selected={selected}
            onSelect={select}
            empty={effectiveTab === "waiting" ? "No applications waiting. New ones land here and on Today." : `No ${TAB_LABEL[effectiveTab].toLowerCase()} vets.`}
          />
        )}
      </div>
      <aside className={s.aside} aria-label="Application">
        {selected ? (
          <VetPanel key={selected} id={selected} onChanged={list.reload} />
        ) : (
          <p className={s.asideEmpty}>Pick a vet to open their application.</p>
        )}
      </aside>
    </div>
  );
}

const DOC_LABEL: Record<AdminDocument["kind"], string> = {
  certificate: "Registration certificate",
  photo_id: "Photo ID",
  ngo_registration: "Registration certificate",
};

function DocIcon(): React.JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 18l5-5 3 3 3-3 5 5" />
    </svg>
  );
}

/** Documents stream to admins only (every open is audited) and never get a public URL. */
export function DocumentTile({ doc }: { doc: AdminDocument }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (doc.deleted) {
    return (
      <div className={cx(s.doc, s.docMissing)}>
        <DocIcon />
        {DOC_LABEL[doc.kind]}: deleted
      </div>
    );
  }
  return (
    <>
      <button type="button" className={s.doc} onClick={() => setOpen(true)} aria-label={`Open ${DOC_LABEL[doc.kind]}`}>
        <DocIcon />
        {DOC_LABEL[doc.kind]}
      </button>
      {open && <DocumentViewer doc={doc} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DocumentViewer({ doc, onClose }: { doc: AdminDocument; onClose: () => void }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    api.downloadDocument(doc.id).then(
      ({ blob }) => {
        if (!live) return;
        u = URL.createObjectURL(blob);
        setUrl(u);
      },
      (e) => live && setErr(errorText(e)),
    );
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [doc.id]);
  const label = DOC_LABEL[doc.kind];
  return (
    <Dialog title={label} onClose={onClose}>
      <p className={s.note}>
        Uploaded {fullDate(doc.uploadedAt)}. Private: only admins can open it, and opening it is written to the audit log.{" "}
        {doc.deleteAfter ? `It is deleted on ${fullDate(doc.deleteAfter)}.` : "It is deleted 30 days after the decision."}
      </p>
      {err ? (
        <ErrorLine message={err} />
      ) : !url ? (
        <Loading what="Opening the document" />
      ) : doc.mime === "application/pdf" ? (
        <iframe src={url} title={label} style={{ width: "100%", height: "60vh", border: 0, borderRadius: 12 }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} style={{ width: "100%", borderRadius: 12 }} />
      )}
      <div className={s.dialogActions}>
        <button type="button" className={cx(s.btn, s.btnOutline)} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

/** The adapted MSVC item: a tick the admin makes after looking the vet up. */
function RegisterCheck({
  vet,
  editable,
  ticked,
  onTick,
  validTo,
  onValidTo,
}: {
  vet: AdminVetDetail;
  editable: boolean;
  ticked: boolean;
  onTick: (v: boolean) => void;
  validTo: string;
  onValidTo: (v: string) => void;
}): React.JSX.Element {
  const url = vet.registerUrl || MSVC_REGISTER_URL;
  const council = vet.council || "MSVC";
  if (vet.registerChecked) {
    const bits = [`Reg. ${vet.regNo}`];
    if (vet.validTo) bits.push(`valid to ${monthLabel(vet.validTo)}`);
    return (
      <div className={cx(s.check, s.checkOk)} style={{ gap: 4 }} data-testid="register-check">
        <span className={s.checkTitle}>✓ Checked on the {council} register</span>
        <span className={s.checkSub}>{bits.join(" · ")}</span>
        <span className={s.checkSub}>
          {vet.registerCheckedBy ? `Ticked by ${vet.registerCheckedBy}` : "Ticked"}
          {vet.registerCheckedAt ? `, ${shortDate(vet.registerCheckedAt)}` : ""} ·{" "}
          <a href={url} target="_blank" rel="noreferrer" className={s.okText} style={{ textDecoration: "underline" }}>
            Open the register<span className="h-sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      </div>
    );
  }
  return (
    <div className={cx(s.check, ticked && s.checkOk)} data-testid="register-check">
      {editable ? (
        <label className={s.checkRow}>
          <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} />
          <span className={s.checkTitle}>Checked on the {council} register</span>
        </label>
      ) : (
        <span className={s.checkTitle}>Not checked on the {council} register yet</span>
      )}
      <span className={s.checkSub} style={{ color: ticked ? undefined : "var(--h-text-mid)" }}>
        Look up reg. {vet.regNo || "(not given)"} and the name on the council&apos;s public list.{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ color: ticked ? "inherit" : "var(--h-link)", fontWeight: 600, textDecoration: ticked ? "underline" : undefined }}
        >
          Open the {council} register<span className="h-sr-only"> (opens in a new tab)</span> ↗
        </a>
      </span>
      {editable && (
        <label className={s.checkRow} style={{ color: ticked ? undefined : "var(--h-text-mid)" }}>
          <span>Valid to, if the register says</span>
          <input
            className={s.input}
            type="month"
            style={{ height: 32, width: 170, fontSize: 13 }}
            value={validTo}
            onChange={(e) => onValidTo(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}

function VetPanel({ id, onChanged }: { id: string; onChanged: () => void }): React.JSX.Element {
  const res = useAsync(() => api.getAdminVet(id), [id]);
  const { refreshToday } = useAdmin();
  const { codes } = useWards();
  const canDecide = useCan("vets");
  const canRemove = useCan("vets_remove");
  const [confirmNode, confirm] = useConfirm();
  const [ticked, setTicked] = useState(false);
  const [validTo, setValidTo] = useState("");
  const after = useCallback(() => {
    res.reload();
    onChanged();
    refreshToday();
  }, [res, onChanged, refreshToday]);

  if (res.error) return <ErrorLine message={res.error} retry={res.reload} />;
  if (!res.data) return <Loading what="Opening the application" />;
  const v = res.data;
  const short = shortVetName(v.name);
  const decidable = v.status === "waiting" || v.status === "more_info";
  const registered = v.registerChecked || ticked;
  const wards = v.wards.map((w) => wardCode(w, codes)).join(", ");

  const verify = () =>
    confirm(
      {
        title: `Verify ${short}?`,
        body: (
          <>
            {short} can sign vaccinations, sterilisation and treatment notes from now on
            {v.sosAvailable ? `, and accept SOS calls in ${wards}. Their phone number shows on public pages` : ""}. Their documents are
            deleted in 30 days.
          </>
        ),
        confirm: `Verify ${short}`,
        tone: "dark",
        run: () => api.verifyVet(v.id, { registerChecked: true, validTo: validTo || v.validTo || null }),
        done: `${short} is verified.`,
      },
      after,
    );
  const askMore = () =>
    confirm(
      {
        title: "Ask for more",
        body: <>{short} gets your message and can send more documents. The application stays open until they do.</>,
        confirm: "Send",
        tone: "dark",
        reason: {
          label: "What do you need?",
          placeholder: "The certificate photo is blurred. Please send a clearer one.",
          hint: `${short} sees exactly what you type.`,
        },
        run: (reason) => api.decideVet(v.id, "ask-more", reason),
        done: `Asked ${short} for more.`,
      },
      after,
    );
  const decline = () =>
    confirm(
      {
        title: `Decline ${short}?`,
        body: <>{short} is told why and cannot sign records. They can apply again. Their documents are deleted in 30 days.</>,
        confirm: "Decline",
        reason: {
          label: "Reason",
          placeholder: `Registration ${v.regNo || "number"} is not on the ${v.council} register.`,
          hint: `${short} sees exactly what you type.`,
        },
        run: (reason) => api.decideVet(v.id, "decline", reason),
        done: `${short} was declined.`,
      },
      after,
    );
  const suspend = () =>
    confirm(
      {
        title: `Suspend ${short}?`,
        body: (
          <>
            {short} stops signing new records and their Accept SOS button is hidden. Every record they already signed ({v.signatures}) stays
            valid.
          </>
        ),
        confirm: "Suspend",
        reason: { label: "Reason", placeholder: "Registration lapsed", hint: "Shown to the vet and written to the audit log." },
        run: (reason) => api.decideVet(v.id, "suspend", reason),
        done: `${short} is suspended.`,
      },
      after,
    );
  const remove = () =>
    confirm(
      {
        title: `Remove ${short}?`,
        body: <>{short} goes back to being a feeder: no signing, no SOS calls, no public number. Choose what happens to their past signatures.</>,
        confirm: "Remove",
        choices: {
          label: `Their ${v.signatures} signed records`,
          initial: "keep",
          options: [
            { value: "keep", title: "Keep them valid", detail: "The badges stay on every dog's page. Choose this unless a record is in doubt." },
            { value: "flag", title: "Flag them for re-check", detail: "Each record shows as needing a vet to confirm it again." },
          ],
        },
        reason: { label: "Reason", placeholder: "Left practice in Mumbai", hint: "Shown to the vet and written to the audit log." },
        run: (reason, choice) => api.removeVet(v.id, { reason, signatures: choice === "flag" ? "flag" : "keep" }),
        done: `${short} was removed.`,
      },
      after,
    );
  const reinstate = () =>
    confirm(
      {
        title: `Reinstate ${short}?`,
        body: <>{short} can sign records and accept SOS calls again. Written to the audit log.</>,
        confirm: "Reinstate",
        tone: "dark",
        run: () => api.decideVet(v.id, "reinstate"),
        done: `${short} is back.`,
      },
      after,
    );

  const sub = [v.qualification, v.clinic].filter(Boolean).join(" · ");
  const docs = v.documents.filter((d) => d.kind === "certificate" || d.kind === "photo_id");
  const suspended = v.status === "suspended";

  return (
    <>
      <div className={s.who}>
        <Initials name={v.name} />
        <div className={s.whoText}>
          <h2 className={s.whoName}>{v.name}</h2>
          <span className={s.whoSub}>{sub || (v.status === "invited" ? "Invited, not applied yet" : "")}</span>
        </div>
      </div>

      {(v.status !== "waiting" && v.status !== "invited") || v.decisionReason ? (
        <p className={s.note}>
          <span
            className={cx(
              s.pill,
              v.status === "verified" ? s.pillOk : ["suspended", "removed", "declined"].includes(v.status) ? s.pillDanger : s.pillWarn,
            )}
          >
            {VET_STATUS_LABEL[v.status]}
          </span>
          {v.decidedBy && (
            <>
              {" "}
              by {v.decidedBy}
              {v.decidedAt ? `, ${shortDate(v.decidedAt)}` : ""}
            </>
          )}
          {v.decisionReason ? ` · ${v.status === "more_info" ? "asked" : "reason"}: ${v.decisionReason}` : ""}
        </p>
      ) : null}
      {v.vouchedBy && <p className={s.note}>Vouched for by {v.vouchedBy.name}.</p>}

      {v.status !== "invited" && (
        <RegisterCheck vet={v} editable={canDecide && decidable} ticked={ticked} onTick={setTicked} validTo={validTo} onValidTo={setValidTo} />
      )}

      <div className={s.section}>
        <span className={s.label}>Documents</span>
        {docs.length ? (
          <div className={s.docs}>
            {docs.map((d) => (
              <DocumentTile key={d.id} doc={d} />
            ))}
          </div>
        ) : (
          <p className={s.note}>{v.status === "invited" ? "Not applied yet." : "Deleted 30 days after the decision."}</p>
        )}
      </div>

      <Rows
        rows={[
          ["Phone", v.publicPhoneMasked ? `${v.publicPhoneMasked} · verified` : "Not given"],
          ["Wards they cover", wards || "None chosen"],
          ["Takes SOS calls", v.sosAvailable ? `Yes, ${sosHoursLabel(v.sosHours)}` : "No"],
          ...(v.status === "verified" || suspended
            ? ([["Records signed", `${v.signatures}${v.signaturesFlagged ? " · flagged for re-check" : ""}`]] as [string, string][])
            : []),
        ]}
      />

      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>{v.status === "verified" ? "What they can do" : suspended ? "While suspended" : "What they can do once verified"}</span>
        <Chips
          label="Permissions"
          items={[
            { text: "Sign vaccinations", on: !suspended },
            { text: "Sign sterilisation", on: !suspended },
            { text: "Treatment notes", on: !suspended },
            { text: "Accept SOS", on: !suspended && v.sosAvailable },
          ]}
        />
      </div>

      {canDecide && decidable && (
        <>
          <div className={s.actions}>
            <button
              type="button"
              className={cx(s.btn, s.btnDark, s.btnGrow)}
              onClick={verify}
              disabled={!registered}
              aria-describedby={registered ? undefined : `need-reg-${v.id}`}
            >
              Verify {short}
            </button>
            <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={askMore}>
              Ask for more
            </button>
            <button type="button" className={cx(s.btn, s.btnDanger)} onClick={decline}>
              Decline
            </button>
          </div>
          {!registered && (
            <p id={`need-reg-${v.id}`} className={s.note} style={{ marginTop: -10 }}>
              Tick “Checked on the {v.council} register” first.
            </p>
          )}
        </>
      )}
      {canDecide && v.status === "verified" && (
        <div className={s.actions}>
          <button type="button" className={cx(s.btn, s.btnQuiet, s.btnGrow)} onClick={suspend}>
            Suspend
          </button>
          {canRemove && (
            <button type="button" className={cx(s.btn, s.btnDanger)} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      )}
      {canDecide && suspended && (
        <div className={s.actions}>
          <button type="button" className={cx(s.btn, s.btnDark, s.btnGrow)} onClick={reinstate}>
            Reinstate {short}
          </button>
          {canRemove && (
            <button type="button" className={cx(s.btn, s.btnDanger)} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      )}
      {confirmNode}
    </>
  );
}
