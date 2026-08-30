import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { IdGenerator } from "../../src/shared/types.js";
import { WayfinderDatabase } from "../../src/storage/database.js";
import { createTemporaryDatabase } from "../utils/database.js";

const ids: IdGenerator = (() => {
  let value = 0;
  return { next: () => `id-${++value}` };
})();

describe("Wayfinder SQLite storage", () => {
  it("atomically deduplicates inbound events", async () => {
    const temporary = await createTemporaryDatabase(ids);
    try {
      const input = {
        eventId: "event-1",
        messageId: "message-1",
        conversationKey: "dm:hash",
        actorHash: "actor-hash",
        receivedAt: "2026-08-30T00:00:00.000Z",
      };
      expect(temporary.database.claimInboundEvent(input)).toBe(true);
      expect(temporary.database.claimInboundEvent(input)).toBe(false);
    } finally {
      await temporary.close();
    }
  });

  it("marks unfinished audits interrupted when the service reopens", async () => {
    const temporary = await createTemporaryDatabase(ids);
    const auditId = temporary.database.startAudit({
      requestId: "request-1",
      actorHash: "actor-hash",
      conversationKey: "dm:hash",
      toolName: "get_nas_overview",
      parameterSummary: "{}",
      startedAt: "2026-08-30T00:00:00.000Z",
    });
    temporary.database.close();
    const reopened = await WayfinderDatabase.open(temporary.path, ids);
    reopened.close();
    const raw = new DatabaseSync(temporary.path, { readOnly: true });
    try {
      const row = raw.prepare("SELECT status, error_type FROM audit_events WHERE id = ?").get(auditId);
      expect(row).toEqual({ status: "interrupted", error_type: "process_interrupted" });
    } finally {
      raw.close();
      await temporary.remove();
    }
  });

  it("marks both received and processing inbound events failed when the service reopens", async () => {
    const temporary = await createTemporaryDatabase(ids);
    temporary.database.claimInboundEvent({
      eventId: "event-received",
      messageId: "message-received",
      conversationKey: "dm:hash",
      actorHash: "actor-hash",
      receivedAt: "2026-08-30T00:00:00.000Z",
    });
    temporary.database.claimInboundEvent({
      eventId: "event-processing",
      messageId: "message-processing",
      conversationKey: "dm:hash",
      actorHash: "actor-hash",
      receivedAt: "2026-08-30T00:00:00.000Z",
    });
    temporary.database.updateInboundEvent("event-processing", "processing", "2026-08-30T00:00:01.000Z");
    temporary.database.close();
    const reopened = await WayfinderDatabase.open(temporary.path, ids);
    reopened.close();
    const raw = new DatabaseSync(temporary.path, { readOnly: true });
    try {
      const rows = raw
        .prepare("SELECT event_id, status, error_type FROM inbound_events ORDER BY event_id")
        .all();
      expect(rows).toEqual([
        { event_id: "event-processing", status: "failed", error_type: "process_interrupted" },
        { event_id: "event-received", status: "failed", error_type: "process_interrupted" },
      ]);
    } finally {
      raw.close();
      await temporary.remove();
    }
  });

  it("commits a real settings write for readiness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
    const temporary = await createTemporaryDatabase(ids);
    try {
      expect(temporary.database.healthCheck()).toEqual({ ok: true });
      const raw = new DatabaseSync(temporary.path, { readOnly: true });
      try {
        const row = raw
          .prepare("SELECT key, updated_at FROM settings WHERE key = '__health_probe__'")
          .get() as { key: string; updated_at: string };
        expect(row.key).toBe("__health_probe__");
        vi.advanceTimersByTime(299_999);
        expect(temporary.database.healthCheck()).toEqual({ ok: true });
        const cached = raw
          .prepare("SELECT updated_at FROM settings WHERE key = '__health_probe__'")
          .get() as { updated_at: string };
        expect(cached.updated_at).toBe(row.updated_at);

        vi.advanceTimersByTime(1);
        expect(temporary.database.healthCheck()).toEqual({ ok: true });
        const refreshed = raw
          .prepare("SELECT updated_at FROM settings WHERE key = '__health_probe__'")
          .get() as { updated_at: string };
        expect(refreshed.updated_at).toBe("2026-08-30T00:05:00.000Z");
      } finally {
        raw.close();
      }
    } finally {
      await temporary.close();
      vi.useRealTimers();
    }
  });

  it("refuses to open a database created by a newer application schema", async () => {
    const temporary = await createTemporaryDatabase(ids);
    temporary.database.close();
    const raw = new DatabaseSync(temporary.path);
    raw
      .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (999, 'future', ?)")
      .run("2026-08-30T00:00:00.000Z");
    raw.close();
    try {
      await expect(WayfinderDatabase.open(temporary.path, ids)).rejects.toThrow("newer");
    } finally {
      await temporary.remove();
    }
  });
});
