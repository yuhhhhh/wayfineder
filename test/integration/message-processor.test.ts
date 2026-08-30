import { describe, expect, it } from "vitest";
import type { AnswerRequest, AnswerService } from "../../src/agent/service.js";
import type { AppConfig } from "../../src/config/index.js";
import { MessageProcessor } from "../../src/lark/message-processor.js";
import type { InboundMessage, MessageTransport } from "../../src/lark/types.js";
import { AccessPolicy } from "../../src/policy/access-policy.js";
import type { Logger } from "../../src/shared/logger.js";
import type { Clock, IdGenerator } from "../../src/shared/types.js";
import { createTemporaryDatabase } from "../utils/database.js";

class FakeTransport implements MessageTransport {
  readonly sent: Array<{ chatId: string; text: string }> = [];
  async connect() {}
  async disconnect() {}
  onMessage() {
    return () => undefined;
  }
  async sendText(chatId: string, text: string) {
    this.sent.push({ chatId, text });
  }
  isConnected() {
    return true;
  }
}

class FakeAnswers implements AnswerService {
  readonly requests: AnswerRequest[] = [];
  async answer(request: AnswerRequest) {
    this.requests.push(request);
    await request.onProgress?.("get_nas_overview");
    return "NAS 正常";
  }
}

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const config = {
  service: { maximumConcurrentRequests: 2, maximumQueuedRequests: 2, maximumMessageCharacters: 4_000 },
} as AppConfig;

const inbound = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  eventId: "event-1",
  messageId: "message-1",
  chatId: "oc_allowed",
  chatType: "p2p",
  senderOpenId: "ou_viewer",
  text: "NAS 状态怎么样？",
  mentionedBot: false,
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
  ...overrides,
});

describe("Lark message processing", () => {
  it("processes a duplicate event exactly once", async () => {
    const ids: IdGenerator = (() => {
      let index = 0;
      return { next: () => `request-${++index}` };
    })();
    const temporary = await createTemporaryDatabase(ids);
    const transport = new FakeTransport();
    const answers = new FakeAnswers();
    const policy = new AccessPolicy({
      enabled: true,
      userRoles: new Map([["ou_viewer", "viewer"]]),
      allowedChatIds: new Set(["oc_allowed"]),
    });
    const processor = new MessageProcessor({
      transport,
      answers,
      policy,
      database: temporary.database,
      ids,
      clock,
      logger,
      config,
    });
    try {
      processor.accept(inbound());
      processor.accept(inbound());
      await processor.stopAcceptingAndDrain();
      expect(answers.requests).toHaveLength(1);
      expect(transport.sent.some((entry) => entry.text.includes("NAS 正常"))).toBe(true);
    } finally {
      await temporary.close();
    }
  });

  it("silently ignores an allowed group that did not mention the bot", async () => {
    const ids: IdGenerator = { next: () => "request-1" };
    const temporary = await createTemporaryDatabase(ids);
    const transport = new FakeTransport();
    const answers = new FakeAnswers();
    const policy = new AccessPolicy({
      enabled: true,
      userRoles: new Map([["ou_viewer", "viewer"]]),
      allowedChatIds: new Set(["oc_allowed"]),
    });
    const processor = new MessageProcessor({
      transport,
      answers,
      policy,
      database: temporary.database,
      ids,
      clock,
      logger,
      config,
    });
    try {
      processor.accept(inbound({ chatType: "group", mentionedBot: false }));
      await processor.stopAcceptingAndDrain();
      expect(answers.requests).toHaveLength(0);
      expect(transport.sent).toHaveLength(0);
    } finally {
      await temporary.close();
    }
  });

  it("acknowledges a queued request before it obtains an execution slot", async () => {
    let index = 0;
    const ids: IdGenerator = { next: () => `request-${++index}` };
    const temporary = await createTemporaryDatabase(ids);
    const transport = new FakeTransport();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answers: AnswerService = {
      async answer() {
        await gate;
        return "done";
      },
    };
    const policy = new AccessPolicy({
      enabled: true,
      userRoles: new Map([["ou_viewer", "viewer"]]),
      allowedChatIds: new Set(["oc_allowed"]),
    });
    const processor = new MessageProcessor({
      transport,
      answers,
      policy,
      database: temporary.database,
      ids,
      clock,
      logger,
      config: {
        ...config,
        service: { ...config.service, maximumConcurrentRequests: 1, maximumQueuedRequests: 1 },
      },
    });
    try {
      processor.accept(inbound({ eventId: "event-1", messageId: "message-1" }));
      processor.accept(inbound({ eventId: "event-2", messageId: "message-2" }));
      await Promise.resolve();
      expect(
        transport.sent.some(
          (entry) => entry.text.includes("请求已接收，正在排队") && entry.text.includes("request-2"),
        ),
      ).toBe(true);
      release?.();
      await processor.stopAcceptingAndDrain();
    } finally {
      await temporary.close();
    }
  });
});
