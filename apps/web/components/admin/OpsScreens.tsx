"use client";

/**
 * The designed sections: Feeders (with the D13 moderation tools: suspend
 * account, block device, take down photo, each with a reason and audited),
 * Collars, SOS cases (Assign a vet) and Reports. Same visual language as A2:
 * the list with the selected item open.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  api,
  type AdminCollarRow,
  type AdminFeederRow,
  type AdminReportRow,
  type AdminSosRow,
  type SosOutcome,
  type SosSeverity,
} from "@/lib/api";
import { ago, collarNumber, dogName, fullDate, minutesLabel, phoneLabel, plural, REPORT_KIND_LABEL, reportTab, shortDate, VET_STATUS_LABEL, wardCode, type ReportTab } from "./format";
import {
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

/** Selection for list-with-detail: ?id wins, else the first row; Esc closes. */
function useSelection<R>(rows: R[], key: (r: R) => string): [string | null, (v: string | null) => void] {
  const [picked, setPicked] = useQueryParam("id");
  const [closed, setClosed] = useState(false);
  const selected = picked ?? (closed ? null : rows[0] ? key(rows[0]) : null);
  const select = (v: string | null) => {
    setClosed(v === null);
    setPicked(v);
  };
  useEscape(selected ? () => select(null) : null);
  return [selected, select];
}

// ---------------------------------------------------------------------------
// Feeders
// ---------------------------------------------------------------------------

export function FeedersScreen(): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState("");
  const res = useAsync(() => api.getAdminFeeders(q.trim() || undefined), [q]);
  const { codes } = useWards();
  const columns: Column<AdminFeederRow>[] = [
    { key: "name", label: "Name", width: "24%", cell: (f) => f.name },
    { key: "wards", label: "Wards", width: "18%", cell: (f) => f.wards.map((w) => wardCode(w, codes)).join(", ") },
    { key: "trust", label: "Trust", width: "10%", cell: (f) => f.trust },
    { key: "dogs", label: "Dogs", width: "10%", cell: (f) => f.dogs },
    { key: "feeds", label: "Feeds · 30d", width: "13%", cell: (f) => f.feeds30d },
    { key: "joined", label: "Joined", width: "12%", cell: (f) => shortDate(f.createdAt) },
    { key: "st", label: "Status", cell: (f) => (f.suspended ? <span className={cx(s.pill, s.pillDanger)}>Suspended</span> : "Active") },
  ];
  return (
    <div className={s.page}>
      <header className={s.headText}>
        <h1 className={s.h1}>Feeders</h1>
      </header>
      <div className={s.toolbar} role="search">
        <input className={s.search} type="search" aria-label="Search feeders by name" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className={s.note}>Feeders&apos; contact details never show here, or anywhere: Hetja keeps only a keyed fingerprint of them.</p>
      {res.error ? (
        <ErrorLine message={res.error} retry={res.reload} />
      ) : !res.data ? (
        <Loading what="Loading feeders" />
      ) : (
        <SelectTable
          caption="Feeders"
          columns={columns}
          rows={res.data.feeders}
          rowKey={(f) => f.id}
          selected={null}
          onSelect={(id) => router.push(`/admin/feeders/${encodeURIComponent(id)}`)}
          empty={q ? `No feeder matches “${q}”.` : "No feeders yet."}
        />
      )}
    </div>
  );
}

export function FeederScreen({ id }: { id: string }): React.JSX.Element {
  const res = useAsync(() => api.getAdminFeeder(id), [id]);
  const can = useCan("feeders");
  const { now } = useAdmin();
  const { codes } = useWards();
  const [confirmNode, confirm] = useConfirm();
  if (res.error) return <div className={s.page}><ErrorLine message={res.error} retry={res.reload} /></div>;
  if (!res.data) return <div className={s.page}><Loading what="Opening the feeder" /></div>;
  const f = res.data;

  const suspend = () =>
    confirm(
      {
        title: `Suspend ${f.name}?`,
        body: (
          <>
            {f.name} can still sign in and read, but cannot log feeds, add dogs, raise or answer an SOS, or post photos until you lift it. Their past
            feeds stay. They see the reason you type.
          </>
        ),
        confirm: "Suspend the account",
        reason: { label: "Reason", placeholder: "Posting other people's photos", hint: `${f.name} sees this, and it goes in the audit log.` },
        run: (reason) => api.suspendFeeder(f.id, reason),
        done: `${f.name} is suspended.`,
      },
      res.reload,
    );
  const unsuspend = () =>
    confirm(
      { title: `Lift ${f.name}'s suspension?`, body: <>{f.name} can feed, add dogs and answer SOS again. Written to the audit log.</>, confirm: "Lift it", tone: "dark", run: () => api.unsuspendFeeder(f.id), done: `${f.name} is active again.` },
      res.reload,
    );
  const block = (deviceRef: string, seen: string) =>
    confirm(
      {
        title: "Block this device?",
        body: (
          <>
            The phone last seen {seen} can no longer get a device token, so it cannot log feeds or raise an SOS without an account, even from a new
            one. {f.name}&apos;s account is not suspended by this.
          </>
        ),
        confirm: "Block the device",
        reason: { label: "Reason", placeholder: "Fake SOS reports from this phone", hint: "Written to the audit log." },
        run: (reason) => api.blockDevice({ deviceRef, reason }),
        done: "The device is blocked.",
      },
      res.reload,
    );
  const unblock = (deviceRef: string) =>
    confirm(
      { title: "Unblock this device?", body: <>It can get a device token again and log feeds.</>, confirm: "Unblock", tone: "dark", run: () => api.unblockDevice(deviceRef), done: "The device is unblocked." },
      res.reload,
    );
  const takeDown = (scanId: string, dog: string) =>
    confirm(
      {
        title: "Take this photo down?",
        body: <>It comes off {dog}&apos;s page and the map at once. The feed itself stays on the record.</>,
        confirm: "Take it down",
        reason: { label: "Reason", placeholder: "Shows a person's face", hint: "Written to the audit log." },
        run: (reason) => api.hidePhoto(scanId, reason),
        done: "The photo is down.",
      },
      res.reload,
    );

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.headText}>
          <Crumbs items={[{ label: "Feeders", href: "/admin/feeders" }, { label: f.name }]} />
          <h1 className={s.h1}>{f.name}</h1>
          <span className={s.whoSub}>
            {[f.wards.map((w) => wardCode(w, codes)).join(", "), `joined ${fullDate(f.createdAt)}`, plural(f.dogs, "dog"), `${f.feeds30d} feeds in 30 days`].filter(Boolean).join(" · ")}
          </span>
        </div>
        {f.suspended && <span className={cx(s.pill, s.pillDanger)}>Suspended</span>}
      </header>
      <div className={s.twoCol} style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <div className={s.col}>
          <section className={s.weekCard} aria-labelledby="feeds-h">
            <h2 id="feeds-h" className={s.cardTitle}>
              Recent feeds
            </h2>
            {f.recentFeeds.length ? (
              <ul className={s.inset}>
                {f.recentFeeds.map((r) => (
                  <li key={r.scanId} className={s.insetRow}>
                    <span className={s.cellMain}>
                      {r.photoUrl && !r.hidden ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={s.thumb} src={r.photoUrl} alt={`Photo of ${dogName(r.dog.name)}`} />
                      ) : null}
                      <Link href={`/admin/dogs/${encodeURIComponent(r.dog.slug)}`} className={s.rowLink}>
                        {dogName(r.dog.name)}
                      </Link>
                      <span className={s.muted}>{ago(r.at, now())} ago</span>
                      {r.hidden && <span className={s.pill}>Photo taken down</span>}
                    </span>
                    {can && r.photoUrl && !r.hidden && (
                      <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} style={{ color: "var(--h-sos)" }} onClick={() => takeDown(r.scanId, dogName(r.dog.name))}>
                        Take down photo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.note}>No feeds yet.</p>
            )}
          </section>
          <section className={s.weekCard} aria-labelledby="dogs-h">
            <h2 id="dogs-h" className={s.cardTitle}>
              Dogs · {f.dogList.length}
            </h2>
            <ul className={s.chips}>
              {f.dogList.map((d) => (
                <li key={d.slug}>
                  <Link className={s.chip} href={`/admin/dogs/${encodeURIComponent(d.slug)}`}>
                    {dogName(d.name)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className={s.weekCard} aria-labelledby="trust-h">
            <h2 id="trust-h" className={s.cardTitle}>
              Trust · {f.trust}
            </h2>
            {f.trustEvents.length ? (
              <ol className={s.historyList}>
                {f.trustEvents.map((e, i) => (
                  <li key={i} className={s.historyItem}>
                    <time className={s.muted} dateTime={e.at}>
                      {shortDate(e.at)}
                    </time>
                    <span>
                      <b className={e.delta < 0 ? s.dangerText : s.okText}>{e.delta > 0 ? `+${e.delta}` : e.delta}</b> {e.reason}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={s.note}>No trust changes yet.</p>
            )}
          </section>
        </div>
        <div className={s.col}>
          <section className={s.weekCard} aria-labelledby="acct-h">
            <h2 id="acct-h" className={s.cardTitle}>
              Account
            </h2>
            <Rows
              rows={[
                ["Reports against them", String(f.reportsAgainst)],
                ["Vet", f.vet ? VET_STATUS_LABEL[f.vet.status] : "No"],
                ["NGO", f.ngo ? `${f.ngo.name} · ${f.ngo.role}` : "No"],
                ...(f.suspension
                  ? ([["Suspended", `${shortDate(f.suspension.at)}${f.suspension.byName ? ` by ${f.suspension.byName}` : ""}${f.suspension.reason ? ` · ${f.suspension.reason}` : ""}`]] as [string, string][])
                  : []),
              ]}
            />
            {can && (
              <div className={s.actionsInline}>
                {f.suspended ? (
                  <button type="button" className={cx(s.btn, s.btnMd, s.btnDark)} onClick={unsuspend}>
                    Lift the suspension
                  </button>
                ) : (
                  <button type="button" className={cx(s.btn, s.btnMd, s.btnDanger)} onClick={suspend}>
                    Suspend account
                  </button>
                )}
              </div>
            )}
          </section>
          <section className={s.weekCard} aria-labelledby="dev-h">
            <h2 id="dev-h" className={s.cardTitle}>
              Devices · {f.devices.length}
            </h2>
            <p className={s.note}>Shown by when they were last seen. Hetja never shows a device&apos;s own id.</p>
            <ul className={s.inset}>
              {f.devices.map((d, i) => (
                <li key={d.deviceRef} className={s.insetRow}>
                  <span>
                    Device {i + 1} <span className={s.muted}>· last seen {ago(d.lastSeenAt, now())} ago</span>
                    {d.blocked && <span className={cx(s.pill, s.pillDanger)} style={{ marginLeft: 8 }}>Blocked</span>}
                  </span>
                  {can &&
                    (d.blocked ? (
                      <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={() => unblock(d.deviceRef)}>
                        Unblock
                      </button>
                    ) : (
                      <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} style={{ color: "var(--h-sos)" }} onClick={() => block(d.deviceRef, `${ago(d.lastSeenAt, now())} ago`)}>
                        Block device
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {confirmNode}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collars
// ---------------------------------------------------------------------------

type CollarTab = "all" | "reprints" | "reissues" | "nobatch";

export function CollarsScreen(): React.JSX.Element {
  const [q, setQ] = useState("");
  const [tabParam, setTab] = useQueryParam("tab");
  const tab = (["all", "reprints", "reissues", "nobatch"] as string[]).includes(tabParam ?? "") ? (tabParam as CollarTab) : "all";
  const res = useAsync(() => api.getAdminCollars(q.trim() ? { q: q.trim() } : {}), [q]);
  const { codes } = useWards();
  const all = res.data?.collars ?? [];
  const filt: Record<CollarTab, (c: AdminCollarRow) => boolean> = {
    all: () => true,
    reprints: (c) => c.prints > 1,
    reissues: (c) => c.reissues > 0,
    nobatch: (c) => !c.batchNo,
  };
  const rows = all.filter(filt[tab]);
  const [selected, select] = useSelection(rows, (c) => c.slug);
  const columns: Column<AdminCollarRow>[] = [
    { key: "no", label: "Collar", width: "24%", cell: (c) => collarNumber(c.batchNo, c.code) },
    { key: "dog", label: "Dog", width: "22%", cell: (c) => dogName(c.dogName) },
    { key: "ward", label: "Ward", width: "12%", cell: (c) => wardCode(c.wardId, codes) },
    { key: "issued", label: "Issued", width: "16%", cell: (c) => shortDate(c.issuedAt) },
    { key: "pr", label: "Prints", width: "12%", cell: (c) => c.prints },
    { key: "re", label: "Reissues", cell: (c) => c.reissues },
  ];
  const count = (t: CollarTab) => (res.data ? all.filter(filt[t]).length : "…");
  return (
    <div className={s.split}>
      <div className={s.splitMain}>
        <header className={s.headText}>
          <h1 className={s.h1}>Collars</h1>
        </header>
        <div className={s.toolbar} role="search">
          <input className={s.search} type="search" aria-label="Search collars by number, dog ID or name" placeholder="Search by collar number, dog ID or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Tabs
          label="Collars"
          tabs={[
            { key: "all", label: `Issued · ${count("all")}` },
            { key: "reprints", label: `Reprinted · ${count("reprints")}` },
            { key: "reissues", label: `Reissued · ${count("reissues")}` },
            { key: "nobatch", label: `No batch number · ${count("nobatch")}`, warn: !!res.data && all.some(filt.nobatch) },
          ]}
          value={tab}
          onChange={(k) => setTab(k, { id: null })}
        />
        {res.error ? (
          <ErrorLine message={res.error} retry={res.reload} />
        ) : !res.data ? (
          <Loading what="Loading collars" />
        ) : (
          <SelectTable caption="Collars" columns={columns} rows={rows} rowKey={(c) => c.slug} selected={selected} onSelect={select} empty="No collars here." />
        )}
      </div>
      <aside className={s.aside} aria-label="Collar">
        {selected ? <CollarPanel key={selected} slug={selected} onChanged={res.reload} /> : <p className={s.asideEmpty}>Pick a collar to open it.</p>}
      </aside>
    </div>
  );
}

function CollarPanel({ slug, onChanged }: { slug: string; onChanged: () => void }): React.JSX.Element {
  const res = useAsync(() => api.getAdminCollar(slug), [slug]);
  const can = useCan("collars");
  const { toast } = useAdmin();
  const { codes } = useWards();
  const [batch, setBatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (res.error) return <ErrorLine message={res.error} retry={res.reload} />;
  if (!res.data) return <Loading what="Opening the collar" />;
  const c = res.data;
  const value = batch ?? c.batchNo ?? "";
  const save = async () => {
    setBusy(true);
    try {
      await api.setCollarBatchNo(c.slug, value.trim().toUpperCase());
      toast(`${dogName(c.dogName)}'s collar is ${value.trim().toUpperCase()}.`);
      setBatch(null);
      res.reload();
      onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className={s.whoText}>
        <h2 className={s.whoName}>{collarNumber(c.batchNo, c.code)}</h2>
        <span className={s.whoSub}>
          <Link href={`/admin/dogs/${encodeURIComponent(c.slug)}`} className={s.linkBtn}>
            {dogName(c.dogName)}
          </Link>{" "}
          · {wardCode(c.wardId, codes)} · dog ID {c.code}
        </span>
      </div>
      <Rows
        rows={[
          ["Issued", fullDate(c.issuedAt)],
          ["Material", c.material],
          ["Status", c.status],
        ]}
      />
      {can && (
        <form
          className={s.field}
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && value.trim().toUpperCase() !== c.batchNo) save();
          }}
        >
          <span className={s.fieldLabel}>Batch number, as printed on the tag</span>
          <div className={s.actionsInline}>
            <input className={s.input} style={{ width: 180 }} value={value} placeholder="HJ-0412" onChange={(e) => setBatch(e.target.value)} aria-label="Batch number" />
            <button type="submit" className={cx(s.btn, s.btnXs, s.btnDark)} disabled={busy || !value.trim() || value.trim().toUpperCase() === c.batchNo}>
              Save
            </button>
          </div>
          <span className={s.note}>Avatar files named with it match this dog (A3).</span>
        </form>
      )}
      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>Prints · {c.printList.length}</span>
        <ul className={s.inset}>
          {c.printList.map((p, i) => (
            <li key={i} className={s.insetRow}>
              <span>{fullDate(p.at)}</span>
              <span className={s.muted}>
                {p.layout} · {p.paper.toUpperCase()} · {plural(p.tagCount, "tag")}
                {p.byName ? ` · ${p.byName}` : ""}
              </span>
            </li>
          ))}
          {!c.printList.length && <li className={s.insetRow}>Not printed yet.</li>}
        </ul>
      </div>
      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>Reissues · {c.reissueList.length}</span>
        {c.reissueList.length ? (
          <ul className={s.inset}>
            {c.reissueList.map((r, i) => (
              <li key={i} className={s.insetRow} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span>
                  {fullDate(r.at)}: {r.previousBatchNo} to {r.newBatchNo}
                </span>
                <span className={s.muted}>
                  {r.reason ?? "No reason given"}
                  {r.byName ? ` · ${r.byName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.note}>Never reissued.</p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SOS cases
// ---------------------------------------------------------------------------

type SosTab = "open" | "unassigned" | "escalated" | "closed";
const SOS_TABS: SosTab[] = ["open", "unassigned", "escalated", "closed"];
const SOS_TAB_LABEL: Record<SosTab, string> = { open: "Open", unassigned: "Unassigned", escalated: "Escalated", closed: "Closed" };
const SEVERITY_LABEL: Record<SosSeverity, string> = { minor: "Minor", serious: "Serious", critical: "Critical" };
const OUTCOMES: { value: SosOutcome; title: string; detail: string }[] = [
  { value: "taken_to_vet", title: "Taken to a vet", detail: "The dog is with a vet or clinic." },
  { value: "treated_on_spot", title: "Treated on the spot", detail: "Someone treated the dog where it was." },
  { value: "not_found", title: "Not found", detail: "Nobody could find the dog." },
  { value: "died", title: "The dog died", detail: "Feeders of the dog are told gently." },
  { value: "false_alarm", title: "False alarm", detail: "The dog was fine, or it was not a real case." },
];

export function SosScreen(): React.JSX.Element {
  const [tabParam, setTab] = useQueryParam("tab");
  const tab = (SOS_TABS as string[]).includes(tabParam ?? "") ? (tabParam as SosTab) : "open";
  const res = useAsync(() => api.getAdminSos(tab), [tab]);
  const { now } = useAdmin();
  const rows = res.data?.cases ?? [];
  const [selected, select] = useSelection(rows, (c) => c.id);
  const columns: Column<AdminSosRow>[] = [
    { key: "dog", label: "Dog", width: "22%", cell: (c) => dogName(c.dog?.name) },
    { key: "ward", label: "Ward", width: "11%", cell: (c) => c.wardCode ?? "" },
    { key: "sev", label: "Severity", width: "14%", cell: (c) => <span className={c.severity === "critical" ? s.dangerText : undefined}>{SEVERITY_LABEL[c.severity]}</span> },
    { key: "open", label: "Opened", width: "14%", cell: (c) => `${ago(c.openedAt, now())} ago` },
    {
      key: "who",
      label: "Who's going",
      cell: (c) =>
        c.responder ?? c.assignedVet?.name ?? (c.unassignedMin !== null ? <span className={s.dangerText}>Nobody for {minutesLabel(c.unassignedMin)}</span> : c.state === "resolved" || c.state === "false_alarm" ? "Closed" : "Nobody yet"),
    },
  ];
  return (
    <div className={s.split}>
      <div className={s.splitMain}>
        <header className={s.headText}>
          <h1 className={s.h1}>SOS cases</h1>
        </header>
        <Tabs label="SOS cases" tabs={SOS_TABS.map((k) => ({ key: k, label: SOS_TAB_LABEL[k] }))} value={tab} onChange={(k) => setTab(k, { id: null })} />
        {res.error ? (
          <ErrorLine message={res.error} retry={res.reload} />
        ) : !res.data ? (
          <Loading what="Loading cases" />
        ) : (
          <SelectTable caption={`${SOS_TAB_LABEL[tab]} SOS cases`} columns={columns} rows={rows} rowKey={(c) => c.id} selected={selected} onSelect={select} empty={`No ${SOS_TAB_LABEL[tab].toLowerCase()} cases.`} />
        )}
        <p className={s.note}>
          Cases go to feeders nearby first, then the NGO covering the ward, then every vet nearby once 15 minutes pass with nobody accepting. You
          can assign a vet at any time.
        </p>
      </div>
      <aside className={s.aside} aria-label="SOS case">
        {selected ? <SosPanel key={selected} id={selected} onChanged={res.reload} /> : <p className={s.asideEmpty}>Pick a case to open it.</p>}
      </aside>
    </div>
  );
}

const TIMELINE_TEXT: Record<string, (d: string | null) => string> = {
  raised: (d) => `${d ?? "Someone"} raised it`,
  told: (d) => `Told ${d ?? "people nearby"}`,
  escalation_due: () => "Due to open to every vet nearby",
  escalated: (d) => `Opened to every vet nearby${d ? `: ${d}` : ""}`,
};

function SosPanel({ id, onChanged }: { id: string; onChanged: () => void }): React.JSX.Element {
  const res = useAsync(() => api.getAdminSosCase(id), [id]);
  const vets = useAsync(() => api.getAssignableVets(id), [id]);
  const can = useCan("sos");
  const { now, refreshToday } = useAdmin();
  const { codes } = useWards();
  const [confirmNode, confirm] = useConfirm();
  if (res.error) return <ErrorLine message={res.error} retry={res.reload} />;
  if (!res.data) return <Loading what="Opening the case" />;
  const c = res.data;
  const name = dogName(c.dog?.name);
  const closed = c.state === "resolved" || c.state === "false_alarm";
  const after = () => {
    res.reload();
    onChanged();
    refreshToday();
  };
  const assign = (vetId: string, vetName: string, phone: string | null) =>
    confirm(
      {
        title: `Assign ${vetName} to ${name}?`,
        body: (
          <>
            {vetName} gets a push now{phone ? ` (and you can call ${phone})` : ""}. Their “I&apos;m going” takes the case, and {c.raisedBy ?? "whoever raised it"} sees who is coming. Everyone
            already told keeps the case until someone takes it.
          </>
        ),
        confirm: `Assign ${vetName}`,
        tone: "dark",
        run: () => api.assignVet(c.id, vetId),
        done: `${vetName} was paged for ${name}.`,
      },
      after,
    );
  const resolve = () =>
    confirm(
      {
        title: `Close ${name}'s SOS?`,
        body: <>The case stops paging anyone. Everyone told is told it is closed, with the outcome you choose.</>,
        confirm: "Close the case",
        choices: { label: "What happened", initial: "taken_to_vet", options: OUTCOMES.map((o) => ({ value: o.value, title: o.title, detail: o.detail })) },
        reason: { label: "Note", placeholder: "Dr. Qureshi took him to Paws Clinic", required: false },
        run: (note, outcome) => api.resolveAdminSos(c.id, { outcome: outcome as SosOutcome, ...(note ? { resolution: note } : {}) }),
        done: "The case is closed.",
      },
      after,
    );

  return (
    <>
      <div className={s.whoText}>
        <h2 className={s.whoName}>
          {c.dog ? (
            <Link href={`/admin/dogs/${encodeURIComponent(c.dog.slug)}`} style={{ color: "inherit" }}>
              {name}
            </Link>
          ) : (
            name
          )}
        </h2>
        <span className={s.whoSub}>
          {[SEVERITY_LABEL[c.severity], wardCode(c.wardId, codes), `raised by ${c.raisedBy ?? "a passer-by"} ${ago(c.openedAt, now())} ago`].filter(Boolean).join(" · ")}
        </span>
      </div>
      {c.note && <p style={{ fontSize: 15 }}>“{c.note}”</p>}
      {c.unassignedMin !== null && !closed && (
        <div className={cx(s.check, s.checkBad)}>
          <span className={s.checkTitle}>Nobody has accepted for {minutesLabel(c.unassignedMin)}</span>
        </div>
      )}
      <Rows
        rows={[
          ["Told", `${plural(c.told.feeders, "feeder")}, ${plural(c.told.vets, "vet")}, ${plural(c.told.ngos, "NGO")}`],
          ["NGO for the ward", c.ngo?.name ?? "None"],
          ["Who's going", c.responder ?? c.assignedVet?.name ?? "Nobody yet"],
        ]}
      />
      {c.dispatches.length > 0 && (
        <div className={cx(s.section, s.section8)}>
          <span className={s.label}>Sent</span>
          <ul className={s.inset}>
            {c.dispatches.map((d) => (
              <li key={d.id} className={s.insetRow}>
                <span>{d.memberName}{d.withAmbulance ? " + ambulance" : ""}</span>
                <span className={d.acceptedAt ? s.okText : d.declinedAt ? s.muted : s.warnText}>{d.acceptedAt ? "✓ Going" : d.declinedAt ? "Can't" : `Paged ${ago(d.sentAt, now())} ago`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {can && !closed && (
        <div className={cx(s.section, s.section8)}>
          <span className={s.label}>Assign a vet</span>
          {vets.error ? (
            <ErrorLine message={vets.error} retry={vets.reload} />
          ) : !vets.data ? (
            <Loading what="Finding vets" />
          ) : vets.data.vets.length ? (
            <ul className={s.inset}>
              {vets.data.vets.map((v) => (
                <li key={v.feederId} className={s.insetRow}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{v.name}</span>
                    <span className={s.muted} style={{ fontSize: 13 }}>
                      {[v.regLabel, v.coversWard ? "covers this ward" : "other wards", v.inHours ? "in SOS hours" : "outside SOS hours", phoneLabel(v.publicPhone)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <button type="button" className={cx(s.btn, s.btnXs, v.coversWard && v.inHours ? s.btnDark : s.btnQuiet)} onClick={() => assign(v.feederId, v.name, v.publicPhone ? phoneLabel(v.publicPhone) : null)}>
                    Assign<span className="h-sr-only"> {v.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.note}>No verified vet can take SOS calls right now. Call the ward&apos;s NGO or a government hospital.</p>
          )}
        </div>
      )}
      <div className={cx(s.section, s.section8)}>
        <span className={s.label}>Timeline</span>
        <ol className={s.historyList}>
          {c.timeline.map((t, i) => (
            <li key={i} className={s.historyItem} style={{ gridTemplateColumns: "60px 1fr" }}>
              <time className={s.muted} dateTime={t.at}>
                {ago(t.at, now())}
              </time>
              <span>{(TIMELINE_TEXT[t.kind] ?? ((d: string | null) => `${t.kind.replace(/_/g, " ")}${d ? `: ${d}` : ""}`))(t.detail)}</span>
            </li>
          ))}
        </ol>
      </div>
      {can && !closed && (
        <div className={s.actions}>
          <button type="button" className={cx(s.btn, s.btnOutline, s.btnGrow)} onClick={resolve}>
            Close the case
          </button>
        </div>
      )}
      {confirmNode}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const REPORT_TABS: { key: ReportTab | "other"; label: string }[] = [
  { key: "duplicates", label: "Duplicates" },
  { key: "photos", label: "Photos" },
  { key: "tags", label: "Tag reports" },
  { key: "fake", label: "Fake tags" },
  { key: "other", label: "Other" },
];

export function ReportsScreen(): React.JSX.Element {
  const [tabParam, setTab] = useQueryParam("tab");
  const [statusParam, setStatus] = useQueryParam("status");
  const status = statusParam === "resolved" ? "resolved" : "open";
  const res = useAsync(() => api.getAdminReports(status), [status]);
  const { now } = useAdmin();
  const all = res.data?.reports ?? [];
  const [picked] = useQueryParam("id");
  const pickedRow = picked ? all.find((r) => r.id === picked) : undefined;
  const tab = pickedRow ? reportTab(pickedRow) : ((REPORT_TABS.map((t) => t.key) as string[]).includes(tabParam ?? "") ? (tabParam as ReportTab | "other") : "duplicates");
  const rows = all.filter((r) => reportTab(r) === tab);
  const [selected, select] = useSelection(rows, (r) => r.id);
  const columns: Column<AdminReportRow>[] = [
    { key: "what", label: "What", width: "28%", cell: (r) => REPORT_KIND_LABEL[r.kind] },
    { key: "dog", label: "Dog", width: "26%", cell: (r) => (r.otherDog ? `${dogName(r.dog.name)} and ${dogName(r.otherDog.name)}` : dogName(r.dog.name)) },
    { key: "by", label: "Reported by", width: "22%", cell: (r) => r.reporter ?? "A passer-by" },
    { key: "when", label: "When", cell: (r) => `${ago(r.createdAt, now())} ago` },
  ];
  return (
    <div className={s.split}>
      <div className={s.splitMain}>
        <header className={cx(s.head, s.headCenter)}>
          <h1 className={s.h1}>Reports</h1>
          <button type="button" className={s.linkBtn} onClick={() => setStatus(status === "open" ? "resolved" : null, { id: null })}>
            {status === "open" ? "Show resolved" : "Show open"}
          </button>
        </header>
        <Tabs
          label="Reports by kind"
          tabs={REPORT_TABS.map((t) => ({ key: t.key, label: `${t.label} · ${res.data ? all.filter((r) => reportTab(r) === t.key).length : "…"}` }))}
          value={tab}
          onChange={(k) => setTab(k, { id: null })}
        />
        {res.error ? (
          <ErrorLine message={res.error} retry={res.reload} />
        ) : !res.data ? (
          <Loading what="Loading reports" />
        ) : (
          <SelectTable caption="Reports" columns={columns} rows={rows} rowKey={(r) => r.id} selected={selected} onSelect={select} empty={status === "open" ? "Nothing reported here." : "Nothing resolved here yet."} />
        )}
      </div>
      <aside className={s.aside} aria-label="Report">
        {selected && all.find((r) => r.id === selected) ? (
          <ReportPanel key={selected} report={all.find((r) => r.id === selected)!} onChanged={res.reload} />
        ) : (
          <p className={s.asideEmpty}>Pick a report to open it.</p>
        )}
      </aside>
    </div>
  );
}

function ReportPanel({ report: r, onChanged }: { report: AdminReportRow; onChanged: () => void }): React.JSX.Element {
  const can = useCan("reports");
  const canMerge = useCan("merge");
  const { now, refreshToday } = useAdmin();
  const [confirmNode, confirm] = useConfirm();
  const name = dogName(r.dog.name);
  const after = () => {
    onChanged();
    refreshToday();
  };
  const close = (outcome: "different" | "photo_removed" | "no_action" | "fixed", title: string, body: string) =>
    confirm(
      {
        title,
        body: <>{body}</>,
        confirm: "Close the report",
        tone: "dark",
        reason: { label: "Note", placeholder: "Checked the photo: no face in it", required: false, hint: `Written to the audit log${r.reporter ? `; ${r.reporter} is told it was looked at` : ""}.` },
        run: (note) => api.resolveReport(r.id, { outcome, ...(note ? { note } : {}) }),
        done: "Report closed.",
      },
      after,
    );
  const open = r.status === "open";
  return (
    <>
      <div className={s.whoText}>
        <span className={s.eyebrow}>{REPORT_KIND_LABEL[r.kind]}</span>
        <h2 className={s.whoName}>{r.otherDog ? `${name} and ${dogName(r.otherDog.name)}` : name}</h2>
        <span className={s.whoSub}>
          Reported by {r.reporter ?? "a passer-by"} {ago(r.createdAt, now())} ago
        </span>
      </div>
      {r.note && <p style={{ fontSize: 15, lineHeight: 1.45 }}>“{r.note}”</p>}
      {r.dog.photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.dog.photoUrl} alt={`${name}'s photo`} style={{ width: "100%", borderRadius: 14 }} />
      )}
      {!open && (
        <p className={s.note}>
          <span className={cx(s.pill, s.pillOk)}>Resolved</span> {r.outcome ?? ""}
        </p>
      )}
      <p className={s.actionsInline} style={{ gap: 16 }}>
        <Link className={s.linkBtn} href={`/admin/dogs/${encodeURIComponent(r.dog.slug)}`}>
          Open {name} ›
        </Link>
        {r.otherDog && (
          <Link className={s.linkBtn} href={`/admin/dogs/${encodeURIComponent(r.otherDog.slug)}`}>
            Open {dogName(r.otherDog.name)} ›
          </Link>
        )}
      </p>
      {open && r.kind === "duplicate_dog" && r.otherDog && canMerge && (
        <div className={s.actions}>
          <Link
            href={`/admin/merge?a=${encodeURIComponent(r.dog.slug)}&b=${encodeURIComponent(r.otherDog.slug)}&report=${encodeURIComponent(r.id)}`}
            className={cx(s.btn, s.btnDark, s.btnGrow)}
          >
            Compare
          </Link>
        </div>
      )}
      {open && r.kind === "photo" && can && (
        <>
          <p className={s.note}>Take the photo down from {name}&apos;s page (under Photos), then close the report here.</p>
          <div className={s.actions}>
            <Link href={`/admin/dogs/${encodeURIComponent(r.dog.slug)}`} className={cx(s.btn, s.btnDark, s.btnGrow)}>
              Open {name}&apos;s photos
            </Link>
            <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => close("photo_removed", "Close as taken down?", `You took the reported photo off ${name}'s page.`)}>
              Taken down
            </button>
            <button type="button" className={cx(s.btn, s.btnOutline)} onClick={() => close("no_action", "Keep the photo?", `The photo stays on ${name}'s page.`)}>
              It&apos;s fine
            </button>
          </div>
        </>
      )}
      {open && r.source === "tag" && (
        <p className={s.note}>
          Tag reports close from the dog: reissue the collar, or clear the tag, from {name}&apos;s page. A tag on the wrong dog may be a fake: check the
          collar number against the photo.
        </p>
      )}
      {open && r.source === "report" && r.kind === "other" && can && (
        <div className={s.actions}>
          <button type="button" className={cx(s.btn, s.btnDark, s.btnGrow)} onClick={() => close("fixed", "Close as fixed?", "You fixed what was reported.")}>
            Fixed
          </button>
          <button type="button" className={cx(s.btn, s.btnOutline)} onClick={() => close("no_action", "Close with no change?", "Nothing needed changing.")}>
            No change needed
          </button>
        </div>
      )}
      {confirmNode}
    </>
  );
}

