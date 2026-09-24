/**
 * Live Impact stats for the home page's "Today in Mumbai" card.
 *
 * Fetched server-side with ISR (revalidate 60s) so a DB hiccup never breaks
 * the landing: any failure returns null and the card shows honest "-"
 * placeholders (docs/HOW-IT-WORKS.md §10: "the system is allowed to know less
 * than it wants to, but not allowed to claim more than it knows"). Never fall
 * back to the mock's made-up 412 / 1,086. The API is also cached 60s
 * (apps/api/src/routes/stats.ts), so the two layers age out together.
 *
 * No auth, no geo: the endpoint returns three integers only (INVARIANT 2
 * coarsening), so this fetch carries no PII and needs no header.
 */

export interface ImpactStats {
  dogsTracked: number;
  feedsLogged: number;
  livesTouched: number;
}

export const IMPACT_REVALIDATE_SECONDS = 60;

export async function getImpactStats(): Promise<ImpactStats | null> {
  // NEXT_PUBLIC_API_URL is inlined at build time for the browser; on the
  // server it is read at runtime. Local dev default so `next dev` works bare.
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
  try {
    const res = await fetch(`${origin}/api/v1/stats/impact`, {
      next: { revalidate: IMPACT_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: Partial<ImpactStats> };
    if (json.ok !== true || !json.data) return null;
    const { dogsTracked, feedsLogged, livesTouched } = json.data;
    const valid = [dogsTracked, feedsLogged, livesTouched].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
    );
    if (!valid) return null;
    return {
      dogsTracked: dogsTracked as number,
      feedsLogged: feedsLogged as number,
      livesTouched: livesTouched as number,
    };
  } catch {
    return null;
  }
}

const COUNT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 1086 -> "1,086" (Indian grouping: 125000 -> "1,25,000"); missing -> "-". */
export function formatCount(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? COUNT.format(n) : "-";
}
