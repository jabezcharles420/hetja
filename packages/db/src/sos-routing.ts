/**
 * Design v7 SOS routing to professionals, shared by the API (routes/sos.ts at
 * filing, routes/ngo.ts when an NGO passes) and the worker (the
 * `sos_open_to_vets` job, NGO_WINDOW_MINUTES after filing). One copy of the
 * SQL, so "which NGO" and "which vets" cannot drift between the two services.
 * The rule itself is written down in apps/api/src/lib/sos-eligibility.ts.
 *
 * Every page is an ordinary sos_notifications row (channel 'push', feeder_id
 * = the professional's account) tagged with `route`, so delivery, the
 * responder's case page and "I'm going" all work unchanged. Rows are
 * ON CONFLICT DO NOTHING against 0020's unique index: a vet who was already
 * paged as a nearby feeder keeps that one page.
 */
interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const NGO_WINDOW_MINUTES = 15;
export const MAX_VETS_PAGED = 15;

/**
 * Page the NGO covering the case's ward: an ACTIVE NGO (a paused one gets no
 * new routing) naming the ward, else a citywide one, oldest approval first.
 * Its coordinators are paged (route ngo_coordinator). Returns the NGO id, or
 * null when none covers the ward. Records sos_cases.ngo_id / ngo_routed_at.
 */
export async function routeCaseToNgo(client: TxClient, caseId: string, wardId: string | null): Promise<{ ngoId: string; paged: number } | null> {
  if (!wardId) return null;
  const ngo = await client.query<{ id: string }>(
    `SELECT id FROM ngos
      WHERE status = 'active' AND (wards @> ARRAY[$1]::text[] OR citywide)
      ORDER BY (wards @> ARRAY[$1]::text[]) DESC, decided_at NULLS LAST, created_at
      LIMIT 1`,
    [wardId],
  );
  const ngoId = ngo.rows[0]?.id;
  if (!ngoId) return null;
  await client.query(`UPDATE sos_cases SET ngo_id = $2, ngo_routed_at = now() WHERE id = $1 AND ngo_id IS NULL`, [
    caseId,
    ngoId,
  ]);
  const ins = await client.query(
    `INSERT INTO sos_notifications (case_id, feeder_id, channel, route)
     SELECT $1, m.feeder_id, 'push', 'ngo_coordinator'
       FROM ngo_members m JOIN feeders f ON f.id = m.feeder_id
      WHERE m.ngo_id = $2 AND m.left_at IS NULL AND m.role = 'coordinator'
        AND f.deleted_at IS NULL AND f.suspended_at IS NULL
     ON CONFLICT DO NOTHING`,
    [caseId, ngoId],
  );
  return { ngoId, paged: ins.rowCount ?? 0 };
}

/** Queue the vets' turn for `minutes` from now (0 = now), unless one is already queued. */
export async function scheduleOpenToVets(client: TxClient, caseId: string, minutes: number): Promise<void> {
  await client.query(
    `INSERT INTO jobs (kind, payload, run_after)
     SELECT 'sos_open_to_vets', jsonb_build_object('caseId', $1::text), now() + make_interval(mins => $2)
      WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'sos_open_to_vets' AND j.failed_at IS NULL
                          AND j.payload->>'caseId' = $1::text AND j.run_after <= now() + make_interval(mins => $2))`,
    [caseId, minutes],
  );
}

/**
 * The case opens to every vet nearby: verified (never suspended), taking SOS,
 * inside their SOS hours (Mumbai time), covering the case's ward, at most
 * MAX_VETS_PAGED, government vets first. Only while nobody has taken the case
 * and it is not closed; once per case (vets_opened_at). Returns how many vets
 * were paged; the caller enqueues send_sos_push when that is > 0.
 */
export async function openCaseToVets(client: TxClient, caseId: string): Promise<number> {
  const c = await client.query<{ ward_id: string | null }>(
    `UPDATE sos_cases c SET vets_opened_at = now()
      WHERE c.id = $1 AND c.acked_by IS NULL AND c.resolved_at IS NULL AND c.vets_opened_at IS NULL
        AND c.state IN ('open', 'escalated')
      RETURNING COALESCE(c.ward_id, (SELECT d.ward_id FROM dogs d WHERE d.id = c.dog_id)) AS ward_id`,
    [caseId],
  );
  const wardId = c.rows[0]?.ward_id;
  if (!c.rows[0] || !wardId) return 0;
  const minute = `(((extract(epoch FROM now()) / 60 + 330)::int % 1440 + 1440) % 1440)`;
  const ins = await client.query(
    `INSERT INTO sos_notifications (case_id, feeder_id, channel, route)
     SELECT $1, v.feeder_id, 'push', 'vet_escalation'
       FROM vet_profiles v JOIN feeders f ON f.id = v.feeder_id
       LEFT JOIN care_providers cp ON cp.id = v.care_provider_id
      WHERE v.status = 'verified' AND v.sos_available AND v.wards @> ARRAY[$2]::text[]
        AND f.deleted_at IS NULL AND f.suspended_at IS NULL
        AND (v.sos_start IS NULL OR v.sos_end IS NULL OR v.sos_start = v.sos_end
             OR (v.sos_start < v.sos_end AND ${minute} >= v.sos_start AND ${minute} < v.sos_end)
             OR (v.sos_start > v.sos_end AND (${minute} >= v.sos_start OR ${minute} < v.sos_end)))
      ORDER BY COALESCE(cp.is_government OR cp.kind = 'govt', FALSE) DESC, v.decided_at
      LIMIT ${MAX_VETS_PAGED}
     ON CONFLICT DO NOTHING`,
    [caseId, wardId],
  );
  return ins.rowCount ?? 0;
}
