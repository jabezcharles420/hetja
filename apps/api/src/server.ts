/**
 * Hetja API — Fastify bootstrap with health endpoint, CORS, and
 * graceful shutdown. Routes are registered per module (auth, devices, dogs,
 * scans, sos, push, medical, ledger, stories, moderation, trust, heatmap,
 * care, territories, gamification).
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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
  });

  void app.register(helmet);
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
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  app.listen({ host: config.HOST, port: config.PORT }).then(() => {
    app.log.info(`Hetja API listening on ${config.HOST}:${config.PORT}`);
  });
}
