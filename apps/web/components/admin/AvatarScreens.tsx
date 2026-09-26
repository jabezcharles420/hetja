"use client";

/**
 * A3 Bulk avatar upload and A4 One avatar, plus the batch list they hang off.
 *
 * Adapted (CONTRACT.md): files match by the dog's ID (slug) or the collar's
 * batch number in the file name, and nothing else. The mock's "By photo"
 * matching and its percentages need an image model the shared box cannot
 * run, so those files land in "No match · pick dog".
 *
 * Nothing goes live until Publish. The real photo stays the record of truth
 * on the dog page; the avatar is for pins, lists, share cards and the collar
 * print.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api, type AvatarBatch, type AvatarTile } from "@/lib/api";
import { fileKey, filesFromDrop, isImageFile } from "./avatarMatch";
import { dogName, fullDate, matchLine, shortDate } from "./format";
import { Crumbs, cx, Dialog, ErrorLine, errorText, Loading, SelectTable, styles as s, Tabs, useAdmin, useAsync, useCan, useConfirm, type Column } from "./ui";

/** A File as the base64 the upload endpoint takes. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(file);
  });
}

function Well({ url, label, avatar, round }: { url: string | null | undefined; label: string; avatar?: boolean; round?: boolean }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return (
    <div className={cx(s.well, avatar && s.wellAvatar)} style={round ? { borderRadius: "50%" } : undefined}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden="true">{label}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batches (designed)
// ---------------------------------------------------------------------------

export function AvatarsScreen(): React.JSX.Element {
  const router = useRouter();
  const list = useAsync(() => api.getAvatarBatches(), []);
  const can = useCan("avatars");
  const { toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const open = (list.data?.batches ?? []).find((b) => b.status === "open");
  const start = async () => {
    setBusy(true);
    try {
      const b = await api.createAvatarBatch();
      router.push(`/admin/avatars/${encodeURIComponent(b.id)}`);
    } catch (e) {
      toast(errorText(e));
      setBusy(false);
    }
  };
  const columns: Column<AvatarBatch>[] = [
    { key: "n", label: "Batch", width: "18%", cell: (b) => `Batch #${b.number}` },
    { key: "files", label: "Files", width: "14%", cell: (b) => b.files },
    { key: "matched", label: "Matched", width: "14%", cell: (b) => b.matched },
    { key: "pub", label: "Published", width: "16%", cell: (b) => (b.status === "published" ? b.published : <span className={s.warnText}>Not yet</span>) },
    { key: "by", label: "Started", cell: (b) => `${fullDate(b.createdAt)}${b.createdBy ? ` by ${b.createdBy}` : ""}` },
  ];
  return (
    <div className={s.page}>
      <header className={cx(s.head, s.headCenter)}>
        <div className={s.headText}>
          <span className={s.eyebrow}>Avatars</span>
          <h1 className={s.h1}>Batches</h1>
        </div>
        {can && (
          <div className={s.headActions}>
            {open && (
              <Link href={`/admin/avatars/${encodeURIComponent(open.id)}`} className={cx(s.btn, s.btnMd, s.btnOutline)}>
                Open batch #{open.number}
              </Link>
            )}
            <button type="button" className={cx(s.btn, s.btnMd, s.btnBlue)} onClick={start} disabled={busy}>
              {busy ? "Starting…" : "New batch"}
            </button>
          </div>
        )}
      </header>
      <div className={s.info}>
        <b>How files match:</b> name the file with the dog&apos;s ID (r4n7kw2ab.png) or collar number (HJ-0412.png). Anything else goes to No match,
        and you pick the dog by hand. Nothing goes live until you publish the batch.
      </div>
      {list.error ? (
        <ErrorLine message={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading what="Loading batches" />
      ) : (
        <SelectTable
          caption="Avatar batches"
          columns={columns}
          rows={list.data.batches}
          rowKey={(b) => b.id}
          selected={null}
          onSelect={(id) => router.push(`/admin/avatars/${encodeURIComponent(id)}`)}
          empty="No batches yet. Start one and drop a folder of avatars on it."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A3
// ---------------------------------------------------------------------------

type Filter = "all" | "id" | "manual" | "none" | "replaces";

interface Pending {
  key: string;
  name: string;
  state: "uploading" | "failed";
  error?: string;
}

export function tileFilter(t: AvatarTile, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "id":
      return (t.match === "id" || t.match === "collar") && !!t.dog;
    case "manual":
      return t.match === "manual" && !!t.dog;
    case "none":
      return t.match === "none" || !t.dog;
    case "replaces":
      return t.replacesExisting;
  }
}

/** What Publish will put live: matched drafts. */
export const publishable = (tiles: AvatarTile[]): AvatarTile[] => tiles.filter((t) => t.dog && t.match !== "none" && t.status === "draft");

export function BatchScreen({ batchId }: { batchId: string }): React.JSX.Element {
  const router = useRouter();
  const res = useAsync(() => api.getAvatarBatch(batchId), [batchId]);
  const can = useCan("avatars");
  const { toast, refreshToday } = useAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState<AvatarTile | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter(isImageFile);
      if (!images.length) {
        toast("No images there. Avatars are PNG, JPEG or WebP.");
        return;
      }
      const jobs = images.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, file: f }));
      setPending((p) => [...p, ...jobs.map((j) => ({ key: j.key, name: j.file.name, state: "uploading" as const }))]);
      let failed = 0;
      // Two at a time: the room is small and every file is one request.
      const queue = [...jobs];
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          try {
            await api.uploadAvatar(batchId, { fileName: job.file.name, imageBase64: await fileToBase64(job.file) });
            setPending((p) => p.filter((x) => x.key !== job!.key));
          } catch (e) {
            failed++;
            const message = errorText(e);
            setPending((p) => p.map((x) => (x.key === job!.key ? { ...x, state: "failed", error: message } : x)));
          }
        }
      };
      await Promise.all([worker(), worker()]);
      res.reload();
      refreshToday();
      toast(failed ? `${images.length - failed} added, ${failed} did not upload.` : `${images.length} ${images.length === 1 ? "file" : "files"} added.`);
    },
    [batchId, res, toast, refreshToday],
  );

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!can) return;
    upload(await filesFromDrop(e.dataTransfer));
  };

  if (res.error) return <div className={s.page}><ErrorLine message={res.error} retry={res.reload} /></div>;
  if (!res.data) return <div className={s.page}><Loading what="Opening the batch" /></div>;
  const { batch, tiles, counts } = res.data;
  const live = batch.status === "published";
  const toPublish = publishable(tiles);
  const matched = tiles.filter((t) => t.dog && t.match !== "none").length;
  const shown = tiles.filter((t) => tileFilter(t, filter));
  const byId = counts.byId + counts.byCollar;

  const publish = () =>
    confirm(
      {
        title: `Publish ${toPublish.length} avatars?`,
        body: (
          <>
            They go live at once on the map pins, feeders&apos; home lists, share cards and collar sheets of {toPublish.length} dogs. The dog pages keep
            their real photos.
            {counts.replaces ? ` ${counts.replaces} replace an existing avatar, which stays one click away for 30 days.` : ""}
            {counts.noMatch ? ` The ${counts.noMatch} files with no match stay here, unpublished.` : ""}
          </>
        ),
        confirm: `Publish ${toPublish.length} avatars`,
        tone: "dark",
        run: () => api.publishAvatarBatch(batch.id),
        done: `${toPublish.length} avatars are live.`,
      },
      () => {
        res.reload();
        refreshToday();
      },
    );

  const tabs = [
    { key: "all" as const, label: `All ${counts.all}` },
    { key: "id" as const, label: `By ID · ${byId}` },
    ...(counts.manual ? [{ key: "manual" as const, label: `Picked · ${counts.manual}` }] : []),
    { key: "none" as const, label: `No match · ${counts.noMatch}`, warn: counts.noMatch > 0 },
    { key: "replaces" as const, label: `Replaces existing · ${counts.replaces}` },
  ];

  return (
    <div
      className={s.page}
      onDragOver={(e) => {
        if (!can || live) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className={s.head}>
        <div className={s.headText}>
          <Crumbs items={[{ label: "Avatars", href: "/admin/avatars" }, { label: `Batch #${batch.number}` }]} />
          <h1 className={s.h1}>
            {tiles.length} files, {matched} matched
          </h1>
        </div>
        {can && !live && (
          <div className={s.headActions}>
            <button type="button" className={cx(s.btn, s.btnMd, s.btnOutline)} onClick={() => filesInput.current?.click()}>
              Add more files
            </button>
            <button type="button" className={cx(s.btn, s.btnMd, s.btnBlue)} onClick={publish} disabled={!toPublish.length || pending.some((p) => p.state === "uploading")}>
              Publish {toPublish.length} avatars
            </button>
          </div>
        )}
        {live && <span className={cx(s.pill, s.pillOk)}>Published</span>}
      </header>
      <input ref={filesInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => upload(Array.from(e.target.files ?? []))} />
      <input ref={folderInput} type="file" multiple hidden onChange={(e) => upload(Array.from(e.target.files ?? []))} />

      <div className={s.info}>
        <b>How files match:</b> name the file with the dog&apos;s ID (r4n7kw2ab.png) or collar number (HJ-0412.png). Anything else goes to No match,
        and you pick the dog by hand.
        {can && !live && (
          <>
            {" "}
            Drop files or a folder anywhere on this page, or{" "}
            <button type="button" className={cx(s.linkBtn, s.linkBtnSm)} onClick={() => folderInput.current?.click()} style={{ fontSize: 14 }}>
              choose a folder
            </button>
            .
          </>
        )}
      </div>

      {dragging && (
        <div className={cx(s.drop, s.dropActive)} aria-hidden="true">
          Drop to add to batch #{batch.number}
        </div>
      )}

      <Tabs label="Files by match" tabs={tabs} value={filter} onChange={setFilter} />

      <ul className={s.tiles} aria-label={`Batch #${batch.number} files`}>
        {pending.map((p) => {
          const k = fileKey(p.name);
          return (
            <li key={p.key}>
              <div className={s.tile} style={{ cursor: "default" }} role="status">
                <div className={s.tilePair}>
                  <Well url={null} label="Photo" />
                  <Well url={null} label={p.state === "failed" ? "Failed" : "Uploading"} avatar />
                </div>
                <div className={s.tileText}>
                  <span className={s.tileName}>{p.name}</span>
                  <span className={cx(s.tileSub, p.state === "failed" && s.dangerText)}>
                    {p.state === "failed" ? p.error : k.kind === "slug" ? `Matching ID · ${k.value}` : k.kind === "batch_no" ? `Matching collar · ${k.value}` : "Uploading…"}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
        {shown.map((t) => {
          const line = matchLine(t);
          const noMatch = line.tone === "warn";
          const title = t.dog ? dogName(t.dog.name) : t.fileName;
          return (
            <li key={t.id}>
              {noMatch && can && !live ? (
                <button type="button" className={cx(s.tile, s.tileWarn)} onClick={() => setPicking(t)} aria-label={`${t.fileName}: no match, pick the dog`}>
                  <TileBody t={t} title={title} line={line} />
                </button>
              ) : (
                <Link href={`/admin/avatars/${encodeURIComponent(batch.id)}/${encodeURIComponent(t.id)}`} className={cx(s.tile, noMatch && s.tileWarn)}>
                  <TileBody t={t} title={title} line={line} />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && !pending.length && (
        <p className={s.muted}>{tiles.length ? "Nothing in this tab." : "No files yet. Drop a folder of avatars here, or use Add more files."}</p>
      )}
      <p className={s.note}>Each tile puts the dog&apos;s real photo next to the avatar so a wrong match is obvious at a glance. Nothing goes live until Publish.</p>
      {picking && (
        <PickDog
          tile={picking}
          onClose={() => setPicking(null)}
          onPicked={() => {
            setPicking(null);
            res.reload();
          }}
        />
      )}
      {confirmNode}
    </div>
  );
}

function TileBody({ t, title, line }: { t: AvatarTile; title: string; line: ReturnType<typeof matchLine> }): React.JSX.Element {
  return (
    <>
      <div className={s.tilePair}>
        <Well url={t.dog?.photoUrl} label="Photo" />
        <Well url={t.imageUrl} label="Avatar" avatar />
      </div>
      <div className={s.tileText}>
        <span className={s.tileName}>{title}</span>
        <span className={cx(s.tileSub, line.tone === "warn" && s.warnText, line.tone === "link" && s.linkText)}>{line.text}</span>
        {t.status === "published" && <span className={s.tileState}>✓ Published</span>}
      </div>
    </>
  );
}

/** No-match tiles open a search to pick the dog. */
function PickDog({ tile, onClose, onPicked }: { tile: AvatarTile; onClose: () => void; onPicked: () => void }): React.JSX.Element {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const res = useAsync(() => (q.trim().length >= 2 ? api.getAdminDogs({ q: q.trim() }) : Promise.resolve({ dogs: [] })), [q]);
  const pick = async (slug: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api.matchAvatar(tile.id, slug);
      onPicked();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Which dog is ${tile.fileName}?`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "start" }}>
        <Well url={tile.imageUrl} label="Avatar" avatar />
        <label className={s.field}>
          <span className={s.fieldLabel}>Search by name, dog ID or collar number</span>
          <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chiku, r4n7kw2ab, HJ-0412" autoComplete="off" />
        </label>
      </div>
      {res.error ? (
        <ErrorLine message={res.error} retry={res.reload} />
      ) : res.loading && q.trim().length >= 2 ? (
        <Loading what="Searching" />
      ) : q.trim().length < 2 ? (
        <p className={s.note}>Type at least two letters.</p>
      ) : (
        <ul className={s.inset} aria-label="Dogs">
          {(res.data?.dogs ?? []).slice(0, 8).map((d) => (
            <li key={d.slug} className={s.insetRow}>
              <span>
                <b>{dogName(d.name)}</b>{" "}
                <span className={s.muted}>
                  · {d.wardCode} · {d.collar?.batchNo ?? d.slug}
                </span>
              </span>
              <button type="button" className={cx(s.btn, s.btnXs, s.btnDark)} disabled={busy} onClick={() => pick(d.slug)}>
                This is {dogName(d.name)}
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && !res.loading && !(res.data?.dogs ?? []).length && <li className={s.insetRow}>No dog matches.</li>}
        </ul>
      )}
      {err && <ErrorLine message={err} />}
      <p className={s.note}>The avatar goes live with the rest of the batch when it is published, not before.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A4
// ---------------------------------------------------------------------------

export function AvatarScreen({ batchId, tileId }: { batchId: string; tileId: string }): React.JSX.Element {
  const router = useRouter();
  const batch = useAsync(() => api.getAvatarBatch(batchId), [batchId]);
  const res = useAsync(() => api.getAvatar(tileId), [tileId]);
  const can = useCan("avatars");
  const { toast, refreshToday } = useAdmin();
  const [confirmNode, confirm] = useConfirm();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const order = useMemo(() => batch.data?.tiles ?? [], [batch.data]);
  const i = order.findIndex((t) => t.id === tileId);
  const go = useCallback(
    (step: number) => {
      if (i < 0 || !order.length) return;
      const next = order[(i + step + order.length) % order.length];
      router.replace(`/admin/avatars/${encodeURIComponent(batchId)}/${encodeURIComponent(next.id)}`);
    },
    [i, order, router, batchId],
  );

  // ← → move through the batch, unless a field or a dialog has the keys.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      go(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  if (res.error) return <div className={s.page}><ErrorLine message={res.error} retry={res.reload} /></div>;
  if (!res.data) return <div className={s.page}><Loading what="Opening the avatar" /></div>;
  const t = res.data;
  const d = t.dog;
  const name = d ? dogName(d.name) : t.fileName;
  const feeder = t.signoff?.feederName ?? d?.photoBy ?? null;
  const number = batch.data?.batch.number;
  const published = t.status === "published";

  const run = async (fn: () => Promise<AvatarTile>, done: string) => {
    setBusy(true);
    try {
      res.setData(await fn());
      toast(done);
      refreshToday();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const wrongDog = () =>
    confirm(
      {
        title: `Not ${name}?`,
        body: <>The file goes back to No match in batch #{number ?? ""} and is not published for {name}. You can pick the right dog from there.</>,
        confirm: "Wrong dog",
        run: () => api.matchAvatar(t.id, null),
        done: `Moved to No match.`,
      },
      () => router.push(`/admin/avatars/${encodeURIComponent(batchId)}`),
    );

  return (
    <div className={s.a4}>
      <div className={s.a4Main}>
        <h1 className="h-sr-only">
          {name}&apos;s avatar{i >= 0 && order.length ? `, ${i + 1} of ${order.length} in the batch` : ""}
        </h1>
        <Crumbs items={[{ label: number ? `Batch #${number}` : "Batch", href: `/admin/avatars/${encodeURIComponent(batchId)}` }, { label: name }]} />
        <div className={s.a4Pair}>
          <figure className={s.a4Col} style={{ margin: 0 }}>
            <figcaption className={s.label}>
              {d ? `Photo on record${d.photoBy ? ` · by ${d.photoBy}` : ""}${d.photoAt ? `, ${shortDate(d.photoAt)}` : ""}` : "No dog picked yet"}
            </figcaption>
            <div className={s.a4Img}>
              {d?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.photoUrl} alt={`${name}'s photo on record`} />
              ) : d ? (
                <span>{name} photo</span>
              ) : (
                <button type="button" className={cx(s.btn, s.btnDark, s.btnMd)} onClick={() => setPicking(true)} disabled={!can}>
                  Pick the dog
                </button>
              )}
            </div>
          </figure>
          <figure className={s.a4Col} style={{ margin: 0 }}>
            <figcaption className={s.label}>New avatar · {t.fileName}</figcaption>
            <div className={cx(s.a4Img, s.a4ImgAvatar)}>
              {t.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.imageUrl} alt={`New avatar for ${name}`} />
              ) : (
                <span>{name} avatar</span>
              )}
            </div>
          </figure>
        </div>
        <div className={s.actionsInline} style={{ flexWrap: "nowrap" }}>
          {can && (
            <>
              <button
                type="button"
                className={cx(s.btn, s.btnDark, s.btnWide)}
                disabled={busy || published || !d}
                onClick={() => run(() => api.publishAvatar(t.id), `${name}'s avatar is live.`)}
              >
                {published ? "✓ Published" : "Approve"}
              </button>
              <button type="button" className={cx(s.btn, s.btnOutline, s.btnWide)} disabled={busy} onClick={() => fileInput.current?.click()}>
                Upload a different file
              </button>
              {d && (
                <button type="button" className={cx(s.btn, s.btnOutline, s.btnWide)} disabled={busy} onClick={wrongDog}>
                  Wrong dog
                </button>
              )}
            </>
          )}
          <span className={s.a4Hint}>
            <span aria-hidden="true">← →</span>&nbsp; to move through the batch
          </span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            await run(async () => api.replaceAvatarFile(t.id, { fileName: f.name, imageBase64: await fileToBase64(f) }), "The new file is in.");
            e.target.value = "";
          }}
        />
        {batch.error && (
          <ErrorLine message={`The rest of the batch did not load, so ← → cannot move. ${batch.error}`} retry={batch.reload} />
        )}
        {t.replacesExisting && <p className={s.note}>This replaces {name}&apos;s current avatar. The old one stays one click away on the dog&apos;s page for 30 days.</p>}
      </div>

      <div className={s.a4Side}>
        <section className={s.weekCard} style={{ gap: 12 }} aria-labelledby="used-h">
          <h2 id="used-h" className={s.cardTitle}>
            Where it&apos;s used
          </h2>
          <dl className={s.kvList} style={{ gap: 12 }}>
            {[
              ["Map pin", "On"],
              ["Dog page header", "Photo stays"],
              ["Feeder's home list", "On"],
              ["Collar sheet print", "On"],
              ["Share card", "On"],
            ].map(([k, v]) => (
              <div key={k} className={s.useRow}>
                <dt>{k}</dt>
                <dd style={{ margin: 0 }} className={v === "On" ? s.on : s.muted}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={s.weekCard} style={{ gap: 12 }} aria-labelledby="pin-h">
          <h2 id="pin-h" className={s.cardTitle}>
            Map pin preview
          </h2>
          <div className={s.pinMap} aria-hidden="true">
            {t.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={cx(s.pin, s.pin52)} src={t.imageUrl} alt="" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={cx(s.pin, s.pin36)} src={t.imageUrl} alt="" />
              </>
            ) : (
              <>
                <span className={cx(s.pin, s.pin52)} />
                <span className={cx(s.pin, s.pin36)} />
              </>
            )}
          </div>
          <span className={s.note} style={{ fontSize: 13 }}>
            Checked at 36px so the face still reads when zoomed out.
          </span>
        </section>
        {d && (
          <section className={s.weekCard} style={{ gap: 8 }} aria-labelledby="signoff-h">
            <h2 id="signoff-h" className={s.cardTitle}>
              Feeder sign-off
            </h2>
            {t.signoff ? (
              <p className={s.signoff}>
                {t.signoff.answer === "looks_right"
                  ? `${feeder ?? "The feeder"} says it looks like ${name}.`
                  : t.signoff.answer === "redo"
                    ? `${feeder ?? "The feeder"} asked for a redo. Upload a different file.`
                    : `Sent to ${feeder ?? "the feeder"} ${shortDate(t.signoff.requestedAt)}. Waiting for an answer.`}
              </p>
            ) : (
              <>
                <p className={s.signoff}>
                  Send to {feeder ?? "the feeder"} so they can say it looks like {name}. Published either way; they can ask for a redo.
                </p>
                {can && (
                  <button type="button" className={s.linkBtn} style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => run(() => api.askAvatarSignoff(t.id), `Sent to ${feeder ?? "the feeder"}.`)}>
                    Ask {feeder ?? "the feeder"}
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>
      {picking && (
        <PickDog
          tile={t}
          onClose={() => setPicking(false)}
          onPicked={() => {
            setPicking(false);
            res.reload();
            batch.reload();
          }}
        />
      )}
      {confirmNode}
    </div>
  );
}
