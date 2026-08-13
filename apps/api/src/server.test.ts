import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

/**
 * Cache-header contract (enhancement stack §M.3): cacheable GETs get an ETag;
 * life-safety paths (/api/v1/sos/*, /api/v1/dogs/*) never do — a stale 304
 * for a case that just got acked is worse than no cache at all. The onSend
 * hook in server.ts enforces it, and Caddy's Cache-Control policy
 * (ops/check-caddy-cache.sh) mirrors the same rule at the edge.
 */
describe("cache headers (M.3)", () => {
  it("tags cacheable responses with an ETag and no no-store", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers["cache-control"] ?? "").not.toContain("no-store");
    await app.close();
  });

  it("never ETags /api/v1/sos/* and forces no-store", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: "/api/v1/sos/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers["cache-control"]).toContain("no-store");
    await app.close();
  });

  it("never ETags /api/v1/dogs/* and forces no-store", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: "/api/v1/dogs/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers["cache-control"]).toContain("no-store");
    await app.close();
  });
});
