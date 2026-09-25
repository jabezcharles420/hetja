/**
 * Request body ceilings (hardening batch 1, T5, audit A-06).
 *
 * The whole API used to accept MAX_PHOTO_BASE64_CHARS + 64 KiB (~2.9 MB) on
 * EVERY route, because the scan photo needed it. Fastify buffers and parses a
 * JSON body before any handler runs, so any unauthenticated caller could make
 * the process hold ~3 MB per request on /auth/otp, /devices/token or any other
 * public POST, inside an 80 MB heap. Now the default is 64 KiB, which is far
 * above any non-photo payload this API defines, and only the two routes that
 * take a photo opt into the large limit:
 *
 *   POST /api/v1/scans     photoBase64 (routes/scans.ts)
 *   POST /api/v1/reports   photoBase64 (routes/sos.ts)
 *
 * /scans also refuses an unauthenticated request in onRequest, before the body
 * is read at all, so the large limit is only ever spent on a caller holding a
 * Bearer token or a valid device token.
 */
import { MAX_PHOTO_BASE64_CHARS } from "@hetja/contracts";

/** Every route that does not say otherwise. */
export const GLOBAL_BODY_LIMIT = 64 * 1024;

/**
 * The two photo routes: the contract's base64 ceiling plus room for the JSON
 * envelope around it. Must stay at least this large, or a 2 MiB photo from the
 * offline queue hits a permanent 413 and is dropped with its feed (the bug the
 * old global limit was raised to fix).
 */
export const PHOTO_ROUTE_BODY_LIMIT = MAX_PHOTO_BASE64_CHARS + 64 * 1024;
