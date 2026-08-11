/**
 * StrayNet API — Fastify bootstrap with health endpoint, CORS, and
 * graceful shutdown. Routes are registered per module (auth, dogs, scans,
 * sos, medical, ledger, stories, moderation, trust, heatmap).
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadConfig, type AppConfig } from "./config.js";
import authRoutes from "./routes/auth.js";
import dogRoutes from "./routes/dogs.js";
import scanRoutes from "./routes/scans.js";
import sosRoutes from "./routes/sos.js";
import medicalRoutes from "./routes/medical.js";
import ledgerRoutes from "./routes/ledger.js";

export function buildServer(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: { level: config.NODE_ENV === "test" ? "warn" : "info" },
    trustProxy: true,
  });

  void app.register(cors, { origin: true });
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
