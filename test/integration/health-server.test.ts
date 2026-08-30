import { describe, expect, it } from "vitest";
import { HealthServer } from "../../src/monitoring/health-server.js";
import type { Logger } from "../../src/shared/logger.js";
import type { IdGenerator } from "../../src/shared/types.js";
import { createTemporaryDatabase } from "../utils/database.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const ids: IdGenerator = { next: () => "id" };

describe("health server", () => {
  it("exposes stable live, degraded-ready, method, not-found, and stopping responses", async () => {
    const temporary = await createTemporaryDatabase(ids);
    const health = new HealthServer({
      host: "127.0.0.1",
      port: 0,
      database: temporary.database,
      larkEnabled: false,
      modelEnabled: false,
      logger,
    });
    await health.start();
    const url = (path: string) => `http://127.0.0.1:${health.port()}${path}`;
    try {
      const live = await fetch(url("/health/live"));
      expect(live.status).toBe(200);
      await expect(live.json()).resolves.toEqual({ status: "ok" });

      const ready = await fetch(url("/health/ready"));
      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toEqual({
        status: "degraded",
        reasonCodes: ["lark_disabled", "model_disabled"],
      });

      expect((await fetch(url("/health/live"), { method: "POST" })).status).toBe(405);
      expect((await fetch(url("/missing"))).status).toBe(404);

      health.markShuttingDown();
      expect((await fetch(url("/health/live"))).status).toBe(503);
      expect((await fetch(url("/health/ready"))).status).toBe(503);
    } finally {
      await health.close();
      await temporary.close();
    }
  });
});
