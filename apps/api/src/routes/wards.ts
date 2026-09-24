/**
 * GET /api/v1/wards: the 24 BMC wards, as { id, code, name }.
 *
 *   id    the canonical code stored in dogs.ward_id ("K-West")
 *   code  the short slash form BMC signage uses ("K/W")
 *   name  the locality people actually say ("Andheri West")
 *
 * Static: built once at module load from @hetja/contracts, so the list the
 * web registration form offers and the list the API validates against
 * (BMC_WARD_CODES) cannot drift. Public and cacheable for a day: it changes
 * only when a deploy changes it. Ward-level is as fine as any public surface
 * in this system names a place (INVARIANT 2).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { BMC_WARD_CODES, wardDisplay } from "@hetja/contracts";

export const WARDS: ReadonlyArray<{ id: string; code: string; name: string }> = BMC_WARD_CODES.map(
  (id) => {
    const display = wardDisplay(id);
    // Every canonical code has a name (BMC_WARD_NAMES is a Record over the
    // code type), so the fallback is unreachable; it keeps `name` a string.
    return { id, code: display.code, name: display.name ?? id };
  },
);

export default async function wardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/wards", async (_req, reply: FastifyReply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return { ok: true, data: { wards: WARDS } };
  });
}
