/**
 * Hetja API — Fastify bootstrap with health endpoint, CORS, and
 * graceful shutdown. Routes are registered per module (auth, devices, dogs,
 * scans, sos, push, medical, ledger, stories, moderation, trust, heatmap,
 * care, territories, gamification, metrics).
 */
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import etag from "@fastify/etag";
import { MAX_PHOTO_BASE64_CHARS } from "@hetja/contracts";
import { pool } from "@hetja/db";
import { loadConfig, type AppConfig } from "./config.js";
import authRoutes from "./routes/auth.js";
import deviceRoutes from "./routes/devices.js";
import dogRoutes from "./routes/dogs.js";
import scanRoutes from "./routes/scans.js";
import sosRoutes from "./routes/sos.js";
import pushRoutes from "./routes/push.js";
import medicalRoutes from "./routes/medical.js";
import ledgerRoutes from "./routes/ledger.js";
import storyRoutes from "./routes/stories.js";
import moderationRoutes from "./routes/moderation.js";
import trustRoutes from "./routes/trust.js";
import heatmapRoutes from "./routes/heatmap.js";
import careRoutes from "./routes/care.js";
import territoryRoutes from "./routes/territories.js";
import gamificationRoutes from "./routes/gamification.js";
import metricsRoutes from "./routes/metrics.js";

export function buildServer(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "warn" : "info",
      // RESEARCH-2: redact PII from logs — phone_hmac, exact coordinates,
      // device tokens, bearer tokens.
      redact: {
        paths: [
          "phone", "phoneHmac", "phone_hmac", "deviceToken", "device_token",
          "lat", "lng", "authorization", "token", "signature",
        ],
        censor: "[REDACTED]",
      },
      // Care directory (routes/care.ts) takes the reporter's lat/lng as GET
      // query params. Key-based `redact` above only strips top-level fields
      // of the *logged object*, not substrings inside another string field
      // -- and Fastify's default request log embeds the raw query string in
      // a single `url` field, so "lat"/"lng" in `redact.paths` never reaches
      // it. Override the req serializer to drop the query string entirely
      // from access logs instead (INVARIANT: reporter position is never
      // logged at full precision, plan docs/PLAN-v2.md §2.3).
      serializers: {
        req(request) {
          const [path] = request.url.split("?");
          return {
            method: request.method,
            url: path,
            hostname: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
    // RESEARCH-2: trustProxy must be pinned to the real proxy, never `true`
    // (true lets any client forge X-Forwarded-For).
    trustProxy: config.TRUST_PROXY || false,
    // Fastify's default body limit is 1 MiB, but `@hetja/contracts` accepts a
    // photo up to MAX_PHOTO_BASE64_CHARS (~2.8 MB of base64 for 2 MiB decoded)
    // and lib/exif-strip.ts enforces the same 2 MiB ceiling. So the contract
    // promised roughly three times what the transport would accept: a scan
    // carrying a photo over ~750 KB decoded was rejected by Fastify with
    // FST_ERR_CTP_BODY_TOO_LARGE before any route saw it. That 413 is a
    // permanent 4xx, and apps/web's offline queue drops permanent 4xx — so the
    // feed and its photo were discarded rather than retried. Sized to the
    // contract plus room for the surrounding JSON envelope.
    bodyLimit: MAX_PHOTO_BASE64_CHARS + 64 * 1024,
  });

  void app.register(helmet);
  // Brotli/gzip on the wire (Caddy also compresses at the edge; this covers
  // direct clients and the api.hetja.in origin). Enhancement stack §M.3.
  void app.register(compress);
  // ETag + conditional GET for cacheable routes. SOS state and dog pages are
  // explicitly excluded in the onSend hook below — never ETag a life-safety
  // state endpoint (a stale 304 for a case that just got acked is worse than
  // no cache at all). Enhancement stack §M.3.
  void app.register(etag, { weak: false });
  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/api/v1/sos") || request.url.startsWith("/api/v1/dogs")) {
      reply.removeHeader("etag");
      reply.header("Cache-Control", "no-store");
    }
  });
  void app.register(cors, {
    // Production: an exact allowlist from CORS_ORIGINS. Development reflects any
    // origin so local hosts and phones on the LAN can hit the dev server.
    origin:
      config.NODE_ENV === "production"
        ? config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
        : true,
    credentials: false,
  });
  app.decorate("config", config);

  /**
   * Anything a route throws instead of returning ends up here.
   *
   * There was no error handler at all, so Fastify's default applied: it echoes
   * `error.message` in the 500 body. Two live paths reached it with
   * attacker-controlled input — `medical.ts` let a `JwtError` escape (fixed
   * separately, it should be a 401), and any route interpolating a `:id` path
   * param into a `uuid` column turned `GET /api/v1/sos/cases/abc` into a
   * PostgreSQL 22P02 whose message quotes the input back. Neither leak is
   * catastrophic on its own; the pattern — internal errors rendered verbatim to
   * unauthenticated callers — is worth closing once rather than per route.
   *
   * Client errors keep their status and message: those are deliberate, and a
   * 400 that says only "error" is a support ticket. Anything >= 500 is logged
   * in full and answered with a fixed body.
   */
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, "unhandled error");
      return reply.status(status).send({
        ok: false,
        error: { message: "internal server error", code: "INTERNAL" },
      });
    }
    // Fastify's own 4xx (body too large, malformed JSON, unsupported media
    // type) arrive with a machine-readable `code` like FST_ERR_CTP_*. Pass it
    // through so a client can branch on it, in this API's envelope shape rather
    // than Fastify's.
    request.log.warn({ err }, "client error");
    return reply.status(status).send({
      ok: false,
      error: { message: err.message, code: err.code ?? "BAD_REQUEST" },
    });
  });

  app.get("/healthz", async () => ({
    ok: true,
    service: "hetja-api",
    time: new Date().toISOString(),
  }));

  app.get("/", async () => ({
    service: "Hetja API",
    docs: "/docs",
  }));

  void app.register(authRoutes);
  void app.register(deviceRoutes);
  void app.register(dogRoutes);
  void app.register(scanRoutes);
  void app.register(sosRoutes);
  void app.register(pushRoutes);
  void app.register(medicalRoutes);
  void app.register(ledgerRoutes);
  void app.register(storyRoutes);
  void app.register(moderationRoutes);
  void app.register(trustRoutes);
  void app.register(heatmapRoutes);
  void app.register(careRoutes);
  void app.register(territoryRoutes);
  void app.register(gamificationRoutes);
  void app.register(metricsRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const config = loadConfig();
  const app = buildServer(config);
  // Guards against a second signal re-entering shutdown while the first is
  // still draining, which would call app.close() twice.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    // A bounded drain. `app.close()` waits for in-flight requests, and without a
    // ceiling one stuck request holds the process until systemd's
    // TimeoutStopSec fires SIGKILL — which is the same outcome, minus the log
    // line saying why. Previously this had no timeout AND no catch, so a
    // rejecting close() left `process.exit(0)` unreachable inside a floating
    // promise: the unit hung on every deploy restart with no diagnostic.
    const FORCE_EXIT_MS = 10_000;
    const timer = setTimeout(() => {
      app.log.error(`shutdown did not complete within ${FORCE_EXIT_MS}ms — exiting anyway`);
      process.exit(1);
    }, FORCE_EXIT_MS);
    timer.unref();
    try {
      await app.close();
      // Release the pool explicitly. Without it the Postgres connections are
      // torn down by process exit rather than closed, which shows up on the
      // server as a burst of "unexpected EOF on client connection" on every
      // deploy.
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  app
    .listen({ host: config.HOST, port: config.PORT })
    .then(() => {
      app.log.info(`Hetja API listening on ${config.HOST}:${config.PORT}`);
    })
    // Without this, a failure to bind (EADDRINUSE, EACCES on a privileged port)
    // was an unhandled rejection: no log line, and the exit code depended on the
    // Node version's unhandled-rejection policy. systemd would restart it into
    // the same failure with nothing in the journal explaining it.
    .catch((err: unknown) => {
      app.log.error({ err }, `failed to listen on ${config.HOST}:${config.PORT}`);
      process.exit(1);
    });
}
