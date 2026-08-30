import type { AppConfig } from "../config/index.js";
import type { InboundMessage } from "../lark/types.js";
import { hashIdentifier } from "../shared/ids.js";
import type { ActorContext, RiskLevel, Role } from "../shared/types.js";

export type InboundDenialReason =
  | "unknown_user"
  | "group_not_allowed"
  | "mention_required"
  | "malformed_identity";

export type InboundDecision =
  | { allowed: true; actor: ActorContext }
  | { allowed: false; reason: InboundDenialReason; silent: boolean };

export type ToolDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "unknown_tool" | "insufficient_role" | "approval_required" | "high_risk_disabled";
    };

const roleRank: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export class AccessPolicy {
  constructor(private readonly lark: AppConfig["lark"]) {}

  authorizeInbound(message: InboundMessage, requestId: string): InboundDecision {
    if (
      !message.senderOpenId ||
      !message.chatId ||
      (message.chatType !== "p2p" && message.chatType !== "group")
    ) {
      return { allowed: false, reason: "malformed_identity", silent: true };
    }
    const role = this.lark.userRoles.get(message.senderOpenId);
    if (!role) return { allowed: false, reason: "unknown_user", silent: false };
    if (message.chatType === "group") {
      if (!this.lark.allowedChatIds.has(message.chatId)) {
        return { allowed: false, reason: "group_not_allowed", silent: true };
      }
      if (!message.mentionedBot) return { allowed: false, reason: "mention_required", silent: true };
    }

    return {
      allowed: true,
      actor: {
        actorHash: hashIdentifier(message.senderOpenId),
        chatHash: hashIdentifier(message.chatId),
        conversationKey: buildConversationKey(message),
        requestId,
        role,
      },
    };
  }

  authorizeTool(role: Role, tool: { risk: RiskLevel } | undefined): ToolDecision {
    if (!tool) return { allowed: false, reason: "unknown_tool" };
    if (tool.risk === "read_only") {
      return roleRank[role] >= roleRank.viewer
        ? { allowed: true }
        : { allowed: false, reason: "insufficient_role" };
    }
    if (tool.risk === "recoverable") {
      return roleRank[role] >= roleRank.operator
        ? { allowed: false, reason: "approval_required" }
        : { allowed: false, reason: "insufficient_role" };
    }
    return { allowed: false, reason: "high_risk_disabled" };
  }
}

export function buildConversationKey(
  message: Pick<InboundMessage, "chatType" | "chatId" | "senderOpenId">,
): string {
  if (message.chatType === "p2p") {
    return `dm:${hashIdentifier(`${message.senderOpenId}\0${message.chatId}`)}`;
  }
  return `group:${hashIdentifier(message.chatId)}`;
}
