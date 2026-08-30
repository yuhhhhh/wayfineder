import type { AnswerService } from "../agent/service.js";
import type { AppConfig } from "../config/index.js";
import type { AccessPolicy } from "../policy/access-policy.js";
import { BoundedSemaphore, CapacityError } from "../shared/concurrency.js";
import type { Logger } from "../shared/logger.js";
import type { Clock, IdGenerator } from "../shared/types.js";
import type { WayfinderDatabase } from "../storage/database.js";
import type { InboundMessage, MessageTransport } from "./types.js";

export class MessageProcessor {
  private readonly capacity: BoundedSemaphore;
  private accepting = true;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly dependencies: {
      transport: MessageTransport;
      answers: AnswerService;
      policy: AccessPolicy;
      database: WayfinderDatabase;
      ids: IdGenerator;
      clock: Clock;
      logger: Logger;
      config: AppConfig;
    },
  ) {
    this.capacity = new BoundedSemaphore(
      dependencies.config.service.maximumConcurrentRequests,
      dependencies.config.service.maximumQueuedRequests,
    );
  }

  accept(message: InboundMessage): void {
    if (!this.accepting) return;
    const requestId = this.dependencies.ids.next();
    const decision = this.dependencies.policy.authorizeInbound(message, requestId);
    if (!decision.allowed) {
      if (!decision.silent) {
        void this.dependencies.transport
          .sendText(message.chatId, `无法处理此请求。请求编号：${requestId}`, message.messageId)
          .catch(() => undefined);
      }
      this.dependencies.logger.warn("inbound_denied", { requestId, reason: decision.reason });
      return;
    }
    if (message.text.length > this.dependencies.config.service.maximumMessageCharacters) {
      void this.dependencies.transport
        .sendText(
          message.chatId,
          `消息过长，未处理。请缩短至最多 ${this.dependencies.config.service.maximumMessageCharacters} 个字符后重试。\n请求编号：${requestId}`,
          message.messageId,
        )
        .catch(() => undefined);
      return;
    }

    const timestamp = this.dependencies.clock.now().toISOString();
    const claimed = this.dependencies.database.claimInboundEvent({
      eventId: message.eventId,
      messageId: message.messageId,
      conversationKey: decision.actor.conversationKey,
      actorHash: decision.actor.actorHash,
      receivedAt: timestamp,
    });
    if (!claimed) return;

    const acknowledgment = this.dependencies.transport
      .sendText(message.chatId, `请求已接收，正在排队…\n请求编号：${requestId}`, message.messageId)
      .catch(() => undefined);
    const task = this.capacity
      .run(async () => {
        await acknowledgment;
        return this.process(message, decision.actor);
      })
      .catch(async (error) => {
        await acknowledgment;
        return this.handleFailure(message, requestId, error);
      })
      .finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
  }

  private async process(
    message: InboundMessage,
    actor: Extract<ReturnType<AccessPolicy["authorizeInbound"]>, { allowed: true }>["actor"],
  ): Promise<void> {
    const startedAt = this.dependencies.clock.now().toISOString();
    this.dependencies.database.updateInboundEvent(message.eventId, "processing", startedAt);
    await this.dependencies.transport
      .sendText(message.chatId, `正在检查 NAS 状态…\n请求编号：${actor.requestId}`, message.messageId)
      .catch(() => {
        this.dependencies.logger.warn("progress_send_failed", { requestId: actor.requestId });
      });
    const announced = new Set<string>();
    const answer = await this.dependencies.answers.answer({
      actor,
      externalEventId: message.eventId,
      text: message.text,
      isGroup: message.chatType === "group",
      onProgress: async (toolName) => {
        if (announced.has(toolName)) return;
        announced.add(toolName);
        await this.dependencies.transport
          .sendText(
            message.chatId,
            `${progressText(toolName)}\n请求编号：${actor.requestId}`,
            message.messageId,
          )
          .catch(() => {
            this.dependencies.logger.warn("tool_progress_send_failed", {
              requestId: actor.requestId,
              toolName,
            });
          });
      },
    });
    const displayedAnswer = answer.length > 10_000 ? `${answer.slice(0, 10_000)}\n\n（回复已截断）` : answer;
    try {
      await this.dependencies.transport.sendText(
        message.chatId,
        `${displayedAnswer}\n\n请求编号：${actor.requestId}`,
        message.messageId,
      );
    } catch {
      this.dependencies.logger.error("final_reply_failed", { requestId: actor.requestId });
      this.dependencies.database.updateInboundEvent(
        message.eventId,
        "failed",
        this.dependencies.clock.now().toISOString(),
        "reply_failed",
      );
      return;
    }
    this.dependencies.database.updateInboundEvent(
      message.eventId,
      "completed",
      this.dependencies.clock.now().toISOString(),
    );
  }

  private async handleFailure(message: InboundMessage, requestId: string, error: unknown): Promise<void> {
    const errorType = error instanceof CapacityError ? "capacity_exhausted" : "request_failed";
    this.dependencies.logger.error("inbound_processing_failed", { requestId, errorType });
    this.dependencies.database.updateInboundEvent(
      message.eventId,
      "failed",
      this.dependencies.clock.now().toISOString(),
      errorType,
    );
    await this.dependencies.transport
      .sendText(
        message.chatId,
        `${error instanceof CapacityError ? "当前请求较多，请稍后重试。" : "检查未完成，请稍后重试或联系管理员。"}\n请求编号：${requestId}`,
        message.messageId,
      )
      .catch(() => undefined);
  }

  async stopAcceptingAndDrain(timeoutMs = 20_000): Promise<boolean> {
    this.accepting = false;
    const drained = Promise.allSettled([...this.inFlight]).then(() => true);
    const timedOut = new Promise<false>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });
    return Promise.race([drained, timedOut]);
  }
}

function progressText(toolName: string): string {
  const labels: Record<string, string> = {
    get_nas_overview: "正在检查系统负载与内存…",
    get_wifi_status: "正在检查 Wi-Fi 连接…",
    get_disk_status: "正在检查磁盘容量…",
    get_docker_status: "正在检查容器状态…",
    get_recent_alerts: "正在读取近期告警…",
  };
  return labels[toolName] ?? "正在检查受控工具状态…";
}
