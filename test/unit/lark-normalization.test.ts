import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../../src/lark/channel-transport.js";

describe("Lark message normalization", () => {
  it("maps the SDK identity, chat, mention, time, and durable event key", () => {
    const normalized = normalizeMessage({
      messageId: "om_message",
      chatId: "oc_chat",
      chatType: "group",
      senderId: "ou_sender",
      content: "NAS 状态怎么样？",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: true,
      createTime: 1_787_000_000_000,
    });
    expect(normalized).toEqual({
      eventId: "om_message",
      messageId: "om_message",
      chatId: "oc_chat",
      chatType: "group",
      senderOpenId: "ou_sender",
      text: "NAS 状态怎么样？",
      mentionedBot: true,
      createdAt: new Date(1_787_000_000_000),
    });
  });

  it("rejects an unknown runtime chat type instead of treating it as a direct message", () => {
    const normalized = normalizeMessage({
      messageId: "om_message",
      chatId: "oc_chat",
      chatType: "channel" as "p2p",
      senderId: "ou_sender",
      content: "status",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
      createTime: 1_787_000_000_000,
    });
    expect(normalized).toBeUndefined();
  });
});
