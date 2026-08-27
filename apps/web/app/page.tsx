import Link from "next/link";
import ScanEntry from "@/components/ScanEntry";

function PawArt(): React.JSX.Element {
  return (
    <svg
      className="h-paw-art"
      viewBox="0 0 200 200"
      role="img"
      aria-label="A paw print"
    >
      <g fill="currentColor">
        <circle cx="72" cy="82" r="16" />
        <circle cx="100" cy="60" r="18" />
        <circle cx="128" cy="82" r="16" />
        <path d="M62 124c0-22 16-34 38-34s38 12 38 34c0 21-15 32-38 32s-38-11-38-32Z" />
      </g>
      <circle cx="36" cy="44" r="4" fill="var(--h-ink-muted)" />
      <circle cx="164" cy="40" r="4" fill="var(--h-ink-muted)" />
      <circle cx="176" cy="112" r="3" fill="var(--h-rule)" />
      <circle cx="24" cy="132" r="3" fill="var(--h-rule)" />
    </svg>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div>
      <p className="h-stat-value">{value}</p>
      <p className="h-stat-label">{label}</p>
    </div>
  );
}

function Step({
  num,
  title,
  text,
}: {
  num: string;
  title: string;
  text: string;
}): React.JSX.Element {
  return (
    <article className="h-card h-step">
      <span className="h-step-num" aria-hidden="true">
        {num}
      </span>
      <h3 className="h-step-title">{title}</h3>
      <p className="h-step-text">{text}</p>
    </article>
  );
}

/**
 * Live Impact stats for the landing strip.
 *
 * Fetched server-side with ISR (revalidate 60s) so a DB hiccup never
 * breaks the landing — the catch returns null and the caller renders
 * honest placeholders "—" instead (docs/HOW-IT-WORKS.md §10: "the
 * system is allowed to know less than it wants to, but not allowed to
 * claim more than it knows"). The API itself is also cached 60s
 * (apps/api/src/routes/stats.ts) so the two layers age out together.
 *
 * No auth, no geo — the endpoint returns three integers only
 * (INVARIANT 2 coarsening), so this fetch carries no PII and needs no
 * header.
 */
interface ImpactStats {
  dogsTracked: number;
  feedsLogged: number;
  livesTouched: number;
}

async function getImpactStats(): Promise<ImpactStats | null> {
  // NEXT_PUBLIC_API_URL is inlined at build time for the browser, but
  // on the server we can also read it at runtime. Fall back to the
  // local dev default so `next dev` works without env.
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
  const url = `${origin}/api/v1/stats/impact`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      data?: ImpactStats;
    };
    if (json.ok !== true || !json.data) return null;
    const { dogsTracked, feedsLogged, livesTouched } = json.data;
    // Defensive: ensure they are finite numbers before rendering.
    if (
      typeof dogsTracked !== "number" ||
      typeof feedsLogged !== "number" ||
      typeof livesTouched !== "number" ||
      !Number.isFinite(dogsTracked) ||
      !Number.isFinite(feedsLogged) ||
      !Number.isFinite(livesTouched)
    ) {
      return null;
    }
    return { dogsTracked, feedsLogged, livesTouched };
  } catch {
    return null;
  }
}

export default async function LandingPage(): Promise<React.JSX.Element> {
  const stats = await getImpactStats();

  // Fallback to "—" on any fetch failure so a DB hiccup does not break
  // the landing. Matches the previous hardcoded placeholders exactly.
  const dogsTracked = stats ? String(stats.dogsTracked) : "—";
  const feedsLogged = stats ? String(stats.feedsLogged) : "—";
  const livesTouched = stats ? String(stats.livesTouched) : "—";

  return (
    <>
      <section className="h-hero">
        <div className="h-container h-hero-grid">
          <div className="h-hero-fade-up">
            <span className="h-pill h-pill-amber h-hero-kicker">
              Mumbai&rsquo;s street heroes
            </span>
            <h1 className="h-hero-title">Every street has a hero.</h1>
            <p className="h-hero-sub">
              Hetja is a small network of feeders, vets, and neighbours who
              show up for stray dogs across Mumbai. Scan a collar, meet the
              dog, and keep the streak alive.
            </p>
            <div className="h-hero-ctas">
              <Link className="h-btn h-btn-primary" href="/scan">
                Scan a collar
              </Link>
              <Link className="h-btn h-btn-dark" href="/login">
                Become a feeder
              </Link>
            </div>
            <div className="h-hero-entry">
              <ScanEntry
                id="collar-code"
                label="Collar code"
                hint="No QR reader? Type the collar code:"
                placeholder="e.g. abc234567"
                buttonLabel="View profile"
              />
            </div>
          </div>

          <div className="h-hero-fade-up h-paw-panel" style={{ animationDelay: "120ms" }}>
            <PawArt />
          </div>
        </div>
      </section>

      <section className="h-stats" aria-label="Impact">
        <div className="h-container h-stats-row">
          <Stat value={dogsTracked} label="dogs tracked" />
          <Stat value={feedsLogged} label="feeds logged" />
          <Stat value={livesTouched} label="lives touched" />
        </div>
      </section>

      <section className="h-section" id="how-it-works">
        <div className="h-container">
          <div className="h-how-head">
            <span className="h-pill h-pill-amber">How it works</span>
            <h2 className="h-how-title">Three steps to a warmer street.</h2>
            <p className="h-how-sub">
              Every dog has a collar code and a story. Meet them, feed them,
              act.
            </p>
          </div>
          <div className="h-steps">
            <Step
              num="1"
              title="Scan"
              text="Point at the QR on a dog's collar — or type the 9-character code. It's their ID and their whole file."
            />
            <Step
              num="2"
              title="See"
              text="Meet the dog: name, ward, ABC and vaccine status, verified medical records, and a micro-story."
            />
            <Step
              num="3"
              title="Act"
              text="Log a feed, raise an SOS, or keep your streak. Every act is counted and builds your trust score."
            />
          </div>
        </div>
      </section>

      <section className="h-band">
        <div className="h-container h-band-inner">
          <h2 className="h-band-title">
            Be the reason a street dog eats today.
          </h2>
          <p className="h-band-sub">
            Hetja is built by and for Mumbai&rsquo;s street heroes. Create an
            account, claim your patches, and show up tomorrow too.
          </p>
          <Link className="h-btn h-btn-primary" href="/login">
            Become a feeder
          </Link>
        </div>
      </section>
    </>
  );
}
