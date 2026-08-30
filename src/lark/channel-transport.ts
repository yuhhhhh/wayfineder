import {
  createLarkChannel,
  Domain,
  type LarkChannel,
  LoggerLevel,
  type NormalizedMessage,
} from "@larksuiteoapi/node-sdk";
import type { AppConfig } from "../config/index.js";
import type { Logger } from "../shared/logger.js";
import type { InboundMessage, MessageTransport } from "./types.js";

export class LarkChannelTransport implements MessageTransport {
  private readonly channel: LarkChannel;
  private connected = false;
  private readonly handlers = new Set<(message: InboundMessage) => void | Promise<void>>();

  constructor(config: AppConfig["lark"], logger: Logger) {
    if (!config.appId || !config.appSecret) throw new Error("Lark credentials are required");
    this.channel = createLarkChannel({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Domain.Feishu,
      transport: "websocket",
      includeRawEvent: false,
      handshakeTimeoutMs: 15_000,
      loggerLevel: LoggerLevel.warn,
      logger: {
        error: () => logger.error("lark_sdk_error"),
        warn: () => logger.warn("lark_sdk_warning"),
        info: () => logger.info("lark_sdk_info"),
        debug: () => logger.debug("lark_sdk_debug"),
        trace: () => undefined,
      },
      policy: {
        dmMode: "allowlist",
        dmAllowlist: [...config.userRoles.keys()],
        groupAllowlist: [...config.allowedChatIds],
        requireMention: true,
        respondToMentionAll: false,
      },
      safety: {
        staleMessageWindowMs: 5 * 60_000,
        chatQueue: { enabled: true },
        dedup: { ttl: 10 * 60_000, maxEntries: 10_000 },
      },
      outbound: {
        textChunkLimit: 3_000,
        retry: { maxAttempts: 2, baseDelayMs: 250 },
        ssrfGuard: true,
      },
      source: "wayfinder",
    });

    this.channel.on("message", async (message) => {
      const normalized = normalizeMessage(message);
      if (!normalized) {
        logger.warn("lark_message_rejected", { reason: "invalid_chat_type" });
        return;
      }
      for (const handler of this.handlers) await handler(normalized);
    });
    this.channel.on("error", (error) => {
      logger.warn("lark_transport_error", { errorType: error.code });
    });
    this.channel.on("reconnecting", () => {
      this.connected = false;
      logger.warn("lark_reconnecting");
    });
    this.channel.on("reconnected", () => {
      this.connected = true;
      logger.info("lark_reconnected");
    });
  }

  async connect(): Promise<void> {
    await this.channel.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.channel.disconnect();
  }

  onMessage(handler: (message: InboundMessage) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendText(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    await this.channel.send(
      chatId,
      { text: text.slice(0, 12_000) },
      replyToMessageId ? { replyTo: replyToMessageId } : undefined,
    );
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export function normalizeMessage(message: NormalizedMessage): InboundMessage | undefined {
  if (message.chatType !== "p2p" && message.chatType !== "group") return undefined;
  return {
    eventId: message.messageId,
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderOpenId: message.senderId,
    text: message.content,
    mentionedBot: message.mentionedBot,
    createdAt: new Date(message.createTime),
  };
}
