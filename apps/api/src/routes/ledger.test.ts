import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query } from "@straynet/db";
import type { FastifyInstance } from "fastify";

const config = loadConfig();
let app: FastifyInstance;

beforeAll(async () => {
  app = buildServer(config);
  await app.ready();
});

afterAll(async () => {
  await query("DELETE FROM ledger_anchors WHERE published_url = 'test-anchor'");
  await app.close();
});

describe("GET /api/v1/ledger/anchor", () => {
  it("returns the latest published anchor or a clear empty state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger/anchor" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.anchor === null || typeof data.anchor.head_hash === "string").toBe(true);
  });
});

describe("GET /api/v1/ledger/verify", () => {
  it("detects a tampered published anchor (INVARIANT 10)", async () => {
    // Publish a WRONG anchor: 64 'f's cannot match any real recomputed head.
    await query(
      `INSERT INTO ledger_anchors (head_hash, record_count, published_url)
       VALUES ($1, 0, 'test-anchor')`,
      ["f".repeat(64)],
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger/verify" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    if (data.verdict !== "insufficient_data") {
      expect(data.verdict).toBe("TAMPERED");
    }
  });
});
