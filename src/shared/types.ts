export type Role = "viewer" | "operator" | "admin";

export type RiskLevel = "read_only" | "recoverable" | "high_risk";

export interface ActorContext {
  actorHash: string;
  chatHash: string;
  conversationKey: string;
  requestId: string;
  role: Role;
}

export type ToolStatus =
  | "ok"
  | "partial"
  | "unavailable"
  | "timeout"
  | "permission_denied"
  | "malformed_output"
  | "internal_error";

export interface ToolEnvelope<T> {
  schemaVersion: 1;
  status: ToolStatus;
  observedAt: string;
  durationMs: number;
  data: T;
  warnings: string[];
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface IdGenerator {
  next(): string;
}
