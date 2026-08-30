import { access, mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { err, FileError, ok } from "@earendil-works/pi-agent-core";
import {
  createNodeSqliteFactory,
  SqliteSessionRepository,
} from "@earendil-works/pi-session-backend-sqlite-node";

export function createPiSessionRepository(databasePath: string): SqliteSessionRepository {
  return new SqliteSessionRepository({
    databasePath,
    sqlite: createNodeSqliteFactory(),
    env: {
      absolutePath: async (path) => ok(isAbsolute(path) ? path : resolve(path)),
      createDir: async (path, options) => {
        try {
          await mkdir(path, { recursive: options?.recursive ?? true, mode: 0o700 });
          return ok(undefined);
        } catch (error) {
          return err(new FileError("unknown", "Unable to create Pi session directory", path, asError(error)));
        }
      },
      exists: async (path) => {
        try {
          await access(path);
          return ok(true);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return ok(false);
          return err(new FileError("unknown", "Unable to inspect Pi session path", path, asError(error)));
        }
      },
    },
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unknown filesystem error");
}
