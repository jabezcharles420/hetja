"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { StickyFooter } from "@/components/ds";
import { ngoApi, type DriveTask, type Ngo, type NgoTeam, type WardDog } from "./ngo-api";
import { roleLabel, wardCodeOf } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, Loading, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * New drive (designed, not in the board): where and when, the ward, the
 * lead vet, the volunteers and the dogs, each with what it needs. The dogs'
 * tasks start from what Hetja knows (not sterilised: sterilise; no signed
 * vaccination: rabies) and can be changed. Coordinators plan drives.
 */

const TASKS: { key: DriveTask; label: string }[] = [
  { key: "collar", label: "Collar" },
  { key: "vaccinate", label: "Rabies" },
  { key: "sterilise", label: "Sterilise" },
];

export function defaultTasks(d: Pick<WardDog, "sterilised" | "vaccinated">): DriveTask[] {
  const t: DriveTask[] = [];
  if (d.vaccinated !== "yes") t.push("vaccinate");
  if (d.sterilised !== "yes") t.push("sterilise");
  return t;
}

/** "2026-09-27" + "07:00" -> "2026-09-27T07:00:00+05:30" (Mumbai time). */
export function kolkataIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return `${date}T${time}:00+05:30`;
}

function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 3600_000 + 5.5 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export default function NewDriveScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/drives/new" frame={{ href: "/ngo/drives", label: "Drives" }}>
      {(ngo, role) => (
        <NgoFrame back={{ href: "/ngo/drives", label: "Drives" }} mist={false}>
          {isCoordinator(role) ? (
            <NewDrive ngo={ngo} />
          ) : (
            <div className={`h-container ${styles.body}`}>
              <h1 className={styles.title}>New drive</h1>
              <p className={styles.lead}>Coordinators plan drives. Ask one at {ngo.name} to add you to the next one.</p>
            </div>
          )}
        </NgoFrame>
      )}
    </ActiveNgo>
  );
}

function NewDrive({ ngo }: { ngo: Ngo }): React.JSX.Element {
  const router = useRouter();
  const ids = { place: useId(), ward: useId(), date: useId(), time: useId(), vet: useId(), vols: useId(), dogs: useId(), collars: useId() };
  const [place, setPlace] = useState("");
  const [ward, setWard] = useState<string>(ngo.wards[0] ?? "");
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("07:00");
  const [vet, setVet] = useState<string | null>(null);
  const [vols, setVols] = useState<string[]>([]);
  const [collars, setCollars] = useState(0);
  const [picked, setPicked] = useState<Record<string, DriveTask[]>>({});
  const [team, setTeam] = useState<NgoTeam | null>(null);
  const [dogs, setDogs] = useState<WardDog[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    ngoApi.getTeam().then(setTeam, () => setTeam({ canManage: true, vets: [], members: [] }));
    ngoApi.getWardDogs("all").then((r) => setDogs(r.dogs), () => setDogs([]));
  }, []);

  const inWard = useMemo(() => (dogs ?? []).filter((d) => !ward || d.wardId === ward), [dogs, ward]);
  const vets = (team?.vets ?? []).filter((v) => v.status === "verified");
  const count = Object.keys(picked).length;

  const toggleDog = (d: WardDog) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[d.slug]) delete next[d.slug];
      else next[d.slug] = defaultTasks(d);
      return next;
    });

  const toggleTask = (slug: string, t: DriveTask) =>
    setPicked((p) => {
      const cur = p[slug] ?? [];
      return { ...p, [slug]: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] };
    });

  const submit = async () => {
    const startsAt = kolkataIso(date, time);
    if (place.trim().length < 2) return setProblem("Add where the drive is, like a street or a colony.");
    if (!ward) return setProblem("Pick the ward.");
    if (!startsAt) return setProblem("Pick the date and time.");
    if (count === 0) return setProblem("Pick at least one dog.");
    const list = Object.entries(picked).map(([slug, tasks]) => ({ slug, tasks }));
    if (list.some((d) => d.tasks.length === 0)) return setProblem("Each dog needs at least one thing to do.");
    setBusy(true);
    setProblem(null);
    try {
      const d = await ngoApi.createDrive({
        place: place.trim(),
        wardId: ward,
        date,
        time,
        leadVetId: vet,
        volunteerIds: vols,
        collarsPacked: collars,
        dogs: list,
      });
      router.push(`/ngo/drives/${encodeURIComponent(d.id)}`);
    } catch (err) {
      setProblem(errorWords(err, "Could not plan the drive. Try again."));
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>New drive</h1>
          <p className={styles.lead}>
            Feeders of the dogs you pick get a heads-up the day before, so they can help find them.
          </p>
        </div>

        <div className={styles.stack6}>
          <label className={styles.label} htmlFor={ids.place}>
            Where
          </label>
          <input
            id={ids.place}
            className={styles.input}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Aram Nagar"
            maxLength={60}
          />
        </div>

        <div className={styles.stack6}>
          <span className={styles.label} id={ids.ward}>
            Ward
          </span>
          <div className={styles.chips} role="radiogroup" aria-labelledby={ids.ward}>
            {ngo.wards.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={ward === w}
                className={`${styles.chip} ${styles.chipBold} ${ward === w ? styles.chipOn : ""}`}
                onClick={() => setWard(w)}
              >
                {wardCodeOf(w)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.tiles}>
          <div className={styles.stack6}>
            <label className={styles.label} htmlFor={ids.date}>
              Date
            </label>
            <input id={ids.date} className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={styles.stack6}>
            <label className={styles.label} htmlFor={ids.time}>
              Starts at
            </label>
            <input id={ids.time} className={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div className={styles.stack6}>
          <span className={styles.label} id={ids.vet}>
            Lead vet
          </span>
          {team === null ? (
            <Loading label="Loading the team" />
          ) : vets.length === 0 ? (
            <p className={styles.note}>No verified vets on the team yet. Vaccinations need one to sign them.</p>
          ) : (
            <div className={styles.chips} role="radiogroup" aria-labelledby={ids.vet}>
              {vets.map((v) => (
                <button
                  key={v.feederId}
                  type="button"
                  role="radio"
                  aria-checked={vet === v.feederId}
                  className={`${styles.chip} ${vet === v.feederId ? styles.chipOn : ""}`}
                  onClick={() => setVet(vet === v.feederId ? null : v.feederId)}
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {team && team.members.length > 0 && (
          <div className={styles.stack6}>
            <span className={styles.label} id={ids.vols}>
              Volunteers · {vols.length}
            </span>
            <div className={styles.chips} role="group" aria-labelledby={ids.vols}>
              {team.members.map((m) => {
                const on = vols.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${m.name}, ${roleLabel(m.role)}`}
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => setVols(on ? vols.filter((x) => x !== m.id) : [...vols, m.id])}
                  >
                    {on ? `✓ ${m.name}` : m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.stack6}>
          <span className={styles.label} id={ids.dogs}>
            Dogs · {count} picked
          </span>
          {dogs === null ? (
            <Loading label="Loading the ward's dogs" />
          ) : inWard.length === 0 ? (
            <p className={styles.note}>No dogs on Hetja in {ward ? wardCodeOf(ward) : "this ward"} yet.</p>
          ) : (
            <ul className={`${styles.list} ${styles.listMist}`} aria-labelledby={ids.dogs}>
              {inWard.map((d) => {
                const tasks = picked[d.slug];
                return (
                  <li key={d.slug}>
                    <button type="button" className={styles.row} aria-pressed={!!tasks} onClick={() => toggleDog(d)}>
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>{d.name ?? "No name yet"}</span>
                        <span className={styles.rowSub}>
                          {d.sterilised === "yes" ? "Sterilised" : "Not sterilised"} ·{" "}
                          {d.vaccinated === "yes" ? "vaccinated" : "vaccination unknown"}
                        </span>
                      </span>
                      <span className={`${styles.check} ${tasks ? styles.checkOn : ""}`} aria-hidden="true">
                        {tasks ? "✓" : ""}
                      </span>
                    </button>
                    {tasks && (
                      <div className={`${styles.chips} ${styles.taskChips}`} role="group" aria-label={`What ${d.name ?? "this dog"} needs`}>
                        {TASKS.map((t) => {
                          const on = tasks.includes(t.key);
                          return (
                            <button
                              key={t.key}
                              type="button"
                              aria-pressed={on}
                              className={`${styles.chip} ${on ? styles.chipOn : styles.chipWhite}`}
                              onClick={() => toggleTask(d.slug, t.key)}
                            >
                              {on ? `✓ ${t.label}` : t.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`${styles.stepper} ${styles.onMist}`}>
          <span className={styles.rowTitle} id={ids.collars}>
            Collars packed
          </span>
          <div className={styles.stepperBtns} role="group" aria-labelledby={ids.collars}>
            <button
              type="button"
              className={`${styles.stepperBtn} ${styles.stepperBtnWhite}`}
              aria-label="One fewer collar"
              disabled={collars <= 0}
              onClick={() => setCollars((c) => Math.max(0, c - 1))}
            >
              −
            </button>
            <output className={styles.stepperNum} aria-live="polite">
              {collars}
            </output>
            <button
              type="button"
              className={`${styles.stepperBtn} ${styles.stepperBtnWhite}`}
              aria-label="One more collar"
              onClick={() => setCollars((c) => Math.min(200, c + 1))}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <StickyFooter background="white" divider={false}>
        <div className={styles.footer}>
          {problem && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void submit()} disabled={busy}>
            {busy ? "Planning…" : "Plan the drive"}
          </button>
        </div>
      </StickyFooter>
    </>
  );
}
