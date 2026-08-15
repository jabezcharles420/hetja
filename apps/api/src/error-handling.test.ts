/**
 * Error-surface regressions.
 *
 * Two defects, one shared root cause: nothing called `app.setErrorHandler`, so
 * any throw that escaped a route hit Fastify's default handler, which renders
 * `error.message` into the 500 body. Whatever internal detail the throw carried
 * went straight to the caller, authenticated or not.
 *
 *   1. `routes/medical.ts` called `verifyAccessToken` outside a try/catch.
 *      `verifyToken` THROWS on a malformed/mis-signed/expired token and never
 *      returns a falsy payload, so the `if (!payload)` guard beneath it was
 *      unreachable and a bad Bearer token produced
 *      `500 {"message":"malformed token"}` instead of a 401. Every other
 *      authenticated route wrapped the same call correctly; medical.ts — which
 *      guards the append-only ledger write — did not.
 *
 *   2. Routes that put a `:id` path param straight into a `uuid` column turned
 *      a non-UUID into a PostgreSQL 22P02, whose message quotes the offending
 *      input back at an unauthenticated caller.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { pool } from "@hetja/db";
import type { FastifyInstance } from "fastify";

const config = loadConfig();
let app: FastifyInstance;

beforeAll(() => {
  app = buildServer(config);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("authentication failures are 401s, not 500s", () => {
  // The token shapes that make verifyToken throw down each of its distinct
  // paths: wrong segment count, bad base64, and a well-formed token signed with
  // the wrong key.
  const badTokens: [name: string, token: string][] = [
    ["not a JWT at all", "garbage"],
    ["two segments", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0"],
    ["undecodable segments", "a.b.c"],
    [
      "correct shape, wrong signature",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAiLCJ0eXBlIjoiYWNjZXNzIiwiZXhwIjo5OTk5OTk5OTk5fQ." +
        "definitely-not-the-right-signature",
    ],
  ];

  it.each(badTokens)("POST /api/v1/medical_records rejects %s with 401", async (_name, token) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        dogId: randomUUID(),
        recordType: "feeding_observation",
        note: "regression fixture",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json() as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_TOKEN");
    // The internal JwtError text ("malformed token", "bad signature") must not
    // reach the client — that was the shape of the 500 this replaces.
    expect(body.error.message).toBe("invalid token");
  });
});

describe("the error handler does not leak internals", () => {
  it("answers a malformed JSON body with a 4xx in the API envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { "content-type": "application/json", authorization: "Bearer x.y.z" },
      payload: "{ this is not json",
    });

    // Fastify raises FST_ERR_CTP_INVALID_JSON_BODY (400) before routing. What
    // matters is that it comes back in this API's envelope rather than
    // Fastify's own {statusCode, error, message} shape, so a client has one
    // response format to parse.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    const body = res.json() as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeTruthy();
  });

  it("keeps a 404 a 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/definitely-not-a-route" });
    expect(res.statusCode).toBe(404);
  });

  it("still serves healthz", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });
});
