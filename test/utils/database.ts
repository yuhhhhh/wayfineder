import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../src/config/index.js";
import type { IdGenerator } from "../../src/shared/types.js";
import { WayfinderDatabase } from "../../src/storage/database.js";

export async function createTemporaryDirectory(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "wayfinder-test-"));
  return {
    path,
    remove: () => rm(path, { recursive: true, force: true }),
  };
}

export async function createTemporaryDatabase(ids: IdGenerator) {
  const directory = await createTemporaryDirectory();
  const path = join(directory.path, "wayfinder.sqlite");
  const database = await WayfinderDatabase.open(path, ids);
  const config = {
    tools: {
      wifiInterface: "wlp2s0",
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 64_000,
      maximumConcurrentCommands: 2,
    },
  } as AppConfig;
  return {
    path,
    database,
    config,
    remove: directory.remove,
    async close() {
      database.close();
      await directory.remove();
    },
  };
}
