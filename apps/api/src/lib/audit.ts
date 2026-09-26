/**
 * The audit log (design v7, A6): one row for every admin action, every vet
 * signature and every document access.
 *
 * audit_log is APPEND-ONLY for every role, the Owner included (migration
 * 0029: app_user holds SELECT and INSERT only, and triggers refuse UPDATE,
 * DELETE and TRUNCATE for everyone). This module is the only writer. It
 * takes the caller's transaction when there is one, so an action and its
 * audit row commit together or not at all: an admin action with no audit row
 * is exactly what the log exists to rule out.
 *
 * WHAT NEVER GOES IN (INVARIANT 3, and the documents promise): contact
 * details (an email, a feeder's phone), document contents, coordinates. The
 * `detail` object is filtered on the way in; a key that looks like one of
 * those is dropped rather than trusted to every caller's discipline.
 */
import { query } from "@hetja/db";

export type ActorKind = "admin" | "vet" | "ngo" | "feeder" | "system";

export interface AuditEvent {
  actorId: string | null;
  actorKind: ActorKind;
  /** "vet.verify", "dog.merge", "document.view", ... (<= 64 chars). */
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** One human line, e.g. "verified Dr. Arjun Deshmukh" (<= 300 chars). */
  summary: string;
  detail?: Record<string, unknown>;
}

interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

const FORBIDDEN_KEY = /(email|phone|mobile|lat|lng|geo|address|base64|bytes|content|token|secret|password)/i;

/** The detail object with anything that could carry contact data, a position or file bytes removed. */
export function scrubDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (FORBIDDEN_KEY.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => (typeof x === "string" ? x.slice(0, 100) : x));
  }
  return out;
}

export async function audit(client: TxClient | null, e: AuditEvent): Promise<void> {
  const run = (text: string, params: unknown[]) => (client ? client.query(text, params) : query(text, params));
  await run(
    `INSERT INTO audit_log (actor_id, actor_kind, action, subject_type, subject_id, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      e.actorId,
      e.actorKind,
      e.action.slice(0, 64),
      e.subjectType ?? null,
      e.subjectId ?? null,
      e.summary.slice(0, 300),
      JSON.stringify(scrubDetail(e.detail)),
    ],
  );
}
