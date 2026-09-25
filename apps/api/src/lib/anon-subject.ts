/**
 * The rate-limit subject for an anonymous request (design v5).
 *
 * A valid `x-device-token` is always preferred: INVARIANT 6 keys limits on an
 * attested device, never on an address, wherever a device exists. Only when
 * the request carries none (the public lookup and ward reads are called with
 * no credential at all) does the subject fall back to the client address, by
 * ipBucketKey (IPv4 as is, IPv6 by its /64). Those fallbacks are the IP-keyed
 * limits docs/INVARIANTS.md #6 records for design v5; every one of them is
 * paired with a global bucket.
 */
import type { FastifyRequest } from "fastify";
import { deviceTokenSubject } from "./device.js";
import { ipBucketKey, type SubjectKind } from "./rate-limit.js";

export interface AnonSubject {
  key: string;
  kind: SubjectKind;
  /** The canonical device id, when a valid device token was presented. */
  deviceSubject: string | null;
}

export function deviceSubjectOf(req: FastifyRequest): string | null {
  const token = req.headers["x-device-token"];
  return typeof token === "string" && token.length > 0
    ? deviceTokenSubject(token, req.server.config.HETJA_DEVICE_SECRET)
    : null;
}

export function anonSubject(req: FastifyRequest): AnonSubject {
  const deviceSubject = deviceSubjectOf(req);
  if (deviceSubject) return { key: `dev:${deviceSubject}`, kind: "device", deviceSubject };
  return { key: ipBucketKey(req.ip), kind: "ip", deviceSubject: null };
}
