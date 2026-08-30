import { type AgentMessage, estimateTokens } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { boundToolResultForModel, trimContextForModel } from "../../src/agent/service.js";

describe("agent context budget", () => {
  it("keeps the newest messages within count and approximate character budgets", () => {
    const messages = Array.from(
      { length: 100 },
      (_, index) =>
        ({
          role: "user",
          content: `${index}:${"x".repeat(1_000)}`,
          timestamp: index,
        }) as AgentMessage,
    );

    const trimmed = trimContextForModel(messages, 4_000);

    expect(trimmed.length).toBeLessThanOrEqual(80);
    expect(Buffer.byteLength(JSON.stringify(trimmed), "utf8")).toBeLessThanOrEqual(8_000);
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
    expect(trimmed[0]?.role).toBe("user");
    expect(trimmed.length).toBeLessThan(messages.length);
  });

  it("compacts a single oversized CJK message below the hard byte budget", () => {
    const message = {
      role: "user",
      content: "状".repeat(20_000),
      timestamp: 1,
    } as AgentMessage;

    const trimmed = trimContextForModel([message], 4_000);

    expect(Buffer.byteLength(JSON.stringify(trimmed), "utf8")).toBeLessThanOrEqual(6_000);
    expect(trimmed.reduce((total, item) => total + estimateTokens(item), 0)).toBeLessThanOrEqual(2_000);
    expect(trimmed[0]?.role).toBe("user");
    expect(JSON.stringify(trimmed)).toContain("truncated by context budget");
  });

  it("keeps an oversized assistant tool call paired with its tool result", () => {
    const toolCallId = "call-1";
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "get_wifi_status",
            arguments: { payload: "状".repeat(20_000) },
          },
        ],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId,
        toolName: "get_wifi_status",
        content: [{ type: "text", text: "状".repeat(20_000) }],
        details: { payload: "状".repeat(20_000) },
        isError: false,
        timestamp: 2,
      },
    ] as AgentMessage[];

    const trimmed = trimContextForModel(messages, 4_000);

    expect(trimmed.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
    expect(Buffer.byteLength(JSON.stringify(trimmed), "utf8")).toBeLessThanOrEqual(6_000);
    expect(trimmed.reduce((total, item) => total + estimateTokens(item), 0)).toBeLessThanOrEqual(2_000);
    expect(trimmed[1]?.role === "toolResult" && trimmed[1].toolCallId).toBe(toolCallId);
  });

  it("replaces oversized model-visible tool details with bounded metadata", () => {
    const bounded = boundToolResultForModel({ status: "ok", payload: "状".repeat(20_000) });

    expect(bounded).toMatchObject({
      status: "ok",
      truncated: true,
      reason: "tool_result_size_limit",
    });
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThan(16_384);
  });
});
