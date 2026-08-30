import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { BoundedSemaphore } from "../../shared/concurrency.js";

export interface FixedCommand {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maximumOutputBytes: number;
}

export type ProcessFailureType =
  | "aborted"
  | "timeout"
  | "output_limit"
  | "not_found"
  | "permission_denied"
  | "nonzero_exit"
  | "spawn_error";

export type ProcessResult =
  | { ok: true; stdout: string; durationMs: number; exitCode: 0 }
  | { ok: false; errorType: ProcessFailureType; durationMs: number; exitCode?: number };

export interface ProcessRunner {
  run(command: FixedCommand, signal?: AbortSignal): Promise<ProcessResult>;
}

const MINIMAL_ENVIRONMENT = {
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
};

export class SpawnProcessRunner implements ProcessRunner {
  private readonly semaphore: BoundedSemaphore;

  constructor(maximumConcurrentCommands: number, maximumQueuedCommands = 32) {
    this.semaphore = new BoundedSemaphore(maximumConcurrentCommands, maximumQueuedCommands);
  }

  run(command: FixedCommand, signal?: AbortSignal): Promise<ProcessResult> {
    return this.semaphore.run(() => this.runUnbounded(command, signal));
  }

  private runUnbounded(command: FixedCommand, signal?: AbortSignal): Promise<ProcessResult> {
    if (!isAbsolute(command.executable)) {
      return Promise.resolve({ ok: false, errorType: "spawn_error", durationMs: 0 });
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      let settled = false;
      let capturedBytes = 0;
      let requestedFailure: ProcessFailureType | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let hardStopTimer: NodeJS.Timeout | undefined;
      const stdoutChunks: Buffer[] = [];
      const child = spawn(command.executable, [...command.args], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: MINIMAL_ENVIRONMENT,
      });

      const finish = (
        result:
          | Omit<Extract<ProcessResult, { ok: false }>, "durationMs">
          | { ok: true; stdout: string; exitCode: 0 },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (hardStopTimer) clearTimeout(hardStopTimer);
        signal?.removeEventListener("abort", abort);
        resolve({ ...result, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      };
      const stop = (errorType: ProcessFailureType) => {
        if (settled || requestedFailure) return;
        requestedFailure = errorType;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
          hardStopTimer = setTimeout(() => finish({ ok: false, errorType }), 500);
          hardStopTimer.unref();
        }, 500);
        forceKillTimer.unref();
      };
      const capture = (chunk: Buffer, include: boolean) => {
        capturedBytes += chunk.byteLength;
        if (capturedBytes > command.maximumOutputBytes) {
          stop("output_limit");
          return;
        }
        if (include) stdoutChunks.push(chunk);
      };
      const abort = () => stop("aborted");
      const timer = setTimeout(() => stop("timeout"), command.timeoutMs);
      timer.unref();

      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (requestedFailure) {
          finish({ ok: false, errorType: requestedFailure });
          return;
        }
        if (error.code === "ENOENT") finish({ ok: false, errorType: "not_found" });
        else if (error.code === "EACCES") finish({ ok: false, errorType: "permission_denied" });
        else finish({ ok: false, errorType: "spawn_error" });
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        if (requestedFailure) {
          finish({ ok: false, errorType: requestedFailure });
          return;
        }
        if (exitCode !== 0) {
          finish({ ok: false, errorType: "nonzero_exit", ...(exitCode === null ? {} : { exitCode }) });
          return;
        }
        finish({ ok: true, stdout: Buffer.concat(stdoutChunks).toString("utf8"), exitCode: 0 });
      });
    });
  }
}
