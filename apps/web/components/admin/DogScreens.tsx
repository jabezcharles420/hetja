"use client";

/**
 * Dogs (designed): search, and one dog with its history, photos, avatar,
 * collar, status, feeders and a way to merge it. A5 Merge duplicate dogs,
 * opened from Reports, Today or a dog.
 *
 * A merged dog's link redirects to the kept dog; its scans and medical
 * records are read with the kept dog's. The ledger is never rewritten.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type AdminDogDetail, type AdminDogRow } from "@/lib/api";
import { ago, collarNumber, dateLabel, dogName, fullDate, monthLabel, plural, shortDate, wardCode } from "./format";
import { Crumbs, cx, ErrorLine, Loading, SelectTable, styles as s, useAdmin, useAsync, useCan, useConfirm, useWards, type Column } from "./ui";

const STATUSES = ["active", "lost", "adopted", "deceased", "relocated"] as const;
type DogStatusValue = (typeof STATUSES)[number];
const STATUS_LABEL: Record<string, string> = {
  active: "On the street",
  lost: "Not seen",
  adopted: "Adopted",
  deceased: "Passed away",
  relocated: "Relocated",
  pending_activation: "Waiting for collar",
};

function Thumb({ url, name }: { url: string | null; name: string }): React.JSX.Element {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className={s.thumb} src={url} alt="" /> : <span className={s.thumb} aria-hidden="true" title={name} />;
}

// ---------------------------------------------------------------------------
// Dogs list
// ---------------------------------------------------------------------------

export function DogsScreen(): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { now } = useAdmin();
  const res = useAsync(() => api.getAdminDogs({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}) }), [q, status]);
  const columns: Column<AdminDogRow>[] = [
    {
      key: "name",
      label: "Name",
      width: "26%",
      cell: (d) => (
        <span className={s.cellMain}>
          <Thumb url={d.avatarUrl ?? d.photoUrl} name={dogName(d.name)} />
          {dogName(d.name)}
        </span>
      ),
    },
    { key: "ward", label: "Ward", width: "10%", cell: (d) => d.wardCode },
    { key: "collar", label: "Collar", width: "17%", cell: (d) => (d.collar ? collarNumber(d.collar.batchNo, d.collar.code) : <span className={s.muted}>No collar</span>) },
    { key: "status", label: "Status", width: "15%", cell: (d) => STATUS_LABEL[d.status] ?? d.status },
    { key: "feeders", label: "Feeders", width: "10%", cell: (d) => d.feeders },
    { key: "fed", label: "Last fed", width: "12%", cell: (d) => (d.lastFedAt ? `${ago(d.lastFedAt, now())} ago` : "Never") },
    { key: "added", label: "Added", cell: (d) => shortDate(d.createdAt) },
  ];
  return (
    <div className={s.page}>
      <header className={s.headText}>
        <h1 className={s.h1}>Dogs</h1>
      </header>
      <div className={s.toolbar} role="search">
        <input
          className={s.search}
          type="search"
          aria-label="Search dogs by name, dog ID or collar number"
          placeholder="Search by name, dog ID or collar number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={s.select} style={{ width: 200 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Every status</option>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
      </div>
      {res.error ? (
        <ErrorLine message={res.error} retry={res.reload} />
      ) : !res.data ? (
        <Loading what="Loading dogs" />
      ) : (
        <SelectTable
          caption="Dogs"
          columns={columns}
          rows={res.data.dogs}
          rowKey={(d) => d.slug}
          selected={null}
          onSelect={(slug) => router.push(`/admin/dogs/${encodeURIComponent(slug)}`)}
          empty={q ? `No dog matches “${q}”.` : "No dogs yet."}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One dog
// ---------------------------------------------------------------------------

function signedCount(d: AdminDogDetail): number {
  return d.health.records.filter((r) => r.status === "vet_signed" && !r.withdrawnAt && r.type !== "withdrawal").length;
}

/** The dog's history, newest first, from what the detail carries. */
export function dogHistory(d: AdminDogDetail): { at: string; text: string }[] {
  const items: { at: string; text: string }[] = [];
  if (d.registeredAt) items.push({ at: d.registeredAt, text: `Added${d.registeredBy ? ` by ${d.registeredBy.name}` : ""}` });
  for (const r of d.health.records) {
    if (r.type === "withdrawal") continue;
    const who = r.status === "vet_signed" ? (r.vet?.name ?? "A vet") : (r.addedBy ?? "A feeder");
    const verb = r.status === "vet_signed" ? "signed" : "noted";
    const extra = [r.brand, r.batch].filter(Boolean).join(" ");
    items.push({ at: r.recordedAt, text: `${who} ${verb} ${r.title.toLowerCase()}${extra ? `, ${extra}` : ""}${r.withdrawnAt ? " (withdrawn)" : ""}` });
  }
  for (const m of d.mergedFrom) items.push({ at: m.mergedAt, text: `${dogName(m.name)} was merged into this dog` });
  for (const c of d.sos) items.push({ at: c.openedAt, text: `SOS raised (${c.severity}), ${c.state === "resolved" ? "resolved" : c.state}` });
  if (d.avatar.current?.publishedAt) items.push({ at: d.avatar.current.publishedAt, text: "Avatar published" });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function DogScreen({ slug }: { slug: string }): React.JSX.Element {
  const router = useRouter();
  const res = useAsync(() => api.getAdminDog(slug), [slug]);
  const canMerge = useCan("merge");
  const canPhotos = useCan("feeders");
  const { codes } = useWards();
  const { now } = useAdmin();
  const [confirmNode, confirm] = useConfirm();
  const [status, setStatus] = useState<DogStatusValue | "">("");
  const [other, setOther] = useState("");

  if (res.error) return <div className={s.page}><ErrorLine message={res.error} retry={res.reload} /></div>;
  if (!res.data) return <div className={s.page}><Loading what="Opening the dog" /></div>;
  const d = res.data;
  const name = dogName(d.name);
  if (d.mergedInto) {
    return (
      <div className={s.page}>
        <Crumbs items={[{ label: "Dogs", href: "/admin/dogs" }, { label: name }]} />
        <h1 className={s.h1}>{name} was merged</h1>
        <p className={s.note}>
          This dog&apos;s link now redirects to{" "}
          <Link className={s.linkBtn} href={`/admin/dogs/${encodeURIComponent(d.mergedInto.slug)}`}>
            {dogName(d.mergedInto.name)}
          </Link>
          .
        </p>
      </div>
    );
  }
  const signed = signedCount(d);
  const changeStatus = () => {
    if (!status || status === d.status) return;
    confirm(
      {
        title: `Mark ${name} as ${STATUS_LABEL[status].toLowerCase()}?`,
        body: (
          <>
            {name}&apos;s page and map pin show “{STATUS_LABEL[status]}” at once, and {plural(d.feederList.length, "feeder")} {d.feederList.length === 1 ? "is" : "are"} told.
            {status !== "active" ? " The collar stops asking strangers to log a feed." : ""}
          </>
        ),
        confirm: "Change status",
        reason: { label: "Reason", placeholder: "Adopted by a family in Powai, confirmed by Priya", hint: "Written to the audit log." },
        run: (reason) => api.setAdminDogStatus(d.slug, status, reason),
        done: `${name} is marked ${STATUS_LABEL[status].toLowerCase()}.`,
      },
      res.reload,
    );
  };
  const takeDown = (scanId: string, by: string | null) =>
    confirm(
      {
        title: "Take this photo down?",
        body: <>It comes off {name}&apos;s page and the map at once. The feed it came with stays, and so does {by ?? "the feeder"}&apos;s account.</>,
        confirm: "Take it down",
        reason: { label: "Reason", placeholder: "Shows a person's face", hint: "Written to the audit log." },
        run: (reason) => api.hidePhoto(scanId, reason),
        done: "The photo is down.",
      },
      res.reload,
    );
  const restore = (id: string) =>
    confirm(
      {
        title: "Put this avatar back?",
        body: <>It replaces {name}&apos;s current avatar on pins, lists, share cards and collar sheets. The current one can be put back the same way for 30 days.</>,
        confirm: "Put it back",
        tone: "dark",
        run: () => api.restoreAvatar(id),
        done: "The old avatar is back.",
      },
      res.reload,
    );
  const photo = d.photos.find((p) => !p.hidden);
  const history = dogHistory(d);
  const restorable = d.avatar.history.filter((a) => a.status === "retired" && a.restorableUntil && new Date(a.restorableUntil) > new Date());

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.who}>
          {photo?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.whoPic} src={photo.url} alt="" />
          ) : (
            <span className={s.whoPic} aria-hidden="true">
              {name[0]}
            </span>
          )}
          <div className={s.whoText}>
            <Crumbs items={[{ label: "Dogs", href: "/admin/dogs" }, { label: name }]} />
            <h1 className={s.h1}>{name}</h1>
            <span className={s.whoSub}>
              {[
                wardCode(d.wardId, codes),
                d.sex,
                d.registeredAt ? `added ${fullDate(d.registeredAt)}${d.registeredBy ? ` by ${d.registeredBy.name}` : ""}` : null,
                `${d.feedsTotal} feeds`,
                signed ? plural(signed, "signed record") : "no signed records",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
        <Link href={`/dog/${encodeURIComponent(d.slug)}`} className={cx(s.btn, s.btnMd, s.btnOutline)} target="_blank" rel="noreferrer">
          Open the public page ↗
        </Link>
      </header>

      <div className={s.twoCol} style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className={s.col}>
          <section className={s.weekCard} aria-labelledby="photos-h">
            <h2 id="photos-h" className={s.cardTitle}>
              Photos
            </h2>
            {d.photos.length ? (
              <ul className={s.photoStrip}>
                {d.photos.map((p) => (
                  <li key={p.scanId} className={s.photoCell}>
                    {p.hidden ? (
                      <span className={s.photoGone}>Taken down</span>
                    ) : p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={`${name}, ${shortDate(p.at)}`} />
                    ) : (
                      <span className={s.photoGone}>Photo</span>
                    )}
                    <span>
                      {p.byName ?? "A feeder"}, {shortDate(p.at)}
                    </span>
                    {!p.hidden && canPhotos && (
                      <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} style={{ alignSelf: "flex-start", color: "var(--h-sos)" }} onClick={() => takeDown(p.scanId, p.byName)}>
                        Take down
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.note}>No photos yet.</p>
            )}
          </section>

          <section className={s.weekCard} aria-labelledby="health-h">
            <h2 id="health-h" className={s.cardTitle}>
              Health
            </h2>
            {d.health.records.filter((r) => r.type !== "withdrawal").length ? (
              <ul className={s.inset}>
                {d.health.records
                  .filter((r) => r.type !== "withdrawal")
                  .map((r) => (
                    <li key={r.id} className={s.insetRow}>
                      <span style={{ textDecoration: r.withdrawnAt ? "line-through" : undefined }}>
                        <b>{r.title}</b>{" "}
                        <span className={s.muted}>
                          · {monthLabel(r.date)}
                          {r.vet ? ` · ${r.vet.name}${r.vet.regNo ? ` · ${r.vet.council ?? ""} ${r.vet.regNo}` : ""}` : r.addedBy ? ` · added by ${r.addedBy}` : ""}
                        </span>
                      </span>
                      <span className={cx(s.pill, r.status === "vet_signed" ? (r.flagged ? s.pillWarn : s.pillOk) : undefined)}>
                        {r.status === "vet_signed" ? (r.flagged ? "Needs re-check" : "✓ Vet signed") : "Feeder noted"}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={s.note}>No health records yet.</p>
            )}
          </section>

          <section className={s.weekCard} aria-labelledby="history-h">
            <h2 id="history-h" className={s.cardTitle}>
              History
            </h2>
            <ol className={s.historyList}>
              {history.map((h, i) => (
                <li key={i} className={s.historyItem}>
                  <time className={s.muted} dateTime={h.at}>
                    {dateLabel(h.at, now())}
                  </time>
                  <span>{h.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className={s.col}>
          <section className={s.weekCard} aria-labelledby="status-h">
            <h2 id="status-h" className={s.cardTitle}>
              Status
            </h2>
            <p style={{ fontSize: 15 }}>
              {STATUS_LABEL[d.status] ?? d.status}
              {d.tagUnderReview && <span className={cx(s.pill, s.pillWarn)} style={{ marginLeft: 8 }}>Tag under review</span>}
            </p>
            {canMerge && (
              <div className={s.actionsInline}>
                <select className={s.select} style={{ width: 200 }} aria-label={`New status for ${name}`} value={status} onChange={(e) => setStatus(e.target.value as DogStatusValue)}>
                  <option value="">Change to…</option>
                  {STATUSES.filter((x) => x !== d.status).map((x) => (
                    <option key={x} value={x}>
                      {STATUS_LABEL[x]}
                    </option>
                  ))}
                </select>
                <button type="button" className={cx(s.btn, s.btnXs, s.btnDark)} disabled={!status} onClick={changeStatus}>
                  Change status
                </button>
              </div>
            )}
          </section>

          <section className={s.weekCard} aria-labelledby="collar-h">
            <h2 id="collar-h" className={s.cardTitle}>
              Collar
            </h2>
            {d.collar ? (
              <dl className={s.kvList}>
                <div className={s.kv}>
                  <dt>Number</dt>
                  <dd>{collarNumber(d.collar.batchNo, d.collar.code)}</dd>
                </div>
                <div className={s.kv}>
                  <dt>Dog ID</dt>
                  <dd>{d.slug}</dd>
                </div>
                <div className={s.kv}>
                  <dt>Prints and reissues</dt>
                  <dd>
                    <Link className={s.linkBtn} href={`/admin/collars?id=${encodeURIComponent(d.slug)}`}>
                      Open in Collars ›
                    </Link>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className={s.note}>No collar yet.</p>
            )}
          </section>

          <section className={s.weekCard} aria-labelledby="avatar-h">
            <h2 id="avatar-h" className={s.cardTitle}>
              Avatar
            </h2>
            {d.avatar.current ? (
              <div className={s.cellMain}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {d.avatar.current.imageUrl ? <img className={cx(s.pin, s.pin52)} src={d.avatar.current.imageUrl} alt={`${name}'s avatar`} /> : <span className={cx(s.pin, s.pin52)} aria-hidden="true" />}
                <span className={s.note}>Published {d.avatar.current.publishedAt ? fullDate(d.avatar.current.publishedAt) : ""}. The real photo stays on the page.</span>
              </div>
            ) : (
              <p className={s.note}>No avatar. Pins and lists use the photo.</p>
            )}
            {restorable.map((a) => (
              <div key={a.id} className={s.row} style={{ fontSize: 14 }}>
                <span className={s.muted}>Previous, until {fullDate(a.restorableUntil!)}</span>
                <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={() => restore(a.id)}>
                  Put it back
                </button>
              </div>
            ))}
          </section>

          <section className={s.weekCard} aria-labelledby="feeders-h">
            <h2 id="feeders-h" className={s.cardTitle}>
              Feeders · {d.feederList.length}
            </h2>
            {d.feederList.length ? (
              <ul className={s.inset}>
                {d.feederList.map((f) => (
                  <li key={f.feederId} className={s.insetRow}>
                    <Link href={`/admin/feeders/${encodeURIComponent(f.feederId)}`} className={s.linkBtn} style={{ color: "var(--h-ink)" }}>
                      {f.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.note}>Nobody feeds {name} yet.</p>
            )}
          </section>

          {canMerge && (
            <section className={s.weekCard} aria-labelledby="merge-h">
              <h2 id="merge-h" className={s.cardTitle}>
                Merge
              </h2>
              <p className={s.note}>Same dog added twice? Put the other dog&apos;s ID and compare them side by side first.</p>
              <form
                className={s.actionsInline}
                onSubmit={(e) => {
                  e.preventDefault();
                  const o = other.trim().toLowerCase().replace(/[\s-]/g, "");
                  if (o && o !== d.slug) router.push(`/admin/merge?a=${encodeURIComponent(d.slug)}&b=${encodeURIComponent(o)}`);
                }}
              >
                <input className={s.input} style={{ width: 180 }} aria-label="The other dog's ID" placeholder="k3au8mn2p" value={other} onChange={(e) => setOther(e.target.value)} />
                <button type="submit" className={cx(s.btn, s.btnXs, s.btnQuiet)} disabled={!other.trim()}>
                  Compare
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
      {confirmNode}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A5
// ---------------------------------------------------------------------------

export function mergeMeta(d: AdminDogDetail): string {
  const bits = [
    `Added ${shortDate(d.registeredAt ?? d.createdAt)}${d.registeredBy ? ` by ${d.registeredBy.name}` : ""}`,
    d.collar ? `collar ${collarNumber(d.collar.batchNo, d.collar.code)}` : "no collar",
    plural(d.feedsTotal, "feed"),
    signedCount(d) ? plural(signedCount(d), "signed record") : "no records",
  ];
  return bits.join(" · ");
}

function andList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** A5 "After merging": what the kept dog will be. */
export function afterMerging(keep: AdminDogDetail, merge: AdminDogDetail): string {
  const keepName = dogName(keep.name);
  const mergeName = dogName(merge.name);
  const collar = keep.collar ?? merge.collar;
  const out: string[] = [];
  out.push(collar ? `One dog named ${keepName} with collar ${collarNumber(collar.batchNo, collar.code)}.` : `One dog named ${keepName}, with no collar yet.`);
  const feeds = keep.feedsTotal + merge.feedsTotal;
  const photos = keep.photos.filter((p) => !p.hidden).length + merge.photos.filter((p) => !p.hidden).length;
  const records = signedCount(keep) + signedCount(merge);
  const stay = [plural(feeds, "feed").replace(/^/, "All ")];
  if (photos === 2) stay.push("both photos");
  else if (photos === 1) stay.push("the photo");
  else if (photos > 2) stay.push(`all ${photos} photos`);
  if (records === 1) stay.push("the signed record");
  else if (records > 1) stay.push(`the ${records} signed records`);
  out.push(`${andList(stay)} stay.`);
  const keepFeeders = new Set(keep.feederList.map((f) => f.feederId));
  const added = merge.feederList.filter((f) => !keepFeeders.has(f.feederId)).map((f) => f.name);
  if (added.length) out.push(`${andList(added)} ${added.length === 1 ? "becomes a feeder" : "become feeders"} of ${keepName} and ${added.length === 1 ? "gets" : "get"} a note.`);
  out.push(`${mergeName}'s link redirects to ${keepName}.`);
  return out.join(" ");
}

/** Keep the dog with the signed records, then the collar, then the older one. */
export function defaultKeep(a: AdminDogDetail, b: AdminDogDetail): "a" | "b" {
  const sa = signedCount(a);
  const sb = signedCount(b);
  if (sa !== sb) return sa > sb ? "a" : "b";
  if (!!a.collar !== !!b.collar) return a.collar ? "a" : "b";
  return (a.registeredAt ?? a.createdAt) <= (b.registeredAt ?? b.createdAt) ? "a" : "b";
}

export function MergeScreen({ a, b, reportId }: { a: string; b: string; reportId: string | null }): React.JSX.Element {
  const router = useRouter();
  const res = useAsync(() => Promise.all([api.getAdminDog(a), api.getAdminDog(b)]), [a, b]);
  const can = useCan("merge");
  const { refreshToday, toast } = useAdmin();
  const [confirmNode, confirm] = useConfirm();
  const [keepSide, setKeepSide] = useState<"a" | "b" | null>(null);
  const [busy, setBusy] = useState(false);

  if (res.error) return <div className={s.page}><ErrorLine message={res.error} retry={res.reload} /></div>;
  if (!res.data) return <div className={s.page}><Loading what="Opening both dogs" /></div>;
  const [da, db] = res.data;
  const side = keepSide ?? defaultKeep(da, db);
  const keep = side === "a" ? da : db;
  const merge = side === "a" ? db : da;
  const keepName = dogName(keep.name);
  const mergeName = dogName(merge.name);
  const summary = afterMerging(keep, merge);

  const doMerge = () =>
    confirm(
      {
        title: `Merge ${mergeName} into ${keepName}?`,
        body: (
          <>
            {summary} {mergeName} stops being a dog of its own. The ledger keeps both histories, but the portal cannot split them again.
          </>
        ),
        confirm: `Merge into ${keepName}`,
        tone: "dark",
        run: () => api.mergeDogs({ keepSlug: keep.slug, mergeSlug: merge.slug, name: keep.name, reportId }),
        done: `${mergeName} is merged into ${keepName}.`,
      },
      () => {
        refreshToday();
        router.push(`/admin/dogs/${encodeURIComponent(keep.slug)}`);
      },
    );
  const different = async () => {
    setBusy(true);
    try {
      await api.dismissDuplicate(da.slug, db.slug, reportId);
      toast(`Marked as different dogs. ${dogName(da.name)} and ${dogName(db.name)} won't be suggested again.`);
      refreshToday();
      router.push("/admin/reports");
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not work.");
      setBusy(false);
    }
  };

  const card = (d: AdminDogDetail, which: "a" | "b") => {
    const chosen = side === which;
    const photo = d.photos.find((p) => !p.hidden);
    return (
      <div className={cx(s.mergeCard, chosen && s.mergeCardKeep)}>
        <div className={s.mergeImg}>
          {photo?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={`${dogName(d.name)}'s photo`} />
          ) : (
            <span>{dogName(d.name)} photo</span>
          )}
        </div>
        <div className={s.row} style={{ alignItems: "center" }}>
          <h2 className={s.mergeName}>
            <Link href={`/admin/dogs/${encodeURIComponent(d.slug)}`} style={{ color: "inherit" }}>
              {dogName(d.name)}
            </Link>
          </h2>
          {can && (
            <button
              type="button"
              className={cx(s.linkBtn, s.linkBtnSm)}
              aria-pressed={chosen}
              onClick={() => setKeepSide(which)}
              style={chosen ? undefined : { color: "var(--h-secondary)" }}
            >
              {chosen ? "Keep this name" : "Keep this name instead"}
            </button>
          )}
        </div>
        <span className={s.mergeMeta}>{mergeMeta(d)}</span>
      </div>
    );
  };

  return (
    <div className={s.page}>
      <header className={s.headText}>
        <Crumbs items={[{ label: "Reports", href: "/admin/reports" }, { label: "Possible duplicate" }]} />
        <h1 className={s.h1}>
          Are {dogName(da.name)} and {dogName(db.name)} the same dog?
        </h1>
      </header>
      <div className={s.mergePair}>
        {card(da, "a")}
        {card(db, "b")}
      </div>
      <section className={s.after} aria-labelledby="after-h">
        <h2 id="after-h" style={{ fontSize: 15, fontWeight: 600 }}>
          After merging
        </h2>
        <p>{summary}</p>
      </section>
      {can && (
        <div className={s.actionsInline}>
          <button type="button" className={cx(s.btn, s.btnDark, s.btnWide)} onClick={doMerge} disabled={busy}>
            Merge into {keepName}
          </button>
          <button type="button" className={cx(s.btn, s.btnOutline, s.btnWide)} onClick={different} disabled={busy}>
            They&apos;re different dogs
          </button>
        </div>
      )}
      {confirmNode}
    </div>
  );
}
