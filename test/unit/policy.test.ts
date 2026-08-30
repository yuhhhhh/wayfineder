import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../../src/lark/types.js";
import { AccessPolicy, buildConversationKey } from "../../src/policy/access-policy.js";

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  eventId: "event-1",
  messageId: "message-1",
  chatId: "oc_allowed",
  chatType: "p2p",
  senderOpenId: "ou_viewer",
  text: "status",
  mentionedBot: false,
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
  ...overrides,
});

const policy = new AccessPolicy({
  enabled: true,
  userRoles: new Map([
    ["ou_viewer", "viewer"],
    ["ou_operator", "operator"],
  ]),
  allowedChatIds: new Set(["oc_allowed"]),
});

describe("access policy", () => {
  it("allows a known direct-message user and hashes the conversation key", () => {
    const decision = policy.authorizeInbound(message(), "request-1");
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.actor.role).toBe("viewer");
    expect(decision.actor.conversationKey).toMatch(/^dm:[a-f0-9]{24}$/);
    expect(decision.actor.conversationKey).not.toContain("ou_viewer");
  });

  it("silently ignores group messages without an explicit bot mention", () => {
    expect(policy.authorizeInbound(message({ chatType: "group" }), "request-1")).toEqual({
      allowed: false,
      reason: "mention_required",
      silent: true,
    });
  });

  it("denies unknown users before any tool decision", () => {
    const decision = policy.authorizeInbound(message({ senderOpenId: "ou_unknown" }), "request-1");
    expect(decision.allowed).toBe(false);
  });

  it("fails closed for an unknown runtime chat type", () => {
    const decision = policy.authorizeInbound(
      message({ chatType: "channel" as InboundMessage["chatType"] }),
      "request-1",
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "malformed_identity",
      silent: true,
    });
  });

  it("isolates direct messages by user and chat but groups only by chat", () => {
    const dmA = buildConversationKey(message({ senderOpenId: "ou_a" }));
    const dmB = buildConversationKey(message({ senderOpenId: "ou_b" }));
    const groupA = buildConversationKey(message({ chatType: "group", senderOpenId: "ou_a" }));
    const groupB = buildConversationKey(message({ chatType: "group", senderOpenId: "ou_b" }));
    expect(dmA).not.toBe(dmB);
    expect(groupA).toBe(groupB);
  });

  it("allows only registered read-only tools for a viewer", () => {
    expect(policy.authorizeTool("viewer", { risk: "read_only" })).toEqual({ allowed: true });
    expect(policy.authorizeTool("viewer", undefined)).toEqual({ allowed: false, reason: "unknown_tool" });
    expect(policy.authorizeTool("viewer", { risk: "recoverable" })).toEqual({
      allowed: false,
      reason: "insufficient_role",
    });
    expect(policy.authorizeTool("admin", { risk: "high_risk" })).toEqual({
      allowed: false,
      reason: "high_risk_disabled",
    });
  });
});
