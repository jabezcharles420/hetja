/**
 * StrayNet API — Fastify bootstrap with health endpoint, CORS, and
 * graceful shutdown. Routes are registered per module (auth, dogs, scans,
 * sos, medical, ledger, stories, moderation, trust, heatmap, territories).
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { loadConfig, type AppConfig } from "./config.js";
import authRoutes from "./routes/auth.js";
import dogRoutes from "./routes/dogs.js";
import scanRoutes from "./routes/scans.js";
import sosRoutes from "./routes/sos.js";
import medicalRoutes from "./routes/medical.js";
import ledgerRoutes from "./routes/ledger.js";
import storyRoutes from "./routes/stories.js";
import moderationRoutes from "./routes/moderation.js";
import trustRoutes from "./routes/trust.js";
import heatmapRoutes from "./routes/heatmap.js";
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
    },
    // RESEARCH-2: trustProxy must be pinned to the real proxy, never `true`
    // (true lets any client forge X-Forwarded-For).
    trustProxy: config.TRUST_PROXY || false,
  });

  void app.register(helmet);
  void app.register(cors, {
    // Tighten from reflect-any-origin to the scan origin + dev hosts.
    origin:
      config.NODE_ENV === "production"
        ? [/\.straynet\.in$/, /\.pages\.dev$/]
        : true,
  });
  app.decorate("config", config);

  app.get("/healthz", async () => ({
    ok: true,
    service: "straynet-api",
    time: new Date().toISOString(),
  }));

  app.get("/", async () => ({
    service: "StrayNet API",
    docs: "/docs",
  }));

  void app.register(authRoutes);
  void app.register(dogRoutes);
  void app.register(scanRoutes);
  void app.register(sosRoutes);
  void app.register(medicalRoutes);
  void app.register(ledgerRoutes);
  void app.register(storyRoutes);
  void app.register(moderationRoutes);
  void app.register(trustRoutes);
  void app.register(heatmapRoutes);
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
  app.listen({ host: "0.0.0.0", port: config.PORT }).then(() => {
    app.log.info(`StrayNet API listening on :${config.PORT}`);
  });
}
