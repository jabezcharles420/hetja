"use client";

/**
 * Link a verified vet or an NGO to its care directory entry (the monthly
 * CSV, government vets and hospitals included), so the public lookups show
 * one entry with the right "Government vet · free" label, not two.
 */
import { useState } from "react";
import { api, type CareDirectoryEntry } from "@/lib/api";
import { phoneLabel, wardCode } from "./format";
import { cx, Dialog, ErrorLine, errorText, Loading, styles as s, useAdmin, useAsync, useConfirm, useWards } from "./ui";

export function DirectoryLink({
  kind,
  id,
  name,
  careProviderId,
  canEdit,
  onChanged,
}: {
  kind: "vet" | "ngo";
  id: string;
  name: string;
  careProviderId: string | null;
  canEdit: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const link = (entryId: string | null) => (kind === "vet" ? api.linkVetCare(id, entryId) : api.linkNgoCare(id, entryId));
  const unlink = () =>
    confirm(
      {
        title: `Unlink ${name} from the directory?`,
        body: <>The directory entry shows on its own again in the public care lookups, next to {name}&apos;s own listing.</>,
        confirm: "Unlink",
        run: () => link(null),
        done: "Unlinked.",
      },
      onChanged,
    );
  return (
    <div className={cx(s.section, s.section8)}>
      <span className={s.label}>Care directory</span>
      <div className={s.row} style={{ fontSize: 14, alignItems: "center" }}>
        <span className={careProviderId ? undefined : s.muted}>{careProviderId ? "Linked to its directory entry" : "Not linked to a directory entry"}</span>
        {canEdit && (
          <span className={s.actionsInline} style={{ gap: 12 }}>
            <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={() => setPicking(true)}>
              {careProviderId ? "Change" : "Link to the directory"}
            </button>
            {careProviderId && (
              <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} style={{ color: "var(--h-sos)" }} onClick={unlink}>
                Unlink
              </button>
            )}
          </span>
        )}
      </div>
      {picking && (
        <PickEntry
          name={name}
          kind={kind}
          current={careProviderId}
          onClose={() => setPicking(false)}
          onPick={link}
          onDone={() => {
            setPicking(false);
            onChanged();
          }}
        />
      )}
      {confirmNode}
    </div>
  );
}

function PickEntry({
  name,
  kind,
  current,
  onClose,
  onPick,
  onDone,
}: {
  name: string;
  kind: "vet" | "ngo";
  current: string | null;
  onClose: () => void;
  onPick: (id: string) => Promise<unknown>;
  onDone: () => void;
}): React.JSX.Element {
  const [q, setQ] = useState(name.replace(/^Dr\.?\s+/i, ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useAdmin();
  const { codes } = useWards();
  const res = useAsync(() => (q.trim().length >= 2 ? api.searchCare(q.trim()) : Promise.resolve({ entries: [] as CareDirectoryEntry[] })), [q]);
  const pick = async (e: CareDirectoryEntry) => {
    setBusy(true);
    setErr(null);
    try {
      await onPick(e.id);
      toast(`${name} is linked to ${e.name}.`);
      onDone();
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  };
  const entries = (res.data?.entries ?? []).filter((e) => (kind === "vet" ? true : !e.isPerson));
  return (
    <Dialog title={`Which directory entry is ${name}?`} onClose={onClose}>
      <label className={s.field}>
        <span className={s.fieldLabel}>Search the care directory</span>
        <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </label>
      {res.error ? (
        <ErrorLine message={res.error} retry={res.reload} />
      ) : q.trim().length < 2 ? (
        <p className={s.note}>Type at least two letters.</p>
      ) : res.loading ? (
        <Loading what="Searching the directory" />
      ) : entries.length ? (
        <ul className={s.inset} aria-label="Directory entries">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className={s.insetRow}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <b>{e.name}</b>
                <span className={s.muted} style={{ fontSize: 13 }}>
                  {[e.isGovernment ? (e.isPerson ? "Government vet · free" : "Government hospital · free") : e.kind, e.regNo, e.wards.map((w) => wardCode(w, codes)).join(", "), phoneLabel(e.phoneE164)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <button type="button" className={cx(s.btn, s.btnXs, s.btnDark)} disabled={busy || e.id === current} onClick={() => pick(e)}>
                {e.id === current ? "Linked" : "Link"}
                <span className="h-sr-only"> {e.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.note}>Nothing in the directory matches. It updates monthly from the care CSV.</p>
      )}
      {err && <ErrorLine message={err} />}
    </Dialog>
  );
}
