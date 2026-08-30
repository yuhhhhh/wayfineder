import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AssistantMessage, Model, Models, ToolCall } from "@earendil-works/pi-ai";
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
    throw new Error("No command-backed tool should execute in this test");
  },
};

describe("Pi tool audit lifecycle", () => {
  it("audits valid, invalid-parameter, and unknown tool calls exactly once", async () => {
    let id = 0;
    const ids: IdGenerator = { next: () => `id-${++id}` };
    const temporary = await createTemporaryDatabase(ids);
    const piDatabasePath = join(dirname(temporary.path), "pi.sqlite");
    let repositoryCloseCount = 0;
    const tools = createReadOnlyToolRegistry({
      runner,
      clock,
      database: temporary.database,
      config: temporary.config,
    });
    const responses = [
      assistant(
        [
          toolCall("call-valid", "get_nas_overview", {}),
          toolCall("call-invalid", "get_wifi_status", { injected: true }),
          toolCall("call-unknown", "read_file", {}),
        ],
        "toolUse",
      ),
      assistant([{ type: "text", text: "检查完成" }], "stop"),
    ];
    const models = {
      streamSimple() {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected model turn");
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => stream.push({ type: "done", reason: response.stopReason, message: response }));
        return stream;
      },
    } as unknown as Models;
    const service = new PiConversationService({
      models,
      model: testModel(),
      apiKey: "test-key",
      sessionRepositoryFactory: () => {
        const repository = createPiSessionRepository(piDatabasePath);
        const close = repository.close.bind(repository);
        repository.close = async () => {
          repositoryCloseCount += 1;
          await close();
        };
        return repository;
      },
      database: temporary.database,
      tools,
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
            conversationKey: "dm:conversation-hash",
            requestId: "request-1",
            role: "viewer",
          },
          externalEventId: "event-1",
          text: "status",
          isGroup: false,
        }),
      ).resolves.toBe("检查完成");
      expect(repositoryCloseCount).toBe(1);

      const raw = new DatabaseSync(temporary.path, { readOnly: true });
      try {
        const rows = raw
          .prepare(
            `SELECT tool_name, status, error_type, parameter_summary
             FROM audit_events WHERE request_id = 'request-1' ORDER BY tool_name`,
          )
          .all();
        expect(rows).toEqual([
          {
            tool_name: "get_nas_overview",
            status: "succeeded",
            error_type: null,
            parameter_summary: "{}",
          },
          {
            tool_name: "get_wifi_status",
            status: "denied",
            error_type: "tool_call_rejected_before_authorization",
            parameter_summary: '{"status":"unexpected_parameters_omitted"}',
          },
          {
            tool_name: "read_file",
            status: "denied",
            error_type: "unknown_tool",
            parameter_summary: '{"status":"unknown_tool_parameters_omitted"}',
          },
        ]);
      } finally {
        raw.close();
      }
    } finally {
      await service.close();
      await temporary.close();
    }
  });
});

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function assistant(
  content: AssistantMessage["content"],
  stopReason: Extract<AssistantMessage["stopReason"], "stop" | "length" | "toolUse" | "deferred">,
): AssistantMessage & { stopReason: "stop" | "length" | "toolUse" | "deferred" } {
  return {
    role: "assistant",
    content,
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
    stopReason,
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
