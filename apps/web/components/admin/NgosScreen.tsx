"use client";

/**
 * A7 NGOs: the partner list with the selected NGO open, and (designed) Add
 * an NGO and Edit details. NGOs cover Mumbai wards only (adapted list: the
 * mock's "Thane Street Dogs · Thane" cannot exist).
 *
 * SOS cases route to the NGO covering the ward first, then to vets nearby.
 * Pausing stops new SOS routing; removing unlinks its vets but keeps their
 * verification.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { api, type AdminNgoCreateInput, type AdminNgoDetail, type AdminNgoRow, type NgoRegType } from "@/lib/api";
import { phoneLabel, REG_TYPE_LABEL, VET_STATUS_LABEL, wardCode } from "./format";
import { DocumentTile } from "./VetsScreen";
import {
  Chips,
  Crumbs,
  cx,
  ErrorLine,
  errorText,
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

type NgoTab = "active" | "waiting" | "paused";
const TABS: NgoTab[] = ["active", "waiting", "paused"];
const TAB_LABEL: Record<NgoTab, string> = { active: "Active", waiting: "Waiting", paused: "Paused" };

export function NgosScreen(): React.JSX.Element {
  const [tabParam, setTab] = useQueryParam("tab");
  const [picked, setPicked] = useQueryParam("id");
  const tab = (TABS as string[]).includes(tabParam ?? "") ? (tabParam as NgoTab) : "active";
  const list = useAsync(() => api.getAdminNgos(), []);
  const canAdd = useCan("ngos");
  const { codes } = useWards();

  const all = list.data?.ngos ?? [];
  const pickedRow = picked ? all.find((n) => n.id === picked) : undefined;
  const effectiveTab: NgoTab = pickedRow && (TABS as string[]).includes(pickedRow.status) ? (pickedRow.status as NgoTab) : tab;
  const shown = all.filter((n) => n.status === effectiveTab);
  const [closed, setClosed] = useState(false);
  const selected = picked ?? (closed ? null : (shown[0]?.id ?? null));
  const select = (v: string | null) => {
    setClosed(v === null);
    setPicked(v);
  };
  useEscape(selected ? () => select(null) : null);

  const wards = (n: AdminNgoRow) => (n.citywide ? "Citywide" : n.wards.map((w) => wardCode(w, codes)).join(", "));
  const columns: Column<AdminNgoRow>[] = [
    { key: "name", label: "Name", width: "36%", cell: (n) => n.name },
    { key: "wards", label: "Wards", width: "24%", cell: (n) => (n.status === "waiting" ? `${wards(n)} · waiting` : wards(n)) },
    { key: "vets", label: "Vets", width: "11%", cell: (n) => n.vets },
    { key: "dogs", label: "Dogs", width: "11%", cell: (n) => n.dogs },
    { key: "sos", label: "SOS · 30d", width: "90px", cell: (n) => n.sos30d },
  ];

  return (
    <div className={s.split}>
      <div className={s.splitMain}>
        <header className={cx(s.head, s.headCenter)}>
          <h1 className={s.h1}>NGOs</h1>
          {canAdd && (
            <Link href="/admin/ngos/new" className={cx(s.btn, s.btnSm, s.btnBlue)}>
              Add an NGO
            </Link>
          )}
        </header>
        <Tabs
          label="NGOs by status"
          tabs={TABS.map((k) => ({ key: k, label: `${TAB_LABEL[k]} · ${list.data?.counts[k] ?? "…"}` }))}
          value={effectiveTab}
          onChange={(k) => {
            setClosed(false);
            setTab(k, { id: null });
          }}
        />
        {list.error ? (
          <ErrorLine message={list.error} retry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading what="Loading NGOs" />
        ) : (
          <SelectTable
            caption={`${TAB_LABEL[effectiveTab]} NGOs`}
            columns={columns}
            rows={shown}
            rowKey={(n) => n.id}
            selected={selected}
            onSelect={select}
            empty={effectiveTab === "waiting" ? "No NGO is waiting. New applications land here and on Today." : `No ${TAB_LABEL[effectiveTab].toLowerCase()} NGOs.`}
          />
        )}
      </div>
      <aside className={s.aside} aria-label="NGO">
        {selected ? <NgoPanel key={selected} id={selected} onChanged={list.reload} /> : <p className={s.asideEmpty}>Pick an NGO to open it.</p>}
      </aside>
    </div>
  );
}

function NgoPanel({ id, onChanged }: { id: string; onChanged: () => void }): React.JSX.Element {
  const res = useAsync(() => api.getAdminNgo(id), [id]);
  const { refreshToday } = useAdmin();
  const { codes } = useWards();
  const canDecide = useCan("ngos");
  const canRemove = useCan("ngos_remove");
  const [confirmNode, confirm] = useConfirm();
  const after = useCallback(() => {
    res.reload();
    onChanged();
    refreshToday();
  }, [res, onChanged, refreshToday]);

  if (res.error) return <ErrorLine message={res.error} retry={res.reload} />;
  if (!res.data) return <Loading what="Opening the NGO" />;
  const n = res.data;
  const wards = n.citywide ? "Citywide" : n.wards.map((w) => wardCode(w, codes)).join(", ");
  const sub = [REG_TYPE_LABEL[n.regType], n.has80g ? "80G" : null, n.since ? `since ${n.since}` : null].filter(Boolean).join(" · ");

  const pause = () =>
    confirm(
      {
        title: `Pause ${n.name}?`,
        body: (
          <>
            New SOS cases in {wards} stop going to {n.name}; they go to vets nearby instead. Cases they already took stay with them. Their vets
            stay verified.
          </>
        ),
        confirm: "Pause",
        reason: { label: "Reason", placeholder: "Ambulance off the road for repairs", hint: "Shown to their coordinators and written to the audit log." },
        run: (reason) => api.decideNgo(n.id, "pause", reason),
        done: `${n.name} is paused.`,
      },
      after,
    );
  const resume = () =>
    confirm(
      { title: `Resume ${n.name}?`, body: <>New SOS cases in {wards} go to {n.name} first again.</>, confirm: "Resume", tone: "dark", run: () => api.decideNgo(n.id, "resume"), done: `${n.name} is receiving SOS again.` },
      after,
    );
  const approve = () =>
    confirm(
      {
        title: `Approve ${n.name}?`,
        body: (
          <>
            {n.name} gets an NGO tab, receives SOS cases in {wards} before vets nearby, and can vouch for its vets. Call them before you switch it on.
          </>
        ),
        confirm: `Approve ${n.name}`,
        tone: "dark",
        run: () => api.decideNgo(n.id, "approve"),
        done: `${n.name} is active.`,
      },
      after,
    );
  const remove = () =>
    confirm(
      {
        title: n.status === "waiting" ? `Decline ${n.name}?` : `Remove ${n.name}?`,
        body:
          n.status === "waiting" ? (
            <>{n.name} is told why and does not get an NGO tab. They can apply again.</>
          ) : (
            <>
              {n.name} stops receiving SOS cases and loses its NGO tab. Its {n.vetCount} vets are unlinked but keep their verification. Its{" "}
              {n.members} members keep their feeder accounts.
            </>
          ),
        confirm: n.status === "waiting" ? "Decline" : "Remove",
        reason: { label: "Reason", placeholder: n.status === "waiting" ? "We could not confirm the trust registration." : "Closed down", hint: "Shown to their coordinators and written to the audit log." },
        run: (reason) => api.decideNgo(n.id, "remove", reason),
        done: n.status === "waiting" ? `${n.name} was declined.` : `${n.name} was removed.`,
      },
      after,
    );

  const active = n.status === "active";
  return (
    <>
      <div className={s.who}>
        <span className={cx(s.whoPic, s.whoPicSquare)} aria-hidden="true">
          {n.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")}
        </span>
        <div className={s.whoText}>
          <h2 className={s.whoName}>{n.name}</h2>
          <span className={s.whoSub}>{sub}</span>
        </div>
      </div>
      {n.status !== "active" && (
        <p className={s.note}>
          <span className={cx(s.pill, n.status === "waiting" ? s.pillWarn : s.pillDanger)}>{n.status === "waiting" ? "Waiting" : n.status === "paused" ? "Paused" : "Removed"}</span>
          {n.decisionReason ? ` · reason: ${n.decisionReason}` : ""}
        </p>
      )}

      <Rows
        rows={[
          ["Contact", [n.contactName, phoneLabel(n.publicPhone)].filter(Boolean).join(" · ") || "Not given"],
          ["Wards", wards || "None"],
          ["Ambulance", n.offers.ambulance && n.ambulance.count ? `${n.ambulance.count}${n.ambulance.hours ? ` · ${n.ambulance.hours}` : ""}` : "None"],
          ["Shelter beds", n.offers.shelterBeds && n.beds.total ? `${n.beds.total} · ${n.beds.free} free` : "None"],
        ]}
      />

      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>Vets linked · {n.vetList.length}</span>
        {n.vetList.length ? (
          <ul className={s.inset}>
            {n.vetList.map((v) => (
              <li key={v.feederId} className={s.insetRow}>
                <span>{v.name}</span>
                <span className={v.status === "verified" ? s.okText : v.status === "waiting" || v.status === "more_info" ? s.warnText : s.muted}>
                  {v.status === "verified" ? "✓ Verified" : VET_STATUS_LABEL[v.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.note}>No vets linked yet. A vet who applies through {n.name} arrives in Vets already vouched for.</p>
        )}
      </div>

      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>What this NGO can do</span>
        <Chips
          label="Capabilities"
          items={[
            { text: "Receive SOS in its wards", on: active },
            { text: "Issue collars", on: active && n.offers.collars },
            { text: "Vouch for its vets", on: active },
            { text: "Run sterilisation drives", on: active && n.offers.sterilisation },
          ]}
        />
      </div>

      {n.documents.length > 0 && (
        <div className={s.section}>
          <span className={s.label}>Documents</span>
          <div className={s.docs}>
            {n.documents.map((d) => (
              <DocumentTile key={d.id} doc={d} />
            ))}
          </div>
        </div>
      )}

      {canDecide && (
        <div className={s.actions}>
          {n.status === "waiting" ? (
            <button type="button" className={cx(s.btn, s.btnDark, s.btnGrow)} onClick={approve}>
              Approve {n.name}
            </button>
          ) : (
            <Link href={`/admin/ngos/edit?id=${encodeURIComponent(n.id)}`} className={cx(s.btn, s.btnDark, s.btnGrow)}>
              Edit details
            </Link>
          )}
          {n.status === "active" && (
            <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={pause}>
              Pause
            </button>
          )}
          {n.status === "paused" && (
            <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={resume}>
              Resume
            </button>
          )}
          {canRemove && n.status !== "removed" && (
            <button type="button" className={cx(s.btn, s.btnDanger)} onClick={remove}>
              {n.status === "waiting" ? "Decline" : "Remove"}
            </button>
          )}
        </div>
      )}
      {confirmNode}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add an NGO / Edit details (designed)
// ---------------------------------------------------------------------------

const REG_TYPES: NgoRegType[] = ["trust", "society", "section8", "other"];
const REG_TYPE_NAME: Record<NgoRegType, string> = { trust: "Trust", society: "Society", section8: "Section 8 company", other: "Other" };

interface FormState {
  name: string;
  regType: NgoRegType;
  regNo: string;
  since: string;
  has80g: boolean;
  citywide: boolean;
  wards: string[];
  contactName: string;
  publicPhone: string;
  coordinatorEmail: string;
  offers: AdminNgoCreateInput["offers"];
}

const EMPTY: FormState = {
  name: "",
  regType: "trust",
  regNo: "",
  since: "",
  has80g: false,
  citywide: false,
  wards: [],
  contactName: "",
  publicPhone: "",
  coordinatorEmail: "",
  offers: { ambulance: false, shelterBeds: false, sterilisation: false, collars: false },
};

function fromDetail(n: AdminNgoDetail): FormState {
  return {
    name: n.name,
    regType: n.regType,
    regNo: n.regNo,
    since: n.since ? String(n.since) : "",
    has80g: n.has80g,
    citywide: n.citywide,
    wards: n.wards,
    contactName: n.contactName ?? "",
    publicPhone: n.publicPhone ?? "",
    coordinatorEmail: "",
    offers: n.offers,
  };
}

export function NgoFormScreen({ editId }: { editId?: string | null }): React.JSX.Element {
  const existing = useAsync(() => (editId ? api.getAdminNgo(editId) : Promise.resolve(null)), [editId]);
  if (editId && existing.error) return <div className={s.page}><ErrorLine message={existing.error} retry={existing.reload} /></div>;
  if (editId && !existing.data) return <div className={s.page}><Loading what="Opening the NGO" /></div>;
  return <NgoForm key={editId ?? "new"} existing={existing.data ?? null} />;
}

function NgoForm({ existing }: { existing: AdminNgoDetail | null }): React.JSX.Element {
  const router = useRouter();
  const { toast, refreshToday } = useAdmin();
  const { wards } = useWards();
  const [f, setF] = useState<FormState>(existing ? fromDetail(existing) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.name.trim() && f.regNo.trim() && f.contactName.trim() && f.publicPhone.trim() && (f.citywide || f.wards.length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    const input: AdminNgoCreateInput = {
      name: f.name.trim(),
      regType: f.regType,
      regNo: f.regNo.trim(),
      since: f.since ? Number(f.since) : null,
      has80g: f.has80g,
      citywide: f.citywide,
      wards: f.citywide ? [] : f.wards,
      offers: f.offers,
      contactName: f.contactName.trim(),
      publicPhone: f.publicPhone.trim(),
      ...(f.coordinatorEmail.trim() ? { coordinatorEmail: f.coordinatorEmail.trim() } : {}),
    };
    try {
      const saved = existing ? await api.patchAdminNgo(existing.id, input) : await api.createAdminNgo(input);
      toast(existing ? `${saved.name} is saved.` : `${saved.name} is on Hetja.`);
      refreshToday();
      router.push(`/admin/ngos?id=${encodeURIComponent(saved.id)}`);
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  };

  const toggleWard = (id: string) => set("wards", f.wards.includes(id) ? f.wards.filter((w) => w !== id) : [...f.wards, id]);
  const offer = (k: keyof FormState["offers"], label: string) => (
    <label className={s.checkChip}>
      <input type="checkbox" checked={f.offers[k]} onChange={(e) => set("offers", { ...f.offers, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.headText}>
          <Crumbs items={[{ label: "NGOs", href: "/admin/ngos" }, { label: existing ? existing.name : "Add an NGO" }]} />
          <h1 className={s.h1}>{existing ? "Edit details" : "Add an NGO"}</h1>
        </div>
      </header>
      <p className={s.note} style={{ maxWidth: 640 }}>
        {existing
          ? "Changes show on public pages at once: the contact number is public, so rescuers can call it."
          : "For an NGO you have already checked and called. It is active at once: SOS cases in its wards go to it before vets nearby. Its coordinator gets an email to claim it."}
      </p>
      <form className={s.form} onSubmit={submit} aria-label={existing ? "Edit NGO" : "Add an NGO"}>
        <label className={s.field}>
          <span className={s.fieldLabel}>Registered name</span>
          <input className={s.input} value={f.name} onChange={(e) => set("name", e.target.value)} required autoComplete="organization" />
        </label>
        <div className={s.fieldRow}>
          <label className={s.field}>
            <span className={s.fieldLabel}>Registration type</span>
            <select className={s.select} value={f.regType} onChange={(e) => set("regType", e.target.value as NgoRegType)}>
              {REG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REG_TYPE_NAME[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span className={s.fieldLabel}>Registration number</span>
            <input className={s.input} value={f.regNo} onChange={(e) => set("regNo", e.target.value)} placeholder="E-21904 (Mum)" required />
          </label>
        </div>
        <div className={s.fieldRow}>
          <label className={s.field}>
            <span className={s.fieldLabel}>Registered since (year)</span>
            <input className={s.input} inputMode="numeric" value={f.since} onChange={(e) => set("since", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2014" />
          </label>
          <label className={s.checkChip} style={{ alignSelf: "end", height: 40 }}>
            <input type="checkbox" checked={f.has80g} onChange={(e) => set("has80g", e.target.checked)} />
            Has 80G (donations are tax-deductible)
          </label>
        </div>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={s.fieldLabel} style={{ marginBottom: 6 }}>
            Wards they cover
          </legend>
          <label className={s.checkChip} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
            <input type="checkbox" checked={f.citywide} onChange={(e) => set("citywide", e.target.checked)} />
            Citywide: every ward in Mumbai
          </label>
          {!f.citywide && (
            <div className={s.checks}>
              {wards.map((w) => (
                <label key={w.id} className={s.checkChip}>
                  <input type="checkbox" checked={f.wards.includes(w.id)} onChange={() => toggleWard(w.id)} />
                  {w.code}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={s.fieldLabel} style={{ marginBottom: 6 }}>
            What they can offer
          </legend>
          <div className={s.checks}>
            {offer("ambulance", "Ambulance")}
            {offer("shelterBeds", "Shelter beds")}
            {offer("sterilisation", "Sterilisation")}
            {offer("collars", "Collars")}
          </div>
        </fieldset>
        <div className={s.fieldRow}>
          <label className={s.field}>
            <span className={s.fieldLabel}>Contact person</span>
            <input className={s.input} value={f.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Kavita Nair" required />
          </label>
          <label className={s.field}>
            <span className={s.fieldLabel}>Public phone</span>
            <input className={s.input} type="tel" value={f.publicPhone} onChange={(e) => set("publicPhone", e.target.value)} placeholder="+91 98200 12231" required />
          </label>
        </div>
        {!existing && (
          <label className={s.field}>
            <span className={s.fieldLabel}>Coordinator&apos;s email, to invite them</span>
            <input className={s.input} type="email" value={f.coordinatorEmail} onChange={(e) => set("coordinatorEmail", e.target.value)} autoComplete="off" />
            <span className={s.note}>Hetja keeps only a keyed fingerprint of the address, never the address itself.</span>
          </label>
        )}
        {err && (
          <p className={s.error} role="alert">
            {err}
          </p>
        )}
        <div className={s.actionsInline}>
          <button type="submit" className={cx(s.btn, s.btnDark, s.btnWide)} disabled={!ok || busy}>
            {busy ? "Saving…" : existing ? "Save changes" : "Add the NGO"}
          </button>
          <Link href={existing ? `/admin/ngos?id=${encodeURIComponent(existing.id)}` : "/admin/ngos"} className={cx(s.btn, s.btnOutline, s.btnWide)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

