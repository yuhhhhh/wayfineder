import { dirname, join } from "node:path";
import type { AssistantMessage, Context, Model, Models } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { PiConversationService } from "../../src/agent/service.js";
import { AccessPolicy } from "../../src/policy/access-policy.js";
import type { Logger } from "../../src/shared/logger.js";
import type { Clock, IdGenerator } from "../../src/shared/types.js";
import { createPiSessionRepository } from "../../src/storage/pi-sessions.js";
import type { ProcessRunner } from "../../src/tools/adapters/process-runner.js";
import { createReadOnlyToolRegistry } from "../../src/tools/registry.js";
import { createTemporaryDatabase } from "../utils/database.js";

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const runner: ProcessRunner = {
  async run() {
    throw new Error("No tool should execute in this session-window test");
  },
};

describe("Pi conversation restore window", () => {
  it("restores the newest 80 entries in chronological order and drops a leading orphan tool result", async () => {
    let id = 0;
    const ids: IdGenerator = { next: () => `id-${++id}` };
    const temporary = await createTemporaryDatabase(ids);
    const piDatabasePath = join(dirname(temporary.path), "pi.sqlite");
    const conversationKey = "dm:session-window";
    const piSessionId = "pi-session-window";
    const seedRepository = createPiSessionRepository(piDatabasePath);
    const session = await seedRepository.create({
      id: piSessionId,
      cwd: "wayfinder",
      metadata: { conversationKey },
    });
    for (let index = 0; index < 90; index += 1) {
      if (index === 10) {
        await session.appendMessage({
          role: "toolResult",
          toolCallId: "excluded-call",
          toolName: "get_wifi_status",
          content: [{ type: "text", text: "excluded orphan" }],
          isError: false,
          timestamp: index,
        });
      } else {
        await session.appendMessage({ role: "user", content: `history-${index}`, timestamp: index });
      }
    }
    await seedRepository.close();
    temporary.database.createSession({
      conversationKey,
      piSessionId,
      chatHash: "chat-hash",
      timestamp: clock.now().toISOString(),
    });

    let observedMessages: Context["messages"] = [];
    const response = assistant("window-ok");
    const models = {
      streamSimple(_model: Model<string>, context: Context) {
        observedMessages = context.messages;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: response }));
        return stream;
      },
    } as unknown as Models;
    const service = new PiConversationService({
      models,
      model: testModel(),
      apiKey: "test-key",
      sessionRepositoryFactory: () => createPiSessionRepository(piDatabasePath),
      database: temporary.database,
      tools: createReadOnlyToolRegistry({
        runner,
        clock,
        database: temporary.database,
        config: temporary.config,
      }),
      policy: new AccessPolicy({ enabled: true, userRoles: new Map(), allowedChatIds: new Set() }),
      ids,
      clock,
      logger,
      modelTimeoutMs: 5_000,
    });

    try {
      await expect(
        service.answer({
          actor: {
            actorHash: "actor-hash",
            chatHash: "chat-hash",
            conversationKey,
            requestId: "request-window",
            role: "viewer",
          },
          externalEventId: "event-window",
          text: "current-request",
          isGroup: false,
        }),
      ).resolves.toBe("window-ok");

      expect(observedMessages[0]).toMatchObject({ role: "user", content: "history-11" });
      expect(observedMessages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "current-request" }],
      });
      expect(observedMessages).toHaveLength(80);
      expect(observedMessages.some((message) => message.role === "toolResult")).toBe(false);
      expect(
        observedMessages.some((message) => message.role === "user" && message.content === "history-0"),
      ).toBe(false);
    } finally {
      await service.close();
      await temporary.close();
    }
  });
});

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function testModel(): Model<string> {
  return {
    id: "test-model",
    name: "Test model",
    api: "test-api",
    provider: "test-provider",
    baseUrl: "https://invalid.example",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
  };
}
