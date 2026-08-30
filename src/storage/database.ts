import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IdGenerator } from "../shared/types.js";
import { migrations } from "./migrations.js";

export type AuditStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "denied"
  | "timed_out"
  | "cancelled"
  | "interrupted";

export interface StartAuditInput {
  requestId: string;
  externalEventId?: string;
  actorHash: string;
  conversationKey: string;
  toolName: string;
  parameterSummary: string;
  approvalId?: string;
  startedAt: string;
}

export interface AlertRecord {
  id: string;
  severity: "info" | "warning" | "critical";
  status: "firing" | "resolved" | "acknowledged";
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

interface SessionRow {
  id: string;
  conversation_key: string;
  pi_session_id: string;
  chat_hash: string;
  summary: string | null;
  last_active_at: string;
}

interface AlertRow {
  id: string;
  severity: AlertRecord["severity"];
  status: AlertRecord["status"];
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export class WayfinderDatabase {
  private lastSuccessfulWriteProbeAt = 0;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
  ) {}

  static async open(path: string, ids: IdGenerator): Promise<WayfinderDatabase> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const database = new DatabaseSync(path);
    try {
      database.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 1000;",
      );
      const instance = new WayfinderDatabase(database, ids);
      instance.applyMigrations();
      instance.recoverInterruptedWork(new Date().toISOString());
      await chmod(path, 0o600).catch(() => undefined);
      return instance;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private applyMigrations(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const appliedRows = this.database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as unknown as Array<{ version: number; name: string }>;
    for (const [index, migration] of migrations.entries()) {
      if (migration.version !== index + 1) throw new Error("Application migrations must be contiguous");
    }
    for (const [index, applied] of appliedRows.entries()) {
      const expected = migrations[index];
      if (!expected) throw new Error("Database schema is newer than this Wayfinder version");
      if (expected.version !== Number(applied.version) || expected.name !== applied.name) {
        throw new Error("Database migration history does not match this build");
      }
    }
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(migration.sql);
        this.database
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, new Date().toISOString());
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private recoverInterruptedWork(timestamp: string): void {
    this.database
      .prepare(
        `UPDATE audit_events
         SET status = 'interrupted', error_type = 'process_interrupted', ended_at = ?
         WHERE status = 'started'`,
      )
      .run(timestamp);
    this.database
      .prepare(
        `UPDATE jobs
         SET status = 'interrupted', error_type = 'process_interrupted', ended_at = ?
         WHERE status = 'running'`,
      )
      .run(timestamp);
    this.database
      .prepare(
        `UPDATE inbound_events
         SET status = 'failed', error_type = 'process_interrupted', updated_at = ?
         WHERE status IN ('received', 'processing')`,
      )
      .run(timestamp);
  }

  claimInboundEvent(input: {
    eventId: string;
    messageId: string;
    conversationKey: string;
    actorHash: string;
    receivedAt: string;
  }): boolean {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO inbound_events(
          event_id, message_id, conversation_key, actor_hash, status, received_at, updated_at
        ) VALUES (?, ?, ?, ?, 'received', ?, ?)`,
      )
      .run(
        input.eventId,
        input.messageId,
        input.conversationKey,
        input.actorHash,
        input.receivedAt,
        input.receivedAt,
      );
    return Number(result.changes) === 1;
  }

  updateInboundEvent(
    eventId: string,
    status: "processing" | "completed" | "failed",
    timestamp: string,
    errorType?: string,
  ): void {
    this.database
      .prepare("UPDATE inbound_events SET status = ?, updated_at = ?, error_type = ? WHERE event_id = ?")
      .run(status, timestamp, errorType ?? null, eventId);
  }

  getSession(conversationKey: string): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT id, conversation_key, pi_session_id, chat_hash, summary, last_active_at
         FROM sessions WHERE conversation_key = ?`,
      )
      .get(conversationKey) as SessionRow | undefined;
  }

  createSession(input: {
    conversationKey: string;
    piSessionId: string;
    chatHash: string;
    timestamp: string;
  }): SessionRow {
    const id = this.ids.next();
    this.database
      .prepare(
        `INSERT INTO sessions(id, conversation_key, pi_session_id, chat_hash, last_active_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.conversationKey, input.piSessionId, input.chatHash, input.timestamp);
    const row = this.getSession(input.conversationKey);
    if (!row) throw new Error("Session mapping was not created");
    return row;
  }

  touchSession(conversationKey: string, timestamp: string): void {
    this.database
      .prepare("UPDATE sessions SET last_active_at = ? WHERE conversation_key = ?")
      .run(timestamp, conversationKey);
  }

  startAudit(input: StartAuditInput): string {
    const id = this.ids.next();
    this.database
      .prepare(
        `INSERT INTO audit_events(
          id, request_id, external_event_id, actor_hash, conversation_key, tool_name,
          parameter_summary, approval_id, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
      )
      .run(
        id,
        input.requestId,
        input.externalEventId ?? null,
        input.actorHash,
        input.conversationKey,
        input.toolName,
        input.parameterSummary,
        input.approvalId ?? null,
        input.startedAt,
      );
    return id;
  }

  finishAudit(
    id: string,
    status: Exclude<AuditStatus, "started">,
    endedAt: string,
    resultSummary?: string,
    errorType?: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE audit_events
         SET status = ?, ended_at = ?, result_summary = ?, error_type = ?
         WHERE id = ? AND status = 'started'`,
      )
      .run(status, endedAt, resultSummary ?? null, errorType ?? null, id);
    if (Number(result.changes) !== 1) throw new Error("Audit event was not in the started state");
  }

  recordDeniedTool(input: StartAuditInput, errorType: string): void {
    const id = this.startAudit(input);
    this.finishAudit(id, "denied", input.startedAt, undefined, errorType);
  }

  getRecentAlerts(limit = 20): AlertRecord[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT id, severity, status, title, summary, created_at, updated_at, resolved_at
         FROM alerts ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(safeLimit) as unknown as AlertRow[];
    return rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      status: row.status,
      title: row.title.slice(0, 160),
      summary: row.summary.slice(0, 500),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    }));
  }

  healthCheck(): { ok: true } | { ok: false; reason: "database_unavailable" } {
    try {
      this.database.prepare("SELECT 1").get();
      const now = Date.now();
      if (now - this.lastSuccessfulWriteProbeAt < 300_000) return { ok: true };
      this.database.exec("BEGIN IMMEDIATE");
      const timestamp = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO settings(key, value_json, updated_at) VALUES ('__health_probe__', '{}', ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(timestamp);
      this.database.exec("COMMIT");
      this.lastSuccessfulWriteProbeAt = now;
      return { ok: true };
    } catch {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The original health failure is the only externally observable fact.
      }
      return { ok: false, reason: "database_unavailable" };
    }
  }

  close(): void {
    this.database.close();
  }
}
