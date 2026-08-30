import { createServer, type Server } from "node:http";
import type { MessageTransport } from "../lark/types.js";
import type { Logger } from "../shared/logger.js";
import type { WayfinderDatabase } from "../storage/database.js";

export class HealthServer {
  private readonly server: Server;
  private shuttingDown = false;

  constructor(
    private readonly options: {
      host: string;
      port: number;
      database: WayfinderDatabase;
      lark?: MessageTransport;
      larkEnabled: boolean;
      modelEnabled: boolean;
      logger: Logger;
    },
  ) {
    this.server = createServer((request, response) => {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      if (request.method !== "GET") {
        response.writeHead(405).end(JSON.stringify({ status: "method_not_allowed" }));
        return;
      }
      if (request.url === "/health/live") {
        const live = !this.shuttingDown;
        response.writeHead(live ? 200 : 503).end(JSON.stringify({ status: live ? "ok" : "stopping" }));
        return;
      }
      if (request.url === "/health/ready") {
        const storage = this.options.database.healthCheck();
        const reasonCodes: string[] = [];
        if (!storage.ok) reasonCodes.push(storage.reason);
        if (!this.options.larkEnabled) reasonCodes.push("lark_disabled");
        else if (!this.options.lark?.isConnected()) reasonCodes.push("lark_disconnected");
        if (!this.options.modelEnabled) reasonCodes.push("model_disabled");
        if (this.shuttingDown) reasonCodes.push("service_stopping");
        const ready = storage.ok && !this.shuttingDown;
        const status = ready ? (reasonCodes.length > 0 ? "degraded" : "ok") : "not_ready";
        response.writeHead(ready ? 200 : 503).end(JSON.stringify({ status, reasonCodes }));
        return;
      }
      response.writeHead(404).end(JSON.stringify({ status: "not_found" }));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    this.options.logger.info("health_server_started", {
      host: this.options.host,
      port: this.port(),
    });
  }

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  port(): number {
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Health server is not listening on TCP");
    return address.port;
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
