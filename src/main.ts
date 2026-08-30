import { createConfiguredModelRuntime } from "./agent/model-runtime.js";
import { PiConversationService } from "./agent/service.js";
import { loadConfig } from "./config/index.js";
import { LarkChannelTransport } from "./lark/channel-transport.js";
import { MessageProcessor } from "./lark/message-processor.js";
import { HealthServer } from "./monitoring/health-server.js";
import { AccessPolicy } from "./policy/access-policy.js";
import { randomIdGenerator } from "./shared/ids.js";
import { createJsonLogger } from "./shared/logger.js";
import { systemClock } from "./shared/types.js";
import { WayfinderDatabase } from "./storage/database.js";
import { createPiSessionRepository } from "./storage/pi-sessions.js";
import { SpawnProcessRunner } from "./tools/adapters/process-runner.js";
import { createReadOnlyToolRegistry } from "./tools/registry.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createJsonLogger(config.environment === "development" ? "debug" : "info");
  const database = await WayfinderDatabase.open(config.businessDatabasePath, randomIdGenerator);
  const runner = new SpawnProcessRunner(config.tools.maximumConcurrentCommands);
  const policy = new AccessPolicy(config.lark);
  const tools = createReadOnlyToolRegistry({ runner, clock: systemClock, database, config });

  let transport: LarkChannelTransport | undefined;
  let processor: MessageProcessor | undefined;
  let answers: PiConversationService | undefined;
  let unsubscribe: (() => void) | undefined;
  let health: HealthServer | undefined;

  if (config.lark.enabled && config.model.enabled) {
    const modelRuntime = createConfiguredModelRuntime(config.model);
    transport = new LarkChannelTransport(config.lark, logger);
    answers = new PiConversationService({
      ...modelRuntime,
      sessionRepositoryFactory: () => createPiSessionRepository(config.piDatabasePath),
      database,
      tools,
      policy,
      ids: randomIdGenerator,
      clock: systemClock,
      logger,
      modelTimeoutMs: config.model.timeoutMs,
    });
    processor = new MessageProcessor({
      transport,
      answers,
      policy,
      database,
      ids: randomIdGenerator,
      clock: systemClock,
      logger,
      config,
    });
    unsubscribe = transport.onMessage((message) => processor?.accept(message));
  }

  try {
    health = new HealthServer({
      host: config.health.host,
      port: config.health.port,
      database,
      ...(transport ? { lark: transport } : {}),
      larkEnabled: config.lark.enabled,
      modelEnabled: config.model.enabled,
      logger,
    });
    await health.start();
    if (transport) await transport.connect();
  } catch (error) {
    unsubscribe?.();
    await transport?.disconnect().catch(() => undefined);
    if (answers) await answers.close().catch(() => undefined);
    await health?.close().catch(() => undefined);
    database.close();
    throw error;
  }

  logger.info("wayfinder_started", {
    environment: config.environment,
    larkEnabled: config.lark.enabled,
    modelEnabled: config.model.enabled,
    toolNames: tools.names(),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    health?.markShuttingDown();
    logger.info("wayfinder_stopping", { signal });
    unsubscribe?.();
    const drained = (await processor?.stopAcceptingAndDrain(10_000)) ?? true;
    if (!drained) logger.warn("shutdown_drain_timed_out");
    const sessionsClosed = answers ? await settleWithin("agent_close", answers.close(), 8_000, logger) : true;
    const secondDrain = drained ? true : ((await processor?.stopAcceptingAndDrain(2_000)) ?? true);
    const fullyDrained = drained || secondDrain;
    if (transport) await settleWithin("lark_disconnect", transport.disconnect(), 2_000, logger);
    if (health) await settleWithin("health_close", health.close(), 2_000, logger);
    if (sessionsClosed && fullyDrained) database.close();
    else {
      logger.error("database_close_skipped", {
        reason: sessionsClosed ? "message_tasks_still_active" : "agent_may_still_be_active",
      });
    }
    logger.info("wayfinder_stopped");
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  const logger = createJsonLogger("info");
  logger.error("wayfinder_start_failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});

async function settleWithin(
  operation: string,
  promise: Promise<unknown>,
  timeoutMs: number,
  logger: ReturnType<typeof createJsonLogger>,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const settled = await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
      }),
    ]);
    if (!settled) logger.warn("shutdown_step_timed_out", { operation });
    return settled;
  } catch (error) {
    logger.error("shutdown_step_failed", {
      operation,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
