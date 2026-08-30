import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPiSessionRepository } from "../../src/storage/pi-sessions.js";
import { createTemporaryDirectory } from "../utils/database.js";

describe("Pi SQLite session backend", () => {
  it("persists a conversation transcript across repository reopen", async () => {
    const temporary = await createTemporaryDirectory();
    const path = join(temporary.path, "pi.sqlite");
    const first = createPiSessionRepository(path);
    const session = await first.create({ id: "pi-session-1", cwd: "wayfinder" });
    await session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    await first.close();

    const second = createPiSessionRepository(path);
    try {
      const metadata = (await second.list({ cwd: "wayfinder" }))[0];
      expect(metadata?.id).toBe("pi-session-1");
      if (!metadata) throw new Error("Expected persisted session metadata");
      const reopened = await second.open(metadata);
      const entries = await reopened.findEntries({ type: "message", order: "oldestFirst" });
      expect(entries).toHaveLength(1);
    } finally {
      await second.close();
      await temporary.remove();
    }
  });
});
