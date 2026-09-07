/**
 * The localStorage key the attested device token lives under.
 *
 * In its own module so that flush.ts — which service-worker.ts bundles — can
 * forget a token the server has rejected WITHOUT importing device.ts, which
 * pulls the whole @hetja/pow solver into the worker bundle. Shared with
 * apps/web deliberately: Caddy serves both surfaces from one hostname, so a
 * feeder who scanned a collar before signing in pays for the proof-of-work
 * once (see device.ts for why that joins no records server-side).
 */
export const DEVICE_TOKEN_KEY = "hetja.deviceToken.v1";
